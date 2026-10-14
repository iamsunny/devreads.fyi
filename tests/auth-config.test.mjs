import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, mapIdentity, authAvailable, allowedBrowserRequest, withCors } from '../worker/auth.ts';
test('email-less identities use unverified internal placeholders; verified email requires an explicit claim', () => {
  assert.deepEqual(mapIdentity('linkedin', {sub:'123'}), {email:'123@linkedin.placeholder.invalid',emailVerified:false});
  assert.equal(mapIdentity('google',{email:'a@example.com',email_verified:true}).emailVerified,true);
  assert.equal(mapIdentity('google',{email:'a@example.com',email_verified:'true'}).emailVerified,false);
});
test('credentials and feature flags gate sign-in; exact apex/www CORS cannot trust lookalikes', () => {
  const env={AUTH_MODE:'production',AUTH_ENABLED:'true',BETTER_AUTH_SECRET:'a'.repeat(32),AUTH_DB:{},AUTH_PROVIDERS:'google',GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret'};
  assert.equal(authAvailable(env),true); assert.equal(authAvailable({...env,AUTH_ENABLED:'false'}),false); assert.equal(authAvailable({...env,GOOGLE_CLIENT_SECRET:undefined}),false);
  for(const Origin of ['https://devreads.fyi','https://www.devreads.fyi']) {
    const request=new Request('https://devreads.fyi/api/favorites',{method:'POST',headers:{Origin,'Sec-Fetch-Site':'same-site'}});
    assert.equal(allowedBrowserRequest(request,env,true),true);
    const response=withCors(new Response(null),request,env);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),Origin); assert.equal(response.headers.get('Access-Control-Allow-Credentials'),'true');
  }
  const evil=new Request('https://devreads.fyi/api/favorites',{method:'POST',headers:{Origin:'https://devreads.fyi.evil.example'}});
  assert.equal(allowedBrowserRequest(evil,env,true),false); assert.equal(withCors(new Response(null),evil,env).headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(allowedBrowserRequest(new Request('https://devreads.fyi/api/favorites',{method:'POST'}),env,true),false);
});
