import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';

const origin = 'http://localhost:8787';
const secret = 'runtime-test-secret-not-production-at-least-32-characters';
const fixture = { id: '0123456789abcdef', url: 'https://example.com/read?a=1#intro', title: 'Runtime favorite', source: 'Example', published: null, savedAt: 1000 };
let mf, db;
async function call(path, { user = 'alice', method = 'GET', body, headers = {}, cookie = true } = {}) {
  const token = `${user}-token`;
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return mf.dispatchFetch(origin + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: {
    Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie ? { Cookie: `devreads.session_token=${encodeURIComponent(`${token}.${signature}`)}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
  }, redirect: 'manual' });
}
test.before(async () => {
  mf = new Miniflare({ modules: [{ type: 'ESModule', path: resolve('.wrangler/check-build/index.js'), contents: await readFile('.wrangler/check-build/index.js', 'utf8') }], compatibilityDate: '2026-06-01', compatibilityFlags: ['nodejs_compat'],
    log: new Log(LogLevel.ERROR), d1Databases: { AUTH_DB: 'accounts-test' },
    bindings: { COUNTER_MODE: 'preview', AUTH_MODE: 'local', AUTH_BASE_URL: origin, AUTH_ENABLED: 'true', AUTH_PROVIDERS: 'google,github,linkedin', BETTER_AUTH_SECRET: secret,
      GOOGLE_CLIENT_ID: 'google-test', GOOGLE_CLIENT_SECRET: 'test', GITHUB_CLIENT_ID: 'github-test', GITHUB_CLIENT_SECRET: 'test', LINKEDIN_CLIENT_ID: 'linkedin-test', LINKEDIN_CLIENT_SECRET: 'test' },
    serviceBindings: { ASSETS: () => new Response('Static page', { headers: { 'Content-Type': 'text/html' } }) },
  });
  db = await mf.getD1Database('AUTH_DB');
  const migration = await readFile('migrations/0001_auth_favorites.sql', 'utf8');
  await db.exec(migration.split(';').map(sql => sql.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  const now = Date.now();
  for (const id of ['alice', 'bob', 'stale', 'expired']) {
    await db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(id, id, `${id}@example.com`, now, now).run();
    await db.prepare('INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind(`${id}-session`, `${id}-token`, id, id === 'expired' ? now - 1000 : now + 86400000, id === 'stale' ? now - 600000 : now, now).run();
  }
});
test.after(async () => { await mf?.dispose(); });
test('actual Better Auth session lookup and private API reject missing, forged, and expired sessions', async () => {
  const response = await call('/api/auth/get-session'); assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, 'alice');
  assert.equal((await call('/api/favorites', { cookie: false })).status, 401);
  assert.equal((await call('/api/favorites', { headers: { Cookie: 'devreads.session_token=forged' } })).status, 401);
  assert.equal((await call('/api/favorites', { user: 'expired' })).status, 401);
});
test('idempotent writes, owner isolation, safe metadata, and read-only snapshots', async () => {
  assert.equal((await call(`/api/favorites/${fixture.id}`, { method: 'PUT', body: fixture })).status, 200);
  await call(`/api/favorites/${fixture.id}`, { method: 'PUT', body: fixture });
  const response = await call('/api/favorites'); const data = await response.json();
  assert.equal(data.items.length, 1); assert.equal(data.items[0].url, fixture.url);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await (await call('/api/favorites', { user: 'bob' })).json()).items.length, 0);
  assert.equal((await call(`/api/favorites/${fixture.id}`, { method: 'PUT', body: { ...fixture, url: 'javascript:alert(1)' } })).status, 400);
  await call(`/api/favorites/${fixture.id}`, { method: 'DELETE', user: 'bob' });
  assert.equal((await (await call('/api/favorites')).json()).items.length, 1);
});
test('batch import acknowledgements, duplicate prevention, membership limit, and cursor pagination', async () => {
  const values = Array.from({ length: 105 }, (_, index) => ({ ...fixture, id: index.toString(16).padStart(16, '0'), savedAt: 1000 }));
  for (let start = 0; start < values.length; start += 50) {
    const batch = values.slice(start, start + 50);
    const response = await call('/api/favorites/import', { method: 'POST', body: { items: batch } });
    assert.deepEqual((await response.json()).acknowledged, batch.map(item => item.id));
  }
  await call('/api/favorites/import', { method: 'POST', body: { items: values.slice(0, 50) } });
  const page1 = await (await call('/api/favorites')).json(); assert.equal(page1.items.length, 100); assert.ok(page1.nextCursor);
  const page2 = await (await call('/api/favorites?cursor=' + encodeURIComponent(page1.nextCursor))).json(); assert.equal(page2.items.length, 6);
  assert.equal(new Set([...page1.items, ...page2.items].map(item => item.id)).size, 106);
  const membership = await (await call('/api/favorites/status', { method: 'POST', body: { ids: [values[0].id] } })).json(); assert.deepEqual(membership.ids, [values[0].id]);
  assert.equal((await call('/api/favorites/status', { method: 'POST', body: { ids: values.map(item => item.id) } })).status, 400);
  assert.equal((await call('/api/favorites?cursor=invalid')).status, 400);
});
test('origin/lookalike rejection, JSON checks, unsupported methods, and preview isolation', async () => {
  for (const Origin of ['https://evil.example', 'https://devreads.fyi.evil.example']) {
    const response = await call('/api/favorites', { headers: { Origin, 'Sec-Fetch-Site': 'cross-site' } }); assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal((await call('/api/favorites', { method: 'PATCH', body: {} })).status, 405);
  assert.equal((await call(`/api/favorites/${fixture.id}`, { method: 'PUT', body: fixture, headers: { 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal((await mf.dispatchFetch('https://preview.workers.dev/api/auth/config')).status, 404);
});
test('OAuth initialization builds correct redirects and rejects unsafe return URLs', async () => {
  for (const provider of ['google', 'github', 'linkedin']) {
    const response = await call('/api/auth/sign-in/social', { method: 'POST', cookie: false, body: { provider, callbackURL: origin + '/favorites/', disableRedirect: true } });
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json(); const url = new URL(data.url);
    assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/auth/callback/${provider}`);
    assert.ok(url.searchParams.get('state'));
  }
  assert.equal((await call('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', callbackURL: 'https://evil.example', disableRedirect: true } })).status, 403);
  const cancelled = await call('/api/auth/callback/google?error=access_denied', { cookie: false }); assert.ok(cancelled.status >= 300);
});
test('sensitive account operations require recent sign-in; deleting a user cascades favorites', async () => {
  assert.equal((await call('/api/auth/link-social', { user: 'stale', method: 'POST', body: { provider: 'github', callbackURL: origin + '/account/' } })).status, 403);
  assert.equal((await call('/api/auth/delete-user', { user: 'stale', method: 'POST', body: {} })).status, 403);
  const response = await call('/api/auth/delete-user', { method: 'POST', body: { callbackURL: origin + '/favorites/' } });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM favorite WHERE userId = ?').bind('alice').first()).total, 0);
  assert.equal((await call('/api/favorites')).status, 401);
});
