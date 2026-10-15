// Actual local Worker/D1 with controlled Appwrite HTTP responses; never deployed.
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {appwriteFixture,appwriteBindings,migrate} from './appwrite-fixture.mjs';
export async function browserRuntime(port=8789){
  const origin=`http://localhost:${port}`;const root=resolve('dist');
  const env={...appwriteBindings,COUNTER_MODE:'preview',AUTH_MODE:'local',AUTH_BASE_URL:origin,AUTH_ENABLED:'true'};
  const appwrite=await appwriteFixture(env);
  const mf=new Miniflare({port,host:'127.0.0.1',modules:[{type:'ESModule',path:resolve('.wrangler/check-build/index.js'),contents:await readFile('.wrangler/check-build/index.js','utf8')}],compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),d1Databases:{AUTH_DB:'browser-test'},bindings:env,outboundService:appwrite.outbound,serviceBindings:{ASSETS:async request=>{
    const pathname=new URL(request.url).pathname;
    let path=resolve(root,'.'+decodeURIComponent(pathname));
    if(path!==root&&!path.startsWith(root+sep))return new Response(null,{status:404});
    if(!/\.[a-z0-9]+$/i.test(path))path=resolve(path,'index.html');
    try{return new Response(await readFile(path),{headers:{'Content-Type':path.endsWith('.html')?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'application/octet-stream'}});}catch{return new Response(null,{status:404});}
  }}});
  const db=await mf.getD1Database('AUTH_DB');await migrate(db);await mf.ready;
  async function signIn(context,uid){
    const cookie=await appwrite.cookieFor(uid);const [name,value]=cookie.split('=');
    await context.addCookies([{name,value,url:origin,httpOnly:true,sameSite:'Lax'}]);
  }
  return {origin,mf,db,appwrite,signIn,cancelNext:false,oauthUID:'alice'};
}
