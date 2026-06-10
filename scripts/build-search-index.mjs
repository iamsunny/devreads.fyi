// Builds the Pagefind index directly from the post store (custom records,
// no HTML crawling) and writes it into dist/pagefind. Run after `astro build`.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import * as pagefind from 'pagefind';
import { loadAllPosts } from '../ingest/store.mjs';

const sites = parse(readFileSync('sites.yml', 'utf8')).sites;
const nameById = new Map(sites.map((s) => [s.id, s.name]));

const posts = loadAllPosts();
const { index } = await pagefind.createIndex();

for (const p of posts) {
  if (!p.url) continue;
  const source = nameById.get(p.siteId) ?? p.siteId;
  await index.addCustomRecord({
    url: p.url,
    content: `${p.title}. ${p.summary ?? ''}`,
    language: 'en',
    meta: {
      title: p.title,
      source,
      date: p.published?.slice(0, 10) ?? '',
      url: p.url,
    },
    filters: {
      source: [source],
      tag: p.tags ?? [],
      year: [p.published?.slice(0, 4) ?? 'undated'],
    },
    sort: { date: p.published ?? '0000' },
  });
}

await index.writeFiles({ outputPath: 'dist/pagefind' });
await pagefind.close();
console.log(`search index: ${posts.length} posts`);
