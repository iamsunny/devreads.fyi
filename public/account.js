import { migrateLegacy, readGuest, toggleGuest, acknowledgeImport, GUEST_KEY, normalizeFavorite } from './favorites-store.js';

const API = location.hostname === 'www.devreads.fyi' ? 'https://devreads.fyi' : location.origin;
const base = document.body.dataset.base || '/';
const list = document.getElementById('favorites-list');
const message = document.getElementById('account-status');
const nudge = document.getElementById('favorite-nudge');
const headerLink = document.querySelector('[data-account-link]');
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('devreads-favorites') : null;
let config = { enabled: false, providers: [] };
let current = null;
let items = {};
let nextCursor = null;
let refreshing = null;
let importing = false;
let generation = 0;
const pending = new Set();
const epoch = () => generation;

function announce(text, error = false) {
  if (message) { message.textContent = text; message.dataset.error = String(error); message.hidden = !text; }
  const retry = document.querySelector('[data-account-retry]'); if (retry) retry.hidden = !error || !config.enabled;
}
function showGuestInvitation() {
  if (!nudge || current || !config.enabled) return;
  let dismissed = 0;
  try { dismissed = Number(localStorage.getItem('er:favorite-nudge-until')); } catch {}
  if (dismissed > Date.now()) return;
  nudge.hidden = false;
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const owner = path.startsWith('/api/favorites') ? current?.user.id : null;
  try {
    const response = await fetch(API + path, { ...options, credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers, ...(owner ? {'X-Devreads-User':owner} : {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error?.message || data.error || data.message || 'Account service is unavailable. Try again.');
      error.status = response.status; error.code = data.code; throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}
function syncButtons() {
  for (const row of document.querySelectorAll('.row')) {
    const button = row.querySelector('.favorite-btn');
    if (!button) continue;
    const active = !!items[row.dataset.id];
    button.classList.toggle('favorited', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Remove from favorites' : 'Favorite article');
    button.title = active ? 'Remove from favorites' : 'Favorite article';
    button.disabled = importing || pending.has(row.dataset.id);
  }
}
const shareSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
const heartSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path class="fill" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" stroke-linejoin="round"/></svg>';
function renderList() {
  if (!list) { syncButtons(); return; }
  const fragment = document.createDocumentFragment();
  const values = Object.values(items).sort((a, b) => b.savedAt - a.savedAt || b.id.localeCompare(a.id));
  if (!values.length) {
    const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = 'No favorites yet — tap a heart or press s on an article.'; fragment.append(empty);
  }
  for (const item of values) {
    const row = document.createElement('article'); row.className = 'row';
    Object.assign(row.dataset, { id: item.id, url: item.url, title: item.title, source: item.source });
    const main = document.createElement('div'); main.className = 'row-main';
    const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = item.source;
    const title = document.createElement('h3'); title.className = 'title';
    const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = item.title;
    title.append(link); main.append(meta, title);
    const actions = document.createElement('div'); actions.className = 'post-actions';
    const share = document.createElement('button'); share.type = 'button'; share.className = 'share-btn'; share.setAttribute('aria-label', 'Share article'); share.title = 'Share article'; share.setAttribute('aria-haspopup', 'menu'); share.setAttribute('aria-controls', 'article-share-menu'); share.setAttribute('aria-expanded', 'false'); share.innerHTML = shareSVG;
    const heart = document.createElement('button'); heart.type = 'button'; heart.className = 'favorite-btn'; heart.innerHTML = heartSVG;
    actions.append(share, heart); row.append(main, actions); fragment.append(row);
  }
  list.replaceChildren(fragment);
  const more = document.querySelector('[data-favorites-more]'); if (more) more.hidden = !nextCursor;
  document.dispatchEvent(new CustomEvent('devreads:rows-changed'));
  syncButtons();
}
function renderAccount() {
  if (headerLink) {
    headerLink.textContent = current ? 'Account' : 'Sign in'; headerLink.href = `${base}${current ? 'account/' : 'signin/'}`;
    headerLink.hidden = !config.enabled && !current;
  }
  for (const el of document.querySelectorAll('[data-guest-only]')) el.hidden = !!current;
  for (const el of document.querySelectorAll('[data-signed-in-only]')) el.hidden = !current;
  for (const el of document.querySelectorAll('[data-account-name]')) el.textContent = current?.user.name || 'Your account';
  for (const el of document.querySelectorAll('[data-account-email]')) el.textContent = current?.user.email?.endsWith('.invalid') ? 'Signed in with a social account' : current?.user.email || '';
  const setup = document.querySelector('[data-auth-setup]'); if (setup) setup.hidden = config.enabled;
  for (const button of document.querySelectorAll('[data-auth-provider]')) button.hidden = !config.enabled || !config.providers.includes(button.dataset.authProvider);
  const description = document.querySelector('[data-favorites-description]');
  if (description) description.textContent = current ? 'Your favorites, synchronized with your account.' : 'Your favorites, saved on this device.';
  if (current && nudge) nudge.hidden = true;
}
async function loadMembership(turn) {
  const ids = [...new Set([...document.querySelectorAll('.row[data-id]')].map(row => row.dataset.id))].filter(id => /^[a-f0-9]{16}$/.test(id));
  const found = {};
  for (let start = 0; start < ids.length; start += 50) {
    const data = await api('/api/favorites/status', { method: 'POST', body: JSON.stringify({ ids: ids.slice(start, start + 50) }) });
    for (const id of data.ids) found[id] = { id };
  }
  if (epoch() === turn) { items = found; syncButtons(); }
}
async function loadFavorites(turn, more = false) {
  const data = await api('/api/favorites' + (more && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ''));
  if (epoch() !== turn) return;
  items = { ...(more ? items : {}), ...Object.fromEntries(data.items.map(normalizeFavorite).filter(Boolean).map(item => [item.id, item])) };
  nextCursor = data.nextCursor; renderList();
}
async function importGuest(turn) {
  const guest = readGuest(); const values = Object.values(guest);
  if (!values.length) return;
  importing = true; syncButtons(); announce('Syncing browser favorites…');
  try {
    for (let start = 0; start < values.length; start += 50) {
      const batch = values.slice(start, start + 50);
      const result = await api('/api/favorites/import', { method: 'POST', body: JSON.stringify({ items: batch }) });
      if (epoch() !== turn) return;
      acknowledgeImport(guest, result.acknowledged);
    }
    announce('Your browser favorites are now saved in your account.'); channel?.postMessage({ type: 'changed' });
  } finally { importing = false; syncButtons(); }
}
async function refresh() {
  if (refreshing || pending.size || importing) return refreshing;
  refreshing = (async () => {
    const turn = ++generation;
    try {
      config = await api('/api/auth/config');
      if (!config.enabled) { current = null; items = readGuest(); nextCursor = null; renderAccount(); renderList(); return; }
      const previous = current?.user.id;
      const session = await api('/api/auth/get-session');
      if (epoch() !== turn) return;
      current = session?.user ? session : null;
      if (previous !== current?.user.id) { items = {}; renderList(); }
      renderAccount();
      if (current) {
        await importGuest(turn);
        if (epoch() !== turn) return;
        if (list) await loadFavorites(turn); else await loadMembership(turn);
      } else { items = readGuest(); nextCursor = null; renderList(); }
    } catch (error) {
      if (error.status === 401) { current = null; items = readGuest(); nextCursor = null; renderList(); }
      // Preserve account state during network outages; never copy cloud favorites into guest storage.
      announce(current ? 'Could not refresh account favorites. Try again when connected.' : error.message, true);
      renderAccount();
      if (!current) { try { items = readGuest(); renderList(); } catch {} }
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function toggle(row) {
  const item = normalizeFavorite({ id: row.dataset.id, url: row.dataset.url, title: row.dataset.title, source: row.dataset.source || '', published: row.dataset.published || null, savedAt: Date.now() });
  if (!item || pending.has(item.id) || importing) return;
  if (refreshing) { await refreshing; return toggle(row); }
  if (!current) {
    try { items = toggleGuest(item); renderList(); showGuestInvitation(); channel?.postMessage({ type: 'changed' }); }
    catch (error) { announce(`Could not save on this device: ${error.message}`, true); }
    return;
  }
  const before = items[item.id]; const turn = epoch(); const owner = current.user.id;
  pending.add(item.id);
  if (before) delete items[item.id]; else items[item.id] = item;
  renderList();
  try {
    await api(`/api/favorites/${item.id}`, { method: before ? 'DELETE' : 'PUT', ...(before ? {} : { body: JSON.stringify(item) }) });
    if (epoch() === turn && current?.user.id === owner) { announce('Favorites saved to your account.'); channel?.postMessage({ type: 'changed' }); }
  } catch (error) {
    if (epoch() === turn && current?.user.id === owner) {
      if (before) items[item.id] = before; else delete items[item.id];
      announce(error.status === 401 ? 'Please sign in again to sync favorites. Your displayed favorites have been retained.' : 'Could not sync this change. Please try again.', true);
    }
  } finally { pending.delete(item.id); renderList(); if (epoch() !== turn) await refresh(); }
}
function returnURL() {
  const candidate = new URLSearchParams(location.search).get('returnTo');
  try {
    const target = new URL(candidate || `${base}favorites/`, location.origin);
    if (target.origin === location.origin && target.pathname.startsWith(base) && !target.pathname.startsWith(`${base}signin`)) return target.href;
  } catch {}
  return new URL(`${base}favorites/`, location.origin).href;
}
async function startGoogle(confirmation = false) {
  const target = new URL(returnURL());
  const result = await api(confirmation ? '/api/auth/confirm-google' : '/api/auth/sign-in/google', {
    method: 'POST', body: JSON.stringify({returnTo: target.href}),
  });
  location.assign(result.url);
}
document.addEventListener('click', async event => {
  const heart = event.target.closest('.favorite-btn');
  if (heart) { await toggle(heart.closest('.row')); return; }
  const provider = event.target.closest('[data-auth-provider]');
  if (provider) {
    provider.disabled = true;
    try {
      announce('');
      if (provider.dataset.authProvider !== 'google') throw new Error('Only Google sign-in is available.');
      await startGoogle();
    } catch (error) { announce(error.message, true); }
    finally { provider.disabled = false; }
    return;
  }
  if (event.target.closest('[data-dismiss-nudge]')) {
    if (nudge) nudge.hidden = true;
    try { localStorage.setItem('er:favorite-nudge-until', String(Date.now() + 86400000)); } catch {}
  }
  if (event.target.closest('[data-signout]')) {
    try {
      await api('/api/auth/sign-out', {method:'POST', body:'{}'}); generation++; current = null; items = readGuest(); nextCursor = null;
      renderAccount(); renderList(); announce('Signed out. Account favorites remain in your account.'); channel?.postMessage({ type: 'session' });
    } catch (error) { announce(error.message, true); }
  }
  if (event.target.closest('[data-reauth]')) {
    const button = event.target.closest('[data-reauth]'); button.disabled = true;
    try { await startGoogle(true); }
    catch (error) { announce(error.message, true); }
    finally { button.disabled = false; }
  }
  if (event.target.closest('[data-favorites-more]') && nextCursor && current) {
    const button = event.target.closest('[data-favorites-more]'); button.disabled = true;
    try { await loadFavorites(epoch(), true); } catch (error) { announce(error.message, true); } finally { button.disabled = false; }
  }
  if (event.target.closest('[data-account-retry]')) { announce(''); await refresh(); }
  if (event.target.closest('[data-delete-start]')) document.querySelector('[data-delete-confirm]').hidden = false;
  if (event.target.closest('[data-delete-cancel]')) document.querySelector('[data-delete-confirm]').hidden = true;
  if (event.target.closest('[data-delete-account]')) {
    const button = event.target.closest('[data-delete-account]'); button.disabled = true;
    try {
      await api('/api/auth/delete-user', { method: 'POST', body: '{}' });
      generation++; current = null; items = readGuest(); nextCursor = null; channel?.postMessage({ type: 'session' }); location.assign(`${base}favorites/`);
    } catch (error) { announce(error.message, true); button.disabled = false; }
  }
});
window.addEventListener('devreads:toggle-favorite', event => toggle(event.detail.row));
window.addEventListener('focus', refresh);
window.addEventListener('online', refresh);
window.addEventListener('storage', event => { if (event.key === GUEST_KEY && !current) { try { items = readGuest(); renderList(); } catch {} } });
if (channel) channel.onmessage = () => refresh();
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (link && new URL(link.href, location.href).pathname === `${base}signin/` && location.pathname !== `${base}signin/`) link.href = `${base}signin/?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
});
try { items = migrateLegacy(); renderList(); } catch (error) { announce(`Browser favorites need attention: ${error.message}`, true); }
if (new URLSearchParams(location.search).has('error')) announce('Sign-in was cancelled or could not complete. Your browser favorites are still here. Please try again.', true);
if (new URLSearchParams(location.search).get('confirmed') === '1') announce('Google sign-in confirmed. You can now delete your account.');
refresh();
