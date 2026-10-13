(() => {
  "use strict";
  const key = Symbol.for("devreads.visit-counter");
  if (window[key]) { window[key].render(); return; }

  let total = null;
  let status = "connecting";
  let socket = null;
  let reconnectTimer = null;
  let connectTimer = null;
  let pollTimer = null;
  let reading = false;
  let attempts = 0;
  let paused = false;
  const format = typeof Intl !== "undefined" && Intl.NumberFormat
    ? new Intl.NumberFormat(document.documentElement.lang || undefined)
    : { format: value => String(value) };

  function render() {
    const value = total === null ? "—" : format.format(total);
    document.querySelectorAll("[data-visit-counter]").forEach(element => {
      if (element.textContent !== value) element.textContent = value;
      element.setAttribute("data-visit-counter-status", status);
    });
  }

  function setStatus(value) { status = value; render(); }
  function accept(value) {
    if (!Number.isSafeInteger(value) || value < 0) return false;
    // A delayed HTTP snapshot must not overwrite a newer WebSocket update.
    total = total === null ? value : Math.max(total, value);
    render();
    return true;
  }

  async function read() {
    if (reading || paused || typeof window.fetch !== "function") return;
    reading = true;
    let timeout;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    try {
      const snapshot = (async () => {
        const response = await window.fetch("/api/visits", {
          cache: "no-store", credentials: "same-origin", signal: controller?.signal,
        });
        if (!response.ok) throw new Error("Counter unavailable");
        return response.json();
      })();
      const data = await Promise.race([snapshot, new Promise((_, reject) => {
        timeout = setTimeout(() => { controller?.abort(); reject(new Error("Counter timeout")); }, 10000);
      })]);
      if (!accept(data?.total)) throw new Error("Invalid total");
      if (status !== "live" && status !== "connecting") setStatus("polling");
    } catch {
      if (status !== "live" && status !== "connecting") setStatus("offline");
    } finally {
      clearTimeout(timeout);
      reading = false;
    }
  }

  function startPolling() {
    if (pollTimer === null && !paused) pollTimer = setInterval(read, 30000);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  function reconnect() {
    if (paused || reconnectTimer !== null) return;
    const ceiling = Math.min(30000, 1000 * (2 ** Math.min(attempts++, 6)));
    const delay = ceiling * (0.5 + Math.random() * 0.5);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }
  function fail(current) {
    if (socket !== current) return;
    socket = null;
    clearTimeout(connectTimer);
    connectTimer = null;
    current.onopen = current.onmessage = current.onerror = current.onclose = null;
    try { current.close(); } catch { /* Already closed. */ }
    setStatus("polling");
    startPolling();
    void read();
    reconnect();
  }
  function connect() {
    if (paused || socket) return;
    if (typeof window.WebSocket !== "function") {
      setStatus("polling"); startPolling(); return;
    }
    setStatus("connecting");
    let current;
    try {
      const url = new URL("/api/visits/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      current = new window.WebSocket(url.href);
      socket = current;
    } catch {
      setStatus("polling"); startPolling(); reconnect(); return;
    }
    connectTimer = setTimeout(() => fail(current), 10000);
    current.onopen = () => {
      if (socket !== current) return;
      clearTimeout(connectTimer); connectTimer = null;
      setStatus("live"); stopPolling(); void read();
    };
    current.onmessage = event => {
      if (socket !== current) return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "count" && accept(data.total)) attempts = 0;
      } catch { /* Ignore malformed or unrelated server messages. */ }
    };
    current.onerror = current.onclose = () => fail(current);
  }

  window[key] = { render };
  render();
  startPolling();
  connect();
  void read();
  if (typeof MutationObserver === "function") {
    new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener("astro:after-swap", render);
  document.addEventListener("astro:page-load", () => { render(); void read(); });
  window.addEventListener("online", () => {
    if (paused) return;
    clearTimeout(reconnectTimer); reconnectTimer = null;
    void read(); connect();
  });
  window.addEventListener("pagehide", () => {
    paused = true;
    clearTimeout(reconnectTimer); reconnectTimer = null;
    clearTimeout(connectTimer); connectTimer = null;
    stopPolling();
    if (socket) {
      const current = socket; socket = null;
      current.onopen = current.onmessage = current.onerror = current.onclose = null;
      try { current.close(); } catch { /* Already closed. */ }
    }
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    paused = false; startPolling(); connect(); void read();
  });
})();
