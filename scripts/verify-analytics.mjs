// Run after the static build. Validate the shared analytics markup and our
// consent initialization without executing third-party JavaScript.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';

const cookiehubUrl = 'https://cdn.cookiehub.eu/c2/fa59a1b5.js';
const googleUrl = 'https://www.googletagmanager.com/gtag/js?id=G-VR4M09Z7LQ';
let pages = 0;
let sample;

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(filename); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const html = await readFile(filename, 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([, attributes, code]) => ({ attributes, code }));
    // Articles may mention the vendor; only executable code constitutes an installation.
    const executable = scripts.filter(script => !/type=["']application\/(?:ld\+)?json["']/i.test(script.attributes));
    assert.ok(executable.every(script => !/posthog|phc_/i.test(script.attributes + script.code)), `Removed analytics code in ${filename}`);
    const cookiehub = scripts.filter(script => script.attributes.includes(cookiehubUrl));
    const google = scripts.filter(script => script.attributes.includes(googleUrl));
    const defaults = scripts.filter(script => script.code.includes('wait_for_update'));
    const initialize = scripts.filter(script => script.code.includes('window.cookiehub.load'));
    const configure = scripts.filter(script => script.code.includes("gtag('config', 'G-VR4M09Z7LQ')"));
    for (const group of [cookiehub, google, defaults, initialize, configure]) assert.equal(group.length, 1, filename);
    assert.match(google[0].attributes, /\basync\b/, filename);
    assert.ok(scripts.indexOf(defaults[0]) < scripts.indexOf(cookiehub[0]), filename);
    assert.ok(scripts.indexOf(cookiehub[0]) < scripts.indexOf(google[0]), filename);
    assert.ok(scripts.indexOf(initialize[0]) < scripts.indexOf(google[0]), filename);
    assert.ok(scripts.indexOf(defaults[0]) < scripts.indexOf(configure[0]), filename);
    assert.match(html, /class="ch2-open-settings-btn"/, filename);
    assert.equal((html.match(/data-visit-counter>/g) || []).length, 1, filename);
    sample ??= { defaults: defaults[0].code, initialize: initialize[0].code, configure: configure[0].code };
    pages++;
  }
}

await inspect('dist');
assert.ok(pages > 0, 'Build the site before running this check');
for (const available of [true, false]) {
  const listeners = new Map();
  let loaded = 0;
  const browser = {
    dataLayer: [],
    document: { addEventListener: (event, handler) => listeners.set(event, handler) },
    ...(available ? { cookiehub: { load: options => { assert.equal(Object.keys(options).length, 0); loaded++; } } } : {}),
  };
  browser.window = browser;
  const context = vm.createContext(browser);
  vm.runInContext(sample.defaults, context);
  const [command, action, consent] = Array.from(browser.dataLayer[0]);
  assert.equal(command, 'consent'); assert.equal(action, 'default');
  for (const key of ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization']) assert.equal(consent[key], 'denied');
  vm.runInContext(sample.initialize, context);
  vm.runInContext(sample.configure, context);
  assert.equal(loaded, 0, 'CookieHub initializes at DOMContentLoaded');
  listeners.get('DOMContentLoaded')();
  assert.equal(loaded, available ? 1 : 0);
  const commands = browser.dataLayer.map(value => Array.from(value));
  assert.equal(commands.filter(value => value[0] === 'config').length, 1);
  assert.equal(commands.find(value => value[0] === 'config')[1], 'G-VR4M09Z7LQ');
}
for (const filename of ['public/app.js', 'src/lib/site.mjs']) {
  assert.doesNotMatch(await readFile(filename, 'utf8'), /posthog|phc_/i, filename);
}
assert.doesNotMatch(await readFile('dist/privacy/index.html', 'utf8'), /Short version: no accounts, no cookies/);
console.log(`Verified ${pages} pages: one CookieHub loader, one GA4 tag, denied consent defaults before measurement, cookie-settings link, retained visit counter, and no removed analytics code. CookieHub initialization and CDN-failure fallback passed.`);
