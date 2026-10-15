import { generateKeyPair, exportJWK, SignJWT, decodeJwt } from 'jose';
import { readFile } from 'node:fs/promises';
export const project = 'demo-devreads';
export const firebaseBindings = {FIREBASE_PROJECT_ID:project,FIREBASE_API_KEY:'test-public-api-key',FIREBASE_AUTH_DOMAIN:project+'.firebaseapp.com',FIREBASE_APP_ID:'1:123:web:test'};
export async function firebaseFixture() {
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};
  const state=new Map(); const deleted=new Set(); let outage=false;
  async function tokenFor(uid, overrides={}) {
    const now=Math.floor(Date.now()/1000);
    return new SignJWT({sub:uid,email:uid+'@example.com',email_verified:true,auth_time:now,firebase:{sign_in_provider:'google.com'},iat:now,exp:now+3600,iss:'https://securetoken.google.com/'+project,aud:project,jti:crypto.randomUUID(),...overrides}).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).sign(privateKey);
  }
  async function outbound(request) {
    const url=new URL(request.url);
    if(url.hostname==='www.googleapis.com' && url.pathname.includes('/service_accounts/')) return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=3600'}});
    if(url.hostname!=='identitytoolkit.googleapis.com') return new Response('Unexpected test network request',{status:500});
    if(outage) return Response.json({error:{message:'SERVICE_UNAVAILABLE'}},{status:503});
    const {idToken}=await request.json(); const claims=decodeJwt(idToken); const uid=claims.sub;
    if(deleted.has(uid))return Response.json({error:{message:'USER_NOT_FOUND'}},{status:400});
    if(url.pathname.endsWith('accounts:delete')){deleted.add(uid);return Response.json({});}
    return Response.json({users:[{localId:uid,email:claims.email,emailVerified:true,displayName:uid,validSince:'0',providerUserInfo:[{providerId:'google.com'}],...state.get(uid)}]});
  }
  return {tokenFor,outbound,state,deleted,setOutage:value=>{outage=value;}};
}
export async function migrate(db) {
  for(const name of ['0001_auth_favorites.sql','0002_firebase_google.sql']) await db.exec((await readFile('migrations/'+name,'utf8')).split(';').map(sql=>sql.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'));
}
export async function seedUser(db,uid,id=uid) {
  const now=Date.now();
  await db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(id,uid,uid+'@example.com',now,now).run();
  await db.prepare('INSERT INTO firebase_identity (projectId,uid,userId) VALUES (?,?,?)').bind(project,uid,id).run();
}
