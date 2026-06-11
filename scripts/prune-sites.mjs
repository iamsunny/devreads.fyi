// Removes stored posts and fetch state for any site no longer present in
// sites.yml, so removing a YAML entry plus running this is a complete removal.
// Run explicitly (not part of ingest) so a typo in sites.yml can't mass-delete
// data on a scheduled run. Pass --dry-run to preview.
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { loadState, saveState } from '../ingest/store.mjs';

const dryRun = process.argv.includes('--dry-run');
const ids = new Set(parse(readFileSync('sites.yml', 'utf8')).sites.map((s) => s.id));

let removedFiles = 0;
if (existsSync('data/posts')) {
  for (const f of readdirSync('data/posts')) {
    if (!f.endsWith('.ndjson')) continue;
    const id = f.slice(0, -'.ndjson'.length);
    if (ids.has(id)) continue;
    console.log(`  ${dryRun ? 'would remove' : 'removing'} data/posts/${f}`);
    if (!dryRun) unlinkSync(`data/posts/${f}`);
    removedFiles++;
  }
}

const state = loadState();
let removedState = 0;
for (const id of Object.keys(state)) {
  if (ids.has(id)) continue;
  if (!dryRun) delete state[id];
  removedState++;
}
if (!dryRun) saveState(state);

console.log(`${dryRun ? '[dry-run] ' : ''}pruned ${removedFiles} post file(s), ${removedState} state entr${removedState === 1 ? 'y' : 'ies'} (${ids.size} sites kept)`);
