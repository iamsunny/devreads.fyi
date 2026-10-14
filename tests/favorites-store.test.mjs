import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacy, readGuest, toggleGuest, acknowledgeImport, GUEST_KEY } from '../public/favorites-store.js';
const fixture = { id: '0123456789abcdef', url: 'https://example.com/read?q=1#intro', title: 'A good read', source: 'Example', savedAt: '2026-01-01T00:00:00Z' };
function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
test('legacy migration persists favorites before deleting old data and never resurrects removed entries', () => {
  const store = storage({ 'er:saved': JSON.stringify({ [fixture.id]: fixture }) });
  assert.equal(migrateLegacy(store)[fixture.id].url, fixture.url);
  assert.equal(store.getItem('er:saved'), null);
  toggleGuest(fixture, store); assert.deepEqual(readGuest(store), {});
  assert.deepEqual(migrateLegacy(store), {});
});
test('failed writes and malformed storage retain the legacy copy', () => {
  const store = storage({ 'er:saved': JSON.stringify({ [fixture.id]: fixture }) });
  store.setItem = () => { throw new Error('Quota'); };
  assert.throws(() => migrateLegacy(store), /Quota/);
  assert.ok(store.getItem('er:saved'));
  assert.throws(() => migrateLegacy(storage({ 'er:saved': '{broken' })));
});
test('unsafe legacy entries are retained as a backup without repeated re-import', () => {
  const store = storage({ 'er:saved': JSON.stringify({ valid: fixture, bad: { ...fixture, id: 'bad', url: 'javascript:alert(1)' } }) });
  assert.equal(Object.keys(migrateLegacy(store)).length, 1);
  assert.ok(store.getItem('er:saved'));
  toggleGuest(fixture, store);
  assert.deepEqual(migrateLegacy(store), {});
});
test('imports clear only acknowledged, unchanged guest records; a later edit survives', () => {
  const store = storage();
  toggleGuest(fixture, store); const snapshot = readGuest(store);
  assert.deepEqual(acknowledgeImport(snapshot, [], store), snapshot);
  toggleGuest(fixture, store); toggleGuest(fixture, store);
  assert.ok(acknowledgeImport(snapshot, [fixture.id], store)[fixture.id]);
  const current = readGuest(store);
  assert.deepEqual(acknowledgeImport(current, [fixture.id], store), {});
  assert.equal(JSON.parse(store.getItem(GUEST_KEY)).version, 1);
});
