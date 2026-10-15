import test from 'node:test';
import assert from 'node:assert/strict';
import {authAvailable,appwriteConfig,allowedBrowserRequest,withCors,PROVIDERS,safeReturn,cookieName} from '../worker/auth.ts';
import {appwriteBindings} from './appwrite-fixture.mjs';
test('Appwrite requires server configuration and exposes Google only',()=>{
  const env={...appwriteBindings,AUTH_ENABLED:'true',AUTH_DB:{}};
  assert.equal(authAvailable(env),true);assert.deepEqual(PROVIDERS,['google']);
  assert.equal(authAvailable({...env,AUTH_ENABLED:'false'}),false);
  for(const key of Object.keys(appwriteBindings))assert.equal(authAvailable({...env,[key]:''}),false,key);
  for(const endpoint of ['http://example.com/v1','https://user:pass@example.com/v1','https://example.com/v1?key=x','https://example.com/not-v1'])assert.equal(appwriteConfig({...env,APPWRITE_ENDPOINT:endpoint}),null);
});
test('credentialed CORS allows exact apex/www only; originless mutations fail',()=>{
  const env={AUTH_MODE:'production'};
  for(const Origin of ['https://devreads.fyi','https://www.devreads.fyi']){
    const request=new Request('https://devreads.fyi/api/favorites',{method:'OPTIONS',headers:{Origin,'Sec-Fetch-Site':'same-site'}});
    assert.equal(allowedBrowserRequest(request,env,true),true);
    const response=withCors(new Response(null),request,env);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),Origin);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'),'true');
  }
  const evil=new Request('https://devreads.fyi/api/favorites',{method:'POST',headers:{Origin:'https://devreads.fyi.evil.example'}});
  assert.equal(allowedBrowserRequest(evil,env,true),false);assert.equal(withCors(new Response(null),evil,env).headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(allowedBrowserRequest(new Request('https://devreads.fyi/api/favorites',{method:'POST'}),env,true),false);
});
test('canonical returns and host-only production cookies prevent external redirects',()=>{
  const env={AUTH_BASE_URL:'https://devreads.fyi'};
  for(const value of ['https://evil.example','//evil.example','/api/auth/callback/google','/signin/','https://user@devreads.fyi/'])assert.equal(safeReturn(value,env),'https://devreads.fyi/favorites/');
  assert.equal(safeReturn('/tag/cloud/?q=a#top',env),'https://devreads.fyi/tag/cloud/?q=a#top');
  assert.equal(cookieName(env),'__Host-devreads.session');
  assert.equal(cookieName({AUTH_BASE_URL:'http://localhost:8787'}),'devreads.session');
});
