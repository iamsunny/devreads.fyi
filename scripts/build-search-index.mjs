// Builds the client-side search index: a manifest plus ~10 sharded JSON files
// under dist/search/. Replaces Pagefind, whose one-fragment-file-per-record
// layout (~21K files for 19K posts) exceeded Cloudflare Pages' 20,000-file
// deployment limit. Records are compact tuples:
//   [title, url, sourceName, date(YYYY-MM-DD|''), tags[], summary(<=200 chars)]
// Run after `astro build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'yaml';
import { loadAllPosts } from '../ingest/store.mjs';

const SHARD_SIZE = 2000;
const TAG_LIMIT = 60;
const MIN_TAG_COUNT = 3;

const sites = parse(readFileSync('sites.yml', 'utf8')).sites;
const nameById = new Map(sites.map((s) => [s.id, s.name]));

const posts = loadAllPosts()
  .filter((p) => p.url)
  .sort((a, b) => {
    if (!a.published) return 1;
    if (!b.published) return -1;
    return b.published < a.published ? -1 : b.published > a.published ? 1 : 0;
  });

const sourceCounts = new Map();
const tagCounts = new Map();
const records = posts.map((p) => {
  const source = nameById.get(p.siteId) ?? p.siteId;
  sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  for (const t of p.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  return [
    p.title,
    p.url,
    source,
    p.published?.slice(0, 10) ?? '',
    p.tags ?? [],
    (p.summary ?? '').slice(0, 200),
  ];
});

mkdirSync('dist/search', { recursive: true });
const shardCount = Math.max(1, Math.ceil(records.length / SHARD_SIZE));
for (let i = 0; i < shardCount; i++) {
  writeFileSync(`dist/search/shard-${i}.json`, JSON.stringify(records.slice(i * SHARD_SIZE, (i + 1) * SHARD_SIZE)));
}
writeFileSync(
  'dist/search/manifest.json',
  JSON.stringify({
    total: records.length,
    shardCount,
    sources: [...sourceCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count })),
    tags: [...tagCounts.entries()]
      .filter(([, n]) => n >= MIN_TAG_COUNT)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TAG_LIMIT),
  })
);
console.log(`search index: ${records.length} posts in ${shardCount} shards`);
