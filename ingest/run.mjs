// Ingest orchestrator. Per-site state machine:
//   new -> backfilling -> active, with failing -> quarantined on repeated errors.
// Sites present in sites.yml but absent from state.json are new: they get the
// backfill path automatically. Everyone else gets a cheap conditional-GET delta.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { fetchUrl, parseFeed } from './feed.mjs';
import { backfillExtraPages } from './backfill.mjs';
import { normalizeItem, postKey } from './normalize.mjs';
import { loadState, saveState, loadPosts, appendPosts } from './store.mjs';
import { pruneOrphans } from './prune.mjs';

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const LIMIT = Number(argVal('limit', 0));
const ONLY = argVal('site', null);
const CONCURRENCY = Number(argVal('concurrency', 8));
const MAX_PAGES = Number(argVal('backfill-pages', 10));
const BACKFILL_CAP = 500;
const QUARANTINE_AFTER = 8;
const QUARANTINE_RETRY_HOURS = 24;

const sites = parse(readFileSync('sites.yml', 'utf8')).sites;
let queue = ONLY ? sites.filter((s) => s.id === ONLY) : sites;
if (LIMIT) queue = queue.slice(0, LIMIT);

// Prune before loading state: the end-of-run state save would otherwise
// resurrect entries the prune just removed.
const pruneResult = pruneOrphans(new Set(sites.map((s) => s.id)));

const state = loadState();
const counters = { backfilled: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0, newPosts: 0 };

async function processSite(site) {
  const st = state[site.id] ?? (state[site.id] = { status: 'new', failCount: 0 });
  const now = new Date().toISOString();

  if (st.status === 'quarantined') {
    const last = st.lastPolledAt ? Date.parse(st.lastPolledAt) : 0;
    if (Date.now() - last < QUARANTINE_RETRY_HOURS * 3600e3) {
      counters.skipped++;
      return;
    }
  }

  // Backfill is pending until it has succeeded once; status only reports health.
  const isBackfill = !st.backfilledAt;
  try {
    const res = await fetchUrl(site.feed, isBackfill ? {} : { etag: st.etag, lastModified: st.lastModified });
    st.lastPolledAt = now;
    if (res.status === 304) {
      st.failCount = 0;
      st.status = 'active';
      counters.unchanged++;
      return;
    }

    const feed = await parseFeed(res.text);
    let rawItems = feed.items ?? [];
    const existing = new Set(loadPosts(site.id).map((p) => p.id));
    if (isBackfill) {
      rawItems = rawItems.concat(await backfillExtraPages(site.feed, res.text, { maxPages: MAX_PAGES, existing }));
    }

    const fresh = [];
    const seen = new Set(existing);
    for (const item of rawItems) {
      const key = postKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(normalizeItem(item));
      if (isBackfill && existing.size + fresh.length >= BACKFILL_CAP) break;
    }
    appendPosts(site.id, fresh);

    st.etag = res.etag;
    st.lastModified = res.lastModified;
    st.failCount = 0;
    st.lastSuccessAt = now;
    st.lastError = null;
    st.status = 'active';
    if (isBackfill) {
      st.backfilledAt = now;
      st.backfillDepth = existing.size + fresh.length;
      counters.backfilled++;
    } else {
      counters.updated++;
    }
    counters.newPosts += fresh.length;
    if (fresh.length) console.log(`  ${site.id}: +${fresh.length} post(s)${isBackfill ? ' [backfill]' : ''}`);
  } catch (err) {
    st.lastPolledAt = now;
    st.failCount = (st.failCount ?? 0) + 1;
    st.lastError = String(err?.message ?? err).slice(0, 200);
    st.status = st.failCount >= QUARANTINE_AFTER ? 'quarantined' : 'failing';
    counters.failed++;
    console.log(`  ${site.id}: FAIL ${st.lastError}`);
  }
}

// Per-host serialization with a gap: many sites share a host (~25 on
// medium.com), and hitting one host with the full concurrency triggers 429s.
// Medium rate-limits harder than most, so it gets a longer gap.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostQueues = new Map();
const hostGap = (host) => (host.endsWith('medium.com') ? 2500 : 400);
function withHostLock(url, fn) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    host = url;
  }
  const gap = hostGap(host);
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  hostQueues.set(host, run.then(() => sleep(gap), () => sleep(gap)));
  return run;
}

let cursor = 0;
async function workerLoop() {
  while (cursor < queue.length) {
    const site = queue[cursor++];
    await withHostLock(site.feed, () => processSite(site));
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, queue.length)) }, workerLoop));
saveState(state);
console.log(
  `done in ${Math.round((Date.now() - started) / 1000)}s: ` +
    `${counters.backfilled} backfilled, ${counters.updated} updated, ${counters.unchanged} unchanged (304), ` +
    `${counters.failed} failed, ${counters.skipped} quarantined-skipped, +${counters.newPosts} posts` +
    (pruneResult.pruned ? `, pruned ${pruneResult.pruned} removed site(s)` : '')
);
