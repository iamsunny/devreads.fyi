export const GUEST_KEY = 'er:favorites:v1';
const LEGACY_KEY = 'er:saved';
const MIGRATION_KEY = 'er:saved:migrated:v1';

export function normalizeFavorite(value) {
  if (!value || !/^[a-f0-9]{16}$/.test(value.id || '')) return null;
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return null;
  } catch { return null; }
  const savedAt = Number.isFinite(Number(value.savedAt)) && typeof value.savedAt === 'number' ? value.savedAt : Date.parse(value.savedAt);
  return {
    id: value.id, url: value.url, title: String(value.title || 'Article').slice(0, 512), source: String(value.source || '').slice(0, 128),
    published: value.published && Number.isFinite(Date.parse(value.published)) ? new Date(value.published).toISOString() : null,
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.now(),
    ...(value.localVersion ? { localVersion: value.localVersion } : {}),
  };
}
export function readGuest(storage = localStorage) {
  const raw = storage.getItem(GUEST_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object' || Array.isArray(parsed.items)) throw new Error('Favorites storage is not readable. Export browser data before clearing it.');
  return Object.fromEntries(Object.values(parsed.items).map(normalizeFavorite).filter(Boolean).map(item => [item.id, item]));
}
export function writeGuest(items, storage = localStorage) {
  storage.setItem(GUEST_KEY, JSON.stringify({ version: 1, items }));
}
export function migrateLegacy(storage = localStorage) {
  const items = readGuest(storage);
  if (storage.getItem(MIGRATION_KEY)) return items;
  const raw = storage.getItem(LEGACY_KEY);
  if (!raw) return items;
  const legacy = JSON.parse(raw);
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Saved article storage is not readable.');
  const values = Object.values(legacy).map(normalizeFavorite);
  // Retain the legacy backup if any entry cannot be migrated safely.
  for (const item of values) if (item && !items[item.id]) items[item.id] = item;
  writeGuest(items, storage);
  storage.setItem(MIGRATION_KEY, 'true');
  if (values.every(Boolean)) storage.removeItem(LEGACY_KEY);
  return items;
}
export function toggleGuest(value, storage = localStorage) {
  const item = normalizeFavorite(value);
  if (!item) throw new Error('This article cannot be favorited.');
  const items = readGuest(storage);
  if (items[item.id]) delete items[item.id];
  else items[item.id] = { ...item, localVersion: crypto.randomUUID() };
  writeGuest(items, storage);
  return items;
}
export function acknowledgeImport(snapshot, ids, storage = localStorage) {
  const items = readGuest(storage);
  for (const id of ids) if (items[id] && JSON.stringify(items[id]) === JSON.stringify(snapshot[id])) delete items[id];
  writeGuest(items, storage);
  return items;
}
