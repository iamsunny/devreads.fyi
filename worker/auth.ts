import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthEnv {
  AUTH_DB?: D1Database;
  AUTH_ENABLED?: string; AUTH_MODE?: string; AUTH_BASE_URL?: string;
  FIREBASE_PROJECT_ID?: string; FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string; FIREBASE_APP_ID?: string;
  AUTH_RATE_LIMITER?: RateLimit; FAVORITES_RATE_LIMITER?: RateLimit;
}
export class AuthError extends Error {
  status: number; code: string;
  constructor(message: string, status = 401, code = 'SIGN_IN_REQUIRED') { super(message); this.status = status; this.code = code; }
}
export const PROVIDERS = ['google'] as const;
export function baseURL(env: AuthEnv) { return env.AUTH_BASE_URL || 'https://devreads.fyi'; }
export function trustedOrigins(env: AuthEnv) {
  return ['local', 'staging'].includes(env.AUTH_MODE || '') ? [new URL(baseURL(env)).origin] : ['https://devreads.fyi', 'https://www.devreads.fyi'];
}
export function firebaseConfig(env: AuthEnv) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(env.FIREBASE_PROJECT_ID || '') || !env.FIREBASE_API_KEY || !env.FIREBASE_APP_ID || !/^[a-z0-9.-]+$/.test(env.FIREBASE_AUTH_DOMAIN || '')) return null;
  return { projectId: env.FIREBASE_PROJECT_ID!, apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, appId: env.FIREBASE_APP_ID };
}
export function authAvailable(env: AuthEnv) { return env.AUTH_ENABLED === 'true' && !!env.AUTH_DB && !!firebaseConfig(env); }
export function authHostAllowed(request: Request, env: AuthEnv) { return new URL(request.url).origin === new URL(baseURL(env)).origin; }
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export function allowedBrowserRequest(request: Request, env: AuthEnv, mutation: boolean) {
  const origin = request.headers.get('Origin');
  if (origin && !trustedOrigins(env).includes(origin)) return false;
  if (mutation && !origin) return false;
  return origin ? true : request.headers.get('Sec-Fetch-Site') === 'same-origin';
}
export function withCors(response: Response, request: Request, env: AuthEnv) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store'); headers.append('Vary', 'Origin');
  const origin = request.headers.get('Origin');
  if (origin && trustedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Devreads-User');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'), { timeoutDuration: 8000 });
export function bearerToken(request: Request) {
  const value = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!value || value.length > 20000) throw new AuthError('Please sign in with Google');
  return value;
}
interface FirebaseClaims extends JWTPayload { auth_time: number; email: string; email_verified: boolean; firebase: { sign_in_provider: string } }
export async function verifyFirebaseToken(token: string, env: AuthEnv): Promise<FirebaseClaims> {
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(token, googleKeys, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID, algorithms: ['RS256'], requiredClaims: ['sub', 'iat', 'exp', 'auth_time'],
    }));
  } catch (error) {
    if (error instanceof TypeError || (error as {code?: string}).code === 'ERR_JWKS_TIMEOUT') throw new AuthError('Google sign-in is temporarily unavailable', 503, 'AUTH_UNAVAILABLE');
    throw new AuthError('Please sign in with Google again');
  }
  const now = Math.floor(Date.now() / 1000);
  const firebase = claims.firebase as { sign_in_provider?: string } | undefined;
  const authTime = claims.auth_time as number;
  const validTimes = Number.isInteger(claims.iat) && claims.iat! > 0 && claims.iat! <= now
    && Number.isInteger(authTime) && authTime > 0 && authTime <= claims.iat!
    && claims.exp! > claims.iat! && claims.exp! - claims.iat! <= 3600;
  const validIdentity = claims.sub && claims.sub.length <= 128 && firebase?.sign_in_provider === 'google.com'
    && claims.email_verified === true && typeof claims.email === 'string' && claims.email.length > 0 && claims.email.length <= 320;
  if (!validTimes || !validIdentity) throw new AuthError('A verified Google account is required');
  return claims as FirebaseClaims;
}
interface FirebaseAccount { localId: string; email: string; emailVerified: boolean; displayName?: string; photoUrl?: string; validSince?: string; disabled?: boolean; providerUserInfo?: {providerId: string}[] }
const accounts = new Map<string, { expires: number; account: FirebaseAccount }>();
async function tokenKey(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
async function firebaseREST(method: 'lookup' | 'delete', token: string, env: AuthEnv) {
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(env.FIREBASE_API_KEY!)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({idToken: token}), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new AuthError('Google sign-in is temporarily unavailable. Try again.', 503, 'AUTH_UNAVAILABLE'); }
  const data = await response.json() as {users?: FirebaseAccount[]; error?: {message?: string}};
  if (!response.ok) {
    const reason = data.error?.message?.split(' : ')[0];
    if (method === 'delete' && reason === 'USER_NOT_FOUND') return data;
    if (reason === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') throw new AuthError('Sign in with Google again before deleting your account', 403, 'SESSION_NOT_FRESH');
    if (['INVALID_ID_TOKEN', 'TOKEN_EXPIRED', 'USER_NOT_FOUND', 'USER_DISABLED'].includes(reason || '')) throw new AuthError('Please sign in with Google again');
    throw new AuthError('Google sign-in is temporarily unavailable. Try again.', 503, 'AUTH_UNAVAILABLE');
  }
  return data;
}
async function activeAccount(token: string, claims: FirebaseClaims, env: AuthEnv) {
  const key = await tokenKey(token); const cached = accounts.get(key);
  let account = cached && cached.expires > Date.now() ? cached.account : undefined;
  if (!account) {
    account = (await firebaseREST('lookup', token, env)).users?.[0];
    if (!account) throw new AuthError('Please sign in with Google again');
    if (accounts.size >= 512) accounts.delete(accounts.keys().next().value!);
    accounts.set(key, {account, expires: Date.now() + 60000});
  }
  if (account.localId !== claims.sub || account.disabled || account.emailVerified !== true || account.email !== claims.email || !account.providerUserInfo?.some(provider => provider.providerId === 'google.com') || (account.validSince && (!Number.isFinite(Number(account.validSince)) || claims.auth_time < Number(account.validSince)))) throw new AuthError('Please sign in with Google again');
  return account;
}
interface AppUser { id: string; name: string; email: string; emailVerified: number; image: string | null }
async function identityUserId(claims: FirebaseClaims, env: AuthEnv) {
  return (await env.AUTH_DB!.prepare('SELECT userId FROM firebase_identity WHERE projectId = ? AND uid = ?').bind(env.FIREBASE_PROJECT_ID, claims.sub).first<{userId: string}>())?.userId;
}
export async function getCurrentUser(request: Request, env: AuthEnv) {
  if (!request.headers.has('Authorization')) return null;
  const token = bearerToken(request); const claims = await verifyFirebaseToken(token, env); const db = env.AUTH_DB!;
  if (await db.prepare('SELECT 1 FROM firebase_deleted_user WHERE projectId = ? AND uid = ? AND expiresAt > ?').bind(env.FIREBASE_PROJECT_ID, claims.sub, Date.now()).first()) throw new AuthError('This account has been deleted');
  const account = await activeAccount(token, claims, env);
  const name = (account.displayName || 'Reader').slice(0, 256);
  const image = account.photoUrl?.startsWith('https://') && account.photoUrl.length <= 2048 ? account.photoUrl : null;
  let userId = await identityUserId(claims, env);
  if (!userId) {
    userId = 'fb_' + await tokenKey(`${env.FIREBASE_PROJECT_ID}\0${claims.sub}`);
    const now = Date.now();
    try {
      await db.batch([
        db.prepare('INSERT INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES (?,?,?,1,?,?,?) ON CONFLICT(id) DO NOTHING').bind(userId, name, account.email, image, now, now),
        db.prepare('INSERT INTO firebase_identity (projectId,uid,userId) VALUES (?,?,?) ON CONFLICT(projectId,uid) DO NOTHING').bind(env.FIREBASE_PROJECT_ID, claims.sub, userId),
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: user.email')) throw new AuthError('This account needs a migration before it can sign in. Please contact the site owner.', 409, 'ACCOUNT_MIGRATION_REQUIRED');
      throw error;
    }
    userId = (await identityUserId(claims, env))!;
  }
  const user = await db.prepare('SELECT id,name,email,emailVerified,image FROM user WHERE id = ?').bind(userId).first<AppUser>();
  if (!user) throw new AuthError('Please sign in again');
  if (user.name !== name || user.email !== account.email || user.image !== image || !user.emailVerified) {
    await db.prepare('UPDATE user SET name = ?, email = ?, emailVerified = 1, image = ?, updatedAt = ? WHERE id = ?').bind(name, account.email, image, Date.now(), userId).run();
  }
  return { user: {...user, name, email: account.email, emailVerified: true, image}, session: {authTime: claims.auth_time * 1000} };
}
export async function authEndpoint(request: Request, env: AuthEnv) {
  if (!authHostAllowed(request, env)) return json({error: 'Not found'}, 404);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/api/auth/config') {
    if (request.method !== 'GET') return json({error: 'Method not allowed'}, 405);
    const enabled = authAvailable(env);
    return json({enabled, providers: enabled ? PROVIDERS : [], baseURL: baseURL(env), ...(enabled ? {firebase: firebaseConfig(env)} : {})});
  }
  if (!['/api/auth/get-session', '/api/auth/delete-user'].includes(path)) return json({error: 'Not found'}, 404);
  if (!allowedBrowserRequest(request, env, request.method !== 'GET')) return json({error: 'Origin not allowed'}, 403);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204});
  if ((path.endsWith('get-session') && request.method !== 'GET') || (path.endsWith('delete-user') && request.method !== 'POST')) return json({error: 'Method not allowed'}, 405);
  if (!authAvailable(env)) return json({error: 'Google sign-in is not configured yet'}, 503);
  if (path.endsWith('get-session')) return json(await getCurrentUser(request, env));
  if (env.AUTH_MODE === 'production' && !env.AUTH_RATE_LIMITER) return json({error: 'Authentication is temporarily unavailable'}, 503);
  if (env.AUTH_RATE_LIMITER && !(await env.AUTH_RATE_LIMITER.limit({key: request.headers.get('CF-Connecting-IP') || 'local'})).success) return json({error: 'Too many requests. Try again shortly.'}, 429);
  const token = bearerToken(request); const claims = await verifyFirebaseToken(token, env);
  if (Date.now() - claims.auth_time * 1000 > 300000) throw new AuthError('Sign in with Google again before deleting your account', 403, 'SESSION_NOT_FRESH');
  const db = env.AUTH_DB!; const userId = await identityUserId(claims, env);
  await firebaseREST('delete', token, env);
  await db.batch([
    db.prepare('INSERT INTO firebase_deleted_user (projectId,uid,expiresAt) VALUES (?,?,?) ON CONFLICT(projectId,uid) DO UPDATE SET expiresAt=excluded.expiresAt').bind(env.FIREBASE_PROJECT_ID, claims.sub, Date.now() + 7200000),
    db.prepare('DELETE FROM user WHERE id = ?').bind(userId || ''),
  ]);
  accounts.delete(await tokenKey(token));
  return json({success: true});
}
