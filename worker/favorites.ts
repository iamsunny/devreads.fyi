import { allowedBrowserRequest, authAvailable, authHostAllowed, getCurrentUser, json, type AuthEnv } from './auth';

interface Favorite { id: string; url: string; title: string; source: string; published: string | null; savedAt: number }
export function validateFavorite(value: unknown): Favorite | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  if (typeof f.id !== 'string' || !/^[a-f0-9]{16}$/.test(f.id) || typeof f.url !== 'string' || f.url.length > 2048 || typeof f.title !== 'string' || !f.title.trim() || f.title.length > 512 || typeof f.source !== 'string' || f.source.length > 128) return null;
  try { const url = new URL(f.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; } catch { return null; }
  const date = f.published == null ? null : typeof f.published === 'string' && Number.isFinite(Date.parse(f.published)) ? new Date(f.published).toISOString() : undefined;
  if (date === undefined) return null;
  const saved = typeof f.savedAt === 'number' ? f.savedAt : typeof f.savedAt === 'string' ? Date.parse(f.savedAt) : NaN;
  return { id: f.id, url: f.url, title: f.title.trim(), source: f.source, published: date, savedAt: Number.isSafeInteger(saved) && saved > 0 && saved <= Date.now() ? saved : Date.now() };
}
async function readJSON(request: Request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('Use application/json');
  if (Number(request.headers.get('Content-Length')) > 200000) throw new Error('Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body required');
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 200000) { await reader.cancel(); throw new Error('Request too large'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required');
  return value;
}
export async function favoritesEndpoint(request: Request, env: AuthEnv) {
  if (!authHostAllowed(request, env)) return json({ error: 'Not found' }, 404);
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '');
  if (!allowedBrowserRequest(request, env, request.method !== 'GET')) return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  const itemId = path.match(/^\/api\/favorites\/([a-f0-9]{16})$/)?.[1];
  const validMethod = (path === '/api/favorites' && request.method === 'GET') || (['/api/favorites/status', '/api/favorites/import'].includes(path) && request.method === 'POST') || (!!itemId && ['PUT', 'DELETE'].includes(request.method));
  if (!validMethod) return json({ error: 'Method not allowed' }, 405);
  if (!authAvailable(env)) return json({ error: 'Account sync is not configured yet' }, 503);
  const current = await getCurrentUser(request, env);
  if (!current) return json({ error: 'Please sign in again' }, 401);
  const userId = current.user.id;
  if (request.headers.has('X-Devreads-User') && request.headers.get('X-Devreads-User') !== userId) return json({error:'Account changed. Refresh before syncing favorites.'}, 409);
  if (env.AUTH_MODE === 'production' && !env.FAVORITES_RATE_LIMITER) return json({ error: 'Favorites are temporarily unavailable' }, 503);
  if (env.FAVORITES_RATE_LIMITER && !(await env.FAVORITES_RATE_LIMITER.limit({ key: userId })).success) return json({ error: 'Too many requests. Try again shortly.' }, 429);
  const db = env.AUTH_DB!;
  if (itemId && request.method === 'DELETE') {
    await db.prepare('DELETE FROM favorite WHERE userId = ? AND id = ?').bind(userId, itemId).run();
    return json({ id: itemId, favorited: false });
  }
  if (request.method === 'GET') {
    let cursor: { savedAt: number; id: string } | undefined;
    if (url.searchParams.has('cursor')) {
      try { cursor = JSON.parse(atob(url.searchParams.get('cursor')!)); if (!cursor || !Number.isSafeInteger(cursor.savedAt) || !/^[a-f0-9]{16}$/.test(cursor.id)) throw new Error(); } catch { return json({ error: 'Invalid cursor' }, 400); }
    }
    const sql = 'SELECT id, url, title, source, published, savedAt FROM favorite WHERE userId = ?' + (cursor ? ' AND (savedAt < ? OR (savedAt = ? AND id < ?))' : '') + ' ORDER BY savedAt DESC, id DESC LIMIT 101';
    const args = cursor ? [userId, cursor.savedAt, cursor.savedAt, cursor.id] : [userId];
    const result = await db.prepare(sql).bind(...args).all<Favorite>();
    const items = result.results.slice(0, 100); const last = items.at(-1);
    return json({ items, nextCursor: result.results.length > 100 && last ? btoa(JSON.stringify({ savedAt: last.savedAt, id: last.id })) : null });
  }
  let body;
  try { body = await readJSON(request); } catch { return json({ error: 'Invalid or oversized JSON request' }, 400); }
  if (path === '/api/favorites/status') {
    if (!Array.isArray(body.ids) || body.ids.length > 50 || !body.ids.every((id: unknown) => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id))) return json({ error: 'Provide up to 50 article IDs' }, 400);
    const ids = [...new Set(body.ids)] as string[];
    if (!ids.length) return json({ ids: [] });
    const result = await db.prepare(`SELECT id FROM favorite WHERE userId = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(userId, ...ids).all<{ id: string }>();
    return json({ ids: result.results.map(item => item.id) });
  }
  const values = itemId ? [{ ...body, id: itemId, savedAt: Date.now() }] : body.items;
  if (!Array.isArray(values) || !values.length || values.length > 50) return json({ error: 'Provide 1–50 favorites' }, 400);
  const favorites = values.map(validateFavorite);
  if (favorites.some(value => !value)) return json({ error: 'Invalid favorite' }, 400);
  await db.batch(favorites.map(f => db.prepare('INSERT INTO favorite (userId, id, url, title, source, published, savedAt) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(userId, id) DO NOTHING').bind(userId, f!.id, f!.url, f!.title, f!.source, f!.published, f!.savedAt)));
  return itemId ? json({ id: itemId, favorited: true }) : json({ acknowledged: favorites.map(f => f!.id) });
}
