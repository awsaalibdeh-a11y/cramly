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
