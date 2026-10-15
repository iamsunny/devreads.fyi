import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {appwriteFixture,appwriteBindings,migrate,userId,project} from './appwrite-fixture.mjs';
const origin='http://localhost:8787';
const env={...appwriteBindings,COUNTER_MODE:'preview',AUTH_MODE:'local',AUTH_BASE_URL:origin,AUTH_ENABLED:'true'};
const fixture={id:'0123456789abcdef',url:'https://example.com/read?a=1#intro',title:'Runtime favorite',source:'Example',published:null,savedAt:1000};
let mf,db,appwrite;
async function call(path,{user='alice',cookie,method='GET',body,headers={},authenticated=true}={}) {
  return mf.dispatchFetch(origin+path,{method,redirect:'manual',...(body===undefined?{}:{body:JSON.stringify(body)}),headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',...(authenticated?{Cookie:cookie||await appwrite.cookieFor(user)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}});
}
async function start({cookie,confirm=false,returnTo='/favorites/'}={}) {
  const response=await call(confirm?'/api/auth/confirm-google':'/api/auth/sign-in/google',{method:'POST',body:{returnTo},authenticated:!!cookie,cookie});
  assert.equal(response.status,200,await response.clone().text());
  return {target:new URL((await response.json()).url),cookie:response.headers.getSetCookie()[0].split(';')[0]};
}
async function complete(flow,{uid='oauth-user',token=appwrite.issueToken(uid),cookie=flow.cookie}={}) {
  return call('/api/auth/callback/google?'+new URLSearchParams({state:flow.target.searchParams.get('state'),userId:uid,secret:token}),{authenticated:false,headers:{Cookie:cookie}});
}
test.before(async()=>{
  appwrite=await appwriteFixture(env);
  mf=new Miniflare({modules:[{type:'ESModule',path:resolve('.wrangler/check-build/index.js'),contents:await readFile('.wrangler/check-build/index.js','utf8')}],compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),d1Databases:{AUTH_DB:'appwrite-test'},bindings:env,outboundService:appwrite.outbound,serviceBindings:{ASSETS:()=>new Response('Static page',{headers:{'Content-Type':'text/html'}})}});
  db=await mf.getD1Database('AUTH_DB');await migrate(db);
});
test.after(async()=>{await mf?.dispose();});
test('encrypted cookie validation rejects forged, expired, mismatched and old Firebase credentials',async()=>{
  assert.equal((await(await call('/api/auth/get-session')).json()).user.id,await userId('alice'));
  assert.equal(await(await call('/api/auth/get-session',{authenticated:false})).json(),null);
  assert.equal((await call('/api/favorites',{authenticated:false})).status,401);
  for(const cookie of ['devreads.session=forged.token','devreads.session_token=old-cookie'])assert.equal((await call('/api/favorites',{cookie})).status,401);
  for(const overrides of [{expiresAt:Date.now()-1},{authTime:Date.now()+60000},{uid:'other-user'},{id:'wrong-session'}])assert.equal((await call('/api/favorites',{cookie:await appwrite.cookieFor('alice',overrides)})).status,401);
  const cookie=await appwrite.cookieFor('alice');assert.equal((await call('/api/favorites',{cookie:cookie.slice(0,-3)+'xyz'})).status,401);
  const otherProject=await appwriteFixture({...env,APPWRITE_PROJECT_ID:'other-project'});
  assert.equal((await call('/api/favorites',{cookie:await otherProject.cookieFor('alice')})).status,401);
  assert.equal((await call('/api/favorites',{authenticated:false,headers:{Authorization:'Bearer old.firebase.token'}})).status,401);
});
test('Appwrite verified Google session, account status, expiry, revocation and outages fail closed',async()=>{
  for(const state of [{status:false},{emailVerification:false},{$id:'other-user'}]){
    appwrite.accounts.set('alice',state);assert.equal((await call('/api/favorites')).status,401);
  }
  appwrite.accounts.delete('alice');
  assert.equal((await call('/api/favorites',{cookie:await appwrite.cookieFor('alice',{provider:'github'})})).status,401);
  assert.equal((await call('/api/favorites',{cookie:await appwrite.cookieFor('alice',{remote:{expire:new Date(0).toISOString()}})})).status,401);
  const cookie=await appwrite.cookieFor('alice');appwrite.sessions.clear();assert.equal((await call('/api/favorites',{cookie})).status,401);
  appwrite.setOutage(true);assert.equal((await call('/api/favorites')).status,503);appwrite.setOutage(false);
});
test('OAuth state is browser-bound, expiring and single-use; redirects remove secrets',async()=>{
  const flow=await start({returnTo:'https://evil.example/'});assert.equal(flow.target.origin,'https://test.cloud.appwrite.io');assert.equal(flow.target.pathname,'/v1/account/tokens/oauth2/google');
  assert.equal(flow.target.searchParams.has('key'),false);
  const foreign=await complete(flow,{cookie:'devreads.oauth='+'0'.repeat(64)});assert.match(foreign.headers.get('Location'),/error=oauth/);
  const response=await complete(flow);assert.equal(response.status,303);assert.equal(response.headers.get('Location'),origin+'/favorites/');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  const session=response.headers.getSetCookie().find(c=>c.startsWith('devreads.session='));assert.match(session,/HttpOnly; SameSite=Lax/);assert.doesNotMatch(session,/fixture-server-key|oauth-user/);
  const cookie=session.split(';')[0];assert.equal((await call('/api/favorites',{cookie})).status,200);
  assert.match((await complete(flow)).headers.get('Location'),/error=oauth/);
  const expired=await start();await db.prepare('UPDATE appwrite_oauth SET expiresAt=0').run();assert.match((await complete(expired)).headers.get('Location'),/error=oauth/);
  const cancelled=await start();const result=await call('/api/auth/callback/google?error=denied&state='+cancelled.target.searchParams.get('state'),{authenticated:false,headers:{Cookie:cancelled.cookie}});assert.match(result.headers.get('Location'),/error=oauth/);
  const nonGoogle=await start();assert.match((await complete(nonGoogle,{token:appwrite.issueToken('oauth-user','password')})).headers.get('Location'),/error=oauth/);
});
test('concurrent fresh accounts get one stable D1 identity; no user migration is needed',async()=>{
  const results=await Promise.all(Array.from({length:8},()=>call('/api/auth/get-session',{user:'new-user'})));
  const ids=[];for(const response of results){assert.equal(response.status,200,await response.clone().text());ids.push((await response.json()).user.id);}
  assert.deepEqual(new Set(ids),new Set([await userId('new-user')]));
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM appwrite_identity WHERE uid=?').bind('new-user').first()).total,1);
});
test('Favorites retain idempotence, owner isolation, safe metadata and account-switch guard',async()=>{
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture})).status,200);await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture});
  const response=await call('/api/favorites');const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].url,fixture.url);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await(await call('/api/favorites',{user:'bob'})).json()).items.length,0);await call('/api/favorites/'+fixture.id,{user:'bob',method:'DELETE'});assert.equal((await(await call('/api/favorites')).json()).items.length,1);
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:{...fixture,url:'javascript:alert(1)'}})).status,400);
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture,headers:{'X-Devreads-User':await userId('bob')}})).status,409);
});
test('50-record acknowledged imports, membership limits and 100-record cursor pages',async()=>{
  const values=Array.from({length:105},(_,i)=>({...fixture,id:i.toString(16).padStart(16,'0'),savedAt:1000}));
  for(let i=0;i<values.length;i+=50){const batch=values.slice(i,i+50);assert.deepEqual((await(await call('/api/favorites/import',{method:'POST',body:{items:batch}})).json()).acknowledged,batch.map(f=>f.id));}
  await call('/api/favorites/import',{method:'POST',body:{items:values.slice(0,50)}});
  const first=await(await call('/api/favorites')).json();const second=await(await call('/api/favorites?cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(first.items.length,100);assert.equal(second.items.length,6);assert.equal(new Set([...first.items,...second.items].map(f=>f.id)).size,106);
  assert.equal((await call('/api/favorites/status',{method:'POST',body:{ids:values.map(f=>f.id)}})).status,400);assert.equal((await call('/api/favorites?cursor=invalid')).status,400);
});
test('exact origins, methods, preview isolation and closed legacy APIs remain enforced',async()=>{
  for(const Origin of ['https://evil.example','https://devreads.fyi.evil.example']){const response=await call('/api/favorites',{headers:{Origin,'Sec-Fetch-Site':'cross-site'}});assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);}
  assert.equal((await call('/api/favorites',{method:'PATCH',body:{}})).status,405);assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:null})).status,400);assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture,headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal((await mf.dispatchFetch('https://preview.workers.dev/api/auth/config')).status,404);
  const config=await(await call('/api/auth/config',{authenticated:false})).json();assert.deepEqual(config.providers,['google']);assert.equal(config.service,'appwrite');assert.equal(JSON.stringify(config).includes(appwriteBindings.APPWRITE_API_KEY),false);
  for(const path of ['sign-in/social','link-social','unlink-account','get-access-token','callback/github','callback/linkedin'])assert.equal((await call('/api/auth/'+path,{method:'POST',body:{}})).status,404,path);
  assert.equal((await call('/api/auth/sign-in/google',{method:'POST',body:{returnTo:'x'.repeat(5000)}})).status,400);
});
test('Google confirmation must use the same UID; logout revokes its remote session',async()=>{
  const cookie=await appwrite.cookieFor('alice',{authTime:Date.now()-600000});const flow=await start({cookie,confirm:true});
  assert.match((await complete(flow,{uid:'bob',cookie:flow.cookie+'; '+cookie})).headers.get('Location'),/error=oauth/);
  const fresh=await start({cookie,confirm:true});const response=await complete(fresh,{uid:'alice',cookie:fresh.cookie+'; '+cookie});assert.equal(response.headers.get('Location'),origin+'/account/?confirmed=1');
  const next=response.headers.getSetCookie().find(c=>c.startsWith('devreads.session=')).split(';')[0];
  assert.equal((await call('/api/favorites',{cookie})).status,401,'replaced remote session is revoked');
  assert.equal((await call('/api/auth/sign-out',{method:'POST',cookie:next,body:{}})).status,200);assert.equal((await call('/api/favorites',{cookie:next})).status,401);
  assert.equal((await call('/api/auth/sign-out',{method:'POST',cookie:'devreads.session=broken',body:{}})).status,200);
});
test('fresh Google confirmation gates deletion; durable retries and tombstones reject replay',async()=>{
  const stale=await appwrite.cookieFor('stale',{authTime:Date.now()-600000});assert.equal((await call('/api/auth/delete-user',{method:'POST',cookie:stale,body:{}})).status,403);
  const cookie=await appwrite.cookieFor('alice');await call('/api/auth/get-session',{cookie});
  appwrite.setDeleteFailure(true);assert.equal((await call('/api/auth/delete-user',{method:'POST',cookie,body:{}})).status,503);appwrite.setDeleteFailure(false);
  assert.ok(await db.prepare('SELECT id FROM user WHERE id=?').bind(await userId('alice')).first());assert.equal((await call('/api/favorites',{cookie})).status,401);
  // Simulate Appwrite having succeeded before a failed D1 commit: retry must accept its 404.
  appwrite.deleted.add('alice');assert.equal((await call('/api/auth/delete-user',{method:'POST',cookie,body:{}})).status,200);
  assert.equal(await db.prepare('SELECT id FROM user WHERE id=?').bind(await userId('alice')).first(),null);assert.equal((await db.prepare('SELECT COUNT(*) total FROM favorite WHERE userId=?').bind(await userId('alice')).first()).total,0);
  assert.equal((await call('/api/favorites',{cookie})).status,401);assert.equal((await call('/api/auth/delete-user',{method:'POST',cookie,body:{}})).status,200);
  assert.equal((await db.prepare('SELECT completed FROM appwrite_deletion WHERE project=? AND uid=?').bind(project,'alice').first()).completed,1);
  assert.ok(appwrite.requests.every(r=>!(r.key&&r.session)),'Never mix admin key with user-session requests');
});
test('scheduled cleanup retries pending remote deletion and removes expired OAuth/markers',async()=>{
  const cookie=await appwrite.cookieFor('scheduled-user');await call('/api/auth/get-session',{cookie});
  appwrite.setDeleteFailure(true);assert.equal((await call('/api/auth/delete-user',{method:'POST',cookie,body:{}})).status,503);appwrite.setDeleteFailure(false);
  await db.prepare('UPDATE appwrite_oauth SET expiresAt=0').run();
  await db.prepare('INSERT INTO appwrite_deletion(project,uid,userId,createdAt,completed) VALUES(?,?,?,?,1)').bind(project,'old-marker','old-marker',0).run();
  await (await mf.getWorker()).scheduled({cron:'17 3 * * *'});
  assert.equal(await db.prepare('SELECT id FROM user WHERE id=?').bind(await userId('scheduled-user')).first(),null);
  assert.equal((await db.prepare('SELECT completed FROM appwrite_deletion WHERE uid=?').bind('scheduled-user').first()).completed,1);
  assert.equal(await db.prepare('SELECT uid FROM appwrite_deletion WHERE uid=?').bind('old-marker').first(),null);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM appwrite_oauth WHERE expiresAt=0').first()).total,0);
});
