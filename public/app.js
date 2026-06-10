(() => {
  const base = document.body.dataset.base || '/';
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

  // --- saved posts ----------------------------------------------------------
  const S_KEY = 'er:saved';
  const loadSaved = () => {
    try { return JSON.parse(localStorage.getItem(S_KEY) || '{}'); } catch { return {}; }
  };
  const saved = loadSaved();
  const persist = () => localStorage.setItem(S_KEY, JSON.stringify(saved));
  const syncBtn = (row) => {
    const b = row.querySelector('.save-btn');
    if (b) b.classList.toggle('saved', Boolean(saved[row.dataset.id]));
  };
  rows.forEach(syncBtn);
  function toggleSave(row) {
    const id = row.dataset.id;
    if (!id) return;
    if (saved[id]) delete saved[id];
    else
      saved[id] = {
        id,
        url: row.dataset.url,
        title: row.dataset.title,
        source: row.dataset.source,
        published: row.dataset.published || null,
        savedAt: new Date().toISOString(),
      };
    persist();
    syncBtn(row);
    if (document.getElementById('saved-list')) renderSavedPage();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.save-btn');
    if (b) toggleSave(b.closest('.row'));
  });

  function renderSavedPage() {
    const el = document.getElementById('saved-list');
    if (!el) return;
    const items = Object.values(loadSaved()).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
    if (!items.length) {
      el.innerHTML = '<p class="search-empty">Nothing saved yet. Press <kbd>s</kbd> on any post.</p>';
      return;
    }
    el.innerHTML = items
      .map(
        (i) => `<article class="row" data-id="${esc(i.id)}" data-url="${esc(i.url)}" data-title="${esc(i.title)}" data-source="${esc(i.source)}">
  <div class="row-main">
    <p class="meta"><span class="src">${esc(i.source)}</span>${i.published ? `<time datetime="${esc(i.published)}">${new Date(i.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time>` : ''}</p>
    <h3 class="title"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
  </div>
  <button class="save-btn saved" aria-label="Remove from saved" title="Remove">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path class="fill" d="M6 3h12v18l-6-4.5L6 21Z" stroke-linejoin="round"/></svg>
  </button>
</article>`
      )
      .join('');
    el.querySelectorAll('.row').forEach(syncBtn);
  }
  renderSavedPage();

  // --- search overlay (Pagefind) ---------------------------------------------
  const overlay = document.getElementById('search-overlay');
  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');
  const fSource = document.getElementById('f-source');
  const fTag = document.getElementById('f-tag');
  let pagefind = null;
  let filtersLoaded = false;
  let firstResultUrl = null;

  async function ensurePagefind() {
    if (pagefind) return pagefind;
    try {
      pagefind = await import(`${base}pagefind/pagefind.js`);
      await pagefind.options({ baseUrl: base });
      pagefind.init();
    } catch {
      resultsEl.innerHTML =
        '<p class="search-empty">Search index not available (dev mode). Run <code>npm run build</code> first.</p>';
      pagefind = null;
    }
    return pagefind;
  }

  async function populateFilters() {
    if (filtersLoaded || !(await ensurePagefind())) return;
    const filters = await pagefind.filters();
    const fill = (select, entries, limit) => {
      for (const [value] of entries.slice(0, limit)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
      }
    };
    fill(fSource, Object.entries(filters.source ?? {}).sort((a, b) => a[0].localeCompare(b[0])), 1000);
    fill(fTag, Object.entries(filters.tag ?? {}).sort((a, b) => b[1] - a[1]), 60);
    filtersLoaded = true;
  }

  let searchSeq = 0;
  async function runSearch() {
    const pf = await ensurePagefind();
    if (!pf) return;
    const seq = ++searchSeq;
    const term = input.value.trim();
    const filters = {};
    if (fSource.value) filters.source = fSource.value;
    if (fTag.value) filters.tag = fTag.value;
    if (!term && !fSource.value && !fTag.value) {
      resultsEl.innerHTML = '<p class="search-empty">Type to search.</p>';
      firstResultUrl = null;
      return;
    }
    const res = await pf.search(term || null, {
      filters,
      ...(term ? {} : { sort: { date: 'desc' } }),
    });
    if (seq !== searchSeq) return;
    const top = await Promise.all(res.results.slice(0, 30).map((r) => r.data()));
    if (seq !== searchSeq) return;
    firstResultUrl = top[0]?.meta?.url || null;
    if (!top.length) {
      resultsEl.innerHTML = '<p class="search-empty">No matches.</p>';
      return;
    }
    resultsEl.innerHTML =
      `<p class="search-empty" style="text-align:left; padding: 6px 8px 2px;">${res.results.length.toLocaleString()} result${res.results.length === 1 ? '' : 's'}</p>` +
      top
        .map(
          (d) => `<a class="sr" href="${esc(d.meta.url)}" target="_blank" rel="noopener">
  <p class="meta"><span class="src">${esc(d.meta.source)}</span>${d.meta.date ? `<span>${esc(d.meta.date)}</span>` : ''}</p>
  <p class="t">${esc(d.meta.title)}</p>
  <p class="x">${d.excerpt ?? ''}</p>
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
    if (e.key === 'Enter' && firstResultUrl) window.open(firstResultUrl, '_blank');
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
    if (e.key === 'j') select(Math.min(rows.length - 1, sel + 1));
    else if (e.key === 'k') select(Math.max(0, sel - 1));
    else if (e.key === 'o' || e.key === 'Enter') {
      const url = rows[sel]?.dataset.url;
      if (url) window.open(url, '_blank');
    } else if (e.key === 's') {
      if (rows[sel]) toggleSave(rows[sel]);
    } else if (e.key === '/') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape') closeSearch();
  });
})();
