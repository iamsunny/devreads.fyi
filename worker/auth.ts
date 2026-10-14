import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './auth-schema.ts';

export interface AuthEnv {
  AUTH_DB?: D1Database;
  AUTH_ENABLED?: string;
  AUTH_MODE?: string;
  AUTH_BASE_URL?: string;
  AUTH_PROVIDERS?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string; LINKEDIN_CLIENT_SECRET?: string;
  AUTH_RATE_LIMITER?: RateLimit;
  FAVORITES_RATE_LIMITER?: RateLimit;
}
export const PROVIDERS = ['google', 'github', 'linkedin'] as const;
export function baseURL(env: AuthEnv) { return env.AUTH_BASE_URL || 'https://devreads.fyi'; }
export function trustedOrigins(env: AuthEnv) {
  return env.AUTH_MODE === 'local' || env.AUTH_MODE === 'staging' ? [new URL(baseURL(env)).origin] : ['https://devreads.fyi', 'https://www.devreads.fyi'];
}
export function enabledProviders(env: AuthEnv) {
  const selected = (env.AUTH_PROVIDERS || '').split(',');
  return PROVIDERS.filter(provider => {
    const name = provider.toUpperCase() as 'GOOGLE' | 'GITHUB' | 'LINKEDIN';
    return selected.includes(provider) && !!env[`${name}_CLIENT_ID`] && !!env[`${name}_CLIENT_SECRET`];
  });
}
export function authAvailable(env: AuthEnv) {
  return env.AUTH_ENABLED === 'true' && !!env.AUTH_DB && (env.BETTER_AUTH_SECRET?.length || 0) >= 32 && enabledProviders(env).length > 0;
}
export function authHostAllowed(request: Request, env: AuthEnv) { return new URL(request.url).origin === new URL(baseURL(env)).origin; }

// Providers can omit an email. This internal address is never a contact address.
export function mapIdentity(provider: string, value: object) {
  const profile = value as Record<string, unknown>;
  const email = typeof profile.email === 'string' && profile.email ? profile.email : `${encodeURIComponent(String(profile.sub ?? profile.id))}@${provider}.placeholder.invalid`;
  const verified = !email.endsWith('.invalid') && (profile.email_verified === true || profile.emailVerified === true || profile.verified === true);
  return { email, emailVerified: verified };
}

export function createAuth(env: AuthEnv) {
  if (!env.AUTH_DB || !env.BETTER_AUTH_SECRET) throw new Error('Authentication storage is not configured');
  const enabled = enabledProviders(env);
  return betterAuth({
    appName: 'devreads.fyi', baseURL: baseURL(env), basePath: '/api/auth', secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.AUTH_DB, { schema }), { provider: 'sqlite', schema }),
    trustedOrigins: trustedOrigins(env),
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(enabled.includes('google') ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, scope: ['openid', 'email', 'profile'], prompt: 'select_account', mapProfileToUser: (profile: object) => mapIdentity('google', profile) } } : {}),
      ...(enabled.includes('github') ? { github: { clientId: env.GITHUB_CLIENT_ID!, clientSecret: env.GITHUB_CLIENT_SECRET!, scope: ['read:user', 'user:email'], mapProfileToUser: (profile: object) => (profile as { email?: string }).email ? {} : mapIdentity('github', profile) } } : {}),
      ...(enabled.includes('linkedin') ? { linkedin: { clientId: env.LINKEDIN_CLIENT_ID!, clientSecret: env.LINKEDIN_CLIENT_SECRET!, scope: ['openid', 'profile', 'email'], mapProfileToUser: (profile: object) => mapIdentity('linkedin', profile) } } : {}),
    },
    session: { expiresIn: 30 * 86400, updateAge: 86400, freshAge: 300, cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: true, trustedProviders: [], requireLocalEmailVerified: true, allowDifferentEmails: true } },
    user: { deleteUser: { enabled: true } },
    advanced: { cookiePrefix: 'devreads', useSecureCookies: new URL(baseURL(env)).protocol === 'https:' },
    // The Worker applies native edge rate limits, not isolate-local memory counters.
    rateLimit: { enabled: false },
    databaseHooks: {
      session: { create: { before: async value => ({ data: { ...value, ipAddress: null, userAgent: null } }) } },
    },
  });
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export function allowedBrowserRequest(request: Request, env: AuthEnv, mutation: boolean) {
  const origin = request.headers.get('Origin');
  if (origin && !trustedOrigins(env).includes(origin)) return false;
  if (mutation && !origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return origin ? site !== 'cross-site' || trustedOrigins(env).includes(origin) : site === 'same-origin';
}
export function withCors(response: Response, request: Request, env: AuthEnv) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store'); headers.append('Vary', 'Origin');
  const origin = request.headers.get('Origin');
  if (origin && trustedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export async function authEndpoint(request: Request, env: AuthEnv) {
  if (!authHostAllowed(request, env)) return json({ error: 'Not found' }, 404);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/api/auth/config') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    return json({ enabled: authAvailable(env), providers: authAvailable(env) ? enabledProviders(env) : [], baseURL: baseURL(env) });
  }
  const callback = path.startsWith('/api/auth/callback/');
  const allowedPath = callback || ['/api/auth/get-session', '/api/auth/list-accounts', '/api/auth/sign-in/social', '/api/auth/sign-out', '/api/auth/link-social', '/api/auth/unlink-account', '/api/auth/delete-user', '/api/auth/error'].includes(path);
  // Login-only integration: provider-token, password and email-change APIs stay closed.
  if (!allowedPath) return json({ error: 'Not found' }, 404);
  if (!callback && !allowedBrowserRequest(request, env, request.method !== 'GET')) return json({ error: 'Origin not allowed' }, 403);
  if (!authAvailable(env)) return json({ error: 'Account sync is not configured yet' }, 503);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  if (request.method === 'POST') {
    if (env.AUTH_MODE === 'production' && !env.AUTH_RATE_LIMITER) return json({ error: 'Authentication is temporarily unavailable' }, 503);
    if (env.AUTH_RATE_LIMITER && !(await env.AUTH_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return json({ error: 'Too many requests. Try again shortly.' }, 429);
    if (['/api/auth/link-social', '/api/auth/unlink-account', '/api/auth/delete-user'].includes(path)) {
      const current = await createAuth(env).api.getSession({ headers: request.headers });
      if (!current) return json({ error: 'Please sign in again' }, 401);
      if (Date.now() - new Date(current.session.createdAt).getTime() > 300000) return json({ error: 'Please sign in again before changing your account', code: 'SESSION_NOT_FRESH' }, 403);
    }
  }
  return createAuth(env).handler(request);
}
