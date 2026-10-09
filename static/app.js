/* Cramly: the app. One page, hash routes. Home → a study set → a topic (tutor, read, flashcards, quiz) plus calendar,
   daily review and lecture recording. The tutor lives in a side panel that follows whatever you're studying. */
"use strict";

/* ============================================================ helpers */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const isArabic = (s) => /[؀-ۿ]/.test(s || "");

function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
/** Small, safe markdown: headings, lists, quotes, bold, italics, code, links. A "Remember" section becomes a callout. */
function md(text) {
  const out = [];
  let list = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    const li = /^[-*•]\s+(.*)$/.exec(line), ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (li || ol) {
      const kind = li ? "ul" : "ol";
      if (!list || list.kind !== kind) { list = { kind, items: [] }; out.push(list); }
      list.items.push(`<li>${inline((li || ol)[1])}</li>`);
      continue;
    }
    list = null;
    if (!line) continue;
    const head = /^(#{1,4})\s+(.*)$/.exec(line), quote = /^>\s?(.*)$/.exec(line);
    if (head) out.push({ head: head[2], html: `<h${head[1].length <= 2 ? 3 : 4}>${inline(head[2])}</h${head[1].length <= 2 ? 3 : 4}>` });
    else if (quote) out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  const html = out.map((x) => (typeof x === "string" ? x : x.kind ? `<${x.kind}>${x.items.join("")}</${x.kind}>` : x.html));
  const at = out.findIndex((x) => x.head && /^(remember|تذكّر|تذكر|لا تنس)/i.test(x.head));
  return at >= 0 ? `${html.slice(0, at).join("")}<div class="remember">${html.slice(at).join("")}</div>` : html.join("");
}
const stripMd = (s) => String(s).replace(/[#*`>_]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();

function toast(msg, bad) {
  const t = Object.assign(document.createElement("div"), { className: `toast${bad ? " bad" : ""}`, textContent: msg });
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 5000 : 3200);
}

/* ---------- network ---------- */
let key = ls.get("cramly.key", "");
function baseHeaders() {
  const h = { "X-Tz-Offset": String(new Date().getTimezoneOffset()) };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}
async function api(path, { method, body, form, signal } = {}) {
  const headers = baseHeaders();
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(path, { method: method || (payload ? "POST" : "GET"), headers, body: payload, signal });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && key) { signOut(); throw new Error("Signed out."); }
  if (r.status === 402 && d.locked) { showPaywall(d); throw new Error(d.error || "Free minute used."); }
  if (gateScreen(r.status, d)) throw new Error(d.error || "Blocked.");
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}
async function stream(path, { body, form, signal }, onEvent) {
  const headers = baseHeaders();
  let payload = form;
  if (!form) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(path, { method: "POST", headers, body: payload, signal });
  if (!r.ok) { const d = await r.json().catch(() => ({})); if (r.status === 402 && d.locked) showPaywall(d); else gateScreen(r.status, d); throw new Error(d.error || "Something went wrong."); }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}
function signOut() { ls.del("cramly.key"); key = ""; location.hash = ""; location.reload(); }

/* ---------- sheets, busy overlay, confetti ---------- */
function sheet(html, after) {
  $("#sheet-body").innerHTML = html;
  $$("[data-close]", $("#sheet-body")).forEach((b) => b.addEventListener("click", closeSheet));
  if (!$("#sheet").open) $("#sheet").showModal();
  after?.();
}
const closeSheet = () => { if ($("#sheet").open) $("#sheet").close(); };
$("#sheet").addEventListener("click", (e) => { if (e.target === $("#sheet")) closeSheet(); });
function askText({ title, value = "", label = "", type = "text", ok = "Save", hint = "" }) {
  return new Promise((resolve) => {
    sheet(`<h3>${esc(title)}</h3>${hint ? `<p class="muted">${esc(hint)}</p>` : ""}<label>${esc(label)}<input id="ask-in" type="${type}" value="${esc(value)}"></label>
      <div class="sheet-actions"><button class="btn" data-close type="button">Cancel</button><button class="btn primary" id="ask-ok" type="button">${esc(ok)}</button></div>`, () => {
      const input = $("#ask-in");
      input.focus(); input.select?.();
      let answered = false;
      const done = (v) => { if (answered) return; answered = true; closeSheet(); resolve(v); };
      $("#ask-ok").addEventListener("click", () => done(input.value));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(input.value); });
      $("#sheet").addEventListener("close", () => done(null), { once: true });
    });
  });
}
function confirmSheet({ title, text, ok = "Yes", danger = false }) {
  return new Promise((resolve) => {
    sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="sheet-actions"><button class="btn" data-close type="button">Cancel</button><button class="btn ${danger ? "danger" : "primary"}" id="cf-ok" type="button">${esc(ok)}</button></div>`, () => {
      let answered = false;
      const done = (v) => { if (answered) return; answered = true; closeSheet(); resolve(v); };
      $("#cf-ok").addEventListener("click", () => done(true));
      $("#sheet").addEventListener("close", () => done(false), { once: true });
    });
  });
}
const TIPS = ["Tip: ask the tutor in Arabic or English, it follows you.", "Tip: flashcards come back just before you'd forget them.",
  "Tip: the Guided tutor asks YOU questions. That's how it sticks.", "Tip: score 80% on a topic quiz to master it.", "Tip: a photo of a notebook page works too."];
let tipTimer = null;
function busy(on, title, line) {
  $("#busy").hidden = !on;
  clearInterval(tipTimer);
  if (!on) return;
  $("#busy-title").textContent = title || "Working on it…";
  $("#busy-line").textContent = line || "One moment";
  let i = Math.floor(Math.random() * TIPS.length);
  tipTimer = setInterval(() => { i = (i + 1) % TIPS.length; if (!$("#busy-line").dataset.live) $("#busy-line").textContent = TIPS[i]; }, 4500);
}
function busyLine(text) { const l = $("#busy-line"); l.dataset.live = "1"; l.textContent = text; setTimeout(() => delete l.dataset.live, 3500); }

function confetti(n = 140) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ["#6a4cff", "#ffb938", "#2fbf8a", "#ff6b8b", "#4aa8ff", "#ffffff"];
  const bits = Array.from({ length: n }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.55, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
    w: 6 + Math.random() * 7, h: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[Math.floor(Math.random() * colors.length)] }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const b of bits) {
      b.vy += 0.38; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vx *= 0.99;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (++frames < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

/* ============================================================ state */
const S = {
  me: null, sets: [], cur: null, active: ls.get("cramly.active", {}), ctx: null, chat: null,
  tutorOpen: false, keyHandler: null, calMonth: null, calSel: null,
};
const INTERVALS = [0, 1, 3, 7, 14, 30];
const dayLabel = (d) => (d <= 0 ? "10 min" : d === 1 ? "1 day" : `${d} days`);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const hello = () => { const h = new Date().getHours(); return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const fmtDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const daysUntil = (iso) => Math.round((new Date(`${iso}T12:00`) - new Date(`${S.me?.today || new Date().toISOString().slice(0, 10)}T12:00`)) / 864e5);
const topicById = (id) => S.cur?.topics.find((t) => t.id === id);

/* ============================================================ the shell: sidebar, top bar, layout */
function shell({ tab = "", set = null, crumbs = [], tutor = false, topicId = 0 }) {
  S.ctx = set ? { setId: set.id, topicId } : null;
  const due = S.me?.due || 0;
  const on = (t) => (tab === t ? "on" : "");
  const sid = set?.id;
  $("#side").innerHTML = `
    <a class="logo" href="#/"><img src="/static/icon-64.png" alt="" width="34" height="34"><b>Cramly</b></a>
    <nav>
      <a href="#/" class="${on("home")}">${ic("home")}Home</a>
      <a href="#/calendar" class="${on("calendar")}">${ic("calendar")}Calendar</a>
      <a href="#/review" class="${on("review")}">${ic("cards")}Daily review${due ? `<span class="badge">${due}</span>` : ""}</a>
      <a href="#/record" class="${on("record")}">${ic("mic")}Record lecture</a>
      <a href="#/solve" class="${on("solve")}">${ic("camera")}Snap and solve<span class="badge new">new</span></a>
      <a href="#/progress" class="${on("progress")}">${ic("chart")}Progress</a>
    </nav>
    ${set ? `
    <a class="current" href="#/set/${sid}"><span class="tile" style="--h:${set.hue}">${esc(set.emoji)}</span><b>${esc(set.title)}</b></a>
    <div class="sep">This study set</div>
    <nav>
      <a href="#/set/${sid}" class="${on("set")}">${ic("map")}Study plan</a>
      <button class="nav" data-tutor="ask">${ic("chat")}Chat with tutor</button>
      <button class="nav" data-tutor="guided">${ic("cap")}Tutor me</button>
      <a href="#/set/${sid}/cards" class="${on("cards")}">${ic("cards")}Flashcards</a>
      <a href="#/set/${sid}/swipe" class="${on("swipe")}">${ic("swipe")}Swipe game<span class="badge new">new</span></a>
      <a href="#/set/${sid}/test" class="${on("test")}">${ic("test")}Practice test</a>
      <a href="#/set/${sid}/exam" class="${on("exam")}">${ic("timer")}Exam builder</a>
      <a href="#/set/${sid}/map" class="${on("map")}">${ic("network")}Mind map</a>
      <a href="#/set/${sid}/cheat" class="${on("cheat")}">${ic("sheet")}Cheat sheet</a>
      <a href="#/set/${sid}/match" class="${on("match")}">${ic("puzzle")}Match game</a>
      <a href="#/set/${sid}/add" class="${on("add")}">${ic("upload")}Add material</a>
    </nav>
    <div class="sep">Materials</div>
    <div class="mats">${(S.cur?.materials || []).map((m) => `<span title="${esc(m.name)}">${esc(m.name)}</span>`).join("") || "<span>Nothing yet</span>"}</div>` : ""}
    <div class="grow"></div>
    ${auraCard()}
    <nav>
      <a href="#/new" class="${on("new")}">${ic("plus")}New study set</a>
      <button class="nav" id="open-settings">${ic("gear")}Settings</button>
    </nav>`;
  $("#top").innerHTML = `
    <div class="crumbs">${crumbs.map((c, i) => (c.href ? `<a href="${c.href}">${esc(c.text)}</a>` : `<span>${esc(c.text)}</span>`) + (i < crumbs.length - 1 ? "<span>›</span>" : "")).join("")}</div>
    <div class="right">${accessChip()}<button class="chip-btn" id="focus-chip" title="Focus timer"></button>${auraChip()}
      <span class="chip-btn streak ${S.me?.streak ? "" : "cold"}" title="Days in a row you studied">${ic("flame")}<b>${S.me?.streak || 0}</b></span>
      ${set ? `<button class="chip-btn tutor-btn" id="top-tutor">${ic("chat")}<span class="lbl">Tutor</span></button>` : ""}</div>`;
  $$("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab || (tab === "set" && a.dataset.tab === "home")));
  $("#tabbar").hidden = false;
  applyTutorLayout(tutor && !!set);
  paintTutor();
  wireShell();
}
function wireShell() {
  $$("[data-tutor]").forEach((b) => b.addEventListener("click", () => openTutor({ mode: b.dataset.tutor, topic: S.ctx?.topicId || 0 })));
  $("#open-settings")?.addEventListener("click", settingsSheet);
  $("#top-tutor")?.addEventListener("click", () => toggleTutor());
  afterShell();
}
const wide = () => matchMedia("(min-width: 1240px)").matches;
function applyTutorLayout(show) {
  const hide = ls.get("cramly.tutorHidden", false);
  $("#app").classList.toggle("with-tutor", show && !hide);
  if (!show || wide()) S.tutorOpen = false;
  $("#tutor").classList.toggle("open", S.tutorOpen);
}
function toggleTutor(force) {
  if (wide() && S.ctx) {
    const hidden = force === undefined ? !ls.get("cramly.tutorHidden", false) : !force;
    ls.set("cramly.tutorHidden", hidden);
    $("#app").classList.toggle("with-tutor", !hidden);
  } else {
    S.tutorOpen = force === undefined ? !S.tutorOpen : force;
    $("#tutor").classList.toggle("open", S.tutorOpen);
  }
  if (S.tutorOpen || (wide() && !ls.get("cramly.tutorHidden", false))) setTimeout(() => $("#t-text")?.focus(), 50);
}
$("#tab-tutor").addEventListener("click", () => toggleTutor());
addEventListener("resize", () => { if (S.ctx) applyTutorLayout(true); });

/* ============================================================ the tutor */
const chatKey = () => `cramly.chat.${S.ctx.setId}.${S.ctx.topicId || 0}`;
function loadChat() {
  if (!S.ctx) { S.chat = null; return; }
  const k = chatKey();
  if (S.chat?.key === k) return;
  S.chat = { key: k, msgs: ls.get(k, []), busy: false, live: "", mode: S.ctx.topicId ? ls.get("cramly.mode", "guided") : ls.get("cramly.mode", "ask"), turns: 0 };
}
function saveChat() { if (S.chat) ls.set(S.chat.key, S.chat.msgs.slice(-30)); }
function paintTutor() {
  loadChat();
  const el = $("#tutor");
  if (!S.ctx) {
    el.innerHTML = `<div class="t-head"><div class="ava">🦉</div><div class="grow"><b>Cramly tutor</b><small>Pick a study set to chat about</small></div><button class="icon-btn" data-tclose aria-label="Close">✕</button></div>
      <div class="t-body"><div class="pick">${S.sets.map((s) => `<button data-pick="${s.id}"><span>${esc(s.emoji)}</span>${esc(s.title)}</button>`).join("") || '<p class="muted">Make a study set first.</p>'}</div></div>`;
    $$("[data-pick]", el).forEach((b) => b.addEventListener("click", () => { S.tutorOpen = false; go(`#/set/${b.dataset.pick}`); setTimeout(() => toggleTutor(true), 400); }));
    $("[data-tclose]", el)?.addEventListener("click", () => toggleTutor(false));
    return;
  }
  const set = S.cur?.set, topic = S.ctx.topicId ? topicById(S.ctx.topicId) : null;
  const c = S.chat;
  el.innerHTML = `
    <div class="t-head"><div class="ava">🦉</div><div class="grow"><b>Cramly tutor</b><small>${esc(set?.emoji || "")} ${esc(topic ? topic.title : set?.title || "")}</small></div>
      ${topic ? '<button class="btn small" id="t-whole" title="Talk about the whole study set">Whole set</button>' : ""}
      <button class="icon-btn" id="t-clear" title="Clear this chat" aria-label="Clear chat">🗑️</button>
      <button class="icon-btn" data-tclose aria-label="Close tutor">✕</button></div>
    <div class="t-modes"><button data-mode="guided" class="${c.mode === "guided" ? "on" : ""}">🎓 Guided</button><button data-mode="ask" class="${c.mode === "ask" ? "on" : ""}">💬 Ask</button>
      <select class="t-style" id="t-style" aria-label="Tutor style">${tutorStyleOptions()}</select></div>
    ${call.on ? `<div class="callbar"><span class="wave"><i></i><i></i><i></i><i></i></span><span id="call-state">${call.speaking ? "Speaking…" : "Listening…"}</span><button class="btn small" id="call-lang" style="margin-left:auto">${voiceLang().startsWith("ar") ? "ع" : "EN"}</button></div>` : ""}
    <div class="t-body" id="t-body"></div>
    <div class="t-input"><div class="composer">
      <textarea id="t-text" rows="1" placeholder="${c.mode === "guided" ? "Answer, or ask anything…" : "Ask your tutor anything…"}" aria-label="Message"></textarea>
      <div class="c-row"><button class="call ${call.on ? "live" : ""}" id="t-call">${call.on ? "⏹ End call" : "📞 Call"}</button><span class="grow"></span>
        <button class="mic" id="t-mic" title="Dictate" aria-label="Dictate">🎤</button><button class="send" id="t-send" aria-label="Send">↑</button></div></div></div>`;
  paintMsgs();
  $("[data-tclose]", el).addEventListener("click", () => toggleTutor(false));
  $("#t-whole")?.addEventListener("click", () => { S.ctx.topicId = 0; S.chat = null; paintTutor(); });
  $("#t-clear").addEventListener("click", () => { c.msgs = []; saveChat(); paintMsgs(); });
  $$("[data-mode]", el).forEach((b) => b.addEventListener("click", () => { c.mode = b.dataset.mode; ls.set("cramly.mode", c.mode); paintTutor(); }));
  $("#t-style")?.addEventListener("change", (e) => ls.set("cramly.style", e.target.value));
  const ta = $("#t-text");
  const send = () => { const v = ta.value.trim(); if (v) { ta.value = ""; ta.style.height = ""; sendChat(v); } };
  $("#t-send").addEventListener("click", send);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`; });
  $("#t-call").addEventListener("click", () => (call.on ? stopCall() : startCall()));
  $("#t-mic").addEventListener("click", dictate);
  $("#call-lang")?.addEventListener("click", () => { ls.set("cramly.vlang", voiceLang().startsWith("ar") ? "en-US" : "ar-SA"); paintTutor(); });
}
function suggestions() {
  const t = S.ctx.topicId ? topicById(S.ctx.topicId) : null;
  return t ? ["Explain this simply", "Give me an example", "Quiz me on this", "Why does this matter?"]
    : ["What is this study set about?", "Which topics are hardest?", "Make me a 1-week study plan", "Explain the key terms simply"];
}
function paintMsgs() {
  const body = $("#t-body"), c = S.chat;
  if (!body || !c) return;
  if (!c.msgs.length && !c.busy) {
    body.innerHTML = `<div class="t-empty"><div class="owl">🦉</div><h3>How can I help?</h3>
      <p class="muted small">${c.mode === "guided" ? "I'll teach this step by step and ask you questions." : "Ask anything about your material."}</p>
      <div class="sugs">${suggestions().map((s) => `<button class="sug">${esc(s)}</button>`).join("")}</div></div>`;
    $$(".sug", body).forEach((b) => b.addEventListener("click", () => sendChat(b.textContent)));
    return;
  }
  body.innerHTML = c.msgs.map((m) => (m.role === "user" ? `<div class="msg user" dir="auto">${esc(m.content)}</div>`
    : m.role === "error" ? `<div class="msg bot err">${esc(m.content)}</div>` : `<div class="msg bot" dir="auto">${md(m.content)}</div>`)).join("")
    + (c.busy ? `<div class="msg bot" id="live" dir="auto">${c.live ? md(c.live) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>` : "");
  body.scrollTop = body.scrollHeight;
}
function paintLive() { const l = $("#live"), c = S.chat; if (l && c) { l.innerHTML = md(c.live); const b = $("#t-body"); b.scrollTop = b.scrollHeight; } }
function openTutor({ mode, topic = 0, start = false } = {}) {
  if (!S.ctx) { S.tutorOpen = true; $("#tutor").classList.add("open"); return; }
  S.ctx.topicId = topic;
  S.chat = null;
  loadChat();
  if (mode) { S.chat.mode = mode; ls.set("cramly.mode", mode); }
  applyTutorLayout(true);
  ls.set("cramly.tutorHidden", false);
  $("#app").classList.add("with-tutor");
  if (!wide()) { S.tutorOpen = true; $("#tutor").classList.add("open"); }
  paintTutor();
  const t = topic ? topicById(topic) : null;
  if (start && t && !S.chat.msgs.length) sendChat(S.chat.mode === "guided" ? `Teach me: ${t.title}` : `Explain "${t.title}" simply.`);
  setTimeout(() => $("#t-text")?.focus(), 80);
}
async function sendChat(text, opts = {}) {
  const c = S.chat;
  if (!c || c.busy || !S.ctx) return;
  c.msgs.push({ role: "user", content: text });
  c.busy = true; c.live = ""; c.turns++;
  saveChat(); paintMsgs();
  const ctx = { ...S.ctx };
  let reply = "", err = "";
  try {
    await stream("/api/chat", { body: { set_id: ctx.setId, topic_id: ctx.topicId || null, mode: c.mode, style: ls.get("cramly.style", ""),
      messages: c.msgs.filter((m) => m.role === "user" || m.role === "assistant").map(({ role, content }) => ({ role, content })) } }, (ev) => {
      if (ev.type === "delta") { reply += ev.text; c.live = reply; paintLive(); } else if (ev.type === "error") err = ev.text;
    });
  } catch (e) { err = e.message; }
  c.busy = false; c.live = "";
  if (reply) c.msgs.push({ role: "assistant", content: reply });
  if (err) c.msgs.push({ role: "error", content: err });
  saveChat();
  if (S.chat === c) paintMsgs();
  if (reply && ctx.topicId && c.turns === 3) api(`/api/topics/${ctx.topicId}/event`, { body: { kind: "chat" } }).then(() => refreshCur()).catch(() => {});
  if (opts.speak || call.on) { if (reply) speak(reply); else if (call.on) listen(); }
}

/* ---------- voice: dictation and calls (the browser's speech recognition and voices) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const call = { on: false, rec: null, speaking: false };
const voiceLang = () => ls.get("cramly.vlang", null) || (navigator.language || "en-US");
function dictate() {
  if (!SR) { toast("Dictation needs Chrome or Edge.", true); return; }
  const btn = $("#t-mic"), rec = new SR();
  rec.lang = voiceLang(); rec.interimResults = true;
  const base = $("#t-text").value;
  btn.classList.add("live");
  rec.onresult = (e) => { $("#t-text").value = `${base} ${[...e.results].map((r) => r[0].transcript).join("")}`.trim(); };
  rec.onend = () => btn.classList.remove("live");
  rec.onerror = (e) => { if (e.error === "not-allowed") toast("Allow the microphone to dictate.", true); };
  try { rec.start(); } catch { /* already running */ }
}
function startCall() {
  if (!SR || !("speechSynthesis" in window)) { toast("Voice calls need Chrome or Edge.", true); return; }
  call.on = true; call.speaking = false;
  paintTutor();
  if (!S.chat.msgs.length && S.ctx.topicId) sendChat(S.chat.mode === "guided" ? `Teach me: ${topicById(S.ctx.topicId)?.title || "this topic"}` : "Give me a quick overview.", { speak: true });
  else listen();
}
function stopCall() {
  call.on = false; call.speaking = false;
  try { call.rec?.abort(); } catch { /* ignore */ }
  speechSynthesis.cancel();
  paintTutor();
}
function listen() {
  if (!call.on) return;
  const rec = new SR();
  call.rec = rec; rec.lang = voiceLang(); rec.interimResults = true; rec.continuous = false;
  let finalText = "";
  rec.onresult = (e) => {
    let t = "";
    for (const r of e.results) t += r[0].transcript;
    const ta = $("#t-text"); if (ta) ta.value = t;
    if (e.results[e.results.length - 1].isFinal) finalText = t;
  };
  rec.onend = () => {
    if (finalText.trim()) { const ta = $("#t-text"); if (ta) ta.value = ""; sendChat(finalText.trim(), { speak: true }); }
    else if (call.on && !S.chat?.busy && !call.speaking) setTimeout(listen, 350);
  };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Allow the microphone to call your tutor.", true); stopCall(); } };
  try { rec.start(); } catch { /* already running */ }
  const st = $("#call-state"); if (st) st.textContent = "Listening…";
}
function speak(text) {
  if (!call.on) return;
  const plain = stripMd(text), u = new SpeechSynthesisUtterance(plain);
  u.lang = isArabic(plain) ? "ar-SA" : voiceLang().startsWith("ar") ? "en-US" : voiceLang();
  const voices = speechSynthesis.getVoices(), pref = voices.find((v) => v.lang === u.lang) || voices.find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
  if (pref) u.voice = pref;
  call.speaking = true;
  const st = $("#call-state"); if (st) st.textContent = "Speaking…";
  u.onend = u.onerror = () => { call.speaking = false; if (call.on) listen(); };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ============================================================ router */
async function loadSet(id) {
  if (S.cur?.set.id === id) return S.cur;
  S.cur = await api(`/api/sets/${id}`);
  return S.cur;
}
async function refreshCur() {
  if (!S.cur) return;
  S.cur = await api(`/api/sets/${S.cur.set.id}`);
  S.me = { ...S.me, ...(await api("/api/me")) };
}
async function route() {
  window.leaveView?.();
  S.keyHandler && document.removeEventListener("keydown", S.keyHandler);
  S.keyHandler = null;
  if (!key) { $("#welcome").hidden = false; $("#app").hidden = true; $("#tabbar").hidden = true; return; }
  $("#welcome").hidden = true; $("#app").hidden = false;
  const p = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
  const view = $("#view");
  view.scrollTop = 0;
  try {
    S.me = { ...S.me, ...(await api("/api/me")) };
    if (!S.cur || p[0] !== "set") { if (p[0] !== "set") S.cur = S.cur && p[0] === "set" ? S.cur : null; }
    if (p[0] === "set" && p[1]) {
      const id = +p[1];
      if (!S.sets.length) S.sets = (await api("/api/sets")).sets;
      await loadSet(id);
      const sub = p[2];
      if (!sub) return setView();
      if (sub === "add") return newView(id);
      if (sub === "cards") return cardsView({ set: true });
      if (sub === "test") return testView();
      if (sub === "match") return matchView();
      if (sub === "swipe") return swipeView();
      { const x = setRoute(sub); if (x) return x; }
      if (sub === "t" && p[3]) {
        const tid = +p[3], kind = p[4];
        { const x = topicRoute(kind, p[5], tid); if (x) return x; }
        if (kind === "read") return readView(tid);
        if (kind === "cards") return cardsView({ topicId: tid });
        if (kind === "quiz") return quizView(tid);
        if (kind === "swipe") return swipeView({ topicId: tid });
        if (kind === "explain") return explainView(tid);
      }
      return go("#/");
    }
    S.cur = null;
    { const x = globalRoute(p); if (x) return x; }
    if (p[0] === "new") return newView();
    if (p[0] === "review") return reviewView();
    if (p[0] === "calendar") return calendarView();
    if (p[0] === "record") return recordView();
    return homeView();
  } catch (e) {
    shell({ tab: "home", crumbs: [{ text: "Home", href: "#/" }] });
    view.innerHTML = `<div class="empty-hero"><div class="owl">🙈</div><h2>That didn't load</h2><p>${esc(e.message)}</p><a class="btn primary" href="#/">Back home</a></div>`;
  }
}
addEventListener("hashchange", route);

/* ============================================================ home */
const SAMPLE = `Photosynthesis

Photosynthesis is the process by which plants, algae and some bacteria convert light energy into chemical energy stored in glucose. It takes place in the chloroplasts, which contain the green pigment chlorophyll. The overall equation is: 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. Carbon dioxide enters through stomata in the leaves, and water is absorbed by the roots and carried up the xylem.

The light-dependent reactions happen in the thylakoid membranes. Chlorophyll absorbs mostly red and blue light and reflects green. Light energy splits water molecules (photolysis), releasing oxygen as a by-product, and produces ATP and NADPH, which carry energy to the next stage.

The Calvin cycle (light-independent reactions) takes place in the stroma. Using ATP and NADPH, the enzyme RuBisCO fixes carbon dioxide onto a five-carbon sugar called RuBP. Through a series of steps, three-carbon molecules are produced and used to make glucose, while RuBP is regenerated.

Factors affecting the rate of photosynthesis: light intensity, carbon dioxide concentration and temperature. Each can be the limiting factor. Above about 40 degrees Celsius enzymes begin to denature and the rate falls sharply. Plants store glucose as starch, use it for respiration, or build cellulose for cell walls.

Photosynthesis and respiration are complementary: respiration releases energy from glucose using oxygen and produces CO2 and water, while photosynthesis uses CO2 and water to make glucose and oxygen. Together they cycle carbon and oxygen through ecosystems.`;

async function homeView() {
  shell({ tab: "home", crumbs: [{ text: "Home" }] });
  const { sets } = await api("/api/sets");
  S.sets = sets;
  paintTutor();
  const me = S.me, due = me.due;
  const card = (s) => `<a class="set" href="#/set/${s.id}" style="--h:${s.hue}">
      ${s.due ? `<span class="due">${s.due} due</span>` : ""}
      <span class="tile">${esc(s.emoji)}</span><div><b>${esc(s.title)}</b><small>${s.topics} topics${s.exam ? ` · exam ${daysUntil(s.exam) >= 0 ? `in ${daysUntil(s.exam)} days` : "passed"}` : ""}</small></div>
      <div class="bar green"><i style="width:${pct(s.mastered, s.topics)}%"></i></div><small>${s.mastered} of ${s.topics} mastered</small></a>`;
  $("#view").innerHTML = `<div class="wide">
    <div class="home-head"><div><p class="eyebrow">${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1>${hello()}${me.name ? `, ${esc(me.name)}` : ""} 👋</h1></div>
      <a class="btn primary big" href="#/new">＋ New study set</a></div>
    ${sets.length ? dashboard(sets) : ""}
    ${toolsStrip()}
    ${sets.length ? `<h2 class="sec">Your study sets <small>${sets.length}</small></h2><div class="sets">${sets.map(card).join("")}
      <a class="set new" href="#/new"><span>＋</span>Add a study set</a></div>`
    : `<div class="empty-hero"><div class="owl">🦉</div><h2>Let's make your first study set</h2>
        <p>Upload a PDF, slides, a photo of your notes, or paste text. In under a minute you'll have a plan, a tutor, flashcards and quizzes.</p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center"><a class="btn primary big" href="#/new">Upload my notes</a><button class="btn big" id="sample">Try sample notes</button></div></div>`}
  </div>`;
  $("#sample")?.addEventListener("click", () => submitMaterials({ text: SAMPLE, title: "Photosynthesis (sample)" }));
}

/* ============================================================ making a set */
async function submitMaterials({ files = [], text = "", title = "", setId = 0, name = "" }) {
  busy(true, setId ? "Adding to your set" : "Building your study set", files.length ? "Squeezing your files first…" : "Reading your material…");
  let newId = null, added = null, err = "";
  try {
    const packed = await compressFiles(files, busyLine);
    if (packed.before > 1048576) busyLine(`Uploading ${(packed.after / 1048576).toFixed(1)} MB (was ${(packed.before / 1048576).toFixed(1)} MB)…`);
    const form = new FormData();
    packed.files.forEach((f) => form.append("files", f));
    if (text) form.append("text", text);
    if (title) form.append("title", title);
    if (name) form.append("name", name);
    await stream(setId ? `/api/sets/${setId}/materials` : "/api/sets", { form }, (ev) => {
      if (ev.type === "status") busyLine(ev.text);
      else if (ev.type === "set") newId = ev.id;
      else if (ev.type === "added") added = ev.topics;
      else if (ev.type === "error") err = ev.text;
    });
  } catch (e) { err = e.message; }
  busy(false);
  if (err) { toast(err, true); return false; }
  confetti();
  S.cur = null;
  toast(setId ? (added ? `Added ${added} new topic${added > 1 ? "s" : ""} 🎉` : "Added. Nothing new to plan from it.") : "Your study set is ready! 🎉");
  go(`#/set/${newId || setId}`);
  return true;
}
async function newView(targetId = 0) {
  const set = targetId ? S.cur.set : null;
  shell({ tab: targetId ? "add" : "new", set, crumbs: targetId ? [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${targetId}` }, { text: "Add material" }] : [{ text: "Home", href: "#/" }, { text: "New study set" }] });
  let picked = [];
  $("#view").innerHTML = `<div class="wide"><div class="home-head"><div><p class="eyebrow">${targetId ? "Add to this set" : "Step 1 of 1"}</p><h1>${targetId ? "Add more material" : "What are you studying?"}</h1></div></div>
    <div class="new-grid"><div class="stack">
      <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose files"><span class="big-ico">📄</span><b>Drop your files here</b><small>PDF · Word · PowerPoint · text · photos of notes</small><span class="btn small" style="margin-top:.4rem">Choose files</span></div>
      <input id="file" type="file" multiple hidden accept=".pdf,.docx,.pptx,.txt,.md,.csv,image/*">
      <input id="cam" type="file" accept="image/*" capture="environment" hidden>
      <div class="files" id="files"></div>
      <div class="or">or paste your notes</div>
      <textarea id="text" placeholder="Paste text from your notes, a textbook, a lecture transcript…"></textarea>
      ${targetId ? "" : '<label>Name <small>(optional: I\'ll choose one if you leave it empty)</small><input id="title" maxlength="80" placeholder="e.g. Biology chapter 4"></label>'}
      <div style="display:flex;gap:.6rem;flex-wrap:wrap"><button class="btn primary big" id="go" disabled>${targetId ? "Add it" : "Create my study set ✨"}</button>
        <button class="btn big" id="photo">📷 Take a photo</button><a class="btn big" href="#/record">🎙️ Record a lecture</a></div>
      <button class="link" id="sample2" style="justify-self:start">No notes handy? Try sample notes</button>
    </div>
    <aside class="tips"><h3>What works best</h3><ul><li>Lecture slides and typed notes give the cleanest plans.</li><li>Photos: good light, one page per photo, text facing up.</li>
      <li>Several files at once is fine: I'll organise them together.</li><li>Arabic, English or both, I keep your language.</li><li>Files up to 1 GB are fine. Long textbooks (hundreds of pages) just take a little longer.</li></ul></aside></div></div>`;
  const paint = () => {
    $("#files").innerHTML = picked.map((f, i) => `<div class="file"><span>📄 ${esc(f.name)}</span><small>${(f.size / 1048576).toFixed(1)} MB</small><button data-rm="${i}" aria-label="Remove">✕</button></div>`).join("");
    $$("[data-rm]").forEach((b) => b.addEventListener("click", () => { picked.splice(+b.dataset.rm, 1); paint(); }));
    $("#go").disabled = !(picked.length || $("#text").value.trim().length >= 80);
    const mb = picked.reduce((n, f) => n + f.size, 0) / 1048576;
    if (mb > 40) $("#files").insertAdjacentHTML("beforeend", `<p class="muted small">${mb.toFixed(0)} MB to upload. Big files take a few minutes: keep this tab open.</p>`);
  };
  const add = (list) => {
    const ok = list.filter((f) => f.size <= 1024 ** 3);
    if (ok.length < list.length) toast("Files can be up to 1 GB. Skipped the bigger ones.", true);
    picked = [...picked, ...ok].slice(0, 8); paint();
  };
  const drop = $("#drop");
  drop.addEventListener("click", () => $("#file").click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file").click(); } });
  ["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => add([...e.dataTransfer.files]));
  $("#file").addEventListener("change", (e) => { add([...e.target.files]); e.target.value = ""; });
  $("#photo").addEventListener("click", () => $("#cam").click());
  $("#cam").addEventListener("change", (e) => { add([...e.target.files]); e.target.value = ""; });
  $("#text").addEventListener("input", paint);
  $("#sample2").addEventListener("click", () => { $("#text").value = SAMPLE; paint(); });
  $("#go").addEventListener("click", () => submitMaterials({ files: picked, text: $("#text").value.trim(), title: $("#title")?.value.trim() || "", setId: targetId }));
  paint();
}

/* ============================================================ a study set */
function activeTopic() {
  const { topics, set } = S.cur;
  return topics.find((t) => t.id === S.active[set.id]) || topics.find((t) => t.status < 2) || topics[0];
}
function setActive(id) { S.active[S.cur.set.id] = id; ls.set("cramly.active", S.active); }
function statusWord(t) { return t.status >= 2 ? "Mastered" : t.status === 1 ? "In progress" : "New"; }
async function setView() {
  const { set, topics } = S.cur;
  shell({ tab: "set", set, crumbs: [{ text: "Home", href: "#/" }, { text: set.title }], tutor: true });
  if (!topics.length) { $("#view").innerHTML = `<div class="empty-hero"><div class="owl">🤔</div><h2>No topics yet</h2><p>Add some material and I'll build the plan.</p><a class="btn primary" href="#/set/${set.id}/add">Add material</a></div>`; return; }
  const n = topics.length, today = S.me.today;
  const planDays = {};
  S.cur.plan.forEach((p) => (planDays[p.date] ||= []).push(topicById(p.topic_id)));
  const planHtml = set.exam
    ? `<h2 class="sec">Study plan <small>exam ${fmtDay(set.exam)} · ${daysUntil(set.exam) >= 0 ? `${daysUntil(set.exam)} days left` : "passed"}</small></h2>
       <div class="planlist">${Object.entries(planDays).slice(0, 21).map(([d, ts]) => `<div class="day ${d === today ? "today" : ""}"><time>${d === today ? "Today" : fmtDay(d)}</time><div>${ts.map((t) => `<a href="#/set/${set.id}" data-pick="${t.id}">${t.status ? "◐" : "○"} ${esc(t.title)}</a>`).join("")}</div></div>`).join("") || '<p class="muted">Everything is mastered. 🎉</p>'}</div>`
    : `<h2 class="sec">Study plan</h2><div class="cta-card"><div><b>Got an exam coming up?</b><p>Set the date and I'll spread the topics over the days left.</p></div><button class="btn primary" id="set-exam">📅 Set exam date</button></div>`;
  $("#view").innerHTML = `<div class="wide" style="--h:${set.hue}">
    <div class="set-head"><div class="tile">${esc(set.emoji)}</div><div style="flex:1;min-width:14rem">
      <h1>${esc(set.title)} <button class="icon-btn" id="rename" aria-label="Rename">✏️</button></h1>
      <div class="meta"><span class="pill">📖 ${n} topics</span><span class="pill">✅ ${set.covered} covered</span><span class="pill">🏆 ${set.mastered} mastered</span>
        <button class="pill" id="exam-pill" style="cursor:pointer">${set.exam ? `📅 Exam ${fmtDay(set.exam)}` : "📅 Set exam date"}</button></div>
      <div class="bar green meter" style="margin-top:.8rem"><i style="width:${pct(set.mastered, n)}%"></i></div></div></div>
    ${nextStepCard()}
    <h2 class="sec" style="margin-top:1.4rem">Recommended from your study plan <small>${set.due ? `${set.due} flashcards due` : ""}</small></h2>
    <div class="plan-tabs" id="tabs">${topics.map((t) => `<button class="ptab ${t.status >= 2 ? "done" : t.status ? "half" : ""}" data-t="${t.id}" title="${esc(t.title)}"><em>${String(t.idx + 1).padStart(2, "0")}</em><span>${esc(t.title)}</span></button>`).join("")}</div>
    <div id="topic"></div>
    ${planHtml}
    <h2 class="sec">Practice this whole set</h2>
    <div class="modes four"><a class="mode" style="--bg:var(--mint-bg)" href="#/set/${set.id}/cards"><div class="art">🃏</div><div class="txt"><small>${set.due ? `${set.due} due` : "Spaced repetition"}</small><b>Flashcards</b></div></a>
      <a class="mode" style="--bg:var(--rose-bg)" href="#/set/${set.id}/swipe"><div class="art">🕹️</div><div class="txt"><small>Earn aura</small><b>Swipe game</b></div></a>
      <a class="mode" style="--bg:var(--lilac-2)" href="#/set/${set.id}/test"><div class="art">🎯</div><div class="txt"><small>Mixed questions</small><b>Practice test</b></div></a>
      <a class="mode" style="--bg:var(--sky-bg)" href="#/set/${set.id}/match"><div class="art">🧩</div><div class="txt"><small>Quick game</small><b>Match game</b></div></a></div>
    ${moreTools(set)}
    <h2 class="sec">All topics</h2>
    <div class="alltopics">${topics.map((t) => `<button class="trow ${t.status >= 2 ? "done" : t.status ? "half" : ""}" data-t="${t.id}"><span class="n">${t.status >= 2 ? "✓" : t.idx + 1}</span><b>${esc(t.title)}</b><small>${statusWord(t)}${t.quiz_best >= 0 ? ` · quiz ${t.quiz_best}%` : ""}</small></button>`).join("")}</div>
    <div style="margin-top:2rem;display:flex;gap:.6rem;flex-wrap:wrap"><a class="btn" href="#/set/${set.id}/add">${ic("upload")} Add material</a><button class="btn" id="export">${ic("download")} Export flashcards (CSV)</button><button class="btn danger" id="del-set">🗑️ Delete this set</button></div></div>`;
  const pickTopic = (id, scroll) => { setActive(id); paintTopic(); $$(".ptab").forEach((b) => b.classList.toggle("on", +b.dataset.t === id)); if (scroll) $("#view").scrollTo({ top: 0, behavior: "smooth" }); $(".ptab.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); };
  $$(".ptab").forEach((b) => b.addEventListener("click", () => pickTopic(+b.dataset.t)));
  $$(".trow, [data-pick]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); pickTopic(+(b.dataset.t || b.dataset.pick), true); }));
  $("#rename").addEventListener("click", async () => { const v = await askText({ title: "Rename study set", value: set.title, label: "Name" }); if (v?.trim()) { await api(`/api/sets/${set.id}`, { method: "PATCH", body: { title: v } }); await refreshCur(); setView(); } });
  const examFn = async () => {
    const v = await askText({ title: "When is your exam?", value: set.exam || "", label: "Exam date", type: "date", hint: "I'll plan which topics to study each day until then. Leave it empty to remove the date." });
    if (v === null) return;
    try { await api(`/api/sets/${set.id}`, { method: "PATCH", body: { exam: v } }); await refreshCur(); S.sets = []; setView(); } catch (e) { toast(e.message, true); }
  };
  $("#export").addEventListener("click", () => exportCards().catch((e) => toast(e.message, true)));
  $("#exam-pill").addEventListener("click", examFn); $("#set-exam")?.addEventListener("click", examFn);
  $("#del-set").addEventListener("click", async () => { if (await confirmSheet({ title: "Delete this study set?", text: "Its topics, flashcards and progress are removed for good.", ok: "Delete", danger: true })) { await api(`/api/sets/${set.id}`, { method: "DELETE" }); S.cur = null; S.sets = []; toast("Deleted"); go("#/"); } });
  pickTopic(activeTopic().id);
}
function paintTopic() {
  const { set, topics } = S.cur, t = activeTopic(), i = topics.indexOf(t);
  const box = $("#topic");
  if (!box) return;
  const base = `#/set/${set.id}/t/${t.id}`;
  const modes = [
    { k: "guided", bg: "var(--lilac-2)", art: "🦉", tag: "Recommended", name: "Guided chat", st: "" },
    { k: "read", bg: "var(--butter)", art: "📖", tag: "Catch up quickly", name: "Read", st: t.has_notes ? "opened" : "" },
    { k: "cards", bg: "var(--mint-bg)", art: "🃏", tag: "Most popular", name: "Flashcards", st: t.cards ? `${t.cards} cards${t.due ? ` · ${t.due} due` : ""}` : "" },
    { k: "quiz", bg: "var(--peach)", art: "📝", tag: "Check yourself", name: "Quiz", st: t.quiz_best >= 0 ? `best ${t.quiz_best}%` : "" },
    { k: "swipe", bg: "var(--rose-bg)", art: "🕹️", tag: "Earn aura", name: "Swipe game", st: "" },
    { k: "explain", bg: "var(--sky-bg)", art: "💡", tag: "Teach it back", name: "Explain it", st: "" },
    { k: "match", bg: "var(--butter)", art: "🧩", tag: "Quick game", name: "Match game", st: "" },
    { k: "listen", bg: "var(--sky-bg)", art: "🎧", tag: "Podcast", name: "Listen", st: "" },
    { k: "cardedit", bg: "var(--mint-bg)", art: "✏️", tag: "Your deck", name: "Edit cards", st: "" },
    { k: "test", bg: "var(--lilac-2)", art: "🎯", tag: "Whole set", name: "Practice test", st: "" },
  ];
  const steps = [["Read", t.has_notes, t.has_notes], ["Cards", t.cards > 0, t.cards > 0], ["Quiz", t.quiz_best >= 0, t.quiz_best >= 80]];
  box.innerHTML = `<section class="topic-card"><header><div><p class="kick">Topic ${i + 1} of ${topics.length} · ${statusWord(t)}</p><h2>${esc(t.title)}</h2></div>
      <button class="btn small" id="skip">Skip topic ▷</button></header>
    <p class="sum" dir="auto">${esc(t.summary)}</p>
    <div class="ideas">${t.points.slice(0, 6).map((p) => `<span dir="auto">${esc(p)}</span>`).join("")}</div>
    <div class="steps3" aria-label="Progress on this topic">${steps.map(([n, started, pass], k) => `<span class="stp ${started ? "started" : ""} ${pass ? "pass" : ""}"><i>${pass ? "✓" : k + 1}</i>${n}</span>`).join("")}</div>
    <div class="modes" id="modes">${modes.map((m, k) => `<button class="mode" style="--bg:${m.bg};${k > 2 ? "display:none" : ""}" data-m="${m.k}" data-extra="${k > 2 ? 1 : 0}"><div class="art">${m.art}</div><div class="txt"><small>${m.tag}</small><b>${m.name}${m.st ? `<span class="st">${esc(m.st)}</span>` : ""}</b></div></button>`).join("")}</div>
    <div class="more"><button class="btn small" id="more">Show more ⌄</button></div></section>`;
  $("#skip").addEventListener("click", () => { const next = topics[(i + 1) % topics.length]; setActive(next.id); paintTopic(); $$(".ptab").forEach((b) => b.classList.toggle("on", +b.dataset.t === next.id)); $(".ptab.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); });
  $("#more").addEventListener("click", (e) => { const open = e.target.dataset.open !== "1"; e.target.dataset.open = open ? "1" : "0"; e.target.textContent = open ? "Show less ⌃" : "Show more ⌄"; $$("[data-extra='1']").forEach((m) => { m.style.display = open ? "" : "none"; }); });
  $$(".mode[data-m]", box).forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.m;
    if (m === "guided") openTutor({ mode: "guided", topic: t.id, start: true });
    else if (m === "read") go(`${base}/read`); else if (m === "cards") go(`${base}/cards`); else if (m === "quiz") go(`${base}/quiz`);
    else if (m === "swipe") go(`${base}/swipe`); else if (m === "explain") go(`${base}/explain`);
    else if (m === "listen") go(`${base}/listen`); else if (m === "cardedit") go(`${base}/cards/edit`);
    else if (m === "match") go(`#/set/${set.id}/match`); else if (m === "test") go(`#/set/${set.id}/test`);
  }));
  $$(".ptab").forEach((b) => b.classList.toggle("on", +b.dataset.t === t.id));
}

/* ============================================================ read */
function skeleton(msg) { return `<div class="loading-note"><span class="owl">🦉</span>${esc(msg)}</div><div class="skeleton"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`; }
async function readView(tid) {
  const { set } = S.cur, t = topicById(tid);
  if (!t) return go(`#/set/${set.id}`);
  setActive(tid);
  shell({ tab: "set", set, topicId: tid, tutor: true, crumbs: [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: t.title }] });
  $("#view").innerHTML = `<article class="reader"><a class="btn small back" href="#/set/${set.id}">← ${esc(set.title)}</a><h1 dir="auto">${esc(t.title)}</h1>
    <div id="body">${skeleton(t.has_notes ? "Opening your notes…" : "Writing your notes… (about 10 seconds)")}</div></article>`;
  try {
    const { notes } = await api(`/api/topics/${tid}/notes`);
    if (!$("#body")) return;
    const idx = S.cur.topics.indexOf(t), next = S.cur.topics[idx + 1];
    $("#body").innerHTML = `<div class="prose" dir="auto">${md(notes)}</div>
      <div class="footer-actions"><button class="btn primary" id="done">✓ I've read this</button><a class="btn" href="#/set/${set.id}/t/${tid}/cards">🃏 Flashcards</a><a class="btn" href="#/set/${set.id}/t/${tid}/quiz">📝 Quiz me</a>
      <button class="btn" id="ask">🦉 Ask the tutor</button>${next ? `<a class="btn" href="#/set/${set.id}/t/${next.id}/read">Next topic →</a>` : ""}</div>`;
    $("#done").addEventListener("click", async () => { await api(`/api/topics/${tid}/event`, { body: { kind: "read" } }); await refreshCur(); toast("Marked as read ✓"); go(`#/set/${set.id}/t/${tid}/cards`); });
    $("#ask").addEventListener("click", () => openTutor({ mode: "ask", topic: tid }));
  } catch (e) { if ($("#body")) $("#body").innerHTML = `<div class="empty-hero"><h2>Couldn't write that</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`; }
}

/* ============================================================ flashcards */
function flashSession({ title, cards, backHref, topicId = 0, crumbs, tab = "set", set = S.cur?.set, again = null }) {
  shell({ tab, set, topicId, tutor: !!set, crumbs });
  const view = $("#view");
  if (!cards.length) { view.innerHTML = `<div class="empty-hero"><div class="owl">🎉</div><h2>No cards to review</h2><p>${again || "Nothing is due right now. Come back later."}</p><a class="btn primary" href="${backHref}">Back</a></div>`; return; }
  let queue = [...cards].sort((a, b) => Number(b.due) - Number(a.due)), total = cards.length, done = 0, flipped = false;
  const tally = [0, 0, 0, 0];
  const intervalLabel = (c, g) => (g === 0 ? "10 min" : g === 1 ? "12 h" : dayLabel(INTERVALS[Math.min(5, c.box + (g === 2 ? 1 : 2))]));
  const draw = () => {
    const c = queue[0];
    if (!c) return finish();
    view.innerHTML = `<div class="session"><div class="s-top"><a class="icon-btn" href="${backHref}" aria-label="Close">✕</a><div class="bar"><i style="width:${pct(done, total)}%"></i></div><small>${done} / ${total}</small></div>
      <div class="flip ${flipped ? "on" : ""}" id="flip"><div class="flip-inner"><div class="face"><span class="lbl">${esc(title)}</span><div class="txt" dir="auto">${esc(c.front)}</div></div>
        <div class="face back"><span class="lbl">Answer</span><div class="txt" dir="auto">${esc(c.back)}</div></div></div></div>
      ${flipped ? `<div class="grades">${[["Again", 0], ["Hard", 1], ["Good", 2], ["Easy", 3]].map(([n, g]) => `<button class="grade" data-g="${g}">${n}<small>${intervalLabel(c, g)}</small></button>`).join("")}</div>`
        : '<div class="hint">Tap the card or press Space to flip</div>'}</div>`;
    $("#flip").addEventListener("click", flip);
    $$(".grade").forEach((b) => b.addEventListener("click", () => grade(+b.dataset.g)));
  };
  const flip = () => { if (flipped) return; flipped = true; draw(); };
  const grade = (g) => {
    const c = queue.shift();
    tally[g]++;
    api(`/api/cards/${c.id}/review`, { body: { grade: g } }).catch(() => {});
    if (g === 0) { queue.splice(Math.min(queue.length, 3), 0, c); } else done++;
    flipped = false; draw();
  };
  const finish = async () => {
    const good = tally[2] + tally[3];
    view.innerHTML = `<div class="session"><div class="result"><div class="ring" style="--p:100;--c:var(--mint)">🎉</div><h2>Nice work!</h2>
      <p>${total} cards reviewed. ${good} felt good or easy${tally[0] ? `, ${tally[0]} will come back soon` : ""}.</p>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center">${topicId ? `<a class="btn primary" href="#/set/${set.id}/t/${topicId}/quiz">📝 Quiz this topic</a>` : ""}<a class="btn ${topicId ? "" : "primary"}" href="${backHref}">Done</a></div></div></div>`;
    confetti(80);
    if (topicId) await api(`/api/topics/${topicId}/event`, { body: { kind: "cards" } }).catch(() => {});
    refreshCur().catch(() => {});
  };
  S.keyHandler = (e) => {
    if (e.target.matches?.("input,textarea")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
    else if (flipped && "1234".includes(e.key)) grade(+e.key - 1);
  };
  document.addEventListener("keydown", S.keyHandler);
  draw();
}
async function cardsView({ topicId = 0, set: wholeSet = false }) {
  const { set } = S.cur;
  if (topicId) {
    const t = topicById(topicId);
    if (!t) return go(`#/set/${set.id}`);
    setActive(topicId);
    shell({ tab: "set", set, topicId, tutor: true, crumbs: [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: t.title, href: `#/set/${set.id}/t/${topicId}/read` }, { text: "Flashcards" }] });
    $("#view").innerHTML = `<div class="session">${skeleton(t.cards ? "Shuffling your cards…" : "Writing flashcards… (about 8 seconds)")}</div>`;
    try {
      const { cards } = await api(`/api/topics/${topicId}/cards`);
      flashSession({ title: t.title, cards, backHref: `#/set/${set.id}`, topicId, crumbs: [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: t.title }, { text: "Flashcards" }] });
    } catch (e) { $("#view").innerHTML = `<div class="empty-hero"><h2>Couldn't make flashcards</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`; }
    return;
  }
  shell({ tab: "cards", set, tutor: true, crumbs: [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: "Flashcards" }] });
  $("#view").innerHTML = `<div class="session">${skeleton("Getting your flashcards…")}</div>`;
  try {
    let { cards } = await api(`/api/sets/${set.id}/cards`);
    if (cards.length < 6) {
      busy(true, "Writing flashcards", `For all ${S.cur.topics.length} topics…`);
      try { await api(`/api/sets/${set.id}/prepare`, { body: { what: "cards" } }); } finally { busy(false); }
      ({ cards } = await api(`/api/sets/${set.id}/cards`));
      await refreshCur();
    }
    const dueCards = cards.filter((c) => c.due);
    const deck = dueCards.length ? dueCards : cards;
    flashSession({ title: dueCards.length ? "Due today" : set.title, cards: deck.slice(0, 40), backHref: `#/set/${set.id}`, crumbs: [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: "Flashcards" }], tab: "cards" });
  } catch (e) { $("#view").innerHTML = `<div class="empty-hero"><h2>Couldn't get flashcards</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`; }
}
async function reviewView() {
  shell({ tab: "review", crumbs: [{ text: "Home", href: "#/" }, { text: "Daily review" }] });
  $("#view").innerHTML = `<div class="session">${skeleton("Finding what's due…")}</div>`;
  const { cards } = await api("/api/due");
  flashSession({ title: "Daily review", cards, backHref: "#/", set: null, tab: "review", crumbs: [{ text: "Home", href: "#/" }, { text: "Daily review" }], again: "You're all caught up. Flashcards come back here when they're due." });
}

/* ============================================================ quizzes and tests */
function quizSession({ title, questions, backHref, onDone, crumbs, set, topicId = 0, tab = "set", exam = false, timeLimit = 0 }) {
  shell({ tab, set, topicId, tutor: !!set, crumbs });
  const view = $("#view"), L = "ABCD";
  let i = 0, score = 0, answered = false, over = false, left = timeLimit;
  const log = [];
  const draw = () => {
    const q = questions[i];
    view.innerHTML = `<div class="session"><div class="s-top"><a class="icon-btn" href="${backHref}" aria-label="Close">✕</a><div class="bar"><i style="width:${pct(i, questions.length)}%"></i></div><small>${i + 1} / ${questions.length}</small>${timeLimit ? `<small class="qtimer ${left <= 60 ? "hot" : ""}" id="qtimer">${clock(left)}</small>` : ""}</div>
      <div class="q-card">${q.topic ? `<p class="topic">${esc(q.topic)}</p>` : ""}<h3 dir="auto">${esc(q.q)}</h3>
        <div class="opts">${q.options.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${L[k]}</span><span dir="auto">${esc(o)}</span></button>`).join("")}</div><div id="why"></div></div>
      <div id="next"></div></div>`;
    $$(".opt").forEach((b) => b.addEventListener("click", () => pick(+b.dataset.k)));
    answered = false;
  };
  const pick = (k) => {
    if (answered || over) return;
    answered = true;
    const q = questions[i], ok = k === q.answer;
    if (ok) score++; else log.push({ q, k });
    if (exam) $$(".opt").forEach((b, n) => { b.disabled = true; b.classList.toggle("sel", n === k); });
    else $$(".opt").forEach((b, n) => { b.disabled = true; if (n === q.answer) b.classList.add("right"); else if (n === k) b.classList.add("wrong"); });
    if (!exam) $("#why").innerHTML = `<div class="why" dir="auto">${ok ? "✅ Correct. " : "❌ Not quite. "}${esc(q.why)}</div>`;
    $("#next").innerHTML = `<button class="btn primary big" id="nx" style="width:100%">${i + 1 < questions.length ? "Next question →" : "See my results"}</button>`;
    $("#nx").addEventListener("click", advance); $("#nx").focus();
  };
  const advance = () => { if (!answered || over) return; i++; i < questions.length ? draw() : finish(); };
  const finish = async () => {
    over = true;
    if (S.examTimer) { clearInterval(S.examTimer); S.examTimer = 0; }
    const p = pct(score, questions.length), good = p >= 80;
    view.innerHTML = `<div class="session"><div class="result"><div class="ring" style="--p:${p};--c:${good ? "var(--mint)" : p >= 50 ? "var(--sun)" : "var(--rose)"}">${p}%</div>
      <h2>${good ? "You've got this! 🎉" : p >= 50 ? "Getting there" : "Let's go over it again"}</h2><p>${score} of ${questions.length} right. ${good ? "That's enough to master the topic." : "Score 80% to master the topic: read it again or ask the tutor, then retry."}</p>
      ${log.length ? `<div class="review-list">${log.map(({ q, k }) => `<div class="rv bad" dir="auto"><b>${esc(q.q)}</b><small>Your answer: ${esc(k >= 0 ? q.options[k] : "No answer")}</small><small>✔ ${esc(q.options[q.answer])}: ${esc(q.why)}</small></div>`).join("")}</div>` : ""}
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center">${log.length ? '<button class="btn primary" id="retry">Retry the ones I missed</button>' : ""}<a class="btn ${log.length ? "" : "primary"}" href="${backHref}">Done</a></div></div></div>`;
    if (good) confetti();
    $("#retry")?.addEventListener("click", () => quizSession({ title, questions: log.map((l) => l.q), backHref, onDone: null, crumbs, set, topicId, tab }));
    if (onDone) await onDone(score, questions.length, log);
  };
  S.keyHandler = (e) => {
    if (e.target.matches?.("input,textarea")) return;
    const k = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (!answered && k >= 0 && k < 4 && $$(".opt")[k]) pick(k);
    else if (e.key === "Enter") advance();
  };
  document.addEventListener("keydown", S.keyHandler);
  draw();
  if (timeLimit) {
    S.examTimer = setInterval(() => {
      left--;
      const el = $("#qtimer");
      if (el) { el.textContent = clock(left); el.classList.toggle("hot", left <= 60); }
      if (left > 0 || over) return;
      for (let k = answered ? i + 1 : i; k < questions.length; k++) log.push({ q: questions[k], k: -1 });
      toast("Time is up ⏰", true);
      finish();
    }, 1000);
  }
}
async function quizView(tid) {
  const { set } = S.cur, t = topicById(tid);
  if (!t) return go(`#/set/${set.id}`);
  setActive(tid);
  const crumbs = [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: t.title }, { text: "Quiz" }];
  shell({ tab: "set", set, topicId: tid, tutor: true, crumbs });
  $("#view").innerHTML = `<div class="session">${skeleton(t.has_quiz ? "Getting your quiz…" : "Writing your quiz… (about 8 seconds)")}</div>`;
  try {
    const { questions } = await api(`/api/topics/${tid}/quiz`);
    quizSession({ title: t.title, questions, backHref: `#/set/${set.id}`, crumbs, set, topicId: tid, onDone: async (score, total) => {
      const r = await api(`/api/topics/${tid}/event`, { body: { kind: "quiz", score, total } }).catch(() => null);
      await refreshCur().catch(() => {});
      if (r?.status === 2) toast("Topic mastered! 🏆");
    } });
  } catch (e) { $("#view").innerHTML = `<div class="empty-hero"><h2>Couldn't make the quiz</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`; }
}
async function testView() {
  const { set } = S.cur;
  const crumbs = [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: "Practice test" }];
  shell({ tab: "test", set, tutor: true, crumbs });
  $("#view").innerHTML = `<div class="session">${skeleton("Building a practice test from every topic… (up to 20 seconds)")}</div>`;
  try {
    const { questions } = await api(`/api/sets/${set.id}/test`);
    quizSession({ title: "Practice test", questions, backHref: `#/set/${set.id}`, crumbs, set, tab: "test", onDone: async (score, total, wrong) => {
      const by = {};
      questions.forEach((q) => { (by[q.topic_id] ||= { n: 0, ok: 0 }).n++; by[q.topic_id].ok++; });
      wrong.forEach(({ q }) => { by[q.topic_id].ok--; });
      for (const [id, v] of Object.entries(by)) if (v.n >= 2) await api(`/api/topics/${id}/event`, { body: { kind: "quiz", score: v.ok, total: v.n } }).catch(() => {});
      await refreshCur().catch(() => {});
    } });
  } catch (e) { $("#view").innerHTML = `<div class="empty-hero"><h2>Couldn't make the test</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`; }
}

/* ============================================================ match game */
async function matchView() {
  const { set } = S.cur;
  const crumbs = [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: "Match game" }];
  shell({ tab: "match", set, tutor: true, crumbs });
  $("#view").innerHTML = `<div class="session">${skeleton("Setting up the game…")}</div>`;
  let { cards } = await api(`/api/sets/${set.id}/cards`);
  if (cards.length < 6) {
    busy(true, "Getting cards ready", "This only happens once");
    try { await api(`/api/sets/${set.id}/prepare`, { body: { what: "cards" } }); } catch (e) { busy(false); toast(e.message, true); return go(`#/set/${set.id}`); }
    busy(false);
    ({ cards } = await api(`/api/sets/${set.id}/cards`));
    await refreshCur();
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const play = () => {
    const short = cards.filter((c) => c.front.length <= 80 && c.back.length <= 130);      // short ones fit the tiles best
    const deck = shuffle([...(short.length >= 6 ? short : cards)]).slice(0, 6);
    let sel = null, matched = 0, wrong = 0;
    const t0 = Date.now();
    const left = shuffle([...deck]), right = shuffle([...deck]);
    $("#view").innerHTML = `<div class="session" style="max-width:46rem!important"><div class="s-top"><a class="icon-btn" href="#/set/${set.id}" aria-label="Close">✕</a><div class="bar"><i id="mbar" style="width:0%"></i></div><small id="mtime">0s</small></div>
      <p class="hint">Match each term with its answer</p>
      <div class="match"><div class="col">${left.map((c) => `<button class="m" data-side="l" data-id="${c.id}" dir="auto">${esc(c.front)}</button>`).join("")}</div>
      <div class="col">${right.map((c) => `<button class="m" data-side="r" data-id="${c.id}" dir="auto">${esc(c.back)}</button>`).join("")}</div></div></div>`;
    const timer = setInterval(() => { const el = $("#mtime"); if (!el) return clearInterval(timer); el.textContent = `${Math.round((Date.now() - t0) / 1000)}s`; }, 500);
    $$(".m").forEach((b) => b.addEventListener("click", () => {
      if (b.classList.contains("ok")) return;
      if (!sel) { sel = b; b.classList.add("sel"); return; }
      if (sel === b) { b.classList.remove("sel"); sel = null; return; }
      if (sel.dataset.side === b.dataset.side) { sel.classList.remove("sel"); sel = b; b.classList.add("sel"); return; }
      const a = sel; sel = null; a.classList.remove("sel");
      if (a.dataset.id === b.dataset.id) {
        a.classList.add("ok"); b.classList.add("ok"); matched++;
        $("#mbar").style.width = `${pct(matched, 6)}%`;
        if (matched === 6) {
          clearInterval(timer);
          const secs = Math.round((Date.now() - t0) / 1000), best = ls.get(`cramly.match.${set.id}`, 999);
          if (secs < best) ls.set(`cramly.match.${set.id}`, secs);
          confetti(100);
          $("#view").innerHTML = `<div class="session"><div class="result"><div class="ring" style="--p:100;--c:var(--mint)">${secs}s</div><h2>${secs < best ? "New best time! 🏆" : "All matched! 🎉"}</h2><p>${wrong} wrong guess${wrong === 1 ? "" : "es"}${best < 999 && secs >= best ? ` · your best is ${best}s` : ""}.</p>
            <div style="display:flex;gap:.6rem"><button class="btn primary" id="again">Play again</button><a class="btn" href="#/set/${set.id}">Done</a></div></div></div>`;
          $("#again").addEventListener("click", play);
        }
      } else { wrong++; [a, b].forEach((x) => { x.classList.add("no"); setTimeout(() => x.classList.remove("no"), 400); }); }
    }));
  };
  play();
}

/* ============================================================ calendar */
async function calendarView() {
  shell({ tab: "calendar", crumbs: [{ text: "Home", href: "#/" }, { text: "Calendar" }] });
  const { events, today } = await api("/api/calendar");
  if (!S.sets.length) S.sets = (await api("/api/sets")).sets;
  const hue = Object.fromEntries(S.sets.map((s) => [s.id, s.hue]));
  const base = new Date(`${today}T12:00`);
  S.calMonth ||= { y: base.getFullYear(), m: base.getMonth() };
  S.calSel ||= today;
  const draw = () => {
    const { y, m } = S.calMonth, first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
    const byDay = {};
    events.forEach((e) => (byDay[e.date] ||= []).push(e));
    const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const sel = byDay[S.calSel] || [];
    $("#view").innerHTML = `<div class="wide"><div class="cal-head"><h1>${first.toLocaleDateString([], { month: "long", year: "numeric" })}</h1>
      <div style="display:flex;gap:.4rem"><button class="btn small" id="prev">‹</button><button class="btn small" id="now">Today</button><button class="btn small" id="nextm">›</button></div></div>
      ${events.length ? "" : `<div class="cta-card" style="margin-bottom:1rem"><div><b>Your study calendar is empty</b><p>Open a study set and set your exam date: I'll fill in what to study each day.</p></div><a class="btn primary" href="#/">Open a set</a></div>`}
      <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("")}
      ${cells.map((d) => { const k = iso(d), ev = byDay[k] || []; return `<button class="cell ${d.getMonth() !== m ? "out" : ""} ${k === today ? "today" : ""} ${k === S.calSel ? "sel" : ""}" data-d="${k}"><b>${d.getDate()}</b>
        ${ev.slice(0, 2).map((e) => `<span class="chip ${e.kind === "exam" ? "exam" : ""}" style="--h:${hue[e.set_id] ?? 260}">${e.kind === "exam" ? "🎯 " : ""}${esc(e.topic)}</span>`).join("")}${ev.length > 2 ? `<span class="chip" style="--h:260">+${ev.length - 2}</span>` : ""}</button>`; }).join("")}</div>
      <h2 class="sec">${S.calSel === today ? "Today" : fmtDay(S.calSel)}</h2>
      <div class="day-detail">${sel.length ? sel.map((e) => `<div class="cta-card" style="--h:${hue[e.set_id] ?? 260}"><div><b>${e.kind === "exam" ? "🎯 Exam: " : ""}${esc(e.topic)}</b><p>${esc(e.emoji)} ${esc(e.set)}</p></div>
        <a class="btn ${e.kind === "exam" ? "" : "primary"}" href="#/set/${e.set_id}" ${e.topic_id ? `data-study="${e.set_id}:${e.topic_id}"` : ""}>${e.kind === "exam" ? "Open set" : "Study this"}</a></div>`).join("") : '<p class="muted">Nothing planned for this day.</p>'}</div></div>`;
    $("#prev").addEventListener("click", () => { S.calMonth = { y: m === 0 ? y - 1 : y, m: (m + 11) % 12 }; draw(); });
    $("#nextm").addEventListener("click", () => { S.calMonth = { y: m === 11 ? y + 1 : y, m: (m + 1) % 12 }; draw(); });
    $("#now").addEventListener("click", () => { S.calMonth = { y: base.getFullYear(), m: base.getMonth() }; S.calSel = today; draw(); });
    $$(".cell").forEach((c) => c.addEventListener("click", () => { S.calSel = c.dataset.d; draw(); }));
    $$("[data-study]").forEach((a) => a.addEventListener("click", () => { const [s, t] = a.dataset.study.split(":"); S.active[s] = +t; ls.set("cramly.active", S.active); }));
  };
  draw();
}

/* ============================================================ record a lecture */
async function recordView() {
  shell({ tab: "record", crumbs: [{ text: "Home", href: "#/" }, { text: "Record lecture" }] });
  if (!S.sets.length) S.sets = (await api("/api/sets")).sets;
  let rec = null, live = false, secs = 0, timer = null, finalText = "";
  $("#view").innerHTML = `<div class="wide"><div class="home-head"><div><p class="eyebrow">Live transcription</p><h1>Record a lecture</h1></div></div>
    <div class="new-grid"><div class="stack"><div class="rec"><button class="rec-btn" id="rb" aria-label="Start recording">🎙️</button><div class="time" id="rt">0:00</div>
      <p class="muted small" id="rhint">${SR ? "Tap to start. Keep this tab open while the lecture runs. I'll write down what's said." : "Live recording needs Chrome or Edge. You can paste a transcript below instead."}</p>
      <div style="display:flex;gap:.4rem"><button class="btn small ${voiceLang().startsWith("ar") ? "" : "dark"}" data-l="en-US">English</button><button class="btn small ${voiceLang().startsWith("ar") ? "dark" : ""}" data-l="ar-SA">العربية</button></div></div>
      <textarea class="transcript" id="tr" dir="auto" placeholder="The transcript appears here. You can edit it or paste your own."></textarea>
      <label>Add it to<select id="target"><option value="0">A new study set</option>${S.sets.map((s) => `<option value="${s.id}">${esc(s.emoji)} ${esc(s.title)}</option>`).join("")}</select></label>
      <button class="btn primary big" id="save" disabled>Save and build notes ✨</button></div>
      <aside class="tips"><h3>Tips</h3><ul><li>Sit near the speaker, or put your phone's microphone close.</li><li>The transcript is only as good as the audio, so skim and fix names before saving.</li><li>Works for lectures, videos and voice notes you read aloud.</li></ul></aside></div></div>`;
  const tr = $("#tr"), upd = () => { $("#save").disabled = tr.value.trim().length < 80; };
  tr.addEventListener("input", upd);
  $$("[data-l]").forEach((b) => b.addEventListener("click", () => { ls.set("cramly.vlang", b.dataset.l); recordView(); }));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const stop = () => { live = false; clearInterval(timer); try { rec?.stop(); } catch { /* ignore */ } $("#rb").classList.remove("live"); $("#rb").textContent = "🎙️"; $("#rhint").textContent = "Stopped. Review the transcript, then save."; };
  const startRec = () => {
    finalText = tr.value ? `${tr.value.trim()} ` : "";
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = voiceLang();
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += `${r[0].transcript.trim()} `; else interim += r[0].transcript; }
      tr.value = finalText + interim; tr.scrollTop = tr.scrollHeight; upd();
    };
    rec.onend = () => { if (live) { try { rec.start(); } catch { /* ignore */ } } };
    rec.onerror = (e) => { if (e.error === "not-allowed") { toast("Allow the microphone to record.", true); stop(); } };
    live = true; rec.start();
    $("#rb").classList.add("live"); $("#rb").textContent = "⏹"; $("#rhint").textContent = "Listening… tap to stop.";
    timer = setInterval(() => { secs++; $("#rt").textContent = fmt(secs); }, 1000);
  };
  $("#rb").addEventListener("click", () => { if (!SR) return toast("Live recording needs Chrome or Edge.", true); live ? stop() : startRec(); });
  $("#save").addEventListener("click", () => {
    if (live) stop();
    const target = +$("#target").value, name = `Lecture ${new Date().toLocaleDateString([], { day: "numeric", month: "short" })}`;
    submitMaterials({ text: tr.value.trim(), name, title: target ? "" : name, setId: target });
  });
  S.keyHandler = null;
}

/* ============================================================ settings, welcome */
async function settingsSheet() {
  sheet(`<h3>⚙️ Settings</h3>${accountBlock()}<label>Your name<input id="s-name" value="${esc(S.me.name || "")}" maxlength="30"></label>
    <div class="sheet-actions"><button class="btn primary" id="s-save">Save</button></div><hr>
    <label>Look<div class="seg" id="s-theme"><button data-t="auto">Auto</button><button data-t="light">Light</button><button data-t="dark">Dark</button></div></label><hr>
    <button class="btn" id="s-pair">📱 Use Cramly on another device</button>
    <p class="muted small">Your study sets live in this account on this device. To open them somewhere else, make a code and type it there.</p><hr>
    <button class="btn danger" id="s-del">Delete my account and all my study sets</button>
    <div class="sheet-actions"><button class="btn" data-close>Close</button></div>`, () => {
    $$("#s-theme button").forEach((b) => { b.classList.toggle("on", b.dataset.t === themePref()); b.addEventListener("click", () => { setTheme(b.dataset.t); $$("#s-theme button").forEach((x) => x.classList.toggle("on", x === b)); }); });
    wireAccountBlock();
    $("#s-save").addEventListener("click", async () => { await api("/api/me", { method: "PATCH", body: { name: $("#s-name").value } }); S.me.name = $("#s-name").value; toast("Saved"); closeSheet(); route(); });
    $("#s-pair").addEventListener("click", async () => { const d = await api("/api/pair", { body: {} }); sheet(`<h3>📱 Another device</h3><p class="muted">Open Cramly there, tap <b>I already use Cramly on another device</b>, and type:</p><div class="big-code">${d.code}</div><p class="muted small" style="text-align:center">Works for 10 minutes.</p><div class="sheet-actions"><button class="btn primary" data-close>Done</button></div>`); });
    $("#s-del").addEventListener("click", async () => { if (await confirmSheet({ title: "Delete everything?", text: "Your account and every study set are removed for good.", ok: "Delete it all", danger: true })) { await api("/api/me", { method: "DELETE" }); toast("Deleted"); signOut(); } });
  });
}
$("#start-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", e.target);
  btn.disabled = true;
  try {
    const d = await api("/api/account", { body: { name: $("#start-name").value } });
    key = d.key; ls.set("cramly.key", key);
    await boot();
  } catch (err) { toast(err.message, true); }
  btn.disabled = false;
});
$("#have-code").addEventListener("click", () => sheet(`<h3>Join with a code</h3><p class="muted">On your other device: ⚙️ Settings → <b>Use Cramly on another device</b>, then type the 6 digits here.</p>
  <input id="claim" inputmode="numeric" maxlength="6" placeholder="123456" style="font:700 1.6rem var(--serif);letter-spacing:.3em;text-align:center">
  <div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="claim-go">Join</button></div>`, () => {
  $("#claim-go").addEventListener("click", async () => {
    try { const d = await api("/api/pair/claim", { body: { code: $("#claim").value } }); key = d.key; ls.set("cramly.key", key); closeSheet(); await boot(); toast("Linked ✅"); } catch (err) { toast(err.message, true); }
  });
}));

async function boot() {
  checkStatus();
  if (window.JOIN) { const code = window.JOIN; window.JOIN = ""; await handleJoinLink(code); }
  $("#welcome").hidden = !!key;
  if (!key) { $("#tabbar").hidden = true; return; }
  if (!location.hash) location.hash = "#/";
  await route();
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* not critical */ });
document.addEventListener("DOMContentLoaded", boot);
