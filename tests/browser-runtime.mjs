// Local browser test fixture: real workerd/D1 and static assets, disposable test identities.
// Never deployed; no test-login HTTP endpoint is created.
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHmac } from 'node:crypto';
import { Miniflare, Log, LogLevel } from 'miniflare';
export async function browserRuntime(port = 8789) {
  const origin = `http://localhost:${port}`;
  const secret = 'local-browser-fixture-secret-at-least-32-characters';
  const root = resolve('dist');
  const mf = new Miniflare({ port, host: '127.0.0.1', modules: [{type:'ESModule',path:resolve('.wrangler/check-build/index.js'),contents:await readFile('.wrangler/check-build/index.js','utf8')}],
    compatibilityDate:'2026-06-01', compatibilityFlags:['nodejs_compat'], log:new Log(LogLevel.ERROR), d1Databases:{AUTH_DB:'browser-test'},
    bindings:{COUNTER_MODE:'preview',AUTH_MODE:'local',AUTH_BASE_URL:origin,AUTH_ENABLED:'true',AUTH_PROVIDERS:'google,github,linkedin',BETTER_AUTH_SECRET:secret,GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test',LINKEDIN_CLIENT_ID:'test',LINKEDIN_CLIENT_SECRET:'test'},
    serviceBindings:{ASSETS:async request => {
      let path = resolve(root, '.'+decodeURIComponent(new URL(request.url).pathname));
      if (path !== root && !path.startsWith(root+sep)) return new Response(null,{status:404});
      if (!/\.[a-z0-9]+$/i.test(path)) path = resolve(path,'index.html');
      try { return new Response(await readFile(path),{headers:{'Content-Type':path.endsWith('.html')?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'application/octet-stream'}}); }
      catch { return new Response(null,{status:404}); }
    }},
  });
  const db = await mf.getD1Database('AUTH_DB');
  await db.exec((await readFile('migrations/0001_auth_favorites.sql','utf8')).split(';').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'));
  const now=Date.now();
  for(const id of ['alice','bob']) {
    await db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(id,id,`${id}@example.com`,now,now).run();
    await db.prepare('INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind(id,id+'-token',id,now+86400000,now,now).run();
    await db.prepare('INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind(id,id,'google',id,now,now).run();
  }
  await mf.ready;
  const cookie = id => ({name:'devreads.session_token',value:encodeURIComponent(`${id}-token.${createHmac('sha256',secret).update(id+'-token').digest('base64')}`),url:origin,httpOnly:true,sameSite:'Lax'});
  return {origin,mf,db,cookie};
}
