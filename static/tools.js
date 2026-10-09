/* Cramly study tools: listen (podcast), mind map, cheat sheet, snap and solve, exam builder, progress, flashcard editor.
   Loaded after premium.js. app.js routes into these views and the shell links to them. */
"use strict";

S.examTimer = 0;
window.leaveView = () => {                                   // called by route() before every view and by the paywall
  try { speechSynthesis.cancel(); } catch { /* no speech */ }
  if (S.player) S.player.tk++;
  S.player = null;
  if (S.examTimer) { clearInterval(S.examTimer); S.examTimer = 0; }
  S.cleanup?.(); S.cleanup = null;
};
const crumbsFor = (set, ...rest) => [{ text: "Home", href: "#/" }, { text: set.title, href: `#/set/${set.id}` }, ...rest];
const failView = (title, e, retry = "route()") => { $("#view").innerHTML = `<div class="empty-hero"><div class="owl">🙈</div><h2>${esc(title)}</h2><p>${esc(e.message || e)}</p><button class="btn primary" onclick="${retry}">Try again</button></div>`; };
const prettyDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString([], { day: "numeric", month: "short" });

/* ---------- entry points ---------- */
function moreTools(set) {
  const id = set.id;
  const card = (href, art, name, sub, plan, bg) => `<a class="mode" style="--bg:${bg}" href="${href}"><div class="art">${art}</div><div class="txt"><small>${sub}</small><b>${name} ${planTag(plan)}</b></div></a>`;
  return `<h2 class="sec">Study tools <small>Premium and Premium Plus</small></h2>
    <div class="modes four tools">
      ${card(`#/set/${id}/map`, "🕸️", "Mind map", "See the big picture", "premium", "var(--sky-bg)")}
      ${card(`#/set/${id}/schedule`, "🗓️", "Study schedule", "Day by day to the exam", "premium", "var(--mint-bg)")}
      ${card(`#/set/${id}/cheat`, "📄", "Cheat sheet", "One page, printable", "premium", "var(--butter)")}
      ${card(`#/set/${id}/exam`, "⏱️", "Exam builder", "Timed, your topics", "premium", "var(--peach)")}
      ${card(`#/set/${id}/glossary`, "📖", "Glossary", "Every key term", "premium", "var(--lilac-2)")}
      ${card(`#/set/${id}/mistakes`, "📓", "Mistake notebook", "Retry what you missed", "premium", "var(--rose-bg)")}
      ${card(`#/set/${id}/type`, "⌨️", "Typing practice", "Recall, do not flip", "premium", "var(--sky-bg)")}
      ${card(`#/drill`, "🎯", "Smart drill", "Your weakest cards", "premium", "var(--peach)")}
      ${card(`#/set/${id}/print`, "🖨️", "Print flashcards", "Cut-out cards", "premium", "var(--butter)")}
      ${card(`#/quickcards`, "🃏", "Quick cards", "Any text to flashcards", "premium", "var(--mint-bg)")}
      ${card(`#/summarize`, "📝", "Summariser", "Paste, get the gist", "premium", "var(--butter)")}
      ${card(`#/solve/${id}`, "📸", "Snap and solve", "Photo to answer", "premium", "var(--rose-bg)")}
      ${card(`#/set/${id}/predictor`, "🔮", "Exam predictor", "Likely questions", "plus", "var(--lilac-2)")}
      ${card(`#/set/${id}/mixups`, "🔀", "Mix-ups", "Tell look-alikes apart", "plus", "var(--peach)")}
      ${card(`#/set/${id}/outline`, "✍️", "Essay outline", "Plan any long answer", "plus", "var(--sky-bg)")}
      ${card(`#/set/${id}/guide`, "📚", "Study guide", "Everything in one doc", "plus", "var(--mint-bg)")}
      ${card(`#/report`, "📊", "Weekly report", "How your week went", "plus", "var(--rose-bg)")}
      <button class="mode" id="share-set" type="button" style="--bg:var(--sky-bg)"><div class="art">🔗</div><div class="txt"><small>Send it to a friend</small><b>Share this set ${planTag("plus")}</b></div></button>
    </div>`;
}
function toolsStrip() {
  return `<div class="tools-strip">
    <a href="#/solve" style="--bg:var(--rose-bg)"><span>📸</span><div><b>Snap and solve</b><small>Photo of a question, worked answer</small></div></a>
    <a href="#/progress" style="--bg:var(--mint-bg)"><span>📈</span><div><b>Your progress</b><small>Streaks, heatmap, weak spots</small></div></a>
    <a href="#/review" style="--bg:var(--butter)"><span>🃏</span><div><b>Daily review</b><small>Cards that are due today</small></div></a></div>`;
}
/* app.js calls these from route() for the new URLs; each returns the view's promise, or undefined if the URL is not theirs */
function setRoute(sub) {
  if (sub === "map") return mapView();
  if (sub === "cheat") return cheatView();
  if (sub === "exam") return examView();
  if (sub === "type") return typeView();
  if (sub === "schedule") return scheduleView();
  if (sub === "mistakes") return Promise.resolve(mistakesView());
  if (sub === "print") return printCardsView();
  if (sub === "outline") return outlineView();
  if (sub === "guide") return guideView();
  if (sub === "glossary") return glossaryView();
  if (sub === "predictor") return predictorView();
  if (sub === "mixups") return mixupsView();
  return undefined;
}
function topicRoute(kind, sub, tid) {
  if (kind === "listen") return listenView(tid);
  if (kind === "cards" && sub === "edit") return cardEditView(tid);
  if (kind === "boost") return boostView(tid);
  if (kind === "lab") return labView(tid);
  if (kind === "grade") return gradeView(tid);
  if (kind === "notes") return notesView(tid);
  return undefined;
}
function globalRoute(p) {
  if (p[0] === "solve") return solveView(+p[1] || 0);
  if (p[0] === "progress") return statsView();
  if (p[0] === "focus") return Promise.resolve(focusView());
  if (p[0] === "drill") return drillView();
  if (p[0] === "report") return reportView();
  if (p[0] === "summarize") return summarizeView();
  if (p[0] === "quickcards") return quickCardsView();
  return undefined;
}

/* ============================================================ listen: a two-host podcast of one topic */
const HOSTS = { A: { name: "Sam", emoji: "🦊" }, B: { name: "Nova", emoji: "🦉" } };
function voicesFor(lang) {
  const all = (window.speechSynthesis?.getVoices?.() || []).filter((v) => v.lang.toLowerCase().startsWith(lang));
  const fem = all.find((v) => /female|zira|samantha|aria|jenny|libby|sonia|hazel|susan|karen|moira|google uk english female/i.test(v.name));
  const male = all.find((v) => v !== fem && /\bmale\b|david|mark|guy|daniel|ryan|alex|george|james|google uk english male/i.test(v.name));
  const a = fem || all[0], b = male || all.find((v) => v !== a) || a;
  return { A: a, B: b, same: a === b };
}
async function listenView(tid) {
  const { set } = S.cur, t = topicById(tid);
  if (!t) return go(`#/set/${set.id}`);
  setActive(tid);
  const crumbs = crumbsFor(set, { text: t.title }, { text: "Listen" });
  shell({ tab: "set", set, topicId: tid, tutor: true, crumbs });
  $("#view").innerHTML = `<div class="session">${skeleton("Recording your episode… (about 15 seconds the first time)")}</div>`;
  let ep;
  try { ep = await api(`/api/topics/${tid}/podcast`); } catch (e) { return failView("Could not make the episode", e); }
  const can = "speechSynthesis" in window;
  const P = S.player = { i: -1, playing: false, rate: ls.get("cramly.rate", 1), tk: 0 };
  const mins = Math.max(1, Math.round(ep.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0) / 150));
  $("#view").innerHTML = `<div class="listen">
    <div class="ep-head"><div class="ep-art">🎧</div><div><p class="eyebrow">Episode · ${esc(ep.topic)}</p><h1 dir="auto">${esc(ep.title)}</h1>
      <div class="hosts"><span>${HOSTS.A.emoji} ${HOSTS.A.name}</span><span>${HOSTS.B.emoji} ${HOSTS.B.name}</span><span class="muted">${ep.lines.length} lines · about ${mins} min</span></div></div></div>
    ${can ? "" : `<div class="note-card">Your browser cannot read aloud, but you can read the episode below.</div>`}
    <div class="lines" id="lines">${ep.lines.map((l, k) => `<button class="line ${l.host}" data-k="${k}" dir="auto"><span class="who">${HOSTS[l.host].emoji}</span><span class="say"><small>${HOSTS[l.host].name}</small>${esc(l.text)}</span></button>`).join("")}</div>
    <div class="player" id="player"><button class="icon-btn big" id="p-prev" aria-label="Previous line">⏮</button><button class="play" id="p-play" aria-label="Play">${ic("play")}</button><button class="icon-btn big" id="p-next" aria-label="Next line">⏭</button>
      <div class="p-bar"><i id="p-fill"></i></div><button class="chip-btn" id="p-rate" title="Speed">1×</button></div>
    <div class="ep-end" id="ep-end" hidden><b>That is the episode 🎉</b><p class="muted">Lock it in with a quick quiz or the flashcards.</p>
      <div class="row"><a class="btn primary" href="#/set/${set.id}/t/${tid}/quiz">Quiz me on this</a><a class="btn" href="#/set/${set.id}/t/${tid}/cards">Flashcards</a></div></div></div>`;
  const lines = $$(".line"), fill = $("#p-fill"), playBtn = $("#p-play");
  const paint = () => {
    lines.forEach((el, k) => el.classList.toggle("now", k === P.i));
    fill.style.width = `${P.i < 0 ? 0 : ((P.i + 1) / ep.lines.length) * 100}%`;
    playBtn.innerHTML = ic(P.playing ? "pause" : "play"); playBtn.setAttribute("aria-label", P.playing ? "Pause" : "Play");
    $("#p-rate").textContent = `${P.rate}×`;
    if (P.i >= 0 && P.playing) lines[P.i]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const say = (i) => {
    if (S.player !== P) return;
    if (i >= ep.lines.length) { P.playing = false; P.i = ep.lines.length - 1; paint(); $("#ep-end").hidden = false; try { addAura(10); } catch { /* optional */ } return; }
    P.i = i; P.playing = true; paint();
    const line = ep.lines[i], tk = ++P.tk, ar = isArabic(line.text);
    if (!can) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line.text), v = voicesFor(ar ? "ar" : "en");
    u.lang = ar ? "ar-SA" : "en-US";
    if (v[line.host]) u.voice = v[line.host];
    u.rate = P.rate * (line.host === "A" ? 1.04 : 0.97);
    if (v.same) u.pitch = line.host === "A" ? 1.2 : 0.8;
    const next = () => { if (S.player === P && P.tk === tk && P.playing) say(i + 1); };
    u.onend = next;
    u.onerror = (ev) => { if (ev.error !== "canceled" && ev.error !== "interrupted") next(); };
    speechSynthesis.speak(u);
  };
  const pause = () => { P.playing = false; P.tk++; try { speechSynthesis.cancel(); } catch { /* ok */ } paint(); };
  playBtn.addEventListener("click", () => {
    if (P.playing) return pause();
    $("#ep-end").hidden = true;
    say(P.i < 0 || P.i >= ep.lines.length - 1 ? 0 : P.i);
  });
  $("#p-next").addEventListener("click", () => say(Math.min(ep.lines.length - 1, P.i + 1)));
  $("#p-prev").addEventListener("click", () => say(Math.max(0, P.i - 1)));
  $("#p-rate").addEventListener("click", () => {
    const r = [0.85, 1, 1.2, 1.5];
    P.rate = r[(r.indexOf(P.rate) + 1) % r.length]; ls.set("cramly.rate", P.rate); paint();
    if (P.playing) say(P.i);
  });
  lines.forEach((el) => el.addEventListener("click", () => say(+el.dataset.k)));
  if (can) speechSynthesis.getVoices();
  paint();
}

/* ============================================================ mind map: the study plan as a two-sided tree */
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function mapLayout(d, open) {
  const ROW = 32, GAP = 16, nodes = [], links = [];
  const half = Math.ceil(d.children.length / 2), hue0 = d.hue || 260;
  const sideH = [0, 0];
  const plan = [d.children.slice(0, half), d.children.slice(half)].map((list, si) => {
    let y = 0;
    const arr = list.map((t, idx) => {
      const leaves = open.has(t.id) ? t.children : [], rows = Math.max(1, leaves.length);
      const o = { t, leaves, top: y, rows, cy: y + (rows * ROW) / 2, gi: si === 0 ? idx : half + idx };
      y += rows * ROW + GAP;
      return o;
    });
    sideH[si] = Math.max(0, y - GAP);
    return arr;
  });
  const H = Math.max(sideH[0], sideH[1], 120);
  let minX = -120, maxX = 120;
  plan.forEach((arr, si) => {
    const dir = si === 0 ? 1 : -1, off = -sideH[si] / 2;
    arr.forEach((o) => {
      const label = trunc(o.t.title, 26) + (o.t.children.length ? (open.has(o.t.id) ? "  ▾" : "  ▸") : "");
      const tw = Math.min(240, 36 + label.length * 7.2), x = dir * (150 + tw / 2), y = off + o.cy, hue = (hue0 + o.gi * 31) % 360;
      nodes.push({ kind: "topic", id: o.t.id, x, y, w: tw, h: 38, text: label, full: o.t.title, hue, status: o.t.status });
      links.push({ x1: dir * 100, y1: 0, x2: dir * 150, y2: y, hue });
      minX = Math.min(minX, x - tw / 2); maxX = Math.max(maxX, x + tw / 2);
      o.leaves.forEach((l, k) => {
        const lw = Math.min(280, 30 + l.title.length * 6.6), lx = dir * (150 + tw + 46 + lw / 2), ly = off + o.top + k * ROW + ROW / 2;
        nodes.push({ kind: "leaf", x: lx, y: ly, w: lw, h: 26, text: trunc(l.title, 40), full: l.title, hue });
        links.push({ x1: dir * (150 + tw), y1: y, x2: dir * (150 + tw + 46), y2: ly, hue, thin: true });
        minX = Math.min(minX, lx - lw / 2); maxX = Math.max(maxX, lx + lw / 2);
      });
    });
  });
  return { nodes, links, box: { minX: minX - 30, maxX: maxX + 30, minY: -H / 2 - 30, maxY: H / 2 + 30 } };
}
function mapSvg(d, L, sel) {
  const rootText = `${d.emoji} ${trunc(d.title, 18)}`;
  const paths = L.links.map((l) => {
    const mx = (l.x1 + l.x2) / 2;
    return `<path d="M${l.x1} ${l.y1}C${mx} ${l.y1} ${mx} ${l.y2} ${l.x2} ${l.y2}" fill="none" stroke="hsl(${l.hue} 55% 68%)" stroke-width="${l.thin ? 1.6 : 2.6}" stroke-linecap="round"/>`;
  }).join("");
  const root = `<g class="mm-root"><rect x="-100" y="-30" width="200" height="60" rx="30"/><text text-anchor="middle" dy=".35em">${esc(rootText)}</text></g>`;
  const boxes = L.nodes.map((n) => {
    const attrs = n.kind === "topic" ? `data-id="${n.id}" tabindex="0" role="button"` : "";
    return `<g class="mm-node ${n.kind} ${n.id === sel ? "sel" : ""} s${n.status || 0}" ${attrs} style="--h:${n.hue}" transform="translate(${n.x} ${n.y})">
      <title>${esc(n.full)}</title><rect x="${-n.w / 2}" y="${-n.h / 2}" width="${n.w}" height="${n.h}" rx="${n.h / 2}"/><text text-anchor="middle" dy=".35em">${esc(n.text)}${n.status >= 2 ? " ✓" : ""}</text></g>`;
  }).join("");
  return paths + root + boxes;
}
async function mapView() {
  const { set } = S.cur;
  shell({ tab: "map", set, tutor: true, crumbs: crumbsFor(set, { text: "Mind map" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Drawing your mind map…")}</div>`;
  let d;
  try { d = await api(`/api/sets/${set.id}/mindmap`); } catch (e) { return failView("Could not draw the map", e); }
  if (!d.children.length) return failView("Nothing to map yet", "Add some material and the map appears.");
  const open = new Set(d.children.length <= 6 ? d.children.map((c) => c.id) : []);
  let sel = d.children[0].id, L = mapLayout(d, open);
  $("#view").innerHTML = `<div class="wide mapview"><div class="home-head"><div><p class="eyebrow">${esc(set.title)}</p><h1>Mind map</h1></div>
      <div class="map-tools"><button class="btn small" id="mm-all">Open all</button><button class="btn small" id="mm-none">Close all</button><button class="btn small" id="mm-fit">Fit</button></div></div>
    <div class="map-box"><svg id="mm" role="img" aria-label="Mind map of ${esc(set.title)}"><g id="mm-g"></g></svg>
      <div class="map-zoom"><button class="icon-btn" id="mm-in" aria-label="Zoom in">+</button><button class="icon-btn" id="mm-out" aria-label="Zoom out">−</button></div></div>
    <p class="muted small map-hint">Drag to move, pinch or scroll to zoom, tap a topic to open or close its ideas.</p><div id="mm-info"></div></div>`;
  const svg = $("#mm"), g = $("#mm-g"), vp = { x: 0, y: 0, k: 1 };
  const apply = () => g.setAttribute("transform", `translate(${vp.x} ${vp.y}) scale(${vp.k})`);
  const fit = () => {
    const w = svg.clientWidth, h = svg.clientHeight, b = L.box, small = w < 700;
    vp.k = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY), 1.1);
    if (small) vp.k = Math.max(vp.k, 0.6);
    vp.x = small ? w / 2 : w / 2 - ((b.minX + b.maxX) / 2) * vp.k;
    vp.y = h / 2 - ((b.minY + b.maxY) / 2) * vp.k;
    apply();
  };
  const draw = (refit) => {
    L = mapLayout(d, open);
    g.innerHTML = mapSvg(d, L, sel);
    if (refit) fit();
    const t = topicById(sel);
    $("#mm-info").innerHTML = t ? `<div class="map-info"><div><b dir="auto">${esc(t.title)}</b><p dir="auto">${esc(t.summary)}</p></div>
      <div class="row"><a class="btn small" href="#/set/${set.id}/t/${t.id}/listen">${ic("headphones")} Listen</a><a class="btn small" href="#/set/${set.id}/t/${t.id}/cards">${ic("cards")} Cards</a><a class="btn small primary" href="#/set/${set.id}/t/${t.id}/quiz">${ic("test")} Quiz</a></div></div>` : "";
  };
  const zoomAt = (cx, cy, f) => {
    const nk = Math.min(2.5, Math.max(0.2, vp.k * f));
    vp.x = cx - (cx - vp.x) * (nk / vp.k); vp.y = cy - (cy - vp.y) * (nk / vp.k); vp.k = nk; apply();
  };
  const toggle = (id) => { if (open.has(id)) open.delete(id); else open.add(id); sel = id; draw(false); };
  const ptrs = new Map();
  let moved = 0, pinch = 0;
  svg.addEventListener("pointerdown", (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; pinch = 0; });
  svg.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    if (ptrs.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...ptrs.values()], nd = Math.hypot(a.x - b.x, a.y - b.y), r = svg.getBoundingClientRect();
      if (pinch) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, nd / pinch);
      pinch = nd; moved = 99;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) { vp.x += dx; vp.y += dy; apply(); }
    p.x = e.clientX; p.y = e.clientY;
  });
  const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up); svg.addEventListener("pointerleave", up);
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  svg.addEventListener("click", (e) => { const n = e.target.closest(".mm-node.topic"); if (n && moved < 7) toggle(+n.dataset.id); });
  svg.addEventListener("keydown", (e) => { const n = e.target.closest?.(".mm-node.topic"); if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(+n.dataset.id); } });
  $("#mm-in").addEventListener("click", () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.25));
  $("#mm-out").addEventListener("click", () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 0.8));
  $("#mm-fit").addEventListener("click", fit);
  $("#mm-all").addEventListener("click", () => { d.children.forEach((c) => open.add(c.id)); draw(true); });
  $("#mm-none").addEventListener("click", () => { open.clear(); draw(true); });
  draw(true);
}

/* ============================================================ cheat sheet: one printable page */
async function cheatView(fresh = false) {
  const { set } = S.cur;
  shell({ tab: "cheat", set, tutor: false, crumbs: crumbsFor(set, { text: "Cheat sheet" }) });
  $("#view").innerHTML = `<div class="session">${skeleton(fresh ? "Rewriting your cheat sheet…" : "Writing your one-page cheat sheet… (about 15 seconds the first time)")}</div>`;
  let d;
  try { d = await api(`/api/sets/${set.id}/cheatsheet${fresh ? "?fresh=1" : ""}`); } catch (e) { return failView("Could not write the cheat sheet", e); }
  $("#view").innerHTML = `<div class="cheat-wrap"><div class="cheat-bar noprint"><a class="btn" href="#/set/${set.id}">← Back</a><span class="grow"></span>
      <button class="btn" id="ch-copy">${ic("copy")} Copy</button><button class="btn" id="ch-new">${ic("refresh")} Rewrite</button><button class="btn primary" id="ch-print">${ic("print")} Print or save PDF</button></div>
    <article class="cheat" dir="auto"><header><span class="ch-emoji">${esc(set.emoji)}</span><div><h1>${esc(d.title)}</h1><small>Cheat sheet · made with Cramly</small></div></header>
      <div class="cheat-body">${md(d.sheet)}</div></article></div>`;
  $("#ch-print").addEventListener("click", () => window.print());
  $("#ch-new").addEventListener("click", () => cheatView(true));
  $("#ch-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(d.sheet); toast("Copied"); } catch { toast("Could not copy", true); } });
}

/* ============================================================ snap and solve: a photo or typed question, worked out */
function shrinkImage(file, max = 1600) {
  return new Promise((resolve) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b || file), "image/jpeg", 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function solveView(setId = 0) {
  shell({ tab: "solve", crumbs: [{ text: "Home", href: "#/" }, { text: "Snap and solve" }] });
  if (!S.sets.length) S.sets = (await api("/api/sets").catch(() => ({ sets: [] }))).sets;
  let photo = null;
  const recent = () => ls.get("cramly.solves", []);
  $("#view").innerHTML = `<div class="solve"><div class="home-head"><div><p class="eyebrow">Premium tool</p><h1>Snap and solve 📸</h1>
      <p class="muted">Take a photo of any question, or type it. You get the worked steps, not just the answer.</p></div></div>
    <div class="solve-card"><div class="snap-row"><label class="snap-btn" for="sv-cam">${ic("camera")}<b>Take a photo</b><small>or choose one</small></label>
        <input id="sv-cam" type="file" accept="image/*" capture="environment" hidden><input id="sv-file" type="file" accept="image/*" hidden>
        <button class="snap-btn" id="sv-pick" type="button">${ic("upload")}<b>Upload image</b><small>or paste one</small></button></div>
      <div class="sv-prev" id="sv-prev" hidden><img id="sv-img" alt="Your question"><button class="icon-btn" id="sv-x" aria-label="Remove photo">✕</button></div>
      <label>Or type the question<textarea id="sv-text" rows="3" maxlength="3000" placeholder="e.g. A car goes from 0 to 20 m/s in 8 s. What is its acceleration?"></textarea></label>
      <label>Use my notes from<select id="sv-set"><option value="0">No study set</option>${S.sets.map((s) => `<option value="${s.id}" ${s.id === setId ? "selected" : ""}>${esc(s.emoji)} ${esc(s.title)}</option>`).join("")}</select></label>
      <button class="btn primary big" id="sv-go" type="button">Solve it ✨</button></div>
    <div id="sv-out"></div>
    ${recent().length ? `<h2 class="sec">Recent <small>on this device</small></h2><div class="recent">${recent().map((r, k) => `<button class="rec" data-k="${k}" dir="auto"><b>${esc(r.q)}</b><small>${esc(r.final)}</small></button>`).join("")}</div>` : ""}</div>`;
  const setPhoto = async (f) => {
    if (!f || !f.type.startsWith("image/")) return;
    photo = await shrinkImage(f);
    $("#sv-img").src = URL.createObjectURL(photo); $("#sv-prev").hidden = false;
  };
  $("#sv-cam").addEventListener("change", (e) => setPhoto(e.target.files[0]));
  $("#sv-file").addEventListener("change", (e) => setPhoto(e.target.files[0]));
  $("#sv-pick").addEventListener("click", () => $("#sv-file").click());
  $("#sv-x").addEventListener("click", () => { photo = null; $("#sv-prev").hidden = true; });
  const paste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); setPhoto(f); } };
  document.addEventListener("paste", paste);
  const show = (r, q) => {
    $("#sv-out").innerHTML = `<div class="answer"><p class="eyebrow">Final answer</p><h2 dir="auto">${esc(r.final)}</h2></div>
      <div class="solution" dir="auto">${md(r.solution)}</div>
      <div class="row"><button class="btn" id="sv-copy">${ic("copy")} Copy</button><button class="btn" id="sv-again">Another question</button></div>`;
    $("#sv-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(`${r.final}\n\n${r.solution}`); toast("Copied"); } catch { toast("Could not copy", true); } });
    $("#sv-again").addEventListener("click", () => { photo = null; $("#sv-prev").hidden = true; $("#sv-text").value = ""; $("#sv-out").innerHTML = ""; $("#view").scrollTo({ top: 0, behavior: "smooth" }); });
    $("#sv-out").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $$(".rec").forEach((b) => b.addEventListener("click", () => { const r = recent()[+b.dataset.k]; if (r) show(r, r.q); }));
  $("#sv-go").addEventListener("click", async () => {
    const text = $("#sv-text").value.trim();
    if (!photo && text.length < 5) return toast("Take a photo or type the question first.", true);
    const btn = $("#sv-go"); btn.disabled = true; btn.textContent = "Working it out…";
    $("#sv-out").innerHTML = skeleton("Solving step by step… (10 to 25 seconds)");
    try {
      const form = new FormData();
      if (photo) form.append("image", photo, "question.jpg");
      form.append("text", text); form.append("set_id", $("#sv-set").value);
      const r = await api("/api/solve", { form });
      show(r, text);
      ls.set("cramly.solves", [{ q: text || "Photo question", final: r.final, solution: r.solution }, ...recent()].slice(0, 6));
      try { addAura(15); } catch { /* optional */ }
    } catch (e) { $("#sv-out").innerHTML = `<div class="note-card">${esc(e.message)}</div>`; }
    btn.disabled = false; btn.textContent = "Solve it ✨";
  });
  S.cleanup = () => document.removeEventListener("paste", paste);
}

/* ============================================================ exam builder: pick topics, size, difficulty and a timer */
async function examView() {
  const { set, topics } = S.cur;
  shell({ tab: "exam", set, tutor: false, crumbs: crumbsFor(set, { text: "Exam builder" }) });
  const cfg = { ids: new Set(topics.map((t) => t.id)), n: 15, level: "mixed", mins: 0 };
  const opt = (name, vals) => `<div class="seg" data-seg="${name}">${vals.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join("")}</div>`;
  $("#view").innerHTML = `<div class="exam-cfg"><div class="home-head"><div><p class="eyebrow">${esc(set.title)}</p><h1>Exam builder ⏱️</h1>
      <p class="muted">Build the exam you want. Answers are hidden until the end, like the real thing.</p></div></div>
    <div class="cfg-card"><div class="cfg-head"><b>Topics</b><span><button class="link" id="ex-all" type="button">All</button> · <button class="link" id="ex-none" type="button">None</button></span></div>
      <div class="topic-chips" id="ex-topics">${topics.map((t) => `<button type="button" class="tchip on" data-id="${t.id}">${esc(t.title)}</button>`).join("")}</div></div>
    <div class="cfg-grid"><div class="cfg-card"><b>Questions</b>${opt("n", [[8, "8"], [15, "15"], [25, "25"], [30, "30"]])}</div>
      <div class="cfg-card"><b>Difficulty</b>${opt("level", [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["mixed", "Mixed"]])}</div>
      <div class="cfg-card"><b>Timer</b>${opt("mins", [[0, "Off"], [10, "10 min"], [20, "20 min"], [40, "40 min"]])}</div></div>
    <button class="btn primary big" id="ex-go" type="button">Start the exam →</button></div>`;
  const sync = () => {
    $$(".tchip").forEach((b) => b.classList.toggle("on", cfg.ids.has(+b.dataset.id)));
    $$("[data-seg]").forEach((seg) => $$("button", seg).forEach((b) => b.classList.toggle("on", String(cfg[seg.dataset.seg]) === b.dataset.v)));
    $("#ex-go").disabled = !cfg.ids.size;
  };
  $$(".tchip").forEach((b) => b.addEventListener("click", () => { const id = +b.dataset.id; if (cfg.ids.has(id)) cfg.ids.delete(id); else cfg.ids.add(id); sync(); }));
  $$("[data-seg] button").forEach((b) => b.addEventListener("click", () => { const k = b.parentElement.dataset.seg; cfg[k] = k === "level" ? b.dataset.v : +b.dataset.v; sync(); }));
  $("#ex-all").addEventListener("click", () => { cfg.ids = new Set(topics.map((t) => t.id)); sync(); });
  $("#ex-none").addEventListener("click", () => { cfg.ids.clear(); sync(); });
  $("#ex-go").addEventListener("click", async () => {
    if (cfg.ids.size > 10) toast("Using the first 10 topics you picked.");
    $("#view").innerHTML = `<div class="session">${skeleton("Writing your exam… (up to 25 seconds)")}</div>`;
    try {
      const { questions } = await api(`/api/sets/${set.id}/quiz`, { body: { topic_ids: [...cfg.ids], n: cfg.n, level: cfg.level } });
      quizSession({ title: "Exam", questions, backHref: `#/set/${set.id}/exam`, crumbs: crumbsFor(set, { text: "Exam" }), set, tab: "exam", exam: true, timeLimit: cfg.mins * 60,
        onDone: async (score, total, wrong) => {
          const by = {};
          questions.forEach((q) => { if (q.topic_id) (by[q.topic_id] ||= { n: 0, ok: 0 }).n++, by[q.topic_id].ok++; });
          wrong.forEach(({ q }) => { if (q.topic_id) by[q.topic_id].ok--; });
          for (const [id, v] of Object.entries(by)) if (v.n >= 2) await api(`/api/topics/${id}/event`, { body: { kind: "quiz", score: v.ok, total: v.n } }).catch(() => {});
          await refreshCur().catch(() => {});
        } });
    } catch (e) { failView("Could not build the exam", e); }
  });
  sync();
}

/* ============================================================ progress: heatmap, week, weak spots, badges */
async function statsView() {
  shell({ tab: "progress", crumbs: [{ text: "Home", href: "#/" }, { text: "Progress" }] });
  $("#view").innerHTML = `<div class="session">${skeleton("Adding it all up…")}</div>`;
  let d;
  try { d = await api("/api/stats?full=1"); } catch (e) { return failView("Could not load your progress", e); }
  const t = d.totals, lvl = levelFor(aura());
  const first = new Date(`${d.days[0].day}T12:00`).getDay();                  // weekday of the oldest cell: pads the first column
  const level = (n) => (n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);
  const cells = [...Array(first).fill(null), ...d.days];
  const week = d.days.slice(-7), top = Math.max(1, ...week.map((x) => x.n));
  const badges = [
    ["🔥", "3-day streak", d.best_streak >= 3], ["⚡", "7-day streak", d.best_streak >= 7], ["🌋", "30-day streak", d.best_streak >= 30],
    ["🃏", "100 card reviews", t.reviews >= 100], ["🏆", "First topic mastered", t.mastered >= 1], ["🎓", "5 topics mastered", t.mastered >= 5],
    ["🎯", "5 quizzes taken", t.quizzes >= 5], ["📚", "3 study sets", t.sets >= 3],
  ];
  const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  $("#view").innerHTML = `<div class="wide stats"><div class="home-head"><div><p class="eyebrow">Premium tool</p><h1>Your progress 📈</h1></div></div>
    <div class="stat-grid">${stat(d.streak, "day streak")}${stat(d.best_streak, "best streak")}${stat(d.active_days, "days studied")}${stat(t.reviews, "card reviews")}${stat(`${t.mastered}/${t.topics}`, "topics mastered")}${stat(lvl.name, "aura level")}</div>
    <div class="panel"><h3>Last 17 weeks</h3><div class="heat" role="img" aria-label="Study heatmap">${cells.map((c) => (c ? `<i class="l${level(c.n)}" title="${prettyDay(c.day)}: ${c.n} activities"></i>` : "<i class=\"pad\"></i>")).join("")}</div>
      <div class="legend muted small">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</div></div>
    <div class="two"><div class="panel"><h3>This week</h3><div class="week">${week.map((x) => `<div class="wk"><i style="height:${Math.max(6, (x.n / top) * 100)}%" class="${x.n ? "on" : ""}"></i><small>${new Date(`${x.day}T12:00`).toLocaleDateString([], { weekday: "narrow" })}</small></div>`).join("")}</div></div>
      <div class="panel"><h3>Weak spots</h3>${d.weak.length ? d.weak.map((w) => `<a class="weak" href="#/set/${w.set_id}/t/${w.topic_id}/quiz"><b>${esc(w.topic)}</b><small>${esc(w.set)}</small><span class="score">${w.quiz_best}%</span></a>`).join("") : '<p class="muted">Nothing weak yet. Take some quizzes and the topics that need work show up here.</p>'}</div></div>
    ${d.by_set.length ? `<div class="panel"><h3>By study set</h3>${d.by_set.map((s) => `<a class="byset" href="#/set/${s.id}" style="--h:${s.hue}"><span class="tile">${esc(s.emoji)}</span><b>${esc(s.title)}</b><div class="bar green"><i style="width:${pct(s.mastered, s.topics)}%"></i></div><small>${s.mastered}/${s.topics}</small></a>`).join("")}</div>` : ""}
    <div class="panel"><h3>Badges <small>${badges.filter((b) => b[2]).length} of ${badges.length}</small></h3><div class="badges">${badges.map(([e, n, ok]) => `<div class="bdg ${ok ? "on" : ""}"><span>${e}</span><small>${n}</small></div>`).join("")}</div></div></div>`;
}

/* ============================================================ flashcard editor: add, fix, delete, AI top-up */
async function cardEditView(tid) {
  const { set } = S.cur, t = topicById(tid);
  if (!t) return go(`#/set/${set.id}`);
  setActive(tid);
  shell({ tab: "set", set, topicId: tid, tutor: false, crumbs: crumbsFor(set, { text: t.title }, { text: "Edit cards" }) });
  $("#view").innerHTML = `<div class="session">${skeleton("Opening your deck…")}</div>`;
  let cards;
  try {
    await api(`/api/topics/${tid}/cards`).catch(() => null);                     // makes the first deck if there is none yet
    cards = (await api(`/api/sets/${set.id}/cards`)).cards.filter((c) => c.topic_id === tid);
  } catch (e) { return failView("Could not open the deck", e); }
  const row = (c) => `<div class="ce-row" data-id="${c.id}"><label>Front<textarea rows="2" maxlength="500" data-f="front" dir="auto">${esc(c.front)}</textarea></label>
      <label>Back<textarea rows="2" maxlength="800" data-f="back" dir="auto">${esc(c.back)}</textarea></label>
      <button class="icon-btn danger" data-del aria-label="Delete card">${ic("trash")}</button></div>`;
  $("#view").innerHTML = `<div class="ce"><div class="home-head"><div><p class="eyebrow">${esc(t.title)}</p><h1>Edit flashcards ✏️</h1><p class="muted"><span id="ce-n">${cards.length}</span> cards. Changes save when you leave a box.</p></div>
      <a class="btn" href="#/set/${set.id}/t/${tid}/cards">Study these</a></div>
    <div class="cfg-card ce-new"><b>Add a card</b><div class="ce-row"><label>Front<textarea id="nf" rows="2" maxlength="500" placeholder="Question or term"></textarea></label><label>Back<textarea id="nb" rows="2" maxlength="800" placeholder="Answer"></textarea></label>
      <button class="btn primary" id="ce-add" type="button">Add</button></div><button class="btn" id="ce-import" type="button">📥 Import from text</button> <button class="btn" id="ce-ai" type="button">${ic("sparkle")} Add 6 more with AI</button> <button class="btn" id="ce-fix" type="button">${ic("sparkle")} Improve weak cards ${planTag("plus")}</button></div>
    <div id="ce-list">${cards.map(row).join("") || '<p class="muted">No cards yet. Add one above.</p>'}</div></div>`;
  const count = () => { $("#ce-n").textContent = $$(".ce-row[data-id]").length; };
  const wire = (el) => {
    $$("textarea", el).forEach((ta) => ta.addEventListener("change", async () => {
      const f = $("[data-f=front]", el).value.trim(), b = $("[data-f=back]", el).value.trim();
      if (!f || !b) return toast("A card needs a front and a back.", true);
      try { await api(`/api/cards/${el.dataset.id}`, { method: "PATCH", body: { front: f, back: b } }); toast("Saved"); } catch (e) { toast(e.message, true); }
    }));
    $("[data-del]", el).addEventListener("click", async () => {
      if (!(await confirmSheet({ title: "Delete this card?", text: "It is removed from your deck.", ok: "Delete", danger: true }))) return;
      try { await api(`/api/cards/${el.dataset.id}`, { method: "DELETE" }); el.remove(); count(); } catch (e) { toast(e.message, true); }
    });
  };
  const addRows = (list) => {
    const box = $("#ce-list"); box.querySelector("p.muted")?.remove();
    list.forEach((c) => { const w = document.createElement("div"); w.innerHTML = row(c); const el = w.firstElementChild; box.prepend(el); wire(el); });
    $$("[data-ic]").forEach((n) => { n.innerHTML = ic(n.dataset.ic); }); count();
  };
  $$(".ce-row[data-id]").forEach(wire);
  $("#ce-add").addEventListener("click", async () => {
    try {
      const { card } = await api(`/api/topics/${tid}/cards/add`, { body: { front: $("#nf").value, back: $("#nb").value } });
      $("#nf").value = ""; $("#nb").value = ""; addRows([card]); $("#nf").focus();
    } catch (e) { toast(e.message, true); }
  });
  $("#ce-import").addEventListener("click", () => importCardsSheet(tid, () => cardEditView(tid)));
  $("#ce-fix").addEventListener("click", async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      const { cards: fixed } = await api(`/api/topics/${tid}/cards/improve`, { body: {} });
      sheet(`<h3>Sharper cards ✨</h3><p class="muted">${fixed.length} weak cards were rewritten. Each comes with a memory hook.</p><div class="qc-grid one">${fixed.map((c) => `<article class="qc"><b dir="auto">${esc(c.front)}</b><p dir="auto">${esc(c.back)}</p><small dir="auto">💡 ${esc(c.tip)}</small></article>`).join("")}</div><div class="sheet-actions"><button class="btn primary" data-close>Done</button></div>`, () => $("#sheet").addEventListener("close", () => cardEditView(tid), { once: true }));
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  });
  $("#ce-ai").addEventListener("click", async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = "Writing…";
    try { const { cards: more } = await api(`/api/topics/${tid}/cards/more`, { body: {} }); addRows(more); toast(`${more.length} new cards`); } catch (e) { toast(e.message, true); }
    b.disabled = false; b.innerHTML = `${ic("sparkle")} Add 6 more with AI`;
  });
}
