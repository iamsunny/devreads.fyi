// Run after the static build to check shared controls and the complete directory.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tagDirectory } from '../src/lib/data.mjs';

let pages = 0;
let articles = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(filename); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const html = await readFile(filename, 'utf8');
    const rows = (html.match(/<article\b[^>]*class="row"/g) || []).length;
    assert.equal((html.match(/class="share-btn"/g) || []).length, rows, `Share controls: ${filename}`);
    assert.equal((html.match(/class="favorite-btn"/g) || []).length, rows, `Favorite controls: ${filename}`);
    assert.equal((html.match(/id="article-share-menu"/g) || []).length, 1, `Shared menu: ${filename}`);
    assert.equal((html.match(/<script[^>]+src="[^"]*\/share\.js"[^>]*defer/g) || []).length, 1, `Deferred sharing: ${filename}`);
    assert.match(html, /href="[^"]*\/tags\/">Tags<\/a>/, `Tags navigation: ${filename}`);
    articles += rows;
    pages++;
  }
}
await inspect('dist');
assert.ok(pages > 0 && articles > 0, 'Build the site before running this check');
for (const asset of ['share.js', 'app.js', 'account.js', 'favorites-store.js']) {
  assert.equal(await readFile(`dist/${asset}`, 'utf8'), await readFile(`public/${asset}`, 'utf8'), `Stale built ${asset}`);
}
const directory = await readFile('dist/tags/index.html', 'utf8');
assert.match(directory, /data-tags-empty[^>]*>No matching tags\./, 'Empty state must render for filtering to initialize');
assert.equal((directory.match(/data-tag-search=/g) || []).length, tagDirectory.length);
assert.equal(new Set(tagDirectory.map(entry => entry.slug)).size, tagDirectory.length);
for (const { slug, count } of tagDirectory) {
  assert.ok(directory.includes(`/tag/${slug}/`), `Directory entry missing: ${slug}`);
  const html = await readFile(`dist/tag/${slug}/index.html`, 'utf8');
  assert.ok(html.includes(`<p>${count} posts`), `Directory count differs from tag page: ${slug}`);
}
console.log(`Verified ${pages} pages, ${articles} article controls, shared menus/scripts, Tags navigation, current assets, and ${tagDirectory.length} unique tag destinations with matching counts.`);
