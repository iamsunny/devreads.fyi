// Post store: one NDJSON file per site under data/posts/, plus data/state.json
// for per-site fetch state. NDJSON keeps git diffs append-only across scheduled commits.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const POSTS_DIR = 'data/posts';
const STATE_PATH = 'data/state.json';

export function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

export function saveState(state) {
  mkdirSync('data', { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function loadPosts(siteId) {
  const file = join(POSTS_DIR, `${siteId}.ndjson`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function appendPosts(siteId, posts) {
  if (!posts.length) return;
  mkdirSync(POSTS_DIR, { recursive: true });
  const file = join(POSTS_DIR, `${siteId}.ndjson`);
  appendFileSync(file, posts.map((p) => JSON.stringify(p)).join('\n') + '\n');
}

export function loadAllPosts() {
  if (!existsSync(POSTS_DIR)) return [];
  const all = [];
  for (const f of readdirSync(POSTS_DIR)) {
    if (!f.endsWith('.ndjson')) continue;
    const siteId = f.slice(0, -'.ndjson'.length);
    for (const p of loadPosts(siteId)) all.push({ ...p, siteId });
  }
  return all;
}
