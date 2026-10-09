/* Cramly UI: accent themes, the command palette (Ctrl or Cmd + K), the focus room with ambient sound, the new home pieces
   (daily goal, continue card, getting-started checklist) and the keyboard shortcut help. Free for everyone, no AI. */
"use strict";

/* ============================================================ accent themes */
const ACCENTS = { grape: ["Grape", "#6b5cff"], ocean: ["Ocean", "#2f80ff"], forest: ["Forest", "#12a574"], sunset: ["Sunset", "#ff7a45"], rose: ["Rose", "#e8478f"], night: ["Midnight", "#334155"] };
const accentPref = () => ls.get("cramly.accent", "grape");
function applyAccent(a = accentPref()) {
  if (!ACCENTS[a] || a === "grape") delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = a;
}
applyAccent();
function accentPicker() {
  return `<div class="accents" id="s-accent" role="radiogroup" aria-label="Accent colour">${Object.entries(ACCENTS).map(([k, [n, c]]) => `<button type="button" class="swatch ${accentPref() === k ? "on" : ""}" data-a="${k}" style="--c:${c}" title="${n}" aria-label="${n}" role="radio" aria-checked="${accentPref() === k}"></button>`).join("")}</div>`;
}
function wireAccentPicker() {
  $$("#s-accent .swatch").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.a !== "grape" && !canPremium()) return needPlans("Accent colours");
    ls.set("cramly.accent", b.dataset.a); applyAccent(b.dataset.a);
    $$("#s-accent .swatch").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
  }));
}

/* ============================================================ command palette */
const paletteButton = () => `<button class="chip-btn" id="pal-btn" title="Search and jump anywhere (Ctrl+K)" aria-label="Search">${ic("search")}<span class="lbl kbd">Ctrl K</span></button>`;
function paletteItems() {
  const items = [
    ["🏠", "Home", "#/"], ["📅", "Calendar", "#/calendar"], ["🃏", "Daily review", "#/review"], ["🎙️", "Record a lecture", "#/record"],
    ["➕", "New study set", "#/new"], ["📸", "Snap and solve", "#/solve"], ["📈", "Progress", "#/progress"], ["🎧", "Focus room", "#/focus"], ["📝", "Summariser", "#/summarize"], ["🃏", "Quick cards", "#/quickcards"], ["🎯", "Smart drill", "#/drill"], ["📊", "Weekly report", "#/report"],
  ].map(([e, t, h]) => ({ e, t, h, k: "Go to" }));
  (S.sets || []).forEach((s) => items.push({ e: s.emoji, t: s.title, h: `#/set/${s.id}`, k: "Study set" }));
  const set = S.cur?.set;
  if (set) {
    const id = set.id;
    [["🕸️", "Mind map", "map"], ["📄", "Cheat sheet", "cheat"], ["⏱️", "Exam builder", "exam"], ["📖", "Glossary", "glossary"], ["🔮", "Exam predictor", "predictor"],
      ["🔀", "Mix-ups", "mixups"], ["🗓️", "Study schedule", "schedule"], ["⌨️", "Typing practice", "type"], ["📓", "Mistake notebook", "mistakes"], ["🖨️", "Print flashcards", "print"], ["✍️", "Essay outline", "outline"], ["📚", "Study guide", "guide"], ["🃏", "Flashcards", "cards"], ["🕹️", "Swipe game", "swipe"], ["🎯", "Practice test", "test"], ["🧩", "Match game", "match"]]
      .forEach(([e, t, h]) => items.push({ e, t: `${t}`, h: `#/set/${id}/${h}`, k: set.title }));
    (S.cur.topics || []).forEach((t) => {
      [["read", "Read"], ["cards", "Flashcards"], ["quiz", "Quiz"], ["listen", "Listen"], ["boost", "Memory boost"], ["lab", "Practice lab"], ["grade", "Write and grade"], ["notes", "My notes"]]
        .forEach(([h, n]) => items.push({ e: "📚", t: `${t.title}: ${n}`, h: `#/set/${id}/t/${t.id}/${h}`, k: "Topic" }));
    });
  }
  items.push({ e: "🌓", t: "Switch light or dark", k: "Action", run: () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark") });
  items.push({ e: "⚙️", t: "Settings", k: "Action", run: () => settingsSheet() });
  items.push({ e: "💌", t: "Contact Awsaa (question, problem, idea)", k: "Action", run: () => openContact("question") });
  items.push({ e: "⭐", t: "Ask for premium", k: "Action", run: () => openContact("premium") });
  items.push({ e: "⌨️", t: "Keyboard shortcuts", k: "Action", run: () => shortcutsSheet() });
  Object.entries(ACCENTS).forEach(([k, [n]]) => items.push({ e: "🎨", t: `Accent: ${n}`, k: "Action", run: () => { ls.set("cramly.accent", k); applyAccent(k); } }));
  return items;
}
function openPalette() {
  if ($("#palette") || $("#paywall") || $("#gate")) return;
  if (!canPremium()) return needPlans("Search and quick jump");
  const all = paletteItems();
  const el = document.createElement("div");
  el.id = "palette"; el.className = "palette"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Search");
  el.innerHTML = `<div class="pal-box"><div class="pal-in">${ic("search")}<input id="pal-q" placeholder="Search sets, topics, tools and actions" autocomplete="off" aria-label="Search"><kbd>Esc</kbd></div><div class="pal-list" id="pal-list" role="listbox"></div></div>`;
  document.body.append(el);
  let at = 0, rows = [];
  const draw = () => {
    const q = $("#pal-q").value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    rows = all.filter((i) => q.every((w) => `${i.t} ${i.k}`.toLowerCase().includes(w))).slice(0, 40);
    at = Math.min(at, Math.max(0, rows.length - 1));
    $("#pal-list").innerHTML = rows.map((r, n) => `<button class="pal-row ${n === at ? "on" : ""}" data-n="${n}" role="option"><span>${esc(r.e)}</span><b>${esc(r.t)}</b><small>${esc(r.k)}</small></button>`).join("") || '<p class="muted pad">Nothing found.</p>';
    $(".pal-row.on")?.scrollIntoView({ block: "nearest" });
  };
  const close = () => { el.remove(); document.removeEventListener("keydown", keys, true); };
  const pick = (n) => { const r = rows[n]; if (!r) return; close(); if (r.run) r.run(); else go(r.h); };
  const keys = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(rows.length - 1, at + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(at); }
  };
  document.addEventListener("keydown", keys, true);
  el.addEventListener("click", (e) => { if (e.target === el) close(); const b = e.target.closest(".pal-row"); if (b) pick(+b.dataset.n); });
  $("#pal-q").addEventListener("input", () => { at = 0; draw(); });
  draw(); $("#pal-q").focus();
}
document.addEventListener("keydown", (e) => {
  const typing = e.target.matches?.("input,textarea,select,[contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  else if (!typing && e.key === "/" && key) { e.preventDefault(); openPalette(); }
  else if (!typing && e.key === "?" && key) { e.preventDefault(); shortcutsSheet(); }
});
function shortcutsSheet() {
  const rows = [["Ctrl / Cmd + K or /", "Search and jump anywhere"], ["?", "This list"], ["1 2 3 4 or A B C D", "Answer a quiz question"], ["Enter", "Next question"], ["Space", "Flip a flashcard"], ["← →", "Swipe game"], ["Esc", "Close a panel"]];
  sheet(`<h3>⌨️ Keyboard shortcuts</h3><div class="keys">${rows.map(([k, t]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t)}</span></div>`).join("")}</div><div class="sheet-actions"><button class="btn primary" data-close>Got it</button></div>`);
}

Object.assign(ICON, { search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', volume: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6"/>' });

/* ============================================================ focus room: a big timer, ambient sound, your week */
const ambient = { ctx: null, node: null, gain: null, kind: "off" };
function noiseBuffer(ctx, brown) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}
function setAmbient(kind) {
  if (kind !== "off" && !canPremium()) { needPlans("Focus sounds"); kind = "off"; }
  try { ambient.node?.stop(); } catch { /* not playing */ }
  ambient.kind = kind; ls.set("cramly.ambient", kind);
  if (kind === "off") return;
  ambient.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  const ctx = ambient.ctx;
  ctx.resume?.();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind === "brown" || kind === "waves");
  src.loop = true;
  let tail = src;
  if (kind === "rain") {
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7500;
    src.connect(hp); hp.connect(lp); tail = lp;
  }
  ambient.gain = ctx.createGain();
  ambient.gain.gain.value = ls.get("cramly.ambientVol", 0.35) * (kind === "white" ? 0.35 : 1);
  tail.connect(ambient.gain); ambient.gain.connect(ctx.destination);
  if (kind === "waves") {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 0.09; depth.gain.value = ambient.gain.gain.value * 0.7;
    lfo.connect(depth); depth.connect(ambient.gain.gain); lfo.start();
  }
  src.start(); ambient.node = src;
}
const focusWeek = () => {
  const log = ls.get("cramly.focuslog", {}), out = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = d.toISOString().slice(0, 10); out.push({ k, label: d.toLocaleDateString([], { weekday: "narrow" }), m: log[k] || 0 }); }
  return out;
};
function focusView() {
  shell({ tab: "focus", crumbs: [{ text: "Home", href: "#/" }, { text: "Focus room" }] });
  const R = 88, C = 2 * Math.PI * R, durs = [15, 25, 45, 60];
  const sounds = [["off", "Silence", "🔇"], ["rain", "Rain", "🌧️"], ["brown", "Deep hum", "🌫️"], ["white", "Static", "📻"], ["waves", "Waves", "🌊"]];
  $("#view").innerHTML = `<div class="focus-room"><div class="home-head"><div><p class="eyebrow">Free for everyone</p><h1>Focus room 🎧</h1><p class="muted">One task, one timer, some calm sound. Finish a session to earn aura.</p></div></div>
    <div class="fr-grid"><section class="fr-main"><div class="ring-timer"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="${R}" class="track"/><circle cx="100" cy="100" r="${R}" class="prog" id="fr-prog" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <div class="ring-label"><b id="fr-time">25:00</b><small id="fr-sub">ready</small></div></div>
      <div id="fr-controls"></div></section>
      <section class="fr-side"><div class="panel"><h3>Sound</h3><div class="sounds" id="fr-sounds">${sounds.map(([k, n, e]) => `<button type="button" data-k="${k}" class="${ambient.kind === k ? "on" : ""}"><span>${e}</span>${n}</button>`).join("")}</div>
          <label class="vol">${ic("volume")}<input type="range" id="fr-vol" min="0" max="1" step="0.05" value="${ls.get("cramly.ambientVol", 0.35)}" aria-label="Volume"></label></div>
        ${focusTasksHtml()}<div class="panel"><h3>Your week <small class="muted">${focusWeek().reduce((n, d) => n + d.m, 0)} min</small></h3><div class="week">${focusWeek().map((d) => `<div class="wk"><i class="${d.m ? "on" : ""}" style="height:${Math.max(6, Math.min(100, d.m * 1.2))}%" title="${d.m} min"></i><small>${d.label}</small></div>`).join("")}</div>
          <p class="muted small">Today: <b>${focusToday()} min</b></p></div></section></div></div>`;
  let pick = ls.get("cramly.focusLen", 25);
  const controls = () => {
    const f = focusState();
    $("#fr-controls").innerHTML = f
      ? `<p class="fr-task">${esc(f.task || "Focusing")}</p><div class="row" style="justify-content:center"><button class="btn danger" id="fr-stop" type="button">Stop</button><button class="btn" id="fr-more" type="button">+5 min</button></div>`
      : `<div class="chips fr-durs">${durs.map((m) => `<button type="button" data-m="${m}" class="${m === pick ? "on" : ""}">${m} min</button>`).join("")}</div>
         <input id="fr-task" maxlength="80" placeholder="What are you working on? (optional)" value="${esc(ls.get("cramly.focusTask", ""))}"><button class="btn primary big" id="fr-go" type="button">Start focusing</button>`;
    $$(".fr-durs [data-m]").forEach((b) => b.addEventListener("click", () => { pick = +b.dataset.m; ls.set("cramly.focusLen", pick); controls(); paint(); }));
    $("#fr-go")?.addEventListener("click", () => {
      const task = $("#fr-task").value.trim(); ls.set("cramly.focusTask", task);
      ls.set("cramly.focus", { end: Date.now() + pick * 60000, mins: pick, task });
      try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch { /* ignore */ }
      if (ambient.kind === "off" && ls.get("cramly.ambient", "off") !== "off") setAmbient(ls.get("cramly.ambient"));
      controls(); paint();
    });
    $("#fr-stop")?.addEventListener("click", () => { ls.del("cramly.focus"); focusTick(); controls(); paint(); });
    $("#fr-more")?.addEventListener("click", () => { ls.set("cramly.focus", { ...f, end: f.end + 300000, mins: f.mins + 5 }); paint(); });
  };
  const paint = () => {
    const f = focusState(), total = (f ? f.mins : pick) * 60, left = f ? Math.max(0, Math.round((f.end - Date.now()) / 1000)) : total;
    if (!$("#fr-time")) return;
    $("#fr-time").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    $("#fr-sub").textContent = f ? "stay with it" : "ready";
    $("#fr-prog").style.strokeDashoffset = C * (f ? left / total : 1);
    if (f && !$("#fr-stop")) controls();
    if (!f && $("#fr-stop")) { controls(); toast("Session finished 🎉"); }
  };
  const tick = setInterval(() => { if (!$("#fr-time")) return clearInterval(tick); paint(); }, 500);
  $("#fr-sounds").addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; setAmbient(b.dataset.k); $$("#fr-sounds button").forEach((x) => x.classList.toggle("on", x === b)); });
  $("#fr-vol").addEventListener("input", (e) => { ls.set("cramly.ambientVol", +e.target.value); if (ambient.gain) ambient.gain.gain.value = +e.target.value * (ambient.kind === "white" ? 0.35 : 1); });
  controls(); paint(); wireFocusTasks();
}

/* ============================================================ home: daily goal, continue card, getting-started checklist */
const flags = () => ls.get("cramly.flags", {});
const setFlag = (k) => { const f = flags(); if (!f[k]) { f[k] = 1; ls.set("cramly.flags", f); } };
addEventListener("hashchange", () => {
  const h = location.hash;
  if (/\/(listen|map|cheat|exam|glossary|predictor|mixups|boost|lab|grade)\b|#\/solve/.test(h)) setFlag("tool");
  if (/\/notes$/.test(h)) setFlag("notes");
});
const goalPref = () => ls.get("cramly.goal", 5);
function ringSvg(p, label, sub, color = "var(--grape)") {
  const R = 42, C = 2 * Math.PI * R;
  return `<div class="goal-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${R}" class="track"/><circle cx="50" cy="50" r="${R}" class="prog" style="stroke:${color}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, p))}"/></svg><div><b>${label}</b><small>${sub}</small></div></div>`;
}
async function paintHomeExtras(sets) {
  const box = $("#home-extra");
  if (!box) return;
  setTimeout(maybeTour, 900);
  let st = null;
  try { st = await api("/api/stats"); } catch { /* the cards below still work */ }
  if (!$("#home-extra")) return;
  const today = st?.days?.[st.days.length - 1]?.n || 0, goal = goalPref(), done = today >= goal;
  const last = [...sets].sort((a, b) => (b.opened || 0) - (a.opened || 0))[0];
  const f = flags(), items = [
    ["Make your first study set", sets.length > 0, "#/new"], ["Take a quiz", (st?.totals.quizzes || 0) > 0, last ? `#/set/${last.id}/test` : "#/new"],
    ["Review some flashcards", (st?.totals.reviews || 0) > 0, "#/review"], ["Try a study tool (listen, mind map, solve…)", !!f.tool, last ? `#/set/${last.id}/map` : "#/solve"],
    ["Ask the tutor something", !!ls.get("cramly.tutorUsed", false), last ? `#/set/${last.id}` : "#/new"], ["Do a focus session", focusToday() > 0, "#/focus"], ["Write your own notes", !!f.notes, last ? `#/set/${last.id}` : "#/new"],
  ];
  const got = items.filter((i) => i[1]).length;
  const checklist = ls.get("cramly.hideStart", false) || got === items.length ? "" : `<section class="hcard start"><div class="hc-head"><h3>Getting started</h3><button class="link" id="hide-start" type="button">Hide</button></div>
    <div class="bar green"><i style="width:${pct(got, items.length)}%"></i></div><p class="muted small">${got} of ${items.length} done</p>
    <ul>${items.map(([t, ok, h]) => `<li class="${ok ? "ok" : ""}"><a href="${h}"><span>${ok ? "✓" : ""}</span>${esc(t)}</a></li>`).join("")}</ul></section>`;
  box.innerHTML = `<section class="hcard goal"><div class="hc-head"><h3>Today's goal</h3><button class="link" id="edit-goal" type="button">Change</button></div>
      ${ringSvg(today / goal, `${Math.min(today, goal)}/${goal}`, done ? "goal reached 🎉" : "study actions", done ? "var(--mint)" : "var(--grape)")}
      <p class="muted small">A study action is a quiz, a round of flashcards, a tool or a tutor chat. Streak: <b>${S.me?.streak || 0}</b> day${S.me?.streak === 1 ? "" : "s"}.</p></section>
    ${last ? `<a class="hcard cont" href="#/set/${last.id}" style="--h:${last.hue}"><p class="eyebrow">Continue where you left off</p><div class="cont-row"><span class="tile">${esc(last.emoji)}</span><div><b>${esc(last.title)}</b><small>${last.mastered} of ${last.topics} topics mastered${last.due ? ` · ${last.due} cards due` : ""}</small></div></div>
      <div class="bar green"><i style="width:${pct(last.mastered, last.topics)}%"></i></div><span class="btn primary">Keep studying →</span></a>` : ""}${checklist}`;
  $("#edit-goal")?.addEventListener("click", async () => {
    const v = await askText({ title: "Daily goal", label: "Study actions per day", type: "number", value: String(goal), hint: "Small goals you hit every day beat big ones you skip." });
    const n = Math.max(1, Math.min(50, parseInt(v, 10) || 0)); if (v !== null && n) { ls.set("cramly.goal", n); paintHomeExtras(sets); }
  });
  $("#hide-start")?.addEventListener("click", () => { ls.set("cramly.hideStart", true); paintHomeExtras(sets); });
  paintDaily(box);
  if (done && !ls.get(`cramly.goalDone.${todayKey()}`, false)) { ls.set(`cramly.goalDone.${todayKey()}`, true); try { addAura(25); confetti(80); toast("Daily goal reached! +25 aura 🎯"); } catch { /* decoration */ } }
}

Object.assign(ICON, { grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>' });

/* ============================================================ the More sheet: every tool in one place (the phone's sidebar) */
function moreSheet() {
  const set = S.cur?.set, id = set?.id;
  const tile = (e, n, h, need = "") => `<a class="more-tile ${need}" href="${h}" data-close-more>${`<span>${e}</span>`}<b>${n}</b>${need === "plus" ? '<i class="ptag plus">PLUS</i>' : ""}</a>`;
  const global = [["📸", "Snap and solve", "#/solve", "premium"], ["📝", "Summariser", "#/summarize", "premium"], ["🃏", "Quick cards", "#/quickcards", "premium"], ["🎯", "Smart drill", "#/drill", "premium"],
    ["📈", "Progress", "#/progress", "premium"], ["🎧", "Focus room", "#/focus", ""], ["🎙️", "Record lecture", "#/record", ""], ["📅", "Calendar", "#/calendar", ""], ["📊", "Weekly report", "#/report", "plus"]];
  const mine = set ? [["🕸️", "Mind map", `#/set/${id}/map`, "premium"], ["🗓️", "Study schedule", `#/set/${id}/schedule`, "premium"], ["📄", "Cheat sheet", `#/set/${id}/cheat`, "premium"], ["⏱️", "Exam builder", `#/set/${id}/exam`, "premium"],
    ["📖", "Glossary", `#/set/${id}/glossary`, "premium"], ["⌨️", "Typing practice", `#/set/${id}/type`, "premium"], ["📓", "Mistake notebook", `#/set/${id}/mistakes`, "premium"], ["🖨️", "Print flashcards", `#/set/${id}/print`, "premium"],
    ["🔮", "Exam predictor", `#/set/${id}/predictor`, "plus"], ["🔀", "Mix-ups", `#/set/${id}/mixups`, "plus"], ["✍️", "Essay outline", `#/set/${id}/outline`, "plus"], ["📚", "Study guide", `#/set/${id}/guide`, "plus"]] : [];
  sheet(`<h3>${ic("grid")} All tools</h3>${set ? `<p class="eyebrow">${esc(set.emoji)} ${esc(set.title)}</p><div class="more-grid">${mine.map((t) => tile(...t)).join("")}</div>` : ""}
    <p class="eyebrow">Anywhere</p><div class="more-grid">${global.map((t) => tile(...t)).join("")}</div>
    <div class="more-foot"><button class="btn" id="more-set" type="button">${ic("gear")} Settings</button><button class="btn" id="more-contact" type="button">${ic("mail")} Contact Awsaa</button></div>`, () => {
    $$("[data-close-more]").forEach((a) => a.addEventListener("click", closeSheet));
    $("#more-set").addEventListener("click", () => { closeSheet(); setTimeout(settingsSheet, 150); });
    $("#more-contact").addEventListener("click", () => openContact("question"));
    markLocks?.();
  });
}

/* ============================================================ quick actions on the home page */
function quickActions() {
  const due = S.me?.due || 0;
  return `<div class="quick"><a href="#/new" class="qa a"><span>➕</span><b>New set</b></a><a href="#/review" class="qa b"><span>🃏</span><b>Review</b>${due ? `<i>${due}</i>` : ""}</a><a href="#/focus" class="qa c"><span>🎧</span><b>Focus</b></a><button type="button" class="qa d" id="qa-tutor"><span>🦉</span><b>Ask tutor</b></button></div>`;
}
document.addEventListener("click", (e) => { if (e.target.closest("#qa-tutor")) { const id = S.sets?.[0]?.id; if (id) { go(`#/set/${id}`); setTimeout(() => openTutor({ mode: "ask" }), 500); } else go("#/new"); } if (e.target.closest("#tab-more")) moreSheet(); });

/* ============================================================ a short welcome tour for first-time users */
function maybeTour() {
  if (ls.get("cramly.toured", false) || $("#sheet")?.open || $("#paywall") || $("#gate")) return;
  const slides = [
    ["📚", "Turn your notes into a study plan", "Upload a PDF, slides or a photo of your notebook. Cramly splits it into topics and teaches it back to you."],
    ["🦉", "Learn it your way", "Chat with the tutor, read short notes, flip flashcards that come back just before you forget, and take quizzes."],
    ["🧰", "Tools for every exam", "Mind maps, cheat sheets, timed exams, a glossary, a study schedule and more. Open the search with Ctrl+K, or tap More on your phone."],
    ["🎁", "Free forever, premium on request", "The basics are always free, and you can try every premium tool for 20 minutes a day. Premium is a gift from Awsaa if you ask."],
  ];
  let k = 0;
  const draw = () => {
    const [e, t, p] = slides[k];
    $("#sheet-body").innerHTML = `<div class="gift tour"><div class="gift-ico">${e}</div><h3>${esc(t)}</h3><p class="muted">${esc(p)}</p>
      <div class="dots">${slides.map((_, n) => `<i class="${n === k ? "on" : ""}"></i>`).join("")}</div>
      <div class="sheet-actions"><button class="btn" id="tour-skip" type="button">Skip</button><button class="btn primary" id="tour-next" type="button">${k + 1 < slides.length ? "Next" : "Let us go"}</button></div></div>`;
    $("#tour-skip").addEventListener("click", closeSheet);
    $("#tour-next").addEventListener("click", () => { if (k + 1 < slides.length) { k++; draw(); } else closeSheet(); });
  };
  sheet("<div></div>", draw);
  ls.set("cramly.toured", true);
}
