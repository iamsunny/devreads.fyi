import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isUtilityPage, serializeStructuredData } from '../src/lib/structured-data.mjs';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
const decode = value => value.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, key) => entities[key]);
const attr = (tag, name) => decode(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '');
const text = html => decode(html.replace(/<[^>]*>/g, '')).trim();
const attack = { name: '</script><script>alert("x")</script>&\u2028\u2029' };
const encoded = serializeStructuredData(attack);
assert.ok(!/[<>&\u2028\u2029]/.test(encoded), 'Feed data must not terminate the JSON-LD script');
assert.deepEqual(JSON.parse(encoded), attack, 'Escaping must preserve original data');
assert.equal(isUtilityPage('/tag/account/'), false, 'Public topics must not be mistaken for account pages');
assert.equal(isUtilityPage('/demo/signin/', '/demo/'), true, 'Support configured deployment base paths');

let pages = 0, publicPages = 0, lists = 0, entries = 0, crumbs = 0;
const indexable = new Set();
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(file); continue; }
    if (!file.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8'); pages++;
    const canonical = attr(html.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0] || '', 'href');
    assert.ok(canonical.startsWith('https://'), file);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `One page heading: ${file}`);
    const blocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    const utility = isUtilityPage(new URL(canonical).pathname);
    if (utility) {
      assert.match(html, /<meta name="robots" content="noindex, follow"/, file);
      assert.equal(blocks.length, 0, `No personal data schema: ${file}`); continue;
    }
    publicPages++; indexable.add(canonical);
    assert.equal(blocks.length, 1, `One graph: ${file}`);
    const data = JSON.parse(blocks[0][1]);
    assert.equal(data['@context'], 'https://schema.org');
    const graph = data['@graph'];
    assert.equal(new Set(graph.map(node => node['@id'])).size, graph.length, file);
    const page = graph.find(node => ['WebPage', 'CollectionPage'].includes(node['@type']));
    assert.equal(page.url, canonical); assert.equal(page['@id'], canonical+'#webpage');
    assert.equal(page.name, text(html.match(/<title>(.*?)<\/title>/s)[1]));
    assert.equal(page.description, attr(html.match(/<meta\b[^>]*name="description"[^>]*>/)[0], 'content'));
    const website = graph.find(node => node['@type'] === 'WebSite');
    if (new URL(canonical).pathname === '/') {
      assert.equal(website?.url, canonical); assert.equal(website?.name, 'devreads.fyi');
    } else assert.equal(website, undefined, file);
    let visible = [...html.matchAll(/<article\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].map(([tag]) => ({ title: attr(tag, 'data-title'), url: attr(tag, 'data-url') }));
    const pathname = new URL(canonical).pathname;
    if (pathname.endsWith('/tags/')) visible = [...html.matchAll(/<li\b[^>]*data-tag-search[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>\s*<span class="tag-name"[^>]*>([\s\S]*?)<\/span>\s*<span class="tag-count"/g)].map(([,url,name]) => ({ title: text(name), url: new URL(decode(url),canonical).href }));
    if (pathname.endsWith('/sources/')) visible = [...html.matchAll(/<a\b[^>]*class="src"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(([,url,name]) => ({ title: text(name), url: new URL(decode(url),canonical).href }));
    const list = graph.find(node => node['@type'] === 'ItemList');
    if (list) {
      lists++; entries += visible.length;
      assert.equal(page['@type'], 'CollectionPage');
      assert.equal(page.mainEntity['@id'], list['@id']);
      assert.equal(list.numberOfItems, visible.length, file);
      assert.equal(list.itemListElement.length, visible.length, file);
      list.itemListElement.forEach((node, i) => {
        assert.equal(node['@type'], 'ListItem'); assert.equal(node.position, i+1);
        assert.equal(node.item['@type'], 'WebPage');
        assert.ok(['https:', 'http:'].includes(new URL(node.item.url).protocol), file);
        assert.deepEqual({ title: node.item.name, url: node.item.url }, visible[i], `Schema must match rendered entry ${i+1}: ${file}`);
      });
    } else assert.equal(visible.length, 0, `Missing collection markup: ${file}`);
    const breadcrumb = graph.find(node => node['@type'] === 'BreadcrumbList');
    const nav = html.match(/<nav\b[^>]*class="breadcrumbs"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    if (breadcrumb) {
      crumbs++; assert.ok(nav, file); assert.equal(page.breadcrumb['@id'], breadcrumb['@id']);
      const actual = [...nav.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([,value]) => ({ name: text(value), item: value.includes('<a ') ? new URL(attr(value.match(/<a\b[^>]*>/)[0],'href'),canonical).href : canonical }));
      assert.deepEqual(breadcrumb.itemListElement.map((node,i) => {assert.equal(node.position,i+1); return {name:node.name,item:node.item};}),actual,file);
      assert.match(nav, /aria-current="page"/);
    } else assert.equal(nav, undefined, file);
  }
}
await inspect('dist');
let sitemap = '';
for (const name of await readdir('dist')) if (/^sitemap-\d+\.xml$/.test(name)) sitemap += await readFile(join('dist',name),'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([,url])=>decode(url));
assert.deepEqual(new Set(urls), indexable, 'Sitemap should contain exactly the indexable canonical HTML pages');
console.log(`Verified ${pages} pages: ${publicPages} public graphs, ${lists} lists / ${entries} visible entries, ${crumbs} breadcrumb trails, safe JSON-LD, one H1 each, and sitemap/noindex exclusions.`);
