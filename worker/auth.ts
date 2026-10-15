export interface AuthEnv {
  AUTH_DB?: D1Database;
  AUTH_ENABLED?: string; AUTH_MODE?: string; AUTH_BASE_URL?: string;
  APPWRITE_ENDPOINT?: string; APPWRITE_PROJECT_ID?: string; APPWRITE_API_KEY?: string;
  AUTH_SESSION_SECRET?: string;
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
export function appwriteConfig(env: AuthEnv) {
  try {
    const endpoint = new URL(env.APPWRITE_ENDPOINT || '');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/v1'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(env.APPWRITE_PROJECT_ID || '')) return null;
    return { endpoint: endpoint.href, projectId: env.APPWRITE_PROJECT_ID! };
  } catch { return null; }
}
export function authAvailable(env: AuthEnv) {
  return env.AUTH_ENABLED === 'true' && !!env.AUTH_DB && !!appwriteConfig(env) && !!env.APPWRITE_API_KEY && (env.AUTH_SESSION_SECRET?.length || 0) >= 32;
}
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
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Devreads-User');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const encoder = new TextEncoder();
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
function random() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''); }
function encode(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value: string) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
function scope(env: AuthEnv) { return `${baseURL(env)}\0${env.APPWRITE_ENDPOINT}\0${env.APPWRITE_PROJECT_ID}`; }
async function key(env: AuthEnv) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(env.AUTH_SESSION_SECRET!)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
interface Session { secret: string; uid: string; id: string; userId: string; expiresAt: number; authTime: number }
export async function sealSession(value: Session, env: AuthEnv) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(scope(env))}, await key(env), encoder.encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export function cookieName(env: AuthEnv, state = false) {
  return `${new URL(baseURL(env)).protocol === 'https:' ? '__Host-' : ''}devreads.${state ? 'oauth' : 'session'}`;
}
function cookie(request: Request, name: string) {
  return request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1);
}
function setCookie(env: AuthEnv, value: string, seconds: number, state = false) {
  return `${cookieName(env, state)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}${new URL(baseURL(env)).protocol === 'https:' ? '; Secure' : ''}`;
}
async function readSession(request: Request, env: AuthEnv): Promise<Session | null> {
  const value = cookie(request, cookieName(env));
  if (!value) return null;
  try {
    if (value.length > 3800) throw new Error();
    const [iv, bytes, extra] = value.split('.');
    if (extra || !iv || !bytes) throw new Error();
    const raw = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(iv), additionalData:encoder.encode(scope(env))}, await key(env), decode(bytes));
    const data = JSON.parse(new TextDecoder().decode(raw)) as Session;
    if (!data.secret || !data.uid || !data.id || !data.userId || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()
      || !Number.isSafeInteger(data.authTime) || data.authTime <= 0 || data.authTime > Date.now()) throw new Error();
    return data;
  } catch { throw new AuthError('Please sign in with Google again'); }
}
interface Account { $id: string; name: string; email: string; emailVerification: boolean; status: boolean }
interface RemoteSession { $id: string; $createdAt: string; userId: string; provider: string; expire: string; secret?: string }
class AppwriteError extends AuthError { remoteStatus: number; constructor(status: number) {
  super(status === 401 || status === 404 ? 'Please sign in with Google again' : 'Google sign-in is temporarily unavailable. Try again.', status === 401 || status === 404 ? 401 : 503, status === 401 || status === 404 ? 'SIGN_IN_REQUIRED' : 'AUTH_UNAVAILABLE'); this.remoteStatus = status;
} }
async function appwrite<T>(env: AuthEnv, path: string, method = 'GET', body?: unknown, secret?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(env.APPWRITE_ENDPOINT! + path, {
      method, redirect:'manual', signal:AbortSignal.timeout(8000),
      headers: { 'X-Appwrite-Project':env.APPWRITE_PROJECT_ID!, ...(secret ? {'X-Appwrite-Session':secret} : {'X-Appwrite-Key':env.APPWRITE_API_KEY!}), Accept:'application/json', ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
  } catch { throw new AppwriteError(503); }
  if (!response.ok) throw new AppwriteError(response.status);
  if (response.status === 204) return {} as T;
  try { return await response.json() as T; } catch { throw new AppwriteError(503); }
}
async function validateRemote(env: AuthEnv, session: Pick<Session, 'secret'|'uid'|'id'>) {
  const [account, remote] = await Promise.all([
    appwrite<Account>(env, '/account', 'GET', undefined, session.secret),
    appwrite<RemoteSession>(env, '/account/sessions/current', 'GET', undefined, session.secret),
  ]);
  if (account.$id !== session.uid || account.status !== true || account.emailVerification !== true || typeof account.email !== 'string' || !account.email || account.email.length > 320
    || remote.userId !== session.uid || remote.$id !== session.id || remote.provider !== 'google' || !Number.isFinite(Date.parse(remote.expire)) || Date.parse(remote.expire) <= Date.now()) throw new AuthError('A verified Google account is required');
  return {account, remote};
}
function projectKey(env: AuthEnv) { return `${env.APPWRITE_ENDPOINT}|${env.APPWRITE_PROJECT_ID}`; }
async function pendingDeletion(env: AuthEnv, uid: string) {
  return env.AUTH_DB!.prepare('SELECT uid,userId FROM appwrite_deletion WHERE project = ? AND uid = ?').bind(projectKey(env), uid).first<{uid:string;userId:string}>();
}
async function upsertUser(env: AuthEnv, account: Account) {
  const db = env.AUTH_DB!; const project = projectKey(env);
  if (await pendingDeletion(env, account.$id)) throw new AuthError('Account deletion is still being completed', 409, 'DELETION_PENDING');
  const userId = 'aw_' + await digest(`${project}\0${account.$id}`);
  const name = (account.name || 'Reader').slice(0, 256); const now = Date.now();
  const existing = await db.prepare('SELECT name,email,emailVerified FROM user WHERE id = ?').bind(userId).first<{name:string;email:string;emailVerified:number}>();
  if (existing?.name === name && existing.email === account.email && existing.emailVerified) return {id:userId, name, email:account.email, emailVerified:true, image:null};
  await db.batch([
    db.prepare('INSERT INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) SELECT ?,?,?,1,NULL,?,? WHERE NOT EXISTS (SELECT 1 FROM appwrite_deletion WHERE project = ? AND uid = ?) ON CONFLICT(id) DO NOTHING').bind(userId, name, account.email, now, now, project, account.$id),
    db.prepare('INSERT INTO appwrite_identity (project,uid,userId) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM user WHERE id = ?) ON CONFLICT(project,uid) DO NOTHING').bind(project, account.$id, userId, userId),
    db.prepare('UPDATE user SET name = ?, email = ?, emailVerified = 1, updatedAt = ? WHERE id = ?').bind(name, account.email, now, userId),
  ]);
  if (await pendingDeletion(env, account.$id)) throw new AuthError('This account has been deleted');
  return { id:userId, name, email:account.email, emailVerified:true, image:null };
}
export async function getCurrentUser(request: Request, env: AuthEnv) {
  const session = await readSession(request, env);
  if (!session) return null;
  if (await pendingDeletion(env, session.uid)) throw new AuthError('Account deletion is still being completed', 401, 'DELETION_PENDING');
  const {account} = await validateRemote(env, session);
  const user = await upsertUser(env, account);
  if (user.id !== session.userId) throw new AuthError('Please sign in again');
  return {user, session:{authTime:session.authTime}};
}
export function safeReturn(value: unknown, env: AuthEnv) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/favorites/', baseURL(env));
    if (trustedOrigins(env).includes(url.origin) && !url.username && !url.password && !/^\/(api|signin)(\/|$)/.test(url.pathname)) return url.href;
  } catch {}
  return new URL('/favorites/', baseURL(env)).href;
}
function redirect(url: string, cookies: string[] = []) {
  const headers = new Headers({Location:url, 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer'});
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, {status:303, headers});
}
async function callback(request: Request, env: AuthEnv) {
  const url = new URL(request.url); const state = url.searchParams.get('state');
  const browser = cookie(request, cookieName(env, true));
  // Match the initiating browser before consuming state, so a foreign browser cannot burn a login.
  const failure = () => redirect(new URL('/signin/?error=oauth', baseURL(env)).href, [setCookie(env, '', 0, true)]);
  if (!state || !/^[a-f0-9]{64}$/.test(state) || !browser || !/^[a-f0-9]{64}$/.test(browser)) return failure();
  const transaction = await env.AUTH_DB!.prepare('DELETE FROM appwrite_oauth WHERE state = ? AND browser = ? AND expiresAt > ? RETURNING returnTo,expectedUid,startedAt').bind(await digest(state), await digest(browser), Date.now()).first<{returnTo:string;expectedUid:string|null;startedAt:number}>();
  if (!transaction || url.searchParams.has('error')) return failure();
  const uid = url.searchParams.get('userId'); const token = url.searchParams.get('secret');
  if (!uid || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(uid) || !token || token.length > 10000) return failure();
  let created: RemoteSession | undefined;
  try {
    created = await appwrite<RemoteSession>(env, '/account/sessions/token', 'POST', {userId:uid, secret:token});
    if (!created.secret || created.secret.length > 2048 || created.userId !== uid || created.provider !== 'google') throw new AuthError('Google sign-in could not complete');
    const session = {secret:created.secret, uid, id:created.$id};
    const {account, remote} = await validateRemote(env, session);
    const createdAt = Date.parse(remote.$createdAt);
    if (!Number.isFinite(createdAt) || createdAt < transaction.startedAt - 60000 || createdAt > Date.now() + 60000) throw new AuthError('Please sign in again');
    if (transaction.expectedUid && uid !== transaction.expectedUid) throw new AuthError('Confirm using the same Google account');
    const user = await upsertUser(env, account);
    const expiresAt = Math.min(Date.parse(remote.expire), Date.now() + 30 * 86400000);
    const sealed = await sealSession({...session, userId:user.id, expiresAt, authTime:Date.now()}, env);
    if (sealed.length > 3800) throw new AuthError('Google sign-in could not complete');
    const previous = await readSession(request, env).catch(() => null);
    if (previous && previous.id !== session.id) await appwrite(env, '/account/sessions/current', 'DELETE', undefined, previous.secret).catch(() => {});
    return redirect(safeReturn(transaction.returnTo, env), [setCookie(env, sealed, (expiresAt - Date.now()) / 1000), setCookie(env, '', 0, true)]);
  } catch {
    if (created?.secret) await appwrite(env, '/account/sessions/current', 'DELETE', undefined, created.secret).catch(() => {});
    console.error('appwrite_oauth_failed');
    return failure();
  }
}
async function finishDeletion(env: AuthEnv, job: {uid:string;userId:string}) {
  try { await appwrite(env, '/users/' + encodeURIComponent(job.uid), 'DELETE'); }
  catch (error) { if (!(error instanceof AppwriteError) || error.remoteStatus !== 404) throw error; }
  await env.AUTH_DB!.batch([
    env.AUTH_DB!.prepare('DELETE FROM user WHERE id = ?').bind(job.userId),
    env.AUTH_DB!.prepare('UPDATE appwrite_deletion SET completed = 1 WHERE project = ? AND uid = ?').bind(projectKey(env), job.uid),
  ]);
}
export async function cleanupAppwrite(env: AuthEnv) {
  await env.AUTH_DB!.prepare('DELETE FROM appwrite_oauth WHERE expiresAt < ?').bind(Date.now()).run();
  await env.AUTH_DB!.prepare('DELETE FROM appwrite_deletion WHERE completed = 1 AND createdAt < ?').bind(Date.now() - 31 * 86400000).run();
  if (!appwriteConfig(env) || !env.APPWRITE_API_KEY) return;
  const jobs = await env.AUTH_DB!.prepare('SELECT uid,userId FROM appwrite_deletion WHERE project = ? AND completed = 0 ORDER BY createdAt LIMIT 25').bind(projectKey(env)).all<{uid:string;userId:string}>();
  for (const job of jobs.results) {
    try { await finishDeletion(env, job); } catch { console.error('appwrite_deletion_retry_failed'); }
  }
}
export async function authEndpoint(request: Request, env: AuthEnv) {
  if (!authHostAllowed(request, env)) return json({error:'Not found'}, 404);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/api/auth/config') {
    if (request.method !== 'GET') return json({error:'Method not allowed'}, 405);
    const enabled = authAvailable(env);
    return json({enabled, providers:enabled ? PROVIDERS : [], baseURL:baseURL(env), service:'appwrite'});
  }
  const methods: Record<string,string> = {'/api/auth/get-session':'GET', '/api/auth/sign-in/google':'POST', '/api/auth/confirm-google':'POST', '/api/auth/callback/google':'GET', '/api/auth/sign-out':'POST', '/api/auth/delete-user':'POST'};
  if (!methods[path]) return json({error:'Not found'}, 404);
  if (path !== '/api/auth/callback/google' && !allowedBrowserRequest(request, env, request.method !== 'GET')) return json({error:'Origin not allowed'}, 403);
  if (request.method === 'OPTIONS') return new Response(null, {status:204});
  if (request.method !== methods[path]) return json({error:'Method not allowed'}, 405);
  if (!authAvailable(env)) return json({error:'Google sign-in is not configured yet'}, 503);
  if (path.endsWith('/get-session')) return json(await getCurrentUser(request, env));
  if (env.AUTH_MODE === 'production' && !env.AUTH_RATE_LIMITER) return json({error:'Authentication is temporarily unavailable'}, 503);
  if (env.AUTH_RATE_LIMITER && !(await env.AUTH_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP') || 'local'})).success) return json({error:'Too many requests. Try again shortly.'}, 429);
  if (path.endsWith('/callback/google')) return callback(request, env);
  if (path.endsWith('/sign-in/google') || path.endsWith('/confirm-google')) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'Use application/json'}, 400);
    const reader = request.body?.getReader(); let text = ''; let length = 0;
    if (reader) while (true) { const {value,done} = await reader.read(); if (done) break; length += value.length; if (length > 4096) {await reader.cancel(); return json({error:'Request too large'}, 400);} text += new TextDecoder().decode(value); }
    let body: {returnTo?:string};
    try { body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); } catch {return json({error:'Invalid JSON'}, 400);}
    const expected = path.endsWith('/confirm-google') ? await getCurrentUser(request, env) : null;
    if (path.endsWith('/confirm-google') && !expected) throw new AuthError('Please sign in first');
    const previous = expected ? await readSession(request, env) : null;
    const state = random(); const browser = random(); const now = Date.now();
    await env.AUTH_DB!.prepare('INSERT INTO appwrite_oauth (state,browser,returnTo,expectedUid,startedAt,expiresAt) VALUES (?,?,?,?,?,?)').bind(await digest(state), await digest(browser), expected ? new URL('/account/?confirmed=1', baseURL(env)).href : safeReturn(body.returnTo, env), previous?.uid || null, now, now + 600000).run();
    // Let the browser visit Appwrite first so its own OAuth nonce cookie is set on its host.
    const target = new URL(env.APPWRITE_ENDPOINT! + '/account/tokens/oauth2/google');
    target.searchParams.set('project', env.APPWRITE_PROJECT_ID!);
    target.searchParams.set('success', new URL('/api/auth/callback/google', baseURL(env)).href);
    target.searchParams.set('failure', new URL('/api/auth/callback/google?error=oauth', baseURL(env)).href);
    target.searchParams.set('state', state);
    const response = json({url:target.href}); response.headers.append('Set-Cookie', setCookie(env, browser, 600, true)); return response;
  }
  if (path.endsWith('/sign-out')) {
    const session = await readSession(request, env).catch(() => null);
    if (session) {
      try {await appwrite(env, '/account/sessions/current', 'DELETE', undefined, session.secret);} catch (error) {if (!(error instanceof AppwriteError) || ![401,404].includes(error.remoteStatus)) throw error;}
    }
    const response = json({success:true}); response.headers.append('Set-Cookie', setCookie(env, '', 0)); return response;
  }
  const session = await readSession(request, env);
  if (!session) throw new AuthError('Please sign in first');
  let job = await pendingDeletion(env, session.uid);
  if (!job) {
    if (Date.now() - session.authTime > 300000) throw new AuthError('Confirm Google sign-in before deleting your account', 403, 'SESSION_NOT_FRESH');
    await getCurrentUser(request, env);
    job = {uid:session.uid, userId:session.userId};
    await env.AUTH_DB!.prepare('INSERT INTO appwrite_deletion (project,uid,userId,createdAt) VALUES (?,?,?,?) ON CONFLICT(project,uid) DO NOTHING').bind(projectKey(env), job.uid, job.userId, Date.now()).run();
  }
  await finishDeletion(env, job);
  const response = json({success:true}); response.headers.append('Set-Cookie', setCookie(env, '', 0)); return response;
}
