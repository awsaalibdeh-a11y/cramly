/* Cramly extras: icons, aura and levels, the swipe game, explain-it-back, the focus timer, themes, CSV export and the
   "next best step" suggestion. Loaded after app.js; everything here is used by app.js at run time. */
"use strict";

/* ============================================================ icons (24px, drawn to match) */
const ICON = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  cards: '<rect x="3" y="7" width="14" height="14" rx="2.5"/><path d="M7 7V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
  test: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  puzzle: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  swipe: '<path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4"/>',
  moon: '<path d="M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const ic = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;

/* ============================================================ sounds (tiny WebAudio blips) */
let audio = null;
const muted = () => ls.get("cramly.mute", false);
function tone(notes, { dur = 0.11, vol = 0.05, type = "sine" } = {}) {
  if (muted()) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * dur;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.6);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur * 1.7);
    });
  } catch { /* no audio */ }
}
const sfx = { win: () => tone([523, 659, 784]), lose: () => tone([196, 147], { type: "triangle", vol: 0.06, dur: 0.16 }), done: () => tone([523, 659, 784, 1047], { dur: 0.13 }) };

/* ============================================================ aura and levels */
const LEVELS = [[0, "NPC"], [400, "Side Quest"], [1500, "Main Character"], [4000, "Sigma"], [9000, "Aura Farmer"], [20000, "Legend"]];
const aura = () => ls.get("cramly.aura", 0);
function levelFor(n) {
  let i = 0;
  LEVELS.forEach(([t], k) => { if (n >= t) i = k; });
  const cur = LEVELS[i], nxt = LEVELS[i + 1];
  return { idx: i, name: cur[1], next: nxt ? nxt[0] : null, nextName: nxt ? nxt[1] : "", pct: nxt ? Math.round((100 * (n - cur[0])) / (nxt[0] - cur[0])) : 100 };
}
function addAura(d) {
  const before = aura(), after = Math.max(0, before + d);
  ls.set("cramly.aura", after);
  if (levelFor(after).idx > levelFor(before).idx) { toast(`Level up! You're a ${levelFor(after).name} now ✨`); confetti(170); sfx.done(); }
  paintAura();
  return after;
}
function auraChip() {
  const n = aura(), l = levelFor(n);
  return `<button class="chip-btn aura-chip" id="aura-chip" title="${esc(l.name)}">${ic("sparkle")}<b>${n.toLocaleString()}</b><span class="lbl">${esc(l.name)}</span></button>`;
}
function auraCard() {
  const n = aura(), l = levelFor(n);
  return `<button class="aura-card" id="side-aura"><span class="ac-top">${ic("sparkle")}<b>${n.toLocaleString()} aura</b></span><span class="ac-name">${esc(l.name)}</span>
    <span class="bar"><i style="width:${l.pct}%"></i></span><small>${l.next ? `${(l.next - n).toLocaleString()} to ${esc(l.nextName)}` : "Max level. Legend."}</small></button>`;
}
function paintAura() {
  const n = aura(), l = levelFor(n);
  const chip = $("#aura-chip"); if (chip) chip.innerHTML = `${ic("sparkle")}<b>${n.toLocaleString()}</b><span class="lbl">${esc(l.name)}</span>`;
  const side = $("#side-aura"); if (side) side.outerHTML = auraCard(), $("#side-aura")?.addEventListener("click", auraSheet);
}
function auraSheet() {
  const n = aura(), l = levelFor(n);
  sheet(`<h3>✨ Your aura</h3><p class="muted">Earn aura by swiping the right answers, finishing focus sessions and levelling up. Wrong swipes cost you.</p>
    <div class="levels">${LEVELS.map(([t, name], i) => `<div class="lv ${i === l.idx ? "now" : n >= t ? "done" : ""}"><b>${esc(name)}</b><small>${t.toLocaleString()}+</small></div>`).join("")}</div>
    <div class="sheet-actions"><button class="btn" data-close>Close</button></div>`);
}

/* ============================================================ called by the shell after it draws */
function afterShell() {
  $("#aura-chip")?.addEventListener("click", auraSheet);
  $("#side-aura")?.addEventListener("click", auraSheet);
  $("#focus-chip")?.addEventListener("click", focusSheet);
  $("#pal-btn")?.addEventListener("click", openPalette);
  $$("#tabbar [data-ic], #view [data-ic]").forEach((el) => { el.innerHTML = ic(el.dataset.ic); });
  focusTick();
  wireAccess();
  markLocks();
}

/* ============================================================ theme */
const themePref = () => ls.get("cramly.theme", "light");
function applyTheme(t = themePref()) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = $('meta[name="theme-color"]'); if (meta) meta.content = dark ? "#14110e" : "#f6f8ff";
}
function setTheme(t) { ls.set("cramly.theme", t); applyTheme(t); }

/* ============================================================ the focus timer */
const todayKey = () => S.me?.today || new Date().toISOString().slice(0, 10);
const focusState = () => ls.get("cramly.focus", null);
const focusToday = () => ls.get("cramly.focuslog", {})[todayKey()] || 0;
function focusTick() {
  const chip = $("#focus-chip"), f = focusState();
  if (f && f.end - Date.now() <= 0) { finishFocus(f); return; }
  if (!chip) return;
  if (!f) { chip.className = "chip-btn"; chip.innerHTML = `${ic("timer")}<span class="lbl">Focus</span>`; return; }
  const left = Math.max(0, Math.round((f.end - Date.now()) / 1000));
  chip.className = "chip-btn live";
  chip.innerHTML = `${ic("timer")}<b>${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</b>`;
}
setInterval(focusTick, 1000);
function finishFocus(f) {
  ls.del("cramly.focus");
  const log = ls.get("cramly.focuslog", {}); log[todayKey()] = (log[todayKey()] || 0) + f.mins; ls.set("cramly.focuslog", log);
  const gain = f.mins * 8;
  addAura(gain); confetti(120); sfx.done();
  toast(`Focus done: ${f.mins} min! +${gain} aura 🎉`);
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("Focus session done 🎉", { body: `${f.mins} minutes. Take a 5 minute break.`, icon: "/static/icon-192.png" }); } catch { /* ignore */ }
  focusTick();
}
function focusSheet() {
  const f = focusState();
  if (f) {
    const left = Math.max(0, Math.round((f.end - Date.now()) / 60000));
    sheet(`<h3>⏱ Focus session</h3><p class="muted">${left} minute${left === 1 ? "" : "s"} left of ${f.mins}. Phone down, one topic, go.</p>
      <div class="sheet-actions"><button class="btn danger" id="f-stop">Stop (no aura)</button><button class="btn" id="f-more">+5 min</button><button class="btn primary" data-close>Keep going</button></div>`, () => {
      $("#f-stop").addEventListener("click", () => { ls.del("cramly.focus"); focusTick(); closeSheet(); toast("Session stopped"); });
      $("#f-more").addEventListener("click", () => { ls.set("cramly.focus", { ...f, end: f.end + 5 * 60000, mins: f.mins + 5 }); focusTick(); closeSheet(); toast("+5 minutes"); });
    });
    return;
  }
  sheet(`<h3>⏱ Focus timer</h3><p class="muted">Pick a length. Finish the session and earn aura (8 per minute). Today so far: <b>${focusToday()} min</b>.</p>
    <div class="dur">${[15, 25, 50].map((m) => `<button class="btn big" data-m="${m}">${m} min</button>`).join("")}</div>
    <p class="muted small">Tip: after 25 minutes, take a 5 minute break. Your brain stores what you studied during the break.</p>
    <div class="sheet-actions"><button class="btn" data-close>Cancel</button></div>`, () => {
    $$("[data-m]").forEach((b) => b.addEventListener("click", () => {
      const mins = +b.dataset.m;
      ls.set("cramly.focus", { end: Date.now() + mins * 60000, mins });
      try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch { /* ignore */ }
      focusTick(); closeSheet(); toast(`Focus started: ${mins} minutes ⏱`);
    }));
  });
}

/* ============================================================ export flashcards (CSV opens in Excel, imports into Anki) */
async function exportCards() {
  if (!canPremium()) return needPlans("Exporting flashcards");
  const { cards } = await api(`/api/sets/${S.cur.set.id}/cards`);
  if (!cards.length) return toast("Open the flashcards once first, then export them.", true);
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = `﻿${["Front,Back", ...cards.map((c) => `${q(c.front)},${q(c.back)}`)].join("\r\n")}`;
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `${S.cur.set.title.replace(/[^\w؀-ۿ]+/g, "-")}-flashcards.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${cards.length} flashcards`);
}

/* ============================================================ what to do next */
function nextStep() {
  const { set, topics } = S.cur, base = `#/set/${set.id}`;
  if (set.due) return { icon: "cards", title: `${set.due} flashcard${set.due > 1 ? "s" : ""} due`, sub: "Reviewing now keeps them in your memory for longer.", href: `${base}/cards`, cta: "Review now" };
  const weak = topics.find((t) => t.status === 1 && t.quiz_best >= 0 && t.quiz_best < 80);
  if (weak) return { icon: "test", title: `Retry the quiz: ${weak.title}`, sub: `Your best is ${weak.quiz_best}%. Score 80% to master it.`, href: `${base}/t/${weak.id}/quiz`, cta: "Retry quiz" };
  const fresh = topics.find((t) => t.status === 0);
  if (fresh) return { icon: "cap", title: `Start with: ${fresh.title}`, sub: "A guided chat with the tutor takes about 10 minutes.", guided: fresh.id, cta: "Start learning" };
  const unq = topics.find((t) => t.status < 2 && t.quiz_best < 0);
  if (unq) return { icon: "test", title: `Quiz yourself: ${unq.title}`, sub: "Six questions. 80% masters the topic.", href: `${base}/t/${unq.id}/quiz`, cta: "Take the quiz" };
  return { icon: "trophy", title: "Everything is mastered 🏆", sub: "Lock it in with a practice test across all topics.", href: `${base}/test`, cta: "Practice test" };
}
function nextStepCard() {
  const n = nextStep();
  return `<div class="next-step"><span class="ns-ic">${ic(n.icon)}</span><div><small>Next best step</small><b>${esc(n.title)}</b><p>${esc(n.sub)}</p></div>
    ${n.guided ? `<button class="btn primary" data-guided="${n.guided}">${esc(n.cta)} ${ic("arrow")}</button>` : `<a class="btn primary" href="${n.href}">${esc(n.cta)} ${ic("arrow")}</a>`}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-guided]");
  if (!b || !S.cur) return;
  const tid = +b.dataset.guided;
  setActive(tid);
  if (typeof paintTopic === "function" && $("#topic")) paintTopic();
  openTutor({ mode: "guided", topic: tid, start: true });
});

/* ============================================================ the swipe game: a character asks, you swipe to an answer */
const CAST = [
  { name: "Professor Pip", e: "🧑‍🏫", h: 262, win: ["Class dismissed. Perfect.", "Top of the class!"], lose: ["See me after class.", "Detention for that one."] },
  { name: "DJ Quark", e: "🧑‍🎤", h: 320, win: ["That's a banger!", "Drop the beat!"], lose: ["Record scratch…", "Off-key, my friend."] },
  { name: "Sensei Nori", e: "🥷", h: 200, win: ["You walk the path.", "Silent. Deadly. Correct."], lose: ["Return to the dojo.", "The path turned the other way."] },
  { name: "Wendy the Wizard", e: "🧙", h: 285, win: ["Spell cast!", "Pure magic."], lose: ["Your spell fizzled.", "A wild misfire!"] },
  { name: "Botley", e: "🤖", h: 190, win: ["Processing… correct.", "Beep boop. W."], lose: ["Error 404: answer.", "Does not compute."] },
  { name: "Granny Gus", e: "👵", h: 28, win: ["Proud of you, dear!", "That's my smart cookie."], lose: ["Oh sweetie, no.", "Have some soup and try again."] },
  { name: "Astro Ava", e: "🧑‍🚀", h: 215, win: ["Houston, we have a W.", "Mission success!"], lose: ["We lost signal.", "Abort mission."] },
  { name: "Chef Remy", e: "🧑‍🍳", h: 38, win: ["Chef's kiss!", "Perfectly cooked."], lose: ["Raw. Absolutely raw.", "Back to the kitchen."] },
  { name: "Detective Dot", e: "🕵️", h: 150, win: ["Case closed.", "Elementary."], lose: ["Wrong suspect.", "The trail went cold."] },
  { name: "Coach Kai", e: "🏋️", h: 10, win: ["Gains! Big gains.", "Brain day: not skipped."], lose: ["Skipped brain day.", "Drop and give me ten."] },
];
const WIN_E = ["🤩", "😎", "🔥", "💯", "🫡"], LOSE_E = ["💀", "😬", "🫠", "🥲", "📉"];
const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
const signed = (n) => `${n >= 0 ? "+" : ""}${n.toLocaleString()}`;

function swipeSession({ title, cards, backHref, crumbs, set, topicId = 0, tab = "set", again }) {
  shell({ tab, set, topicId, tutor: false, crumbs });
  const view = $("#view");
  let last = null;
  const deck = cards.map((c) => {
    let who; do { who = pickOf(CAST); } while (who === last && CAST.length > 1);
    last = who;
    return { ...c, order: Math.random() < 0.5 ? [0, 1] : [1, 0], who };
  });
  let i = 0, run = 0, combo = 0, bestCombo = 0, right = 0, locked = false, timer = null;
  const misses = [];
  const opt = (c, side) => c.options[c.order[side]];

  const draw = () => {
    locked = false; clearTimeout(timer);
    const c = deck[i], ch = c.who;
    view.innerHTML = `<div class="swipe" style="--h:${ch.h}">
      <div class="sw-hud"><a class="icon-btn" href="${backHref}" aria-label="Close">${ic("x")}</a><div class="bar"><i style="width:${pct(i, deck.length)}%"></i></div><small>${i + 1}/${deck.length}</small></div>
      <div class="sw-score"><span class="pill ${run < 0 ? "neg" : "pos"}">${ic("sparkle")} ${signed(run)}</span><span class="pill ${combo >= 2 ? "hot" : ""}">${ic("flame")} x${combo}</span>
        <button class="icon-btn" id="sw-mute" aria-label="Sound">${muted() ? "🔇" : "🔊"}</button></div>
      <div class="sw-stage" id="stage"><div class="sw-card enter" id="card">
        <span class="sw-stamp l" id="stL" dir="auto">${esc(opt(c, 0))}</span><span class="sw-stamp r" id="stR" dir="auto">${esc(opt(c, 1))}</span>
        <div class="sw-tag">${esc(c.topic || title)}</div>
        <div class="sw-who"><div class="sw-ava">${ch.e}<span class="react" id="react"></span></div><div class="sw-name">${esc(ch.name)}</div></div>
        <div class="sw-bubble" dir="auto">${esc(c.q)}</div>
        <div class="sw-hint"><span>${ic("swipe")} swipe or tap an answer</span></div></div></div>
      <div class="sw-ctl" id="ctl">
        <button class="sw-btn" data-side="0"><span class="arrow">←</span><span dir="auto">${esc(opt(c, 0))}</span></button>
        <button class="sw-btn" data-side="1"><span dir="auto">${esc(opt(c, 1))}</span><span class="arrow">→</span></button></div></div>`;
    $("#sw-mute").addEventListener("click", () => { ls.set("cramly.mute", !muted()); $("#sw-mute").textContent = muted() ? "🔇" : "🔊"; });
    $$(".sw-btn").forEach((b) => b.addEventListener("click", () => decide(+b.dataset.side)));
    wireDrag($("#card"));
  };

  const wireDrag = (card) => {
    let startX = 0, x = 0, dragging = false;
    const stL = $("#stL"), stR = $("#stR");
    const paint = () => {
      card.style.transform = `translateX(${x}px) rotate(${x / 18}deg)`;
      stL.style.opacity = Math.min(1, Math.max(0, -x / 110)); stR.style.opacity = Math.min(1, Math.max(0, x / 110));
    };
    card.addEventListener("pointerdown", (e) => { if (locked) return; dragging = true; startX = e.clientX; card.setPointerCapture(e.pointerId); card.classList.add("drag"); });
    card.addEventListener("pointermove", (e) => { if (!dragging) return; x = e.clientX - startX; paint(); });
    const end = () => {
      if (!dragging) return;
      dragging = false; card.classList.remove("drag");
      if (Math.abs(x) > 105) decide(x < 0 ? 0 : 1, x); else { x = 0; card.style.transform = ""; stL.style.opacity = stR.style.opacity = 0; }
    };
    card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
  };

  const decide = (side, fromX = 0) => {
    if (locked) return;
    locked = true;
    const c = deck[i], ch = c.who, ok = c.order[side] === c.answer;
    const card = $("#card");
    card.classList.remove("enter"); card.classList.add("gone");
    card.style.transform = `translateX(${side ? 150 : -150}%) translateY(-6%) rotate(${side ? 26 : -26}deg)`;
    card.style.opacity = 0;
    const delta = ok ? 100 + 20 * Math.min(combo, 5) : -50;
    combo = ok ? combo + 1 : 0; bestCombo = Math.max(bestCombo, combo);
    if (ok) right++; else misses.push({ c, picked: c.order[side] });
    run += delta;
    addAura(delta);
    const line = pickOf(ok ? ch.win : ch.lose);
    ok ? sfx.win() : sfx.lose();
    try { navigator.vibrate?.(ok ? 15 : [40, 40, 40]); } catch { /* ignore */ }
    const stage = $("#stage");
    stage.insertAdjacentHTML("beforeend", `<div class="sw-float ${ok ? "good" : "bad"}">${signed(delta)} aura</div>`);
    stage.classList.add(ok ? "flash-good" : "flash-bad");
    $(".sw-score .pill").outerHTML = `<span class="pill ${run < 0 ? "neg" : "pos"} bump">${ic("sparkle")} ${signed(run)}</span>`;
    $(".sw-score .pill:nth-child(2)").outerHTML = `<span class="pill ${combo >= 2 ? "hot" : ""}">${ic("flame")} x${combo}</span>`;
    $("#ctl").innerHTML = `<div class="sw-fb ${ok ? "good" : "bad"}"><div class="fb-top"><span class="fb-e">${pickOf(ok ? WIN_E : LOSE_E)}</span><div><b>${esc(ch.name)}: ${esc(line)}</b>
        <small>${ok ? `+${delta} aura${combo >= 3 ? ` · ${combo} in a row 🔥` : ""}` : `${delta} aura`}</small></div></div>
      <p dir="auto">${esc(c.why)}${ok ? "" : ` <b>Right answer: ${esc(c.options[c.answer])}</b>`}</p>
      <button class="btn primary" id="sw-next">${i + 1 < deck.length ? "Next →" : "See results →"}</button></div>`;
    $("#sw-next").addEventListener("click", next); $("#sw-next").focus({ preventScroll: true });
    if (ok) timer = setTimeout(next, 1800);
  };
  const next = () => { if (!locked) return; clearTimeout(timer); i++; i < deck.length ? draw() : finish(); };

  const finish = async () => {
    const n = deck.length, acc = pct(right, n), l = levelFor(aura());
    view.innerHTML = `<div class="swipe"><div class="result"><div class="ring" style="--p:${acc};--c:${acc >= 70 ? "var(--mint)" : acc >= 50 ? "var(--sun)" : "var(--rose)"}">${acc}%</div>
      <h2>${acc >= 90 ? "Aura maxxed 🏆" : acc >= 70 ? "That's a W round 🔥" : acc >= 50 ? "Mid, but we move 😤" : "Rough one. Learn it, then run it back."}</h2>
      <p>${right} of ${n} right · best combo x${bestCombo}</p>
      <div class="aura-gain ${run >= 0 ? "plus" : "minus"}">${ic("sparkle")} ${signed(run)} aura</div>
      <div class="lvl-box"><b>${esc(l.name)}</b><span class="bar"><i style="width:${l.pct}%"></i></span><small>${l.next ? `${(l.next - aura()).toLocaleString()} aura to ${esc(l.nextName)}` : "Max level"}</small></div>
      ${misses.length ? `<div class="review-list"><p class="muted" style="text-align:start"><b>Learn from these:</b></p>${misses.map(({ c, picked }) => `<div class="rv bad" dir="auto"><b>${esc(c.q)}</b><small>You picked: ${esc(c.options[picked])}</small><small>✔ ${esc(c.options[c.answer])}: ${esc(c.why)}</small></div>`).join("")}</div>` : ""}
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center"><button class="btn primary" id="again">Run it back ↻</button><a class="btn" href="${backHref}">Done</a></div></div></div>`;
    if (acc >= 70) { confetti(); sfx.done(); }
    $("#again").addEventListener("click", again);
    if (topicId) { api(`/api/topics/${topicId}/event`, { body: { kind: "swipe" } }).then(() => refreshCur()).catch(() => {}); }
  };

  S.keyHandler = (e) => {
    if (e.target.matches?.("input,textarea")) return;
    const k = e.key.toLowerCase();
    if (!locked) { if (k === "arrowleft" || k === "a") decide(0); else if (k === "arrowright" || k === "d") decide(1); }
    else if (k === "enter" || k === " " || k === "arrowright") { e.preventDefault(); next(); }
  };
  document.addEventListener("keydown", S.keyHandler);
  draw();
}

async function swipeView({ topicId = 0 } = {}) {
  const { set } = S.cur, t = topicId ? topicById(topicId) : null;
  if (topicId && !t) return go(`#/set/${set.id}`);
  const crumbs = [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, ...(t ? [{ text: t.title }] : []), { text: "Swipe game" }];
  const tab = t ? "set" : "swipe";
  shell({ tab, set, topicId, tutor: false, crumbs });
  const load = async () => {
    $("#view").innerHTML = `<div class="session">${skeleton("Casting your characters… (about 8 seconds the first time)")}</div>`;
    const url = t ? `/api/topics/${topicId}/swipes` : `/api/sets/${set.id}/swipes`;
    const d = await api(url);
    if (t && d.pool < 28) api(`${url}?more=1`).catch(() => {});                 // quietly write more cards for the next round
    swipeSession({ title: t ? t.title : set.title, cards: d.cards, backHref: `#/set/${set.id}`, crumbs, set, topicId, tab, again: () => load().catch(fail) });
  };
  const fail = (e) => { $("#view").innerHTML = `<div class="empty-hero"><h2>Couldn't start the game</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`; };
  try { await load(); } catch (e) { fail(e); }
}

/* ============================================================ explain it back (the Feynman technique) */
async function explainView(tid) {
  const { set } = S.cur, t = topicById(tid);
  if (!t) return go(`#/set/${set.id}`);
  setActive(tid);
  shell({ tab: "set", set, topicId: tid, tutor: true, crumbs: [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, { text: t.title }, { text: "Explain it" }] });
  $("#view").innerHTML = `<div class="explain"><a class="btn small back" href="#/set/${set.id}">← ${esc(set.title)}</a>
    <p class="eyebrow" style="margin-top:1rem">Explain it back</p><h1 dir="auto">${esc(t.title)}</h1>
    <p class="muted">Explain this like you're teaching a friend who's never heard of it. No peeking at your notes. Writing it out is the fastest way to find what you don't know yet.</p>
    <textarea id="ex-text" rows="9" maxlength="3000" dir="auto" placeholder="Start with the big idea, then the details…"></textarea>
    <div class="ex-row"><span class="muted small" id="ex-count">0 / 3000</span><span style="flex:1"></span>
      <button class="btn small" id="ex-nudge" type="button">${ic("bulb")} Need a nudge?</button><button class="btn small" id="ex-mic" type="button">${ic("mic")} Dictate</button>
      <button class="btn primary" id="ex-go" type="button" disabled>Check my explanation</button></div>
    <div class="ideas" id="ex-hint" hidden>${t.points.map((p) => `<span dir="auto">${esc(p)}</span>`).join("")}</div>
    <div id="ex-out"></div></div>`;
  const ta = $("#ex-text"), go_ = $("#ex-go");
  ta.addEventListener("input", () => { $("#ex-count").textContent = `${ta.value.length} / 3000`; go_.disabled = ta.value.trim().length < 40; });
  $("#ex-nudge").addEventListener("click", () => { $("#ex-hint").hidden = !$("#ex-hint").hidden; });
  $("#ex-mic").addEventListener("click", () => {
    if (!SR) return toast("Dictation needs Chrome or Edge.", true);
    const rec = new SR(), base = ta.value;
    rec.lang = voiceLang(); rec.interimResults = true;
    $("#ex-mic").classList.add("live");
    rec.onresult = (e) => { ta.value = `${base} ${[...e.results].map((r) => r[0].transcript).join("")}`.trim(); ta.dispatchEvent(new Event("input")); };
    rec.onend = () => $("#ex-mic").classList.remove("live");
    try { rec.start(); } catch { /* running */ }
  });
  go_.addEventListener("click", async () => {
    go_.disabled = true;
    $("#ex-out").innerHTML = `<div class="loading-note" style="margin-top:1.4rem"><span class="owl">🦉</span>Reading your explanation… (about 5 seconds)</div>`;
    try {
      const r = await api(`/api/topics/${tid}/explain`, { body: { text: ta.value } });
      const good = r.score >= 85, col = good ? "var(--mint)" : r.score >= 60 ? "var(--sun)" : "var(--rose)";
      $("#ex-out").innerHTML = `<div class="ex-result"><div class="ring" style="--p:${r.score};--c:${col}">${r.score}</div><h2>${esc(r.verdict)}</h2>
        <div class="ex-cols"><div class="ex-col good"><h3>✅ What you nailed</h3><ul>${r.got.map((g) => `<li dir="auto">${esc(g)}</li>`).join("")}</ul></div>
          <div class="ex-col gap"><h3>🧩 Fill the gaps</h3><ul>${r.missing.map((g, k) => `<li dir="auto">${esc(g)} <button class="btn small" data-ask="${k}">Ask tutor</button></li>`).join("") || "<li>Nothing important missing. Nice.</li>"}</ul></div></div>
        <div class="tip-box" dir="auto">💡 ${esc(r.tip)}</div>
        <div class="footer-actions"><button class="btn primary" id="ex-again">Improve my explanation</button><a class="btn" href="#/set/${set.id}/t/${tid}/quiz">📝 Quiz me</a><a class="btn" href="#/set/${set.id}">Done</a></div></div>`;
      $$("[data-ask]").forEach((b) => b.addEventListener("click", () => { openTutor({ mode: "ask", topic: tid }); setTimeout(() => sendChat(`Explain this part simply: ${r.missing[+b.dataset.ask]}`), 200); }));
      $("#ex-again").addEventListener("click", () => { $("#ex-out").innerHTML = ""; go_.disabled = false; ta.focus(); });
      $("#ex-out").scrollIntoView({ behavior: "smooth", block: "start" });
      if (good) { confetti(); addAura(150); toast("Topic mastered by explaining it! 🏆 +150 aura"); } else addAura(Math.round(r.score / 4));
      await api(`/api/topics/${tid}/event`, { body: { kind: "explain", score: r.score } }).catch(() => {});
      refreshCur().catch(() => {});
    } catch (e) { $("#ex-out").innerHTML = `<p class="err" style="color:var(--bad-ink);font-weight:600">${esc(e.message)}</p>`; go_.disabled = false; }
  });
}

/* ============================================================ start */
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());


/* ============================================================ the home dashboard */
function dashboard(sets) {
  const me = S.me, due = me.due, mastered = sets.reduce((a, s) => a + s.mastered, 0), total = sets.reduce((a, s) => a + s.topics, 0), l = levelFor(aura());
  const tile = (icon, cls, value, label, act = "") => `<${act ? `button data-act="${act}"` : "div"} class="stat-tile ${cls}"><span class="st-ic">${ic(icon)}</span><b>${value}</b><small>${label}</small></${act ? "button" : "div"}>`;
  const recent = sets[0];
  const cta = due
    ? { icon: "cards", title: `${due} flashcard${due > 1 ? "s" : ""} ready to review`, sub: "Reviewing now keeps them in your memory for longer.", href: "#/review", label: "Start review" }
    : recent ? { icon: "map", title: `Continue: ${recent.title}`, sub: `${recent.mastered} of ${recent.topics} topics mastered`, href: `#/set/${recent.id}`, label: "Open set" } : null;
  return `<div class="stats">${tile("flame", "t-flame", me.streak || 0, "day streak")}${tile("sparkle", "t-aura", aura().toLocaleString(), esc(l.name), "aura")}
    ${tile("cards", "t-cards", due, due === 1 ? "card due" : "cards due")}${tile("trophy", "t-trophy", `${mastered}<em>/${total}</em>`, "topics mastered")}${tile("timer", "t-timer", `${focusToday()}<em>m</em>`, "focused today", "focus")}</div>
    ${cta ? `<a class="next-step big" href="${cta.href}"><span class="ns-ic">${ic(cta.icon)}</span><div><small>Next best step</small><b>${esc(cta.title)}</b><p>${esc(cta.sub)}</p></div><span class="btn primary">${esc(cta.label)} ${ic("arrow")}</span></a>` : ""}`;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (!a) return;
  if (a.dataset.act === "aura") auraSheet(); else if (a.dataset.act === "focus") focusSheet();
});

/* a small lock on the tools your plan does not include */
function markLocks() {
  const plan = S.me?.plan || "free", trial = (S.me?.trial_left ?? 0) > 0;
  const has = (need) => need === "premium" ? plan !== "free" || trial : plan === "plus" || trial;
  $$("[data-need]").forEach((a) => {
    const open = has(a.dataset.need);
    a.classList.toggle("locked", !open);
    if (!open && !a.querySelector(".lk")) a.insertAdjacentHTML("beforeend", `<span class="lk" title="${a.dataset.need === "plus" ? "Premium Plus" : "Premium"}">${ic("lock")}</span>`);
    if (open) a.querySelector(".lk")?.remove();
  });
  $$("details.grp").forEach((d) => d.addEventListener("toggle", () => ls.set(`cramly.g.${d.dataset.g}`, d.open)));
}
