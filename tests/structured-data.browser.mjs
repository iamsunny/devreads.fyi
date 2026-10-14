import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserRuntime } from './browser-runtime.mjs';

const runtime = process.env.SEO_TEST_ORIGIN ? null : await browserRuntime();
const origin = process.env.SEO_TEST_ORIGIN || runtime.origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.newContext({ extraHTTPHeaders: { 'Sec-Purpose': 'prefetch' } });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const paths = ['/', '/page/2/', '/digest/', '/tags/', '/tag/security/', '/sources/', '/source/netflix/', '/favorites/', '/signin/', '/account/'];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      const response = await page.goto(origin + path); assert.equal(response.status(), 200, path);
      assert.equal(await page.locator('h1').count(), 1, path);
      for (const theme of ['light','dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} ${width} ${theme}`);
      }
      if (!['/favorites/', '/signin/', '/account/'].includes(path)) {
        const data = await page.locator('script[type="application/ld+json"]').evaluate(el => JSON.parse(el.textContent));
        assert.equal(data['@context'], 'https://schema.org');
        const list = data['@graph'].find(node => node['@type'] === 'ItemList');
        if (list && await page.locator('article.row').count()) {
          assert.equal(list.numberOfItems, await page.locator('article.row').count());
          assert.deepEqual(list.itemListElement.map(node => node.item.url), await page.locator('article.row .title a').evaluateAll(links => links.map(link => link.href)));
        }
      }
    }
  }
  await page.goto(origin+'/tag/security/');
  assert.equal(await page.locator('.breadcrumbs [aria-current="page"]').textContent(), '#security');
  await page.getByRole('navigation', {name:'Breadcrumb',exact:true}).getByRole('link',{name:'Tags',exact:true}).focus();
  assert.equal(await page.locator('.breadcrumbs a:focus').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await page.keyboard.press('Enter'); await page.waitForURL('**/tags/');
  await page.goto(origin+'/source/netflix/');
  await page.getByRole('navigation', {name:'Breadcrumb',exact:true}).getByRole('link',{name:'Sources',exact:true}).click();
  await page.waitForURL('**/sources/');
  await page.goto(origin+'/saved/'); await page.waitForURL('**/favorites/');
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, follow');
  await mkdir('.wrangler/browser-check', {recursive:true});
  await page.setViewportSize({width:390,height:844}); await page.goto(origin+'/tag/security/');
  await page.screenshot({path:'.wrangler/browser-check/seo-tag-mobile.png'});
  await page.setViewportSize({width:1440,height:900}); await page.goto(origin);
  await page.evaluate(() => {document.documentElement.dataset.theme='light';});
  await page.screenshot({path:'.wrangler/browser-check/seo-home-desktop.png'});
  assert.deepEqual(errors, []);
  console.log('Structured-data browser checks passed: ten routes, both themes, widths 320–1440, rendered list URLs, breadcrumb links/keyboard focus, Saved redirect and noindex.');
} finally { await browser.close(); if(runtime) await runtime.mf.dispose(); }
