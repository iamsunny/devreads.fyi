// Converts an OPML feed list (e.g. kilimchoi/engineering-blogs) into sites.yml.
// Existing sites.yml entries win on conflict so manual edits (tags, renames) survive re-imports.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stringify, parse } from 'yaml';

const OPML_PATH = process.argv[2] ?? 'data/seed.opml';
const SITES_PATH = 'sites.yml';

const decode = (s) =>
  s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';

const xml = readFileSync(OPML_PATH, 'utf8');
const outlines = [...xml.matchAll(/<outline\b([^>]*)\/>/g)];

const imported = [];
const seenFeeds = new Set();
const seenIds = new Set();
for (const [, attrs] of outlines) {
  const attr = Object.fromEntries(
    [...attrs.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])
  );
  if (!attr.xmlUrl) continue;
  const feed = attr.xmlUrl.trim();
  if (seenFeeds.has(feed)) continue;
  seenFeeds.add(feed);
  let id = slugify(attr.title || attr.text || new URL(feed).hostname);
  while (seenIds.has(id)) id += '-2';
  seenIds.add(id);
  imported.push({
    id,
    name: attr.title || attr.text || id,
    feed,
    url: attr.htmlUrl?.trim() || new URL(feed).origin,
  });
}

let existing = [];
if (existsSync(SITES_PATH)) {
  existing = parse(readFileSync(SITES_PATH, 'utf8'))?.sites ?? [];
}
const existingFeeds = new Set(existing.map((s) => s.feed));
const existingIds = new Set(existing.map((s) => s.id));
const added = imported.filter((s) => !existingFeeds.has(s.feed) && !existingIds.has(s.id));

const sites = [...existing, ...added].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(SITES_PATH, stringify({ sites }, { lineWidth: 0 }));
console.log(`sites.yml: ${existing.length} existing, ${added.length} added, ${sites.length} total`);
