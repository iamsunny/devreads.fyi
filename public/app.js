(() => {
  const base = document.body.dataset.base || '/';

  // --- theme toggle -----------------------------------------------------------
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const outUrl = (url) => {
    try {
      const u = new URL(url);
      if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'devreads.fyi');
      return u.toString();
    } catch {
      return url;
    }
  };

  // --- contact email de-obfuscation (kept out of static HTML for scrapers) ----
  for (const el of document.querySelectorAll('a[data-u][data-d]')) {
    const addr = `${el.dataset.u}@${el.dataset.d}`;
    el.href = `mailto:${addr}`;
    el.textContent = addr;
  }

  // --- outbound attribution at navigation time --------------------------------
  // Hrefs in the DOM stay canonical (clean to hover, copy and share); the
  // utm_source param is added only when a navigation actually happens, then
  // the clean href is restored.
  function tagOutbound(e) {
    const a = e.target.closest?.('a[href^="http"]');
    if (!a || a.host === location.host || a.closest('[data-share-platform]')) return;
    const orig = a.getAttribute('href');
    a.href = outUrl(a.href);
    setTimeout(() => a.setAttribute('href', orig));
  }
  document.addEventListener('click', tagOutbound);
  document.addEventListener('auxclick', tagOutbound);

  // --- relative times -------------------------------------------------------
  for (const t of document.querySelectorAll('time[data-rel]')) {
    const diffMin = (Date.now() - Date.parse(t.dateTime)) / 60000;
    if (diffMin < 0) continue;
    if (diffMin < 60) t.textContent = `${Math.max(1, Math.round(diffMin))} min ago`;
    else if (diffMin < 1440) t.textContent = `${Math.round(diffMin / 60)} h ago`;
    else if (diffMin < 10080) t.textContent = `${Math.round(diffMin / 1440)} d ago`;
  }

  // --- unread since last visit ---------------------------------------------
  const HW_KEY = 'er:lastVisit';
  const rows = [...document.querySelectorAll('.row')];
  const highWater = localStorage.getItem(HW_KEY);
  if (!highWater) {
    localStorage.setItem(HW_KEY, new Date().toISOString());
  } else {
    let unread = 0;
    for (const r of rows) {
      if (r.dataset.published && r.dataset.published > highWater) {
        r.classList.add('unread');
        unread++;
      }
    }
    const pill = document.getElementById('new-pill');
    if (unread && pill) {
      document.getElementById('new-count').textContent = `${unread} new since your last visit`;
      pill.style.display = 'flex';
      document.getElementById('mark-read').addEventListener('click', () => {
        localStorage.setItem(HW_KEY, new Date().toISOString());
        rows.forEach((r) => r.classList.remove('unread'));
        pill.style.display = 'none';
      });
    }
  }

  // Favorites are managed by the account module for guests and signed-in readers.
  function toggleSave(row) {
    window.dispatchEvent(new CustomEvent('devreads:toggle-favorite', { detail: { row } }));
  }
  document.addEventListener('devreads:rows-changed', () => {
    rows.splice(0, rows.length, ...document.querySelectorAll('.row'));
    sel = -1;
  });

  // --- search overlay (sharded JSON index) ------------------------------------
  // Record tuple: [title, url, source, date, tags[], summary]
  const overlay = document.getElementById('search-overlay');
  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');
  const fSource = document.getElementById('f-source');
  const fTag = document.getElementById('f-tag');
  let indexPromise = null;
  let manifest = null;
  let filtersLoaded = false;
  let firstResultUrl = null;

  function ensureIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        const mRes = await fetch(`${base}search/manifest.json`);
        if (!mRes.ok) throw new Error('manifest');
        manifest = await mRes.json();
        const shards = await Promise.all(
          Array.from({ length: manifest.shardCount }, (_, i) =>
            fetch(`${base}search/shard-${i}.json`).then((r) => {
              if (!r.ok) throw new Error(`shard ${i}`);
              return r.json();
            })
          )
        );
        return shards.flat();
      })().catch((err) => {
        indexPromise = null;
        throw err;
      });
    }
    return indexPromise;
  }
  // Warm the index in the background, but not on metered or slow connections;
  // those load it on demand when search is opened.
  const conn = navigator.connection;
  const fastEnough = !conn || (!conn.saveData && !/\b[23]g\b/.test(conn.effectiveType ?? ''));
  if (fastEnough) (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2500)))(() => ensureIndex().catch(() => {}));

  async function populateFilters() {
    if (filtersLoaded) return;
    try {
      await ensureIndex();
    } catch {
      resultsEl.innerHTML =
        '<p class="search-empty">// search index not available (dev mode) - run npm run build</p>';
      return;
    }
    const fill = (select, values) => {
      for (const value of values) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
      }
    };
    fill(fSource, manifest.sources.map((s) => s.name));
    fill(fTag, manifest.tags.map(([t]) => t));
    filtersLoaded = true;
  }

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlight = (text, tokens) =>
    tokens.length ? esc(text).replace(new RegExp(`(${tokens.map(escRe).join('|')})`, 'gi'), '<mark>$1</mark>') : esc(text);

  let searchSeq = 0;
  async function runSearch() {
    const seq = ++searchSeq;
    const term = input.value.trim().toLowerCase();
    const srcFilter = fSource.value;
    const tagFilter = fTag.value;
    if (!term && !srcFilter && !tagFilter) {
      resultsEl.innerHTML = '<p class="search-empty">// type to search</p>';
      firstResultUrl = null;
      return;
    }
    let index;
    try {
      if (!indexPromise) resultsEl.innerHTML = '<p class="search-empty">// loading index…</p>';
      index = await ensureIndex();
    } catch {
      resultsEl.innerHTML =
        '<p class="search-empty">// search index not available (dev mode) - run npm run build</p>';
      return;
    }
    if (seq !== searchSeq) return;

    const tokens = term.split(/\s+/).filter(Boolean);
    const matches = [];
    for (const r of index) {
      if (srcFilter && r[2] !== srcFilter) continue;
      if (tagFilter && !r[4].includes(tagFilter)) continue;
      let score = 0;
      if (tokens.length) {
        let ok = true;
        const title = ' ' + r[0].toLowerCase();
        const source = r[2].toLowerCase();
        const summary = r[5].toLowerCase();
        for (const tok of tokens) {
          let s = 0;
          if (title.includes(' ' + tok)) s = 3;
          else if (title.includes(tok)) s = 2;
          if (r[4].some((t) => t.includes(tok))) s = Math.max(s, 2.5);
          if (source.includes(tok)) s = Math.max(s, 2);
          if (summary.includes(tok)) s = Math.max(s, 1);
          if (!s) {
            ok = false;
            break;
          }
          score += s;
        }
        if (!ok) continue;
      }
      matches.push([score, r]);
    }
    // Index is newest-first, so equal scores (and browse mode) stay date-sorted.
    if (tokens.length) matches.sort((a, b) => b[0] - a[0]);
    const top = matches.slice(0, 30).map(([, r]) => r);

    firstResultUrl = top[0]?.[1] || null;
    if (!top.length) {
      resultsEl.innerHTML = '<p class="search-empty">// no matches</p>';
      return;
    }
    resultsEl.innerHTML =
      `<p class="search-empty" style="text-align:left; padding: 6px 8px 2px;">${matches.length.toLocaleString()} result${matches.length === 1 ? '' : 's'}</p>` +
      top
        .map(
          (r) => `<a class="sr" href="${esc(r[1])}" target="_blank" rel="noopener">
  ${r[3] ? `<p class="meta"><span>${esc(r[3])}</span></p>` : ''}
  <div class="title-line"><p class="t">${highlight(r[0], tokens)}</p><span class="src-pill">${esc(r[2])}</span></div>
  <p class="x">${highlight(r[5], tokens)}</p>
</a>`
        )
        .join('');
  }

  let debounce;
  const queueSearch = () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 120);
  };
  input?.addEventListener('input', queueSearch);
  fSource?.addEventListener('change', runSearch);
  fTag?.addEventListener('change', runSearch);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && firstResultUrl) window.open(outUrl(firstResultUrl), '_blank');
  });

  function openSearch() {
    overlay.hidden = false;
    input.focus();
    populateFilters();
  }
  function closeSearch() {
    overlay.hidden = true;
  }
  document.getElementById('search-open')?.addEventListener('click', openSearch);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeSearch();
  });

  // --- keyboard navigation ----------------------------------------------------
  let sel = -1;
  function select(i) {
    rows[sel]?.classList.remove('sel');
    sel = i;
    const r = rows[sel];
    if (r) {
      r.classList.add('sel');
      r.scrollIntoView({ block: 'nearest' });
    }
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches('input, select, textarea')) {
      if (e.key === 'Escape') closeSearch();
      return;
    }
    if (e.target.closest('button, a, [role="menu"], [contenteditable="true"]')) return;
    if (e.key === 'j') select(Math.min(rows.length - 1, sel + 1));
    else if (e.key === 'k') select(Math.max(0, sel - 1));
    else if (e.key === 'o' || e.key === 'Enter') {
      const url = rows[sel]?.dataset.url;
      if (url) window.open(outUrl(url), '_blank');
    } else if (e.key === 's') {
      if (rows[sel]) toggleSave(rows[sel]);
    } else if (e.key === '/') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape') closeSearch();
  });
})();
