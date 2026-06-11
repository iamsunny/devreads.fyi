// Removes stored posts and fetch state for sites absent from sites.yml.
// Runs automatically at the start of every ingest, so deleting a YAML entry
// is a complete removal. Safety guard: refuses to prune more than half of the
// stored sites in one pass (a mangled sites.yml must not wipe the archive);
// pass force for intentional mass curation via scripts/prune-sites.mjs.
import { readdirSync, unlinkSync, existsSync } from 'node:fs';
import { loadState, saveState } from './store.mjs';

export function pruneOrphans(ids, { dryRun = false, force = false, log = console.log } = {}) {
  const files = existsSync('data/posts')
    ? readdirSync('data/posts').filter((f) => f.endsWith('.ndjson'))
    : [];
  const orphans = files.filter((f) => !ids.has(f.slice(0, -'.ndjson'.length)));

  if (!force && files.length > 0 && orphans.length > files.length / 2) {
    const msg =
      `prune: refusing to remove ${orphans.length} of ${files.length} post files in one pass; ` +
      'run "node scripts/prune-sites.mjs --force" if this is intentional';
    log(msg);
    // Surface as an annotation on the workflow run instead of a green silence.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Prune guard triggered::${msg}`);
    return { pruned: 0, prunedState: 0, refused: orphans.length };
  }

  for (const f of orphans) {
    log(`  prune: ${dryRun ? 'would remove' : 'removing'} data/posts/${f}`);
    if (!dryRun) unlinkSync(`data/posts/${f}`);
  }

  const state = loadState();
  let prunedState = 0;
  for (const id of Object.keys(state)) {
    if (ids.has(id)) continue;
    if (!dryRun) delete state[id];
    prunedState++;
  }
  if (!dryRun && prunedState) saveState(state);

  return { pruned: orphans.length, prunedState, refused: 0 };
}
