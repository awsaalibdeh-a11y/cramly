"use strict";
/* Cramly offline: study on the bus, in a library, anywhere the signal is bad.
   - Anything you have opened (sets, topics, notes, flashcards, quizzes) is kept, so it still opens with no connection.
   - Flashcard reviews and topic progress you make offline are queued and sent the moment you are back online.
   - Things that need the AI say so plainly instead of failing with a mystery error. */
(() => {
  const DATA = "cramly-data-v1", OUT = "cramly_outbox";
  let realFetch = window.fetch.bind(window);
  const CACHEABLE = /^\/api\/(sets|topics|cards|me|stats|review|due|progress|calendar|plan|tools|notes|usage|streak|daily|drill|mistakes|focus|report)/;
  const NEVER = /^\/api\/(admin|account|pair|call|messages|chat|paywall|plans)/;
  const QUEUEABLE = /^\/api\/(cards\/\d+\/review|topics\/\d+\/event)$/;
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const authOf = init => { const h = (init && init.headers) || {}; return (h instanceof Headers ? h.get("Authorization") : h.Authorization || h.authorization) || ""; };
  const cacheKey = (url, init) => new Request(url + (url.includes("?") ? "&" : "?") + "__u=" + hash(authOf(init)));   // one cache per account on a shared browser
  const queue = () => { try { return JSON.parse(localStorage.getItem(OUT) || "[]"); } catch (e) { return []; } };
  const saveQueue = q => { try { localStorage.setItem(OUT, JSON.stringify(q.slice(-500))); } catch (e) { /* storage full */ } paint(); };

  /* the little banner */
  let bar = null, offline = !navigator.onLine, usedCache = false;
  function paint() {
    const n = queue().length;
    if (!bar) { bar = document.createElement("div"); bar.id = "offline-bar"; bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;background:#1f2540;color:#fff;padding:10px 18px;border-radius:99px;font:600 14px system-ui,sans-serif;box-shadow:0 8px 30px rgba(20,24,60,.35);display:none;max-width:92vw;text-align:center";
      document.addEventListener("DOMContentLoaded", () => document.body.append(bar)); if (document.body) document.body.append(bar); }
    if (offline) { bar.textContent = "📡 You're offline" + (usedCache ? ", showing your saved study material" : "") + (n ? ` · ${n} review${n > 1 ? "s" : ""} waiting to sync` : ""); bar.style.display = "block"; }
    else if (n) { bar.textContent = `Syncing ${n} review${n > 1 ? "s" : ""}…`; bar.style.display = "block"; }
    else bar.style.display = "none";
  }
  const setOffline = v => { if (offline !== v) { offline = v; if (!v) usedCache = false; paint(); if (!v) flush(); } };
  addEventListener("online", () => { setOffline(false); }); addEventListener("offline", () => setOffline(true));

  async function flush() {
    let q = queue(); if (!q.length || offline) return;
    const left = [];
    for (const job of q) {
      try { const r = await realFetch(job.url, { method: "POST", headers: job.headers, body: job.body }); if (r.status >= 500) left.push(job); }
      catch (e) { left.push(job); setOffline(true); }
    }
    saveQueue(left);
  }

  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url, method = ((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    let path; try { path = new URL(url, location.origin); } catch (e) { return realFetch(input, init); }
    if (path.origin !== location.origin || !path.pathname.startsWith("/api/") || NEVER.test(path.pathname)) return realFetch(input, init);
    try {
      const r = await realFetch(input, init); setOffline(false);
      if (method === "GET" && r.ok && CACHEABLE.test(path.pathname)) { const copy = r.clone(); caches.open(DATA).then(c => c.put(cacheKey(path.pathname + path.search, init), copy)).catch(() => {}); }
      return r;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      setOffline(true);
      if (method === "GET") {
        const hit = await caches.open(DATA).then(c => c.match(cacheKey(path.pathname + path.search, init))).catch(() => null);
        if (hit) { usedCache = true; paint(); return hit; }
        throw new TypeError("You're offline and this has not been saved yet. Open it once with a connection first.");
      }
      if (method === "POST" && QUEUEABLE.test(path.pathname)) {                                           // keep your progress, send it later
        const q = queue(); q.push({ url: path.pathname, headers: { ...(init.headers || {}), "Content-Type": "application/json" }, body: init.body || "{}", at: Date.now() }); saveQueue(q);
        return new Response(JSON.stringify({ ok: true, queued: true }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("You're offline. This part needs a connection (it uses the AI).");
    }
  };
  window.CramlyOffline = { flush, queue, isOffline: () => offline, _use: fn => { realFetch = fn; } };   // _use is for tests: swap the network
  addEventListener("load", () => { paint(); flush(); setInterval(flush, 30000); });
})();
