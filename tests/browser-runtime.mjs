// Disposable, signed-JWT Firebase fixture. Never deployed; no test-login API.
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {firebaseFixture,firebaseBindings,migrate,seedUser} from './firebase-fixture.mjs';
export async function browserRuntime(port=8789) {
  const origin=`http://localhost:${port}`;const root=resolve('dist');const firebase=await firebaseFixture();
  const tokens={alice:await firebase.tokenFor('alice'),bob:await firebase.tokenFor('bob')};
  // This adapter replaces the popup SDK only in this test fixture's static service.
  // Tokens are genuinely signed; the deployed Worker verifies them against mocked Google keys.
  const adapter=`const tokens=${JSON.stringify(tokens)};
    export async function configure(){}
    export async function token(){return tokens[localStorage.getItem('fixture.firebase.user')]||null;}
    export async function signInGoogle(){if(window.__googleError)throw Object.assign(new Error('Test popup failure'),{code:window.__googleError});localStorage.setItem('fixture.firebase.user','alice');window.dispatchEvent(new CustomEvent('devreads:firebase-session',{detail:{uid:'alice'}}));}
    export async function reauthenticateGoogle(){}
    export async function signOut(){localStorage.removeItem('fixture.firebase.user');window.dispatchEvent(new CustomEvent('devreads:firebase-session',{detail:{uid:null}}));}`;
  const mf=new Miniflare({port,host:'127.0.0.1',modules:[{type:'ESModule',path:resolve('.wrangler/check-build/index.js'),contents:await readFile('.wrangler/check-build/index.js','utf8')}],compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),d1Databases:{AUTH_DB:'browser-test'},bindings:{...firebaseBindings,COUNTER_MODE:'preview',AUTH_MODE:'local',AUTH_BASE_URL:origin,AUTH_ENABLED:'true'},outboundService:firebase.outbound,serviceBindings:{ASSETS:async request=>{
    const pathname=new URL(request.url).pathname;
    if(pathname==='/firebase-client.js')return new Response(adapter,{headers:{'Content-Type':'application/javascript'}});
    let path=resolve(root,'.'+decodeURIComponent(pathname));
    if(path!==root&&!path.startsWith(root+sep))return new Response(null,{status:404});
    if(!/\.[a-z0-9]+$/i.test(path))path=resolve(path,'index.html');
    try{return new Response(await readFile(path),{headers:{'Content-Type':path.endsWith('.html')?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'application/octet-stream'}});}catch{return new Response(null,{status:404});}
  }}});
  const db=await mf.getD1Database('AUTH_DB');await migrate(db);
  for(const uid of ['alice','bob'])await seedUser(db,uid);
  await mf.ready;
  async function signIn(context,uid){
    const page=await context.newPage();await page.goto(origin+'/signin/');
    await page.evaluate(uid=>localStorage.setItem('fixture.firebase.user',uid),uid);await page.close();
  }
  return {origin,mf,db,firebase,signIn};
}
