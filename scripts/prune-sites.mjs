// Manual prune CLI. The same prune runs automatically during ingest, but the
// automatic path refuses to remove more than half of the stored sites at once;
// use --force here for intentional mass curation. --dry-run previews.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { pruneOrphans } from '../ingest/prune.mjs';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const ids = new Set(parse(readFileSync('sites.yml', 'utf8')).sites.map((s) => s.id));

const result = pruneOrphans(ids, { dryRun, force });
console.log(
  `${dryRun ? '[dry-run] ' : ''}pruned ${result.pruned} post file(s), ${result.prunedState} state entr${result.prunedState === 1 ? 'y' : 'ies'}` +
    (result.refused ? ` (refused ${result.refused}, see message above)` : '') +
    ` (${ids.size} sites kept)`
);
