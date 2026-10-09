/* Cramly tools 3. Premium: summariser, quick cards, study schedule, mistake notebook, printable flashcards, read aloud, ask-on-selection.
   Premium Plus: essay outline, printable study guide, improve weak cards. Loaded after tools2.js. */
"use strict";

const canPremium = () => !!S.me?.premium || (S.me?.trial_left ?? 0) > 0;
const needPlans = (what) => { plansSheet("premium", `${what} is a Premium feature.`); return false; };
const topCrumbs = (name) => [{ text: "Home", href: "#/" }, { text: name }];

/* ============================================================ summariser: paste anything, get the short version */
async function summarizeView() {
  shell({ tab: "summarize", crumbs: topCrumbs("Summariser") });
  $("#view").innerHTML = `<div class="solve">${toolHead("Premium tool", "Summariser 📝", "Paste a chapter, an article or your notes. Get the short version, the key points, a revision-ready summary and the terms to learn.")}
    <div class="solve-card"><label>Paste your text<textarea id="sm-text" rows="9" maxlength="30000" placeholder="Paste at least a few sentences…" dir="auto"></textarea></label>
      <div class="row" style="margin:0"><button class="btn primary big" id="sm-go" type="button">Summarise ✨</button><span class="muted small" id="sm-count">0 words</span></div></div><div id="sm-out"></div></div>`;
  const words = () => ($("#sm-text").value.trim().match(/\S+/g) || []).length;
  $("#sm-text").addEventListener("input", () => { $("#sm-count").textContent = `${words()} words`; });
  $("#sm-go").addEventListener("click", async (e) => {
    const b = e.currentTarget, text = $("#sm-text").value.trim();
    if (text.length < 80) return toast("Paste a few more sentences first.", true);
    b.disabled = true; b.textContent = "Reading…";
    $("#sm-out").innerHTML = skeleton("Summarising… (about 6 seconds)");
    try {
      const r = await api("/api/summarize", { body: { text } });
      $("#sm-out").innerHTML = `<div class="answer"><p class="eyebrow">In short</p><h2 dir="auto">${esc(r.short)}</h2></div>
        <div class="two"><section class="panel"><h3>Key points</h3><ul class="tick">${r.bullets.map((x) => `<li dir="auto">• ${esc(x)}</li>`).join("")}</ul></section>
          <section class="panel"><h3>Terms to learn</h3><div class="chips" style="margin:0">${r.terms.map((x) => `<span class="pill" dir="auto">${esc(x)}</span>`).join("") || '<span class="muted">None found.</span>'}</div></section></div>
        <section class="panel"><h3>Revision summary</h3><div class="model" dir="auto">${md(r.detailed)}</div><div class="row"><button class="btn small" id="sm-copy" type="button">${ic("copy")} Copy</button></div></section>`;
      $("#sm-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(`${r.short}\n\n${r.bullets.map((x) => `- ${x}`).join("\n")}\n\n${r.detailed}`); toast("Copied"); } catch { toast("Could not copy", true); } });
      try { addAura(10); } catch { /* optional */ }
    } catch (err) { $("#sm-out").innerHTML = `<div class="note-card">${esc(err.message)}</div>`; }
    b.disabled = false; b.textContent = "Summarise ✨";
  });
}

/* ============================================================ quick cards: paste text, get flashcards (and save them) */
async function quickCardsView() {
  shell({ tab: "quickcards", crumbs: topCrumbs("Quick cards") });
  if (!S.sets.length) S.sets = (await api("/api/sets").catch(() => ({ sets: [] }))).sets;
  $("#view").innerHTML = `<div class="solve">${toolHead("Premium tool", "Quick cards 🃏", "Paste any text and turn it into flashcards in seconds. Save them straight into a topic.")}
    <div class="solve-card"><label>Paste your text<textarea id="qc-text" rows="8" maxlength="20000" placeholder="A paragraph from a book, a slide, a lecture note…" dir="auto"></textarea></label>
      <div class="grid2"><label>Save into (optional)<select id="qc-set"><option value="0">Just show me the cards</option>${S.sets.map((s) => `<option value="${s.id}">${esc(s.emoji)} ${esc(s.title)}</option>`).join("")}</select></label>
        <label>Topic<select id="qc-topic" disabled><option>Pick a study set first</option></select></label></div>
      <button class="btn primary big" id="qc-go" type="button">Make flashcards ✨</button></div><div id="qc-out"></div></div>`;
  $("#qc-set").addEventListener("change", async (e) => {
    const sel = $("#qc-topic"), id = +e.target.value;
    if (!id) { sel.disabled = true; sel.innerHTML = "<option>Pick a study set first</option>"; return; }
    try { const d = await api(`/api/sets/${id}`); sel.innerHTML = d.topics.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join(""); sel.disabled = false; } catch (err) { toast(err.message, true); }
  });
  $("#qc-go").addEventListener("click", async (e) => {
    const b = e.currentTarget, text = $("#qc-text").value.trim(), save = +$("#qc-set").value > 0;
    if (text.length < 80) return toast("Paste a few more sentences first.", true);
    b.disabled = true; b.textContent = "Writing cards…";
    $("#qc-out").innerHTML = skeleton("Writing flashcards… (about 6 seconds)");
    try {
      const r = await api("/api/quickcards", { body: { text, save, topic_id: save ? +$("#qc-topic").value : 0 } });
      $("#qc-out").innerHTML = `<div class="panel"><h3>${r.cards.length} cards ${save ? `<small class="muted">${r.saved} saved to your deck</small>` : ""}</h3>
        <div class="qc-grid">${r.cards.map((c) => `<article class="qc"><b dir="auto">${esc(c.front)}</b><p dir="auto">${esc(c.back)}</p></article>`).join("")}</div></div>`;
      try { addAura(8); } catch { /* optional */ }
    } catch (err) { $("#qc-out").innerHTML = `<div class="note-card">${esc(err.message)}</div>`; }
    b.disabled = false; b.textContent = "Make flashcards ✨";
  });
}

/* ============================================================ study schedule: from today to the exam, day by day */
const isoAdd = (base, n) => { const d = new Date(`${base}T12:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
function buildSchedule(set, topics, perDay) {
  const base = todayKey(), left = set.exam ? Math.round((new Date(`${set.exam}T12:00`) - new Date(`${base}T12:00`)) / 864e5) : 14;
  const days = Math.max(2, Math.min(left, 60));
  const need = (t) => (t.status >= 2 ? 0.5 : t.status === 1 ? 1.4 : 2) + (t.quiz_best >= 0 ? (100 - t.quiz_best) / 60 : 0.5);
  const order = [...topics].sort((a, b) => need(b) - need(a));
  const learnDays = Math.max(1, Math.floor((days - 2) * 0.6)), reviewDays = Math.max(0, days - 2 - learnDays);
  const plan = Array.from({ length: days }, (_, i) => ({ date: isoAdd(base, i), label: "", tasks: [] }));
  order.forEach((t, i) => plan[i % learnDays].tasks.push({ text: `Learn: ${t.title}`, href: `#/set/${set.id}/t/${t.id}/read` }));
  plan.slice(0, learnDays).forEach((d) => { d.label = "Learn"; d.tasks.push({ text: "Daily flashcard review", href: "#/review" }); });
  order.forEach((t, i) => { if (reviewDays) plan[learnDays + (i % reviewDays)].tasks.push({ text: `Quiz yourself: ${t.title}`, href: `#/set/${set.id}/t/${t.id}/quiz` }); });
  plan.slice(learnDays, learnDays + reviewDays).forEach((d) => { d.label = "Practise"; d.tasks.push({ text: "Daily flashcard review", href: "#/review" }); });
  const weak = order.slice(0, Math.max(1, Math.ceil(topics.length / 4)));
  plan[days - 2].label = "Weak spots"; plan[days - 2].tasks.push(...weak.map((t) => ({ text: `Last look: ${t.title}`, href: `#/set/${set.id}/t/${t.id}/cards` })));
  plan[days - 1].label = set.exam ? "Exam eve" : "Final day"; plan[days - 1].tasks.push({ text: "Take a full practice test", href: `#/set/${set.id}/test` }, { text: "Skim your cheat sheet, then rest well", href: `#/set/${set.id}/cheat` });
  return plan.map((d) => ({ ...d, tasks: d.tasks.slice(0, Math.max(2, perDay + 1)) }));
}
async function scheduleView() {
  if (!canPremium()) { go(`#/set/${S.cur.set.id}`); return needPlans("The study schedule"); }
  const { set, topics } = S.cur, key2 = `cramly.sched.${set.id}`;
  shell({ tab: "schedule", set, tutor: false, crumbs: crumbsFor(set, { text: "Study schedule" }) });
  const per = ls.get("cramly.schedPer", 2), done = ls.get(key2, {});
  const plan = buildSchedule(set, topics, per), total = plan.reduce((n, d) => n + d.tasks.length, 0);
  const ticked = plan.reduce((n, d) => n + d.tasks.filter((_, k) => done[`${d.date}|${k}`]).length, 0);
  $("#view").innerHTML = `<div class="wide sched">${toolHead(set.title, "Study schedule 🗓️", set.exam ? `Your exam is ${fmtDay(set.exam)}. Here is the plan, hardest topics first.` : "No exam date yet, so this is a 2 week plan. Set the date for an exact one.")}
    <div class="cfg-card"><div class="row between" style="margin:0"><div class="seg" id="sc-per"><button data-v="1">Light</button><button data-v="2">Steady</button><button data-v="3">Intense</button></div>
        <button class="btn small" id="sc-exam" type="button">📅 ${set.exam ? "Change exam date" : "Set exam date"}</button></div>
      <div class="bar green"><i style="width:${pct(ticked, total)}%"></i></div><p class="muted small">${ticked} of ${total} tasks done</p></div>
    <div class="sc-days">${plan.map((d) => `<section class="sc-day ${d.date === todayKey() ? "today" : ""}"><header><b>${d.date === todayKey() ? "Today" : fmtDay(d.date)}</b><span class="tag">${esc(d.label)}</span></header>
      ${d.tasks.map((t, k) => `<label class="sc-task"><input type="checkbox" data-id="${d.date}|${k}" ${done[`${d.date}|${k}`] ? "checked" : ""}><a href="${t.href}">${esc(t.text)}</a></label>`).join("")}</section>`).join("")}</div></div>`;
  $$("#sc-per button").forEach((b) => { b.classList.toggle("on", +b.dataset.v === per); b.addEventListener("click", () => { ls.set("cramly.schedPer", +b.dataset.v); scheduleView(); }); });
  $$(".sc-task input").forEach((c) => c.addEventListener("change", () => { const m = ls.get(key2, {}); m[c.dataset.id] = c.checked; ls.set(key2, m); scheduleView(); }));
  $("#sc-exam").addEventListener("click", async () => {
    const v = await askText({ title: "When is your exam?", value: set.exam || "", label: "Exam date", type: "date" });
    if (v === null) return;
    try { await api(`/api/sets/${set.id}`, { method: "PATCH", body: { exam: v } }); await refreshCur(); scheduleView(); } catch (e) { toast(e.message, true); }
  });
}

/* ============================================================ mistake notebook: every question you got wrong, until you get it right */
const mistakeKey = (id) => `cramly.mistakes.${id}`;
function saveMistakes(setId, log) {
  if (!setId || !log?.length) return;
  const have = ls.get(mistakeKey(setId), []), seen = new Set(have.map((m) => m.q.q));
  log.filter((l) => l.k >= 0 && !seen.has(l.q.q)).forEach((l) => have.push({ q: l.q, at: Date.now() }));
  ls.set(mistakeKey(setId), have.slice(-80));
}
function mistakesView() {
  if (!canPremium()) { go(`#/set/${S.cur.set.id}`); return needPlans("The mistake notebook"); }
  const { set } = S.cur, list = ls.get(mistakeKey(set.id), []);
  shell({ tab: "mistakes", set, tutor: true, crumbs: crumbsFor(set, { text: "Mistake notebook" }) });
  $("#view").innerHTML = `<div class="wide">${toolHead(set.title, "Mistake notebook 📓", "Every question you missed lands here. Get it right in a retry and it leaves the notebook.")}
    ${list.length ? `<div class="row" style="margin:0 0 .8rem"><button class="btn primary" id="mk-retry" type="button">Retry all ${list.length}</button><button class="btn danger" id="mk-clear" type="button">Clear notebook</button></div>
      <div class="mk-list">${list.map((m) => `<article class="mk"><p class="topic">${esc(m.q.topic || "")}</p><h3 dir="auto">${esc(m.q.q)}</h3><p class="ok" dir="auto">✔ ${esc(m.q.options[m.q.answer])}</p><small class="muted" dir="auto">${esc(m.q.why)}</small></article>`).join("")}</div>`
      : '<div class="empty-hero"><div class="owl">📓</div><h2>Nothing here yet</h2><p>Take a quiz or a practice test. The questions you miss are saved here for a second try.</p></div>'}</div>`;
  $("#mk-clear")?.addEventListener("click", async () => { if (await confirmSheet({ title: "Clear the notebook?", text: "The saved mistakes for this set are removed.", ok: "Clear", danger: true })) { ls.del(mistakeKey(set.id)); mistakesView(); } });
  $("#mk-retry")?.addEventListener("click", () => quizSession({ title: "Mistakes", questions: list.map((m) => m.q), backHref: `#/set/${set.id}/mistakes`, crumbs: crumbsFor(set, { text: "Mistakes" }), set, tab: "mistakes",
    onDone: async (score, total, wrong) => { const missed = new Set(wrong.map((w) => w.q.q)); ls.set(mistakeKey(set.id), list.filter((m) => missed.has(m.q.q))); } }));
}

/* ============================================================ printable flashcards: cut them out and take them anywhere */
async function printCardsView() {
  if (!canPremium()) { go(`#/set/${S.cur.set.id}`); return needPlans("Printable flashcards"); }
  const { set } = S.cur;
  shell({ tab: "print", set, tutor: false, crumbs: crumbsFor(set, { text: "Print flashcards" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Getting your cards…")}</div>`;
  let cards;
  try { cards = (await api(`/api/sets/${set.id}/cards`)).cards; } catch (e) { return failView("Could not get the cards", e); }
  if (!cards.length) return failView("No flashcards yet", "Open the Flashcards page once and Cramly writes them.");
  $("#view").innerHTML = `<div class="cheat-wrap"><div class="cheat-bar noprint"><a class="btn" href="#/set/${set.id}">← Back</a><span class="grow"></span><span class="muted small">${cards.length} cards</span><button class="btn primary" id="pc-print" type="button">${ic("print")} Print</button></div>
    <div class="pc-sheet"><div class="pc-head"><b>${esc(set.title)}</b><small>Question on the left, answer on the right. Cut along the lines.</small></div>
      ${cards.map((c) => `<div class="pc-card"><div dir="auto">${esc(c.front)}</div><div dir="auto">${esc(c.back)}</div></div>`).join("")}</div></div>`;
  $("#pc-print").addEventListener("click", () => window.print());
}

/* ============================================================ essay outline (Plus) */
async function outlineView() {
  const { set } = S.cur;
  shell({ tab: "outline", set, tutor: true, crumbs: crumbsFor(set, { text: "Essay outline" }) });
  $("#view").innerHTML = `<div class="solve">${toolHead(set.title, "Essay outline ✍️", "Type an essay or long-answer question. You get a plan built from your own material: thesis, sections, evidence and a conclusion.")}
    <div class="solve-card"><label>The question<textarea id="ol-q" rows="3" maxlength="400" placeholder="e.g. Discuss how plants turn light energy into chemical energy." dir="auto"></textarea></label>
      <button class="btn primary big" id="ol-go" type="button">Plan my answer ✨</button></div><div id="ol-out"></div></div>`;
  $("#ol-go").addEventListener("click", async (e) => {
    const b = e.currentTarget, question = $("#ol-q").value.trim();
    if (question.length < 8) return toast("Type the question first.", true);
    b.disabled = true; b.textContent = "Planning…"; $("#ol-out").innerHTML = skeleton("Building your outline… (about 8 seconds)");
    try {
      const r = await api(`/api/sets/${set.id}/outline`, { body: { question } });
      $("#ol-out").innerHTML = `<div class="answer"><p class="eyebrow">Thesis</p><h2 dir="auto">${esc(r.thesis)}</h2></div>
        ${r.sections.map((s, i) => `<section class="panel"><h3>${i + 1}. ${esc(s.heading)}</h3><ul class="tick">${s.points.map((p) => `<li dir="auto">• ${esc(p)}</li>`).join("")}</ul></section>`).join("")}
        <div class="two"><section class="panel"><h3>Evidence to use</h3><ul class="tick">${r.evidence.map((p) => `<li dir="auto">📌 ${esc(p)}</li>`).join("")}</ul></section><section class="panel"><h3>Conclusion</h3><p dir="auto">${esc(r.conclusion)}</p></section></div>`;
      try { addAura(12); } catch { /* optional */ }
    } catch (err) { $("#ol-out").innerHTML = `<div class="note-card">${esc(err.message)}</div>`; }
    b.disabled = false; b.textContent = "Plan my answer ✨";
  });
}

/* ============================================================ the full study guide (Plus): everything about the set, printable */
async function guideView() {
  const { set } = S.cur;
  shell({ tab: "guide", set, tutor: false, crumbs: crumbsFor(set, { text: "Study guide" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Putting your study guide together…")}</div>`;
  let d;
  try { d = await api(`/api/sets/${set.id}/guide`); } catch (e) { return failView("Could not build the guide", e); }
  $("#view").innerHTML = `<div class="cheat-wrap"><div class="cheat-bar noprint"><a class="btn" href="#/set/${set.id}">← Back</a><span class="grow"></span>
      <button class="btn" id="gd-copy" type="button">${ic("copy")} Copy</button><button class="btn primary" id="gd-print" type="button">${ic("print")} Print or save PDF</button></div>
    <article class="cheat guide" dir="auto"><div class="cheat-body one">${md(d.guide)}</div></article>
    <p class="muted small noprint">Tip: open each topic's Read page, make your glossary and mix-ups first, and they all land in this guide.</p></div>`;
  $("#gd-print").addEventListener("click", () => window.print());
  $("#gd-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(d.guide); toast("Copied"); } catch { toast("Could not copy", true); } });
}

/* ============================================================ the Read page: read aloud, and ask the tutor about any text you select */
function readerExtras(tid) {
  const bar = $(".footer-actions"), prose = $(".prose");
  if (!bar || !prose) return;
  bar.insertAdjacentHTML("afterbegin", `<button class="btn" id="rd-aloud" type="button">${ic("speaker")} Read aloud</button>`);
  let token = 0, playing = false;
  const label = () => { $("#rd-aloud") && ($("#rd-aloud").innerHTML = playing ? `${ic("pause")} Stop reading` : `${ic("speaker")} Read aloud`); };
  $("#rd-aloud").addEventListener("click", async () => {
    if (playing) { token++; playing = false; try { speechSynthesis.cancel(); } catch { /* none */ } return label(); }
    if (!canPremium()) return needPlans("Read aloud");
    if (!("speechSynthesis" in window)) return toast("Your browser cannot read aloud.", true);
    playing = true; const mine = ++token; label();
    for (const p of sentences(prose.innerText)) { if (mine !== token) return; await speakBrowser(p); }
    playing = false; label();
  });
  const pop = Object.assign(document.createElement("div"), { className: "sel-pop", hidden: true });
  pop.innerHTML = `<button type="button" data-a="ask">🦉 Ask</button><button type="button" data-h="y" class="hlb y" aria-label="Highlight yellow"></button><button type="button" data-h="g" class="hlb g" aria-label="Highlight green"></button><button type="button" data-h="p" class="hlb p" aria-label="Highlight pink"></button>`;
  document.body.append(pop);
  const hide = () => { pop.hidden = true; };
  let saved = null;
  const check = () => {
    const sel = getSelection(), text = sel.toString().trim();
    if (text.length < 3 || !sel.rangeCount || !prose.contains(sel.anchorNode)) return hide();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    pop.style.left = `${Math.min(innerWidth - 190, Math.max(8, r.left + r.width / 2 - 90))}px`; pop.style.top = `${Math.max(8, r.top - 50)}px`;
    pop.dataset.text = text.slice(0, 400); saved = sel.getRangeAt(0).cloneRange(); pop.hidden = false;
  };
  prose.addEventListener("pointerup", () => setTimeout(check, 20)); prose.addEventListener("keyup", check);
  const away = (e) => { if (!pop.contains(e.target)) hide(); };
  document.addEventListener("pointerdown", away);
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const text = pop.dataset.text; hide();
    if (b.dataset.a === "ask") { openTutor({ mode: "ask", topic: tid }); setTimeout(() => sendChat(`Explain this simply: "${text}"`), 450); return; }
    if (!canPremium()) return needPlans("Highlights");
    const done = wrapRange(saved, b.dataset.h);
    ls.set(hlKey(tid), [...ls.get(hlKey(tid), []), ...done].slice(-60)); getSelection().removeAllRanges(); updateHl();
  });
  applyHighlights(prose, tid);
  bar.insertAdjacentHTML("afterbegin", `<button class="btn" id="rd-hl" type="button">🖍️ Highlights <span id="rd-hln"></span></button><button class="btn" id="rd-rw" type="button">✨ Rewrite ${planTag("plus")}</button>`);
  const updateHl = () => { const n = ls.get(hlKey(tid), []).length; $("#rd-hln").textContent = n ? `(${n})` : ""; };
  updateHl();
  $("#rd-hl").addEventListener("click", () => highlightsSheet(tid, prose));
  $("#rd-rw").addEventListener("click", () => rewriteSheet(tid));
  const prev = S.cleanup;
  S.cleanup = () => { prev?.(); pop.remove(); document.removeEventListener("pointerdown", away); token++; };
}
