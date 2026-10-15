import test from 'node:test';
import assert from 'node:assert/strict';
import {authAvailable, firebaseConfig, allowedBrowserRequest, withCors, PROVIDERS} from '../worker/auth.ts';
import {firebaseBindings} from './firebase-fixture.mjs';
test('Firebase requires complete public configuration and exposes Google only',()=>{
  const env={...firebaseBindings,AUTH_ENABLED:'true',AUTH_DB:{}};
  assert.equal(authAvailable(env),true);assert.deepEqual(PROVIDERS,['google']);
  assert.equal(authAvailable({...env,AUTH_ENABLED:'false'}),false);
  for(const key of Object.keys(firebaseBindings))assert.equal(authAvailable({...env,[key]:''}),false,key);
  assert.equal(firebaseConfig({...env,FIREBASE_AUTH_DOMAIN:'https://evil.example/path'}),null);
});
test('exact apex/www origins accept bearer preflights; lookalikes and originless mutations fail',()=>{
  const env={AUTH_MODE:'production'};
  for(const Origin of ['https://devreads.fyi','https://www.devreads.fyi']){
    const request=new Request('https://devreads.fyi/api/favorites',{method:'OPTIONS',headers:{Origin,'Sec-Fetch-Site':'same-site'}});
    assert.equal(allowedBrowserRequest(request,env,true),true);
    const response=withCors(new Response(null),request,env);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),Origin);
    assert.match(response.headers.get('Access-Control-Allow-Headers'),/Authorization/);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  }
  const evil=new Request('https://devreads.fyi/api/favorites',{method:'POST',headers:{Origin:'https://devreads.fyi.evil.example'}});
  assert.equal(allowedBrowserRequest(evil,env,true),false);assert.equal(withCors(new Response(null),evil,env).headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(allowedBrowserRequest(new Request('https://devreads.fyi/api/favorites',{method:'POST'}),env,true),false);
});
