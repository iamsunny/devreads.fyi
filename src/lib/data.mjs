// Build-time data layer: loads sites.yml, fetch state and the post store once
// per build and exposes sorted/derived views to pages.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadAllPosts, loadState } from '../../ingest/store.mjs';

export const PAGE_SIZE = 100;
export const MIN_TAG_COUNT = 3;

export const sites = parse(readFileSync('sites.yml', 'utf8')).sites;
export const siteById = new Map(sites.map((s) => [s.id, s]));
export const state = loadState();

export const posts = loadAllPosts().sort((a, b) => {
  if (!a.published) return 1;
  if (!b.published) return -1;
  return b.published < a.published ? -1 : b.published > a.published ? 1 : 0;
});

export const postCountBySite = new Map();
for (const p of posts) {
  postCountBySite.set(p.siteId, (postCountBySite.get(p.siteId) ?? 0) + 1);
}

export const tagCounts = new Map();
for (const p of posts) {
  for (const t of p.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
}
export const indexedTags = [...tagCounts.entries()]
  .filter(([, n]) => n >= MIN_TAG_COUNT)
  .sort((a, b) => b[1] - a[1])
  .map(([t]) => t);

export function tagSlug(tag) {
  return tag.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export const tagBySlug = new Map(indexedTags.map((t) => [tagSlug(t), t]));

const MS_DAY = 86400e3;
export function dayLabel(iso, now = Date.now()) {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (d.getTime() >= startOfToday) return 'Today';
  if (d.getTime() >= startOfToday - MS_DAY) return 'Yesterday';
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

export function hueOf(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function pageCount() {
  return Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
}
export function pageSlice(page) {
  return posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}
