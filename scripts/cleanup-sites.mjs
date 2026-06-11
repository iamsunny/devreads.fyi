// One-time hygiene pass over sites.yml:
// - drops sites that have never had a successful fetch (dead seed entries);
//   sites with a completed backfill are kept even if the last pull failed
//   (transient errors like rate limits recover on their own)
// - ensures every entry has a display `title` (defaults to name)
// - prunes state entries and stray post files for removed sites
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { loadState, saveState } from '../ingest/store.mjs';

const sites = parse(readFileSync('sites.yml', 'utf8')).sites;
const state = loadState();

const kept = [];
const removed = [];
for (const site of sites) {
  const st = state[site.id];
  const everSucceeded = Boolean(st?.backfilledAt || st?.lastSuccessAt);
  const isDead = st && !everSucceeded && ['failing', 'quarantined'].includes(st.status);
  if (isDead) {
    removed.push({ id: site.id, error: st.lastError });
    delete state[site.id];
    const file = `data/posts/${site.id}.ndjson`;
    if (existsSync(file)) unlinkSync(file);
    continue;
  }
  kept.push({
    id: site.id,
    name: site.name,
    title: site.title ?? site.name,
    feed: site.feed,
    url: site.url,
    ...(site.tags ? { tags: site.tags } : {}),
  });
}

writeFileSync('sites.yml', stringify({ sites: kept }, { lineWidth: 0 }));
saveState(state);
console.log(`kept ${kept.length}, removed ${removed.length} dead site(s):`);
for (const r of removed) console.log(`  - ${r.id} (${r.error})`);
