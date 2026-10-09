/* Cramly tools 2: glossary, exam predictor, mix-ups (set level); boost, practice lab, answer grader, my notes (topic level);
   sharing. The Plus ones say so in the sidebar; the server decides who may use them. Loaded after tools.js. */
"use strict";

const planTag = (p) => (p === "plus" ? '<span class="ptag plus">PLUS</span>' : p === "free" ? '<span class="ptag free">FREE</span>' : '<span class="ptag prem">PREMIUM</span>');
function toolHead(eyebrow, title, sub = "") {
  return `<div class="home-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ""}</div></div>`;
}

/* ============================================================ glossary */
async function glossaryView() {
  const { set } = S.cur;
  shell({ tab: "glossary", set, tutor: true, crumbs: crumbsFor(set, { text: "Glossary" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Collecting the key terms… (about 10 seconds the first time)")}</div>`;
  let d;
  try { d = await api(`/api/sets/${set.id}/glossary`); } catch (e) { return failView("Could not make the glossary", e); }
  let hide = false, q = "";
  const draw = () => {
    const rows = d.terms.filter((t) => !q || `${t.term} ${t.definition}`.toLowerCase().includes(q));
    $("#gl-list").innerHTML = rows.map((t) => `<details class="term ${hide ? "hidden-def" : ""}" ${hide ? "" : "open"}><summary dir="auto"><b>${esc(t.term)}</b></summary><p dir="auto">${esc(t.definition)}</p></details>`).join("") || '<p class="muted pad">No term matches.</p>';
    $("#gl-count").textContent = `${rows.length} of ${d.terms.length} terms`;
  };
  $("#view").innerHTML = `<div class="wide glossary">${toolHead(set.title, "Glossary 📖", "Every key term in one place. Switch on test mode and tap a term to check yourself.")}
    <div class="gl-bar"><input id="gl-q" placeholder="Search terms" aria-label="Search terms"><label class="switch"><input type="checkbox" id="gl-test"><span>Test myself</span></label><span class="muted small" id="gl-count"></span></div>
    <div id="gl-list" class="gl-list"></div></div>`;
  $("#gl-q").addEventListener("input", (e) => { q = e.target.value.toLowerCase(); draw(); });
  $("#gl-test").addEventListener("change", (e) => { hide = e.target.checked; draw(); });
  draw();
}

/* ============================================================ mix-ups */
async function mixupsView() {
  const { set } = S.cur;
  shell({ tab: "mixups", set, tutor: true, crumbs: crumbsFor(set, { text: "Mix-ups" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Finding what students confuse… (about 10 seconds the first time)")}</div>`;
  let d;
  try { d = await api(`/api/sets/${set.id}/mixups`); } catch (e) { return failView("Could not find the mix-ups", e); }
  $("#view").innerHTML = `<div class="wide">${toolHead(set.title, "Mix-ups 🔀", "Pairs of ideas that students swap in the exam, and the trick to tell them apart.")}
    <div class="mix-grid">${d.pairs.map((p) => `<article class="mix"><div class="vs"><b dir="auto">${esc(p.a)}</b><span>vs</span><b dir="auto">${esc(p.b)}</b></div>
      <p dir="auto">${esc(p.difference)}</p><div class="tip" dir="auto">💡 ${esc(p.tip)}</div></article>`).join("")}</div>
    <div class="row"><button class="btn" id="mx-new">${ic("refresh")} Find more</button></div></div>`;
  $("#mx-new").addEventListener("click", async () => {
    try { d = await api(`/api/sets/${set.id}/mixups?fresh=1`); mixupsView(); } catch (e) { toast(e.message, true); }
  });
}

/* ============================================================ exam predictor */
async function predictorView() {
  const { set } = S.cur;
  shell({ tab: "predictor", set, tutor: true, crumbs: crumbsFor(set, { text: "Exam predictor" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Thinking like your examiner… (about 15 seconds the first time)")}</div>`;
  let d;
  try { d = await api(`/api/sets/${set.id}/predictor`); } catch (e) { return failView("Could not predict the exam", e); }
  $("#view").innerHTML = `<div class="wide predictor"><div class="cheat-bar noprint"><a class="btn" href="#/set/${set.id}">← Back</a><span class="grow"></span>
      <button class="btn" id="pr-new">${ic("refresh")} New predictions</button><button class="btn primary" id="pr-print">${ic("print")} Print</button></div>
    ${toolHead(set.title, "Exam predictor 🔮", "The questions an examiner is most likely to ask, with full-mark answers. Try to answer first, then reveal.")}
    <div class="pr-list">${d.questions.map((q, i) => `<article class="pr-q"><header><span class="n">${i + 1}</span><span class="marks">${q.marks} mark${q.marks === 1 ? "" : "s"}</span><small>${esc(q.topic)}</small></header>
      <h3 dir="auto">${esc(q.q)}</h3><p class="why muted small" dir="auto">Why it is likely: ${esc(q.why_likely)}</p>
      <details><summary>Show the model answer</summary><div class="model" dir="auto">${md(q.answer)}</div></details></article>`).join("")}</div></div>`;
  $("#pr-print").addEventListener("click", () => { $$(".pr-q details").forEach((x) => (x.open = true)); window.print(); });
  $("#pr-new").addEventListener("click", async () => {
    try { await api(`/api/sets/${set.id}/predictor?fresh=1`); predictorView(); } catch (e) { toast(e.message, true); }
  });
}

/* ============================================================ topic tools: boost, practice lab, answer grader, my notes */
const topicCrumbs = (set, t, name) => crumbsFor(set, { text: t.title, href: `#/set/${set.id}/t/${t.id}/read` }, { text: name });
function topicShell(tid, name) {
  const { set } = S.cur, t = topicById(tid);
  if (!t) { go(`#/set/${set.id}`); return null; }
  setActive(tid);
  shell({ tab: "set", set, topicId: tid, tutor: true, crumbs: topicCrumbs(set, t, name) });
  return { set, t };
}
async function boostView(tid) {
  const ctx = topicShell(tid, "Memory boost");
  if (!ctx) return;
  $("#view").innerHTML = `<div class="session">${skeleton("Finding good ways to remember it…")}</div>`;
  let d;
  try { d = (await api(`/api/topics/${tid}/boost`)).boost; } catch (e) { return failView("Could not make the boost", e); }
  const list = (items, icon) => items.map((x) => `<li dir="auto"><span>${icon}</span>${esc(x)}</li>`).join("");
  $("#view").innerHTML = `<div class="wide">${toolHead(ctx.t.title, "Memory boost 🧠", "Analogies, tricks and one real example so it sticks.")}
    <div class="boost-grid"><section class="bcard a"><h3>Analogies</h3><ul>${list(d.analogies, "🔗")}</ul></section>
      <section class="bcard b"><h3>Mnemonics</h3><ul>${list(d.mnemonics, "🎵")}</ul></section>
      <section class="bcard c"><h3>Real-world example</h3><p dir="auto">${esc(d.example)}</p></section>
      <section class="bcard d"><h3>Common mistake</h3><p dir="auto">⚠️ ${esc(d.common_mistake)}</p></section></div></div>`;
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
async function labView(tid) {
  const ctx = topicShell(tid, "Practice lab");
  if (!ctx) return;
  $("#view").innerHTML = `<div class="session">${skeleton("Setting up your lightning round…")}</div>`;
  let lab;
  try { lab = (await api(`/api/topics/${tid}/lab`)).lab; } catch (e) { return failView("Could not set up the lab", e); }
  const deck = [...lab.cloze.map((c) => ({ kind: "cloze", ...c })), ...lab.tf.map((c) => ({ kind: "tf", ...c }))].sort(() => Math.random() - 0.5);
  let i = 0, score = 0, answered = false;
  const wrong = [];
  const draw = () => {
    const c = deck[i];
    $("#view").innerHTML = `<div class="session"><div class="s-top"><a class="icon-btn" href="#/set/${ctx.set.id}" aria-label="Close">✕</a><div class="bar"><i style="width:${pct(i, deck.length)}%"></i></div><small>${i + 1} / ${deck.length}</small></div>
      <div class="q-card lab-card"><p class="topic">${c.kind === "cloze" ? "Fill in the blank" : "True or false?"}</p>
        <h3 dir="auto">${esc(c.kind === "cloze" ? c.text : c.statement)}</h3>
        ${c.kind === "cloze" ? `<input id="lab-in" autocomplete="off" placeholder="Type the missing word" aria-label="Answer"><small class="muted">Hint: ${esc(c.hint)}</small><button class="btn primary" id="lab-go" type="button">Check</button>`
          : `<div class="tf"><button class="btn big" data-v="true">✅ True</button><button class="btn big" data-v="false">❌ False</button></div>`}
        <div id="lab-fb"></div></div></div>`;
    answered = false;
    if (c.kind === "cloze") { $("#lab-in").focus(); $("#lab-go").addEventListener("click", () => settle(norm($("#lab-in").value) === norm(c.answer) || (norm(c.answer).length > 3 && norm($("#lab-in").value).includes(norm(c.answer))))); $("#lab-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#lab-go").click(); }); }
    else $$(".tf button").forEach((b) => b.addEventListener("click", () => settle((b.dataset.v === "true") === c.answer)));
  };
  const settle = (ok) => {
    if (answered) return;
    answered = true;
    const c = deck[i];
    if (ok) score++; else wrong.push(c);
    $("#lab-fb").innerHTML = `<div class="why ${ok ? "ok" : "no"}" dir="auto">${ok ? "✅ Correct. " : "❌ Not quite. "}${c.kind === "cloze" ? `Answer: <b>${esc(c.answer)}</b>` : esc(c.why)}</div><button class="btn primary big" id="lab-next" type="button">${i + 1 < deck.length ? "Next →" : "Finish"}</button>`;
    $$(".tf button, #lab-go, #lab-in").forEach((b) => (b.disabled = true));
    $("#lab-next").focus();
    $("#lab-next").addEventListener("click", () => { i++; if (i < deck.length) draw(); else finish(); });
  };
  const finish = () => {
    const p = pct(score, deck.length);
    try { addAura(Math.round(score * 2)); } catch { /* optional */ }
    if (p >= 80) confetti();
    $("#view").innerHTML = `<div class="session"><div class="result"><div class="ring" style="--p:${p};--c:${p >= 80 ? "var(--mint)" : p >= 50 ? "var(--sun)" : "var(--rose)"}">${p}%</div>
      <h2>${p >= 80 ? "Lightning fast ⚡" : p >= 50 ? "Getting there" : "Let us go again"}</h2><p>${score} of ${deck.length} right.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" id="lab-again">Another round</button><a class="btn" href="#/set/${ctx.set.id}">Done</a></div></div></div>`;
    $("#lab-again").addEventListener("click", () => labView(tid));
  };
  draw();
}

async function gradeView(tid) {
  const ctx = topicShell(tid, "Write and grade");
  if (!ctx) return;
  $("#view").innerHTML = `<div class="grader">${toolHead(ctx.t.title, "Write and grade ✍️", "Answer an exam-style question in your own words. You get a mark, what you got right, what to fix, and a stronger version.")}
    <div class="solve-card"><div class="row" style="margin:0"><button class="btn primary" id="gr-new" type="button">${ic("sparkle")} Give me a question</button><span class="muted small">or type your own below</span></div>
      <label>Question<input id="gr-q" maxlength="500" placeholder="The question you are answering" dir="auto"></label>
      <label>Your answer<textarea id="gr-a" rows="7" placeholder="Write 3 to 6 sentences, as you would in the exam." dir="auto"></textarea></label>
      <div class="row" style="margin:0"><button class="btn primary big" id="gr-go" type="button">Grade my answer</button><span class="muted small" id="gr-count">0 words</span></div></div>
    <div id="gr-out"></div></div>`;
  const words = () => ($("#gr-a").value.trim().match(/\S+/g) || []).length;
  $("#gr-a").addEventListener("input", () => { $("#gr-count").textContent = `${words()} words`; });
  $("#gr-new").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { $("#gr-q").value = (await api(`/api/topics/${tid}/prompt`, { body: {} })).prompt; $("#gr-a").focus(); } catch (err) { toast(err.message, true); }
    b.disabled = false;
  });
  $("#gr-go").addEventListener("click", async (e) => {
    const b = e.currentTarget, prompt = $("#gr-q").value.trim(), answer = $("#gr-a").value.trim();
    if (!prompt) return toast("Add a question first, or press Give me a question.", true);
    if (answer.length < 20) return toast("Write a little more first.", true);
    b.disabled = true; b.textContent = "Marking…";
    $("#gr-out").innerHTML = skeleton("Marking your answer… (about 8 seconds)");
    try {
      const r = await api(`/api/topics/${tid}/grade`, { body: { prompt, answer } });
      const good = r.score >= 75;
      $("#gr-out").innerHTML = `<div class="grade-card"><div class="ring" style="--p:${r.score};--c:${good ? "var(--mint)" : r.score >= 50 ? "var(--sun)" : "var(--rose)"}">${r.score}</div><div><h2 dir="auto">${esc(r.verdict)}</h2>
        <p class="muted">${good ? "Strong answer." : r.score >= 50 ? "A solid start. Fix the points below." : "Needs work. Use the fixes and the model answer."}</p></div></div>
        <div class="two"><section class="panel"><h3>What you got right</h3><ul class="tick">${r.strengths.map((s) => `<li dir="auto">✅ ${esc(s)}</li>`).join("") || "<li>Keep going.</li>"}</ul></section>
          <section class="panel"><h3>What to fix</h3><ul class="tick">${r.fixes.map((s) => `<li dir="auto">🔧 ${esc(s)}</li>`).join("") || "<li>Nothing major.</li>"}</ul></section></div>
        <section class="panel"><h3>A stronger version</h3><div class="model" dir="auto">${md(r.improved)}</div><div class="row"><button class="btn small" id="gr-copy" type="button">${ic("copy")} Copy</button></div></section>`;
      $("#gr-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.improved); toast("Copied"); } catch { toast("Could not copy", true); } });
      try { addAura(Math.round(r.score / 5)); } catch { /* optional */ }
      if (good) confetti();
    } catch (err) { $("#gr-out").innerHTML = `<div class="note-card">${esc(err.message)}</div>`; }
    b.disabled = false; b.textContent = "Grade my answer";
  });
}

/* ============================================================ my notes (free): your own words, saved as you type */
async function notesView(tid) {
  const ctx = topicShell(tid, "My notes");
  if (!ctx) return;
  let text = "";
  try { text = (await api(`/api/topics/${tid}/mynotes`)).text; } catch (e) { return failView("Could not open your notes", e); }
  $("#view").innerHTML = `<div class="notes-wrap">${toolHead(ctx.t.title, "My notes 📝", "Your own words. Saved automatically, and always free.")}
    <div class="notes-bar"><div class="seg"><button class="on" data-m="edit">Write</button><button data-m="view">Preview</button></div><span class="muted small" id="nt-state">Saved</span><span class="grow"></span><span class="muted small" id="nt-count"></span></div>
    <textarea id="nt-text" class="notes-area" placeholder="Write anything here. Use # for headings and - for lists." dir="auto"></textarea><div id="nt-view" class="notes-view" hidden dir="auto"></div></div>`;
  const ta = $("#nt-text"), count = () => { $("#nt-count").textContent = `${(ta.value.trim().match(/\S+/g) || []).length} words`; };
  ta.value = text; count();
  let timer = 0;
  const save = async () => {
    try { await api(`/api/topics/${tid}/mynotes`, { method: "PUT", body: { text: ta.value } }); $("#nt-state").textContent = "Saved"; } catch (e) { $("#nt-state").textContent = "Not saved"; toast(e.message, true); }
  };
  ta.addEventListener("input", () => { count(); $("#nt-state").textContent = "Saving…"; clearTimeout(timer); timer = setTimeout(save, 700); });
  S.cleanup = () => { clearTimeout(timer); if ($("#nt-state")?.textContent === "Saving…") save(); };
  $$(".notes-bar [data-m]").forEach((b) => b.addEventListener("click", () => {
    const view = b.dataset.m === "view";
    $$(".notes-bar [data-m]").forEach((x) => x.classList.toggle("on", x === b));
    ta.hidden = view; $("#nt-view").hidden = !view;
    if (view) $("#nt-view").innerHTML = md(ta.value) || '<p class="muted">Nothing yet.</p>';
  }));
}

/* ============================================================ sharing a study set (Plus), and opening a shared link */
async function shareSheet(set) {
  let d;
  try { d = await api(`/api/sets/${set.id}/share`, { body: { on: true } }); } catch (e) { return toast(e.message, true); }
  sheet(`<h3>${ic("sparkle")} Share ${esc(set.title)}</h3><p class="muted">Anyone with this link can look at the set and copy it into their own Cramly. They get their own copy with no progress, and your notes stay private.</p>
    <div class="share-box"><code id="sh-link">${esc(d.link)}</code></div>
    <div class="sheet-actions"><button class="btn danger" id="sh-off" type="button">Stop sharing</button><button class="btn primary" id="sh-copy" type="button">${ic("copy")} Copy link</button></div>`, () => {
    $("#sh-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(d.link); toast("Link copied"); } catch { prompt("Copy this link:", d.link); } });
    $("#sh-off").addEventListener("click", async () => { try { await api(`/api/sets/${set.id}/share`, { body: { on: false } }); toast("Sharing is off"); closeSheet(); } catch (e) { toast(e.message, true); } });
  });
}
async function handleShareLink(token) {
  history.replaceState(null, "", "/");
  let d;
  try { d = await api(`/api/shared/${token}`); } catch (e) { return sheet(`<h3>That link is not shared any more</h3><p class="muted">${esc(e.message)}</p><div class="sheet-actions"><button class="btn primary" data-close>OK</button></div>`); }
  sheet(`<h3>${esc(d.emoji)} ${esc(d.title)}</h3><p class="muted">A friend shared this study set with you. ${d.topics.length} topics:</p>
    <ul class="share-topics">${d.topics.slice(0, 12).map((t) => `<li dir="auto"><b>${esc(t.title)}</b><small>${esc(t.summary)}</small></li>`).join("")}</ul>
    <div class="sheet-actions"><button class="btn" data-close>Not now</button><button class="btn primary" id="sh-add" type="button">Add to my Cramly</button></div>`, () => {
    $("#sh-add").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        if (!key) { const a = await api("/api/account", { body: { name: "" } }); key = a.key; ls.set("cramly.key", key); }
        const r = await api(`/api/shared/${token}/import`, { body: {} });
        closeSheet(); S.sets = []; S.cur = null; toast("Added to your study sets 🎉"); await boot(); go(`#/set/${r.id}`);
      } catch (err) { toast(err.message, true); e.currentTarget.disabled = false; }
    });
  });
}
