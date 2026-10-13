(() => {
  const menu = document.getElementById('article-share-menu');
  if (!menu) return;
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const copy = menu.querySelector('[data-share-copy]');
  const status = menu.querySelector('[data-share-status]');
  const manual = menu.querySelector('[data-share-url]');
  let trigger;
  let article;
  let reset;

  function close(restoreFocus = false) {
    clearTimeout(reset);
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger?.isConnected) trigger.focus();
    trigger = undefined;
  }

  function position() {
    if (!trigger || menu.hidden) return;
    const anchor = trigger.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8))}px`;
    const top = anchor.bottom + 6 + box.height <= window.innerHeight - 8 ? anchor.bottom + 6 : anchor.top - box.height - 6;
    menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`;
  }

  function open(button, data) {
    close();
    trigger = button;
    article = data;
    copy.textContent = 'Copy link';
    copy.classList.remove('copied');
    status.textContent = '';
    manual.hidden = true;
    manual.value = data.url;
    const destinations = {
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(data.url)}`,
      x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(data.title)}&url=${encodeURIComponent(data.url)}`,
      bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${data.title}\n${data.url}`)}`,
    };
    for (const link of menu.querySelectorAll('[data-share-platform]')) link.href = destinations[link.dataset.sharePlatform];
    button.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    position();
    items[0].focus();
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('.share-btn');
    if (button) {
      if (button === trigger && !menu.hidden) { close(); return; }
      close();
      const row = button.closest('.row');
      let url;
      try { url = new URL(row.dataset.url); } catch { return; }
      if (!['https:', 'http:'].includes(url.protocol)) return;
      const data = { title: row.dataset.title || 'Article', url: row.dataset.url };
      if (window.matchMedia?.('(pointer: coarse)').matches && typeof navigator.share === 'function') {
        try {
          if (!navigator.canShare || navigator.canShare(data)) {
            await navigator.share(data);
            return;
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      if (button.isConnected) open(button, data);
      return;
    }
    if (menu.hidden) return;
    if (event.target.closest('[data-share-copy]')) {
      const activeArticle = article;
      const activeTrigger = trigger;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(activeArticle.url);
        if (menu.hidden || trigger !== activeTrigger || article !== activeArticle) return;
        copy.textContent = 'Copied';
        copy.classList.add('copied');
        status.textContent = 'Article link copied.';
        position();
        clearTimeout(reset);
        reset = setTimeout(() => {
          copy.textContent = 'Copy link';
          copy.classList.remove('copied');
          status.textContent = '';
          position();
        }, 2000);
      } catch {
        if (menu.hidden || trigger !== activeTrigger || article !== activeArticle) return;
        manual.hidden = false;
        status.textContent = 'Select and copy this article link:';
        position();
        manual.focus();
        manual.select();
      }
    } else if (event.target.closest('[data-share-platform]')) {
      // Defer dismissal so the browser can follow the selected composer link.
      setTimeout(() => close(true), 0);
    } else if (!menu.contains(event.target)) close();
  });

  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (event.target === manual) return;
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); items[next].focus(); }
  });
  document.addEventListener('focusin', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== trigger) close();
  });
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', event => {
    if (!menu.contains(event.target)) close();
  }, true);
})();
