import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {firebaseFixture,firebaseBindings,migrate,seedUser} from './firebase-fixture.mjs';
const origin='http://localhost:8787';
const fixture={id:'0123456789abcdef',url:'https://example.com/read?a=1#intro',title:'Runtime favorite',source:'Example',published:null,savedAt:1000};
let mf,db,firebase;
async function call(path,{user='alice',token,method='GET',body,headers={},authenticated=true}={}) {
  return mf.dispatchFetch(origin+path,{method,...(body===undefined?{}:{body:JSON.stringify(body)}),headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',...(authenticated?{Authorization:'Bearer '+(token||await firebase.tokenFor(user))}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}});
}
test.before(async()=>{
  firebase=await firebaseFixture();
  mf=new Miniflare({modules:[{type:'ESModule',path:resolve('.wrangler/check-build/index.js'),contents:await readFile('.wrangler/check-build/index.js','utf8')}],compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),d1Databases:{AUTH_DB:'firebase-test'},bindings:{...firebaseBindings,COUNTER_MODE:'preview',AUTH_MODE:'local',AUTH_BASE_URL:origin,AUTH_ENABLED:'true'},outboundService:firebase.outbound,serviceBindings:{ASSETS:()=>new Response('Static page',{headers:{'Content-Type':'text/html'}})}});
  db=await mf.getD1Database('AUTH_DB');await migrate(db);
  for(const uid of ['alice','bob','stale'])await seedUser(db,uid);
});
test.after(async()=>{await mf?.dispose();});
test('real RS256 verification rejects missing, forged, expired, wrong-project and non-Google tokens',async()=>{
  assert.equal((await(await call('/api/auth/get-session')).json()).user.id,'alice');
  assert.equal(await(await call('/api/auth/get-session',{authenticated:false})).json(),null);
  assert.equal((await call('/api/favorites',{authenticated:false})).status,401);
  assert.equal((await call('/api/favorites',{token:'forged.token.value'})).status,401);
  const now=Math.floor(Date.now()/1000);
  for(const claims of [{exp:now-1},{aud:'other-project'},{iss:'https://evil.example'},{iat:now+60},{auth_time:now+60},{email_verified:false},{firebase:{sign_in_provider:'github.com'}}])assert.equal((await call('/api/favorites',{token:await firebase.tokenFor('alice',claims)})).status,401,JSON.stringify(claims));
  const valid=await firebase.tokenFor('alice');const pieces=valid.split('.');pieces[2]=(pieces[2][0]==='a'?'b':'a')+pieces[2].slice(1);
  assert.equal((await call('/api/favorites',{token:pieces.join('.')})).status,401);
  assert.equal((await call('/api/favorites',{authenticated:false,headers:{Cookie:'devreads.session_token=old-cookie'}})).status,401);
});
test('Firebase status, revocation, verified email and lookup outages fail closed',async()=>{
  for(const state of [{disabled:true},{validSince:String(Math.floor(Date.now()/1000)+30)},{emailVerified:false},{localId:'other-user'},{providerUserInfo:[{providerId:'password'}]}]){
    firebase.state.set('alice',state);assert.equal((await call('/api/favorites')).status,401,JSON.stringify(state));
  }
  firebase.state.delete('alice');firebase.setOutage(true);assert.equal((await call('/api/favorites')).status,503);firebase.setOutage(false);
});
test('new Firebase identities are stable across concurrent requests and cannot merge by email',async()=>{
  const results=await Promise.all(Array.from({length:8},()=>call('/api/auth/get-session',{user:'new-user'})));
  const ids=[];for(const response of results){assert.equal(response.status,200,await response.clone().text());ids.push((await response.json()).user.id);}
  assert.equal(new Set(ids).size,1);
  const now=Date.now();await db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)').bind('legacy-user','Legacy','collision@example.com',now,now).run();
  assert.equal((await call('/api/auth/get-session',{user:'collision'})).status,409);
  assert.equal(await db.prepare('SELECT userId FROM firebase_identity WHERE uid=?').bind('collision').first(),null);
});
test('Favorites keep idempotence, owner isolation, safe metadata and account-switch guards',async()=>{
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture})).status,200);
  await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture});
  const response=await call('/api/favorites');const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].url,fixture.url);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await(await call('/api/favorites',{user:'bob'})).json()).items.length,0);
  await call('/api/favorites/'+fixture.id,{user:'bob',method:'DELETE'});assert.equal((await(await call('/api/favorites')).json()).items.length,1);
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:{...fixture,url:'javascript:alert(1)'}})).status,400);
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture,headers:{'X-Devreads-User':'bob'}})).status,409);
});
test('50-record acknowledged imports, membership limits and 100-record cursor pages',async()=>{
  const values=Array.from({length:105},(_,i)=>({...fixture,id:i.toString(16).padStart(16,'0'),savedAt:1000}));
  for(let i=0;i<values.length;i+=50){const batch=values.slice(i,i+50);assert.deepEqual((await(await call('/api/favorites/import',{method:'POST',body:{items:batch}})).json()).acknowledged,batch.map(f=>f.id));}
  await call('/api/favorites/import',{method:'POST',body:{items:values.slice(0,50)}});
  const first=await(await call('/api/favorites')).json();const second=await(await call('/api/favorites?cursor='+encodeURIComponent(first.nextCursor))).json();
  assert.equal(first.items.length,100);assert.equal(second.items.length,6);assert.equal(new Set([...first.items,...second.items].map(f=>f.id)).size,106);
  assert.deepEqual((await(await call('/api/favorites/status',{method:'POST',body:{ids:[values[0].id]}})).json()).ids,[values[0].id]);
  assert.equal((await call('/api/favorites/status',{method:'POST',body:{ids:values.map(f=>f.id)}})).status,400);
  assert.equal((await call('/api/favorites?cursor=invalid')).status,400);
});
test('origin/method/JSON/preview checks remain enforced and old provider APIs stay closed',async()=>{
  for(const Origin of ['https://evil.example','https://devreads.fyi.evil.example']){const response=await call('/api/favorites',{headers:{Origin,'Sec-Fetch-Site':'cross-site'}});assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);}
  assert.equal((await call('/api/favorites',{method:'PATCH',body:{}})).status,405);
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:null})).status,400);
  assert.equal((await call('/api/favorites/'+fixture.id,{method:'PUT',body:fixture,headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal((await mf.dispatchFetch('https://preview.workers.dev/api/auth/config')).status,404);
  assert.deepEqual((await(await call('/api/auth/config',{authenticated:false})).json()).providers,['google']);
  for(const path of ['sign-in/social','link-social','unlink-account','get-access-token','callback/github','callback/linkedin'])assert.equal((await call('/api/auth/'+path,{method:'POST',body:{}})).status,404,path);
});
test('recent Google reauthentication is required; deletion cascades and rejects cached-token replay',async()=>{
  const stale=await firebase.tokenFor('stale',{auth_time:Math.floor(Date.now()/1000)-600});
  assert.equal((await call('/api/auth/delete-user',{method:'POST',token:stale,body:{}})).status,403);
  const token=await firebase.tokenFor('alice');await call('/api/auth/get-session',{token});
  firebase.setOutage(true);assert.equal((await call('/api/auth/delete-user',{method:'POST',token,body:{}})).status,503);firebase.setOutage(false);
  assert.ok(await db.prepare('SELECT id FROM user WHERE id=?').bind('alice').first());
  assert.equal((await call('/api/auth/delete-user',{method:'POST',token,body:{}})).status,200);
  assert.equal(await db.prepare('SELECT id FROM user WHERE id=?').bind('alice').first(),null);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM favorite WHERE userId=?').bind('alice').first()).total,0);
  assert.equal((await call('/api/favorites',{token})).status,401);
  assert.equal((await call('/api/auth/delete-user',{method:'POST',token,body:{}})).status,200,'Deletion retry tolerates Firebase USER_NOT_FOUND');
});
