/* Cramly tools 4. Premium: type-your-answer practice, smart drill, daily challenge, highlights, import cards, focus tasks, share a score card.
   Premium Plus: rewrite the notes (simpler, shorter, deeper, translated) and the weekly report. Loaded after tools3.js. */
"use strict";

/* ============================================================ type your answer: active recall beats flipping */
const wordsOf = (s) => norm(s).split(" ").filter((w) => w.length > 2);
function likeness(typed, answer) {
  if (norm(typed) === norm(answer)) return 1;
  const have = new Set(wordsOf(typed)), want = wordsOf(answer);
  return want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
}
function typeSession({ title, cards, backHref, crumbs, set }) {
  shell({ tab: "type", set, tutor: false, crumbs });
  const deck = [...cards].sort(() => Math.random() - 0.5).slice(0, 20), tally = { right: 0, close: 0, wrong: 0 };
  let i = 0;
  const draw = () => {
    const c = deck[i];
    $("#view").innerHTML = `<div class="session"><div class="s-top"><a class="icon-btn" href="${backHref}" aria-label="Close">✕</a><div class="bar"><i style="width:${pct(i, deck.length)}%"></i></div><small>${i + 1} / ${deck.length}</small></div>
      <div class="q-card lab-card"><p class="topic">${esc(title)}</p><h3 dir="auto">${esc(c.front)}</h3>
        <textarea id="ty-in" rows="2" placeholder="Type what you remember…" dir="auto" aria-label="Your answer"></textarea>
        <div class="row" style="margin:0"><button class="btn primary" id="ty-go" type="button">Check</button><button class="btn" id="ty-skip" type="button">I do not know</button></div><div id="ty-fb"></div></div></div>`;
    $("#ty-in").focus();
    $("#ty-go").addEventListener("click", () => settle($("#ty-in").value));
    $("#ty-skip").addEventListener("click", () => settle(""));
    $("#ty-in").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); settle($("#ty-in").value); } });
  };
  const settle = (typed) => {
    const c = deck[i], sim = typed.trim() ? likeness(typed, c.back) : 0, verdict = sim >= 0.7 ? "right" : sim >= 0.4 ? "close" : "wrong";
    const mark = (v, grade) => { tally[v]++; api(`/api/cards/${c.id}/review`, { body: { grade } }).catch(() => {}); };
    $("#ty-fb").innerHTML = `<div class="why ${verdict === "wrong" ? "no" : "ok"}" dir="auto">${verdict === "right" ? "✅ Right. " : verdict === "close" ? "🟡 Close. " : "❌ Not quite. "}The answer: <b>${esc(c.back)}</b></div>
      <div class="row" style="margin:0"><button class="btn primary" id="ty-next" type="button">${i + 1 < deck.length ? "Next →" : "Finish"}</button>${verdict !== "right" ? '<button class="btn" id="ty-ok" type="button">I was right</button>' : ""}</div>`;
    $$("#ty-go, #ty-skip, #ty-in").forEach((x) => (x.disabled = true));
    let graded = false;
    const grade = (v) => { if (graded) return; graded = true; mark(v, v === "right" ? 2 : v === "close" ? 1 : 0); };
    $("#ty-ok")?.addEventListener("click", () => { grade("right"); $("#ty-ok").remove(); toast("Counted as right 👍"); });
    $("#ty-next").addEventListener("click", () => { grade(verdict); i++; i < deck.length ? draw() : finish(); });
    $("#ty-next").focus();
  };
  const finish = () => {
    const p = pct(tally.right + tally.close * 0.5, deck.length);
    try { addAura(tally.right * 3 + tally.close); } catch { /* optional */ }
    if (p >= 80) confetti();
    $("#view").innerHTML = `<div class="session"><div class="result"><div class="ring" style="--p:${p};--c:${p >= 80 ? "var(--mint)" : p >= 50 ? "var(--sun)" : "var(--rose)"}">${p}%</div>
      <h2>${p >= 80 ? "Strong recall 🧠" : p >= 50 ? "Getting there" : "Keep practising"}</h2><p>${tally.right} right, ${tally.close} close, ${tally.wrong} to review.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" id="ty-again" type="button">Another round</button><a class="btn" href="${backHref}">Done</a></div></div></div>`;
    $("#ty-again").addEventListener("click", () => typeSession({ title, cards, backHref, crumbs, set }));
  };
  draw();
}
async function typeView() {
  if (!canPremium()) { go(`#/set/${S.cur.set.id}`); return needPlans("Typing practice"); }
  const { set } = S.cur;
  shell({ tab: "type", set, tutor: false, crumbs: crumbsFor(set, { text: "Typing practice" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Getting your cards…")}</div>`;
  let cards;
  try { cards = (await api(`/api/sets/${set.id}/cards`)).cards; } catch (e) { return failView("Could not get the cards", e); }
  if (cards.length < 3) return failView("Not enough flashcards yet", "Open the Flashcards page once, then come back to practise typing.");
  typeSession({ title: set.title, cards, backHref: `#/set/${set.id}`, crumbs: crumbsFor(set, { text: "Typing practice" }), set });
}

/* ============================================================ smart drill: your weakest cards from every study set */
async function drillView() {
  shell({ tab: "drill", crumbs: topCrumbs("Smart drill") });
  $("#view").innerHTML = `<div class="session">${skeleton("Finding your weakest cards…")}</div>`;
  let d;
  try { d = await api("/api/drill"); } catch (e) { return failView("Could not load the drill", e); }
  flashSession({ title: "Smart drill", cards: d.cards, backHref: "#/", set: null, tab: "drill", crumbs: topCrumbs("Smart drill"),
    again: d.total ? "No weak cards right now. Everything you studied is sticking." : "Make some flashcards first, then your weakest ones show up here." });
}

/* ============================================================ daily challenge: one question a day from your own quizzes */
async function paintDaily(box) {
  if (!box || !canPremium()) return;
  let q;
  try { q = await api("/api/daily"); } catch { return; }
  if (!$("#home-extra")) return;
  const key = `cramly.daily.${q.day || todayKey()}`, picked = ls.get(key, null);
  const html = q.none
    ? `<section class="hcard daily"><div class="hc-head"><h3>Daily challenge</h3></div><p class="muted">Take a quiz on any topic and your daily question appears here.</p></section>`
    : `<section class="hcard daily"><div class="hc-head"><h3>Daily challenge ⚡</h3><small class="muted">${esc(q.set_title)}</small></div><p dir="auto"><b>${esc(q.q)}</b></p>
        <div class="dq-opts">${q.options.map((o, k) => `<button type="button" class="dq ${picked === null ? "" : k === q.answer ? "right" : k === picked ? "wrong" : ""}" data-k="${k}" ${picked === null ? "" : "disabled"} dir="auto">${esc(o)}</button>`).join("")}</div>
        <p class="muted small" id="dq-why" dir="auto">${picked === null ? "One try. Aura for a right answer." : esc(q.why)}</p></section>`;
  box.insertAdjacentHTML("beforeend", html);
  $$(".dq").forEach((b) => b.addEventListener("click", () => {
    const k = +b.dataset.k; ls.set(key, k);
    $$(".dq").forEach((x, n) => { x.disabled = true; x.classList.toggle("right", n === q.answer); x.classList.toggle("wrong", n === k && k !== q.answer); });
    $("#dq-why").textContent = `${k === q.answer ? "Right! +15 aura. " : "Not this time. "}${q.why}`;
    if (k === q.answer) { try { addAura(15); confetti(60); } catch { /* optional */ } }
  }));
}

/* ============================================================ highlights on the Read page */
const HL_COLORS = { y: "Yellow", g: "Green", p: "Pink" };
const hlKey = (tid) => `cramly.hl.${tid}`;
function wrapRange(range, color) {
  const nodes = [], walk = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (range.intersectsNode(n) && n.nodeValue.trim()) nodes.push(n);
  const saved = [];
  nodes.forEach((n) => {
    let from = n === range.startContainer ? range.startOffset : 0, to = n === range.endContainer ? range.endOffset : n.nodeValue.length;
    if (to <= from) return;
    const mid = n.splitText(from); mid.splitText(to - from);
    const mark = document.createElement("mark"); mark.className = `hl ${color}`; mid.parentNode.insertBefore(mark, mid); mark.append(mid);
    saved.push({ t: mid.nodeValue, c: color });
  });
  return saved;
}
function applyHighlights(prose, tid) {
  for (const h of ls.get(hlKey(tid), [])) {
    const walk = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.parentNode.closest?.("mark.hl")) continue;
      const at = n.nodeValue.indexOf(h.t);
      if (at < 0) continue;
      const mid = n.splitText(at); mid.splitText(h.t.length);
      const mark = document.createElement("mark"); mark.className = `hl ${h.c}`; mid.parentNode.insertBefore(mark, mid); mark.append(mid);
      break;
    }
  }
}
function highlightsSheet(tid, prose) {
  const list = ls.get(hlKey(tid), []);
  sheet(`<h3>🖍️ My highlights</h3>${list.length ? `<div class="hl-list">${list.map((h, k) => `<div class="hl-row"><mark class="hl ${h.c}" dir="auto">${esc(h.t)}</mark><button class="icon-btn" data-d="${k}" aria-label="Remove">✕</button></div>`).join("")}</div>` : '<p class="muted">Select text on the page and pick a colour.</p>'}
    <div class="sheet-actions"><button class="btn primary" data-close>Done</button></div>`, () => $$("[data-d]").forEach((b) => b.addEventListener("click", () => {
    const next = ls.get(hlKey(tid), []); next.splice(+b.dataset.d, 1); ls.set(hlKey(tid), next);
    $$("mark.hl", prose).forEach((m) => m.replaceWith(document.createTextNode(m.textContent))); prose.normalize(); applyHighlights(prose, tid); highlightsSheet(tid, prose);
  })));
}

/* ============================================================ rewrite the notes: simpler, shorter, deeper or translated (Plus) */
const LANGS = ["Arabic", "English", "Spanish", "French", "German", "Turkish", "Urdu", "Hindi", "Chinese", "Portuguese", "Russian"];
function rewriteSheet(tid) {
  let mode = "simpler", lang = isArabic(document.querySelector(".prose")?.innerText || "") ? "English" : "Arabic";
  sheet(`<h3>✨ Rewrite these notes</h3><p class="muted">Cramly rewrites the notes you are reading. Your original stays untouched.</p>
    <div class="seg kinds" id="rw-mode"><button data-m="simpler">🌱 Simpler</button><button data-m="shorter">✂️ Shorter</button><button data-m="deeper">🔬 Deeper</button><button data-m="translate">🌍 Translate</button></div>
    <label id="rw-lang-box" hidden>Language<select id="rw-lang">${LANGS.map((l) => `<option ${l === lang ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div id="rw-out"></div><div class="sheet-actions"><button class="btn" data-close>Close</button><button class="btn primary" id="rw-go" type="button">Rewrite</button></div>`, () => {
    const mark = () => { $$("#rw-mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode)); $("#rw-lang-box").hidden = mode !== "translate"; };
    mark();
    $$("#rw-mode button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.m; mark(); }));
    $("#rw-go").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Writing…"; $("#rw-out").innerHTML = skeleton("Rewriting… (about 8 seconds)");
      try {
        const r = await api(`/api/topics/${tid}/rewrite`, { body: { mode, lang: $("#rw-lang").value } });
        $("#rw-out").innerHTML = `<div class="rw-text prose" dir="auto">${md(r.text)}</div><div class="row"><button class="btn small" id="rw-copy" type="button">${ic("copy")} Copy</button><button class="btn small" id="rw-save" type="button">📝 Save to my notes</button></div>`;
        $("#rw-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.text); toast("Copied"); } catch { toast("Could not copy", true); } });
        $("#rw-save").addEventListener("click", async () => {
          try { const cur = (await api(`/api/topics/${tid}/mynotes`)).text; await api(`/api/topics/${tid}/mynotes`, { method: "PUT", body: { text: `${cur ? `${cur}\n\n` : ""}${r.text}` } }); toast("Saved to My notes"); } catch (err) { toast(err.message, true); }
        });
      } catch (err) { $("#rw-out").innerHTML = `<div class="note-card">${esc(err.message)}</div>`; }
      btn.disabled = false; btn.textContent = "Rewrite again";
    });
  });
}

/* ============================================================ import flashcards from pasted text */
function importCardsSheet(tid, onDone) {
  sheet(`<h3>📥 Import flashcards</h3><p class="muted">One card per line: the question, then a tab, a <b>|</b> or a <b>;</b>, then the answer. Pasting two columns from Excel or Anki works too.</p>
    <textarea id="im-text" rows="8" placeholder="What is a cell? | The basic unit of life&#10;What is DNA? | The molecule that carries genes" dir="auto"></textarea>
    <div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="im-go" type="button">Import</button></div>`, () => {
    $("#im-go").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const r = await api(`/api/topics/${tid}/cards/bulk`, { body: { text: $("#im-text").value } }); closeSheet(); toast(`${r.added} cards imported${r.skipped ? `, ${r.skipped} skipped` : ""}`); onDone?.(); } catch (err) { toast(err.message, true); b.disabled = false; }
    });
  });
}

/* ============================================================ share your score as a picture */
function shareScoreCard({ title, p, score, total }) {
  if (!canPremium()) return needPlans("Share cards");
  const c = Object.assign(document.createElement("canvas"), { width: 1080, height: 1350 }), x = c.getContext("2d");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--grape").trim() || "#6b5cff";
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, "#eef0ff"); g.addColorStop(1, "#ffe9f1"); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = "#fff"; x.beginPath(); x.roundRect(90, 150, 900, 1050, 70); x.fill();
  x.textAlign = "center"; x.fillStyle = accent; x.font = "700 64px Georgia, serif"; x.fillText("Cramly", 540, 270);
  x.fillStyle = "#1b2038"; x.font = "700 46px sans-serif"; x.fillText(title.length > 28 ? `${title.slice(0, 27)}…` : title, 540, 360);
  x.lineWidth = 46; x.strokeStyle = "#e6e9f7"; x.beginPath(); x.arc(540, 700, 230, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = p >= 80 ? "#22c08e" : p >= 50 ? "#ffb648" : "#ff6f93"; x.lineCap = "round"; x.beginPath(); x.arc(540, 700, 230, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p / 100)); x.stroke();
  x.fillStyle = "#1b2038"; x.font = "700 170px Georgia, serif"; x.fillText(`${p}%`, 540, 745);
  x.font = "500 48px sans-serif"; x.fillStyle = "#6c7493"; x.fillText(`${score} of ${total} right`, 540, 1010);
  x.font = "600 40px sans-serif"; x.fillStyle = accent; x.fillText(p >= 80 ? "Mastered it 🎉" : "Getting better every day", 540, 1100);
  c.toBlob(async (blob) => {
    const file = new File([blob], "cramly-score.png", { type: "image/png" });
    try { if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: "My Cramly score" }); } catch { /* fall back to a download */ }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "cramly-score.png" }); a.click(); toast("Saved the picture");
  });
}

/* ============================================================ weekly report (Plus) */
async function reportView() {
  if (S.me?.plan !== "plus" && (S.me?.trial_left ?? 0) <= 0) { go("#/"); return plusSheet({ error: "The weekly report is part of Premium Plus" }); }
  shell({ tab: "report", crumbs: topCrumbs("Weekly report") });
  $("#view").innerHTML = `<div class="session">${skeleton("Adding up your week…")}</div>`;
  let d;
  try { d = await api("/api/stats?full=1"); } catch (e) { return failView("Could not build the report", e); }
  const days = d.days, sum = (a) => a.reduce((n, x) => n + x.n, 0), week = days.slice(-7), prev = days.slice(-14, -7);
  const now = sum(week), before = sum(prev), best = [...week].sort((a, b) => b.n - a.n)[0], active = week.filter((x) => x.n).length;
  const log = ls.get("cramly.focuslog", {}), focus = week.reduce((n, x) => n + (log[x.day] || 0), 0);
  const delta = before ? Math.round(((now - before) / before) * 100) : null;
  const tip = d.streak < 3 ? "Short and daily beats long and rare. Aim for a 5 minute review every day to build your streak."
    : d.weak.length ? `Your next best move: revisit <b>${esc(d.weak[0].topic)}</b> (best quiz ${d.weak[0].quiz_best}%).` : "Everything you tested is going well. Try the exam predictor or a timed exam to stretch yourself.";
  const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  $("#view").innerHTML = `<div class="wide stats">${toolHead("Premium Plus", "Your week 📊", `${prettyDay(week[0].day)} to ${prettyDay(week[6].day)}`)}
    <div class="stat-grid">${stat(now, "study actions")}${stat(`${active}/7`, "days studied")}${stat(`${focus}m`, "focused")}${stat(d.streak, "day streak")}${delta === null ? "" : stat(`${delta >= 0 ? "+" : ""}${delta}%`, "vs last week")}${stat(`${d.totals.mastered}/${d.totals.topics}`, "topics mastered")}</div>
    <div class="two"><section class="panel"><h3>Each day</h3><div class="week">${week.map((x) => `<div class="wk"><i class="${x.n ? "on" : ""}" style="height:${Math.max(6, (x.n / Math.max(1, best.n)) * 100)}%" title="${x.n}"></i><small>${new Date(`${x.day}T12:00`).toLocaleDateString([], { weekday: "narrow" })}</small></div>`).join("")}</div>
        <p class="muted small">Best day: <b>${best.n ? prettyDay(best.day) : "none yet"}</b></p></section>
      <section class="panel"><h3>Needs attention</h3>${d.weak.length ? d.weak.slice(0, 4).map((w) => `<a class="weak" href="#/set/${w.set_id}/t/${w.topic_id}/quiz"><b>${esc(w.topic)}</b><small>${esc(w.set)}</small><span class="score">${w.quiz_best}%</span></a>`).join("") : '<p class="muted">No weak topics. Nice.</p>'}</section></div>
    <section class="panel tipcard"><h3>Next week</h3><p>${tip}</p></section></div>`;
}

/* ============================================================ focus room tasks */
const tasksList = () => ls.get("cramly.tasks", []);
function focusTasksHtml() {
  if (!canPremium()) return `<div class="panel"><h3>Tasks ${planTag("premium")}</h3><p class="muted small">Plan what to finish in each focus session. Part of Premium.</p></div>`;
  const list = tasksList();
  return `<div class="panel" id="fr-tasks"><h3>Tasks <small class="muted">${list.filter((t) => !t.done).length} to do</small></h3>
    <form class="task-add" id="tk-form"><input id="tk-in" maxlength="80" placeholder="Add a task and press Enter" aria-label="New task"></form>
    <ul class="tasks">${list.map((t, k) => `<li class="${t.done ? "done" : ""}"><label><input type="checkbox" data-k="${k}" ${t.done ? "checked" : ""}><span dir="auto">${esc(t.t)}</span></label><button class="icon-btn" data-x="${k}" aria-label="Remove">✕</button></li>`).join("") || '<li class="muted small">Nothing yet.</li>'}</ul></div>`;
}
function wireFocusTasks() {
  const box = $("#fr-tasks"); if (!box) return;
  const redraw = () => { box.outerHTML = focusTasksHtml(); wireFocusTasks(); };
  $("#tk-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#tk-in").value.trim(); if (!v) return; ls.set("cramly.tasks", [...tasksList(), { t: v, done: false }].slice(-30)); redraw(); $("#tk-in")?.focus(); });
  $$("#fr-tasks [data-k]").forEach((c) => c.addEventListener("change", () => { const l = tasksList(); l[+c.dataset.k].done = c.checked; ls.set("cramly.tasks", l); if (c.checked) { try { addAura(3); } catch { /* optional */ } } redraw(); }));
  $$("#fr-tasks [data-x]").forEach((b) => b.addEventListener("click", () => { const l = tasksList(); l.splice(+b.dataset.x, 1); ls.set("cramly.tasks", l); redraw(); }));
}
