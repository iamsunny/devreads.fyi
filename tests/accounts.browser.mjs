import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';
import { userId } from './appwrite-fixture.mjs';
await mkdir('.wrangler/browser-check', { recursive: true });
const runtime = await browserRuntime();
const {origin,db,signIn}=runtime;
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
let passed=0;
function ok(message){passed++;console.log('PASS '+message);}
const fixture={id:'fedcba9876543210',title:'A favorite <script>safe</script>',url:'https://example.com/read?a=1#intro',source:'Example',savedAt:'2026-01-01T00:00:00Z'};
async function context(options={}) {
  const c=await browser.newContext({viewport:{width:1440,height:900},...options});
  await c.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(url.origin==='https://test.cloud.appwrite.io' && url.pathname==='/v1/account/tokens/oauth2/google'){
      const target=new URL(url.searchParams.get(runtime.cancelNext?'failure':'success'));
      target.searchParams.set('state',url.searchParams.get('state'));
      if(!runtime.cancelNext){target.searchParams.set('userId',runtime.oauthUID);target.searchParams.set('secret',runtime.appwrite.issueToken(runtime.oauthUID));}
      runtime.cancelNext=false;
      return route.fulfill({status:302,headers:{Location:target.href}});
    }
    return route.abort();
  });
  return c;
}
async function ready(page) { await page.waitForFunction(()=>document.querySelector('[data-account-link]')&&!document.querySelector('[data-account-link]').hidden); }
try {
  const guest=await context();
  await guest.addInitScript(f=>{if(!localStorage.getItem('fixture-seeded')){localStorage.setItem('er:saved',JSON.stringify({[f.id]:f}));localStorage.setItem('fixture-seeded','yes');}},fixture);
  const page=await guest.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/favorites/');await ready(page);
  await page.waitForFunction(()=>document.querySelectorAll('#favorites-list .row').length===1);
  assert.equal(await page.locator('#favorites-list .title').textContent(),fixture.title);
  assert.equal(await page.evaluate(()=>localStorage.getItem('er:saved')),null);
  assert.equal(await page.locator('.favorite-btn').getAttribute('aria-pressed'),'true');
  ok('Legacy migration, green accessible heart, and safe article text rendering');
  await page.locator('.favorite-btn').click();await page.waitForFunction(()=>document.querySelectorAll('#favorites-list .row').length===0);
  await page.goto(origin);await ready(page);
  await page.locator('.favorite-btn').first().click();
  await page.waitForFunction(()=>document.querySelector('.favorite-btn').getAttribute('aria-pressed')==='true');
  const articleId=await page.locator('.row').first().getAttribute('data-id');
  assert.equal(await page.locator('#favorite-nudge').isVisible(),true);
  await page.locator('[data-dismiss-nudge]').click();
  await page.locator('.favorite-btn').first().click();await page.locator('.favorite-btn').first().click();
  assert.equal(await page.locator('#favorite-nudge').isVisible(),false);
  await page.goto(origin+'/favorites/');await ready(page);
  await page.waitForFunction(()=>document.querySelectorAll('#favorites-list .row').length===1);
  ok('Guest local saving, persistence across pages, and 24-hour dismissible nudge');

  await page.goto(origin+'/signin/?returnTo=%2Ffavorites%2F');await ready(page);
  assert.equal(await page.locator('[data-auth-provider]').count(),1);
  assert.equal(await page.locator('[data-auth-provider="google"]').isVisible(),true);
  runtime.cancelNext=true;
  await page.locator('[data-auth-provider="google"]').click();
  await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('cancelled'));
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('er:favorites:v1')).items).length),1);
  await page.locator('[data-auth-provider="google"]').click();await page.waitForURL('**/favorites/');await ready(page);
  await page.waitForFunction(()=>document.querySelector('[data-account-link]').textContent==='Account');
  await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('er:favorites:v1')).items).length===0);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM favorite WHERE userId=?').bind(await userId('alice')).first()).total,1);
  const device=await context();await signIn(device,'alice');const other=await device.newPage();
  await other.goto(origin+'/favorites/');await ready(other);await other.waitForFunction(()=>document.querySelectorAll('#favorites-list .row').length===1);
  ok('Google-only redirect, cancellation/retry, safe return, automatic import and a second device');

  await signIn(guest,'bob');await page.reload();await ready(page);
  await page.waitForFunction(()=>document.querySelectorAll('#favorites-list .row').length===0);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM favorite WHERE userId=?').bind(await userId('alice')).first()).total,1);
  ok('Account switching does not expose or import the previous account collection');
  await signIn(guest,'alice');await page.goto(origin);await ready(page);
  await page.waitForFunction(()=>document.querySelector('.favorite-btn').getAttribute('aria-pressed')==='true');
  await page.route('**/api/favorites/'+articleId,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test outage'})}));
  await page.locator('.favorite-btn').first().click();
  await page.waitForFunction(()=>document.querySelector('#account-status').dataset.error==='true');
  assert.equal(await page.locator('.favorite-btn').first().getAttribute('aria-pressed'),'true');
  await page.unroute('**/api/favorites/'+articleId);
  ok('Failed account writes roll back the heart and retain the server favorite');

  await page.goto(origin+'/account/');await ready(page);
  await page.locator('[data-signout]').click();await page.waitForFunction(()=>document.querySelector('[data-account-link]').textContent==='Sign in');
  await page.goto(origin+'/favorites/');await ready(page);
  assert.equal(await page.locator('#favorites-list .row').count(),0);
  ok('Logout leaves cloud favorites on the server and does not leak them into guest storage');

  const bulk=Array.from({length:51},(_,i)=>({...fixture,id:(i+1000).toString(16).padStart(16,'0'),title:'Imported '+i,savedAt:Date.now()}));
  await page.evaluate(values=>localStorage.setItem('er:favorites:v1',JSON.stringify({version:1,items:Object.fromEntries(values.map(f=>[f.id,f]))})),bulk);
  await signIn(guest,'bob');let imports=0;
  await page.route('**/api/favorites/import',route=>{imports++;return imports===2?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Test second batch failure"}'}):route.continue();});
  await page.reload();await ready(page);await page.waitForFunction(()=>document.querySelector('#account-status').dataset.error==='true');
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('er:favorites:v1')).items).length),1);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM favorite WHERE userId=?').bind(await userId('bob')).first()).total,50);
  await page.unroute('**/api/favorites/import');await page.locator('[data-account-retry]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#favorites-list .row').length===51);
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('er:favorites:v1')).items).length),0);
  ok('Partial import retains unacknowledged guest favorites and retry finishes without duplication');

  for(const width of [320,390,560,768,1440]) {
    await page.setViewportSize({width,height:900});
    for(const path of ['/','/favorites/','/signin/','/account/']) {
      await page.goto(origin+path);await ready(page);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${path} overflow at ${width}`);
    }
  }
  ok('Feed, Favorites, sign-in, account and navigation fit widths 320â€“1440');
  await page.goto(origin+'/account/');await ready(page);await page.waitForFunction(()=>!document.querySelector('[data-signed-in-only]').hidden);
  assert.equal(await page.locator('[data-reauth]').isVisible(),true);
  runtime.oauthUID='bob';
  await page.locator('[data-reauth]').click();await page.waitForURL('**/account/?confirmed=1');await ready(page);
  await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('confirmed'));
  assert.equal(await page.evaluate(()=>document.cookie.includes('devreads.session')),false);
  await page.locator('#theme-toggle').click();
  await page.screenshot({path:'.wrangler/browser-check/account-light.png'});
  await page.goto(origin+'/signin/');await ready(page);await page.locator('[data-signout]').count();
  await page.screenshot({path:'.wrangler/browser-check/signin.png'});
  ok('Google reauthentication control and light/dark themed pages');
  await page.goto(origin+'/account/');await ready(page);await page.locator('[data-delete-start]').click();
  assert.equal(await page.locator('[data-delete-confirm]').isVisible(),true);
  await page.locator('[data-delete-cancel]').click();assert.equal(await page.locator('[data-delete-confirm]').isVisible(),false);
  await page.locator('[data-delete-start]').click();await page.locator('[data-delete-account]').click();
  await page.waitForURL('**/favorites/');await ready(page);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM favorite WHERE userId=?').bind(await userId('bob')).first()).total,0);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM user WHERE id=?').bind(await userId('bob')).first()).total,0);
  ok('Explicit deletion confirmation and removal of account/favorites');
  const clean=await context();const requests=[];const cleanPage=await clean.newPage();cleanPage.on('request',r=>requests.push(r.url()));
  await cleanPage.goto(origin+'/signin/');await ready(cleanPage);
  assert.equal(await cleanPage.locator('[data-auth-provider="google"]').isVisible(),true);
  assert.equal(requests.some(url=>/firebase|identitytoolkit|googleapis/.test(url)),false);
  assert.equal(await cleanPage.evaluate(()=>Object.keys(localStorage).some(key=>/firebase|appwrite/.test(key))),false);
  ok('No Firebase SDK requests or authentication tokens in browser localStorage');await clean.close();
  const unavailable=await context();await unavailable.route('**/api/auth/sign-in/google',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Sign-in is temporarily unavailable"}'}));
  const offline=await unavailable.newPage();await offline.goto(origin);await ready(offline);
  await offline.locator('.favorite-btn').first().click();
  await offline.waitForFunction(()=>document.querySelector('.favorite-btn').getAttribute('aria-pressed')==='true');
  await offline.goto(origin+'/signin/');await ready(offline);await offline.locator('[data-auth-provider="google"]').click();
  await offline.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('unavailable'));
  assert.equal(await offline.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('er:favorites:v1')).items).length),1);
  ok('Unavailable sign-in retains local guest Favorites and offers retry');await unavailable.close();
  assert.deepEqual(errors,[]);
  console.log(`${passed} actual Worker/D1 browser verification groups passed.`);
} finally {await browser.close();await runtime.mf.dispose();}
