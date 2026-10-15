// Only local tests import this fixture. No test authentication route is deployed.
import {readFile} from 'node:fs/promises';
import {sealSession,digest,cookieName} from '../worker/auth.ts';
export const appwriteBindings={APPWRITE_ENDPOINT:'https://test.cloud.appwrite.io/v1',APPWRITE_PROJECT_ID:'devreads-test',APPWRITE_API_KEY:'fixture-server-key',AUTH_SESSION_SECRET:'fixture-only-session-secret-never-deploy-0123456789'};
export const project=appwriteBindings.APPWRITE_ENDPOINT+'|'+appwriteBindings.APPWRITE_PROJECT_ID;
export async function userId(uid){return 'aw_'+await digest(project+'\0'+uid);}
export async function migrate(db){
  for(const name of ['0001_auth_favorites.sql','0002_firebase_google.sql','0003_appwrite_google.sql'])await db.exec((await readFile('migrations/'+name,'utf8')).split(';').map(sql=>sql.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'));
}
export async function appwriteFixture(env){
  const sessions=new Map();const tokens=new Map();const accounts=new Map();const deleted=new Set();const requests=[];let outage=false;let failDelete=false;
  function issueToken(uid,provider='google') {const secret=crypto.randomUUID();tokens.set(secret,{uid,provider});return secret;}
  function createSession(uid,provider='google',overrides={}){
    const secret=crypto.randomUUID();const now=Date.now();
    const session={$id:crypto.randomUUID(),$createdAt:new Date(now).toISOString(),userId:uid,provider,expire:new Date(now+86400000).toISOString(),secret,...overrides};
    sessions.set(secret,session);return session;
  }
  async function cookieFor(uid,overrides={}){
    const remote=createSession(uid,overrides.provider||'google',overrides.remote);
    const value=await sealSession({secret:remote.secret,uid,id:remote.$id,userId:await userId(uid),expiresAt:Date.now()+86400000,authTime:Date.now(),...overrides},env);
    return cookieName(env)+'='+value;
  }
  async function outbound(request){
    const url=new URL(request.url);requests.push({path:url.pathname,method:request.method,key:request.headers.get('X-Appwrite-Key'),session:request.headers.get('X-Appwrite-Session')});
    if(url.origin!==new URL(env.APPWRITE_ENDPOINT).origin||request.headers.get('X-Appwrite-Project')!==env.APPWRITE_PROJECT_ID)return new Response(null,{status:500});
    if(outage)return Response.json({message:'Fixture outage'},{status:503});
    if(url.pathname==='/v1/account/sessions/token'){
      if(request.headers.get('X-Appwrite-Key')!==env.APPWRITE_API_KEY)return new Response(null,{status:403});
      const body=await request.json();const token=tokens.get(body.secret);tokens.delete(body.secret);
      if(!token||token.uid!==body.userId)return new Response(null,{status:401});
      return Response.json(createSession(token.uid,token.provider),{status:201});
    }
    if(url.pathname.startsWith('/v1/users/')&&request.method==='DELETE'){
      if(request.headers.get('X-Appwrite-Key')!==env.APPWRITE_API_KEY)return new Response(null,{status:403});
      if(failDelete)return new Response(null,{status:503});
      const uid=decodeURIComponent(url.pathname.split('/').at(-1));
      if(deleted.has(uid))return new Response(null,{status:404});
      deleted.add(uid);for(const [secret,s] of sessions)if(s.userId===uid)sessions.delete(secret);
      return new Response(null,{status:204});
    }
    const secret=request.headers.get('X-Appwrite-Session');const s=sessions.get(secret);
    if(!s||deleted.has(s.userId))return new Response(null,{status:401});
    if(url.pathname==='/v1/account')return Response.json({$id:s.userId,name:s.userId,email:s.userId+'@example.com',emailVerification:true,status:true,...accounts.get(s.userId)});
    if(url.pathname==='/v1/account/sessions/current'){
      if(request.method==='DELETE'){sessions.delete(secret);return new Response(null,{status:204});}
      return Response.json(s);
    }
    return new Response(null,{status:404});
  }
  return {cookieFor,issueToken,createSession,outbound,sessions,accounts,deleted,requests,setOutage:value=>{outage=value;},setDeleteFailure:value=>{failDelete=value;}};
}
