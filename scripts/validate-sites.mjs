// PR gate for sites.yml. Validates the whole file's shape, then live-checks
// every entry that is new or whose feed changed vs the base branch:
//   - feed and url must be https://
//   - name and title must be non-empty
//   - the feed must fetch successfully and return at least one item
// Exits non-zero (failing the build) if anything is wrong.
// Base resolution: origin/$BASE_REF in CI, HEAD when run locally.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse } from 'yaml';
import { fetchUrl, parseFeed } from '../ingest/feed.mjs';

const errors = [];
const fail = (msg) => errors.push(msg);

const current = parse(readFileSync('sites.yml', 'utf8'))?.sites;
if (!Array.isArray(current)) {
  console.error('sites.yml: missing top-level `sites` list');
  process.exit(1);
}

// --- whole-file shape checks ------------------------------------------------
const ids = new Set();
const feeds = new Set();
for (const s of current) {
  const label = s?.id ?? s?.name ?? JSON.stringify(s).slice(0, 40);
  for (const field of ['id', 'name', 'title', 'feed', 'url']) {
    if (typeof s?.[field] !== 'string' || !s[field].trim()) fail(`${label}: missing or empty "${field}"`);
  }
  if (s?.id && ids.has(s.id)) fail(`${label}: duplicate id`);
  if (s?.feed && feeds.has(s.feed)) fail(`${label}: duplicate feed URL`);
  ids.add(s?.id);
  feeds.add(s?.feed);
}

// --- find new/changed entries vs base ----------------------------------------
function baseSites() {
  const refs = process.env.BASE_REF ? [`origin/${process.env.BASE_REF}`, process.env.BASE_REF] : ['HEAD'];
  for (const ref of refs) {
    try {
      return parse(execSync(`git show ${ref}:sites.yml`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))?.sites ?? [];
    } catch {
      continue;
    }
  }
  return [];
}
const baseByFeed = new Set(baseSites().map((s) => s.feed));
const added = current.filter((s) => s?.feed && !baseByFeed.has(s.feed));

console.log(`sites.yml: ${current.length} entries, ${added.length} new/changed vs base`);

// --- live checks for new entries ---------------------------------------------
for (const s of added) {
  const label = s.id ?? s.name;
  if (!/^https:\/\//.test(s.feed ?? '')) fail(`${label}: feed must use https:// (got "${s.feed}")`);
  if (!/^https:\/\//.test(s.url ?? '')) fail(`${label}: url must use https:// (got "${s.url}")`);
  if (!s.title?.trim()) continue; // already reported above
  if (errors.some((e) => e.startsWith(`${label}:`))) continue; // skip fetch if shape is broken

  try {
    const res = await fetchUrl(s.feed, { timeoutMs: 25000 });
    const feed = await parseFeed(res.text);
    const count = feed.items?.length ?? 0;
    if (!count) fail(`${label}: feed fetched but returned 0 items — not a usable feed`);
    else console.log(`  ok: ${label} (${count} items, "${feed.title ?? ''}")`);
  } catch (err) {
    fail(`${label}: feed fetch failed — ${err?.message ?? err}`);
  }
}

if (errors.length) {
  console.error(`\nValidation failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('All checks passed.');
