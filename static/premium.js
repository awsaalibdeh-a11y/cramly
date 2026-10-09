/* Cramly premium: the free minute, the paywall, premium links and their small UI. Loaded after app.js and extras.js; it uses
   their globals (S, api, key, sheet, toast...) and is called from a few hooks in them (shell, route, boot, api). */
"use strict";

Object.assign(ICON, {
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="2"/><rect x="17" y="14" width="4" height="7" rx="2"/>',
  network: '<circle cx="12" cy="12" r="2.6"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 7l3.2 3.2M17 7l-3.2 3.2M7 17l3.2-3.2M17 17l-3.2-3.2"/>',
  sheet: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
});

const CONTACT_FALLBACK = "Awsaa.libdeh@gmail.com";
const contact = () => S.me?.contact || CONTACT_FALLBACK;
const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const FEATURES = [
  ["🦉", "Unlimited AI tutor, notes and quizzes"], ["🎧", "Listen: a two-host podcast of any topic"], ["🕸️", "Mind maps of your whole study set"],
  ["📄", "One-page printable cheat sheets"], ["📸", "Snap and solve: photo of a question, worked answer"], ["🎯", "Exam builder with timer and difficulty"],
  ["✏️", "Flashcard editor with AI top-ups"], ["📈", "Progress, streaks and weak-spot tracking"],
];

/* ---------- the little chip in the top bar ---------- */
function accessChip() {
  if (!S.me) return "";
  if (S.me.premium) return `<button class="chip-btn prem ${planNow()}" id="acc-chip" title="Your plan">${ic("star")}<b>${S.me.plan === "plus" ? "Plus" : "Premium"}</b></button>`;
  if (S.me.locked) return `<button class="chip-btn trial locked" id="acc-chip" title="Your free minute is used">${ic("lock")}<b>Free plan</b></button>`;
  const left = Math.max(0, Math.round(S.me.trial_left ?? 0));
  return `<button class="chip-btn trial ${left <= 15 ? "hot" : ""}" id="acc-chip" title="Free minute of premium tools left">${ic("timer")}<b id="acc-left">${clock(left)}</b><span class="lbl">free</span></button>`;
}
function wireAccess() {
  $("#acc-chip")?.addEventListener("click", () => plansSheet(S.me?.premium ? "plus" : "premium"));
  if (S.me?.banned) showGate("banned", S.me);
  else if (S.me?.timeout_until) showGate("timeout", S.me);
  else if (S.me?.maintenance) showGate("maintenance", { message: S.me.maintenance_msg });
  else if (S.me?.locked && !S.me?.premium && !softSeen()) minuteOverNotice();
  showInbox();
  startBeat();
}

/* ---------- counting the free minute ---------- */
let beatTimer = 0, tickTimer = 0;
function paintLeft() {
  const el = $("#acc-left");
  if (!el || !S.me || S.me.premium) return;
  const left = Math.max(0, S.me.trial_left ?? 0);
  el.textContent = clock(left);
  el.closest(".chip-btn")?.classList.toggle("hot", left <= 15);
}
async function beat() {
  if (!key || document.hidden || $("#paywall") || $("#gate")) return;
  try {
    const r = await fetch("/api/beat", { method: "POST", headers: { ...baseHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ tool: isToolView() }) });
    if (!r.ok) return;
    const d = await r.json();
    S.me = { ...S.me, ...d };
    paintLeft();
    if (d.banned) return showGate("banned", d);
    if (d.timeout_until) return showGate("timeout", d);
    if (d.maintenance) return showGate("maintenance", { message: d.maintenance_msg });
    showInbox();
    if (d.locked && !d.premium && !softSeen()) minuteOverNotice();
  } catch { /* offline: the next beat will catch up */ }
}
function startBeat() {
  if (beatTimer) return;
  beatTimer = setInterval(beat, 5000);
  startNudge();
  tickTimer = setInterval(() => {
    if (!S.me || S.me.premium || document.hidden || $("#paywall") || !isToolView()) return;
    S.me.trial_left = Math.max(0, (S.me.trial_left ?? 0) - 1);
    paintLeft();
    if (S.me.trial_left <= 0) beat();
  }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
}

/* ---------- the paywall: the free minute is over ---------- */
function mailLink() {
  const subject = encodeURIComponent("Cramly premium please");
  const body = encodeURIComponent(`Hi Awsaa,\n\nI tried Cramly and I would love premium.\nMy name: ${S.me?.name || ""}\n\nThanks!`);
  return `mailto:${contact()}?subject=${subject}&body=${body}`;
}
function codeFromLink(text) {
  const m = /\/join\/([\w-]{6,80})/.exec(String(text)) || /^([\w-]{10,80})$/.exec(String(text).trim());
  return m ? m[1] : "";
}
async function useLink(text, onBad) {
  const code = codeFromLink(text);
  if (!code) return onBad("That does not look like a premium link.");
  if (await redeemJoin(code, { quiet: false })) location.reload();
}
/** The free minute ended: say so once, gently. Nothing is locked; only the premium tools wait for an invite. */
function minuteOverNotice() {
  try { sessionStorage.setItem("cramly.soft", "1"); } catch { /* fine */ }
  if ($("#snack")) return;
  const el = document.createElement("div");
  el.id = "snack"; el.className = "snack"; el.setAttribute("role", "status");
  el.innerHTML = `<span>⏱</span><div><b>Your free minute of premium tools is over.</b><small>Everything free stays open: reading, reviews, notes, focus room and more.</small></div><button class="btn small primary" id="snack-plans" type="button">See plans</button><button class="icon-btn" id="snack-x" aria-label="Dismiss">✕</button>`;
  document.body.append(el);
  const gone = () => el.remove();
  $("#snack-plans").addEventListener("click", () => { gone(); plansSheet("premium"); });
  $("#snack-x").addEventListener("click", gone);
  setTimeout(gone, 14000);
  paintLeft(); const chip = $("#acc-chip"); if (chip && !S.me.premium) chip.outerHTML = accessChip(), $("#acc-chip")?.addEventListener("click", () => plansSheet("premium"));
}
const softSeen = () => { try { return sessionStorage.getItem("cramly.soft") === "1"; } catch { return false; } };
function showPaywall(info = {}) {
  if (info.plus) { if (S.me) S.me.locked = !S.me.premium; return plusSheet(info); }
  if (S.me) { S.me.locked = true; S.me.trial_left = 0; }
  if ($("#paywall")) return;
  window.leaveView?.();
  try { stopCall?.(); } catch { /* no call running */ }
  closeSheet();
  const el = document.createElement("div");
  el.id = "paywall";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "pw-title");
  el.innerHTML = `<div class="pw-card">
      <span class="pw-badge">${ic("timer")} Free minute used up</span>
      <h1 id="pw-title">That one needs Premium</h1>
      <p class="pw-lead">That tool is part of Premium. The free minute to try it is over, but <b>the rest of Cramly stays free</b>. To use it again, <b>message Awsaa for premium</b>. Premium normally costs <b>$2.99</b>, but it is a <b>free gift</b> when you are invited. Message and you will get a personal link that unlocks everything.</p>
      <button class="btn primary big pw-mail" id="pw-ask" type="button">${ic("mail")} Message Awsaa here</button>
      <a class="link" id="pw-mail" href="${esc(mailLink())}">or send an email instead</a>
      <div class="pw-addr"><code>${esc(info.contact || contact())}</code><button class="btn small" id="pw-copy" type="button">${ic("copy")} Copy</button></div>
      <ul class="pw-list">${FEATURES.map(([e, t]) => `<li><span>${e}</span>${esc(t)}</li>`).join("")}</ul>
      <details class="pw-have"><summary>I already have a premium link</summary>
        <div class="pw-row"><input id="pw-link" placeholder="Paste your link here" aria-label="Premium link" autocomplete="off"><button class="btn" id="pw-go" type="button">Unlock</button></div>
        <p class="pw-err" id="pw-err" hidden></p><p class="muted small">Or just open the link on this device and it unlocks by itself.</p></details>
      <button class="link" id="pw-plans" type="button">Compare the plans</button>
      <button class="btn big" id="pw-free" type="button">Keep using the free tools</button>
      <p class="muted small pw-safe">Your study sets are safe. Reading, reviewing, the mind map, notes and the focus room stay free.</p></div>`;
  document.body.append(el);
  document.documentElement.classList.add("pw-open");
  ["#app", "#welcome", "#tabbar"].forEach((s) => { const n = $(s); if (n) n.inert = true; });
  $("#pw-plans").addEventListener("click", () => plansSheet("premium"));
  $("#pw-ask").addEventListener("click", () => { $("#pw-free").click(); setTimeout(() => askSheet("premium"), 150); });
  el.addEventListener("click", (e) => { if (e.target === el) $("#pw-free").click(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#pw-free").click(); });
  $("#pw-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(contact()); toast("Email copied"); } catch { prompt("Copy this email:", contact()); }
  });
  const unlock = () => useLink($("#pw-link").value, (m) => { const e = $("#pw-err"); e.hidden = false; e.textContent = m; });
  $("#pw-go").addEventListener("click", unlock);
  $("#pw-link").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
  $("#pw-free").addEventListener("click", () => {
    try { sessionStorage.setItem("cramly.soft", "1"); } catch { /* fine */ }
    el.remove(); document.documentElement.classList.remove("pw-open");
    ["#app", "#welcome", "#tabbar"].forEach((s) => { const n = $(s); if (n) n.inert = false; });
    paintLeft(); route();
  });
  setTimeout(() => $("#pw-ask")?.focus(), 80);
}

/* ---------- opening a premium link ---------- */
async function redeemJoin(code, { quiet = true } = {}) {
  try {
    const d = await api("/api/join", { body: { code } });
    if (d.key) { key = d.key; ls.set("cramly.key", key); }
    S.me = { ...S.me, premium: true, locked: false };
    return { ok: true, fresh: !!d.key, message: d.message || "", forName: d.for_name || "" };
  } catch (e) {
    if (!quiet) toast(e.message, true);
    redeemJoin.error = e.message;
    return false;
  }
}
async function handleJoinLink(code) {
  history.replaceState(null, "", "/");
  const r = await redeemJoin(code);
  if (!r) {
    sheet(`<h3>That link does not work</h3><p class="muted">${esc(redeemJoin.error || "It is not valid any more.")}</p><div class="sheet-actions"><button class="btn primary" data-close>OK</button></div>`);
    return;
  }
  giftSheet(r);
  if (r.fresh) $("#sheet").addEventListener("close", async () => {
    const name = await askText({ title: "What should I call you?", label: "Your name", ok: "Continue" });
    if (name?.trim()) { await api("/api/me", { method: "PATCH", body: { name } }).catch(() => {}); S.me = { ...S.me, name }; route(); }
  }, { once: true });
}
function giftSheet(r = {}) {
  const note = r.message ? `<div class="gift-note" dir="auto"><small>💌 A note for ${esc(r.forName || "you")}</small>${esc(r.message)}</div>` : "";
  sheet(`<div class="gift"><div class="gift-ico">🎁</div><div class="price"><s>$2.99</s><b>FREE</b></div>
    <h3>Cramly Premium is a gift for you</h3>${note}
    <p>Premium normally costs <b>$2.99</b>. You are getting it <b>completely free</b>, as a gift from Awsaa. Nothing to pay, now or ever.</p>
    <button class="btn primary big" data-close type="button">Start studying 🎉</button></div>`);
  try { confetti(); } catch { /* decoration only */ }
}

/* ---------- the upgrade sheet (the chip) and the account block in Settings ---------- */
function upgradeSheet() {
  if (S.me?.trial_left <= 0) return plansSheet("premium");
  const left = Math.max(0, Math.round(S.me?.trial_left ?? 0));
  sheet(`<h3>${ic("timer")} ${clock(left)} of free time left</h3>
    <p class="muted">Everything in Cramly works for your first minute. After that, premium keeps it going. It is by invitation: message Awsaa and you will get a personal link.</p>
    <ul class="pw-list tight">${FEATURES.map(([e, t]) => `<li><span>${e}</span>${esc(t)}</li>`).join("")}</ul>
    <div class="sheet-actions"><button class="btn" data-close>Keep studying</button><a class="btn primary" href="${esc(mailLink())}">${ic("mail")} Message Awsaa</a></div>`);
}
function accountBlock() {
  if (S.me?.premium) return `<div class="acc-card prem">${ic("star")}<div><b>${PLAN_NAMES[S.me.plan] || "Premium"}</b><small>${S.me.premium_until ? `Until ${new Date(S.me.premium_until * 1000).toLocaleDateString()}` : "Everything is unlocked, with no time limit."} A gift from Awsaa (normally $2.99).</small></div></div>`;
  return `<div class="acc-card">${ic("timer")}<div><b>Free: ${clock(S.me?.trial_left ?? 0)} left</b><small>Premium is a free gift from Awsaa if you ask.</small></div>
    <button class="btn small primary" id="s-ask" type="button">Ask for premium</button></div>
    <button class="link" id="s-haslink" type="button">I have a premium link</button>`;
}
function wireAccountBlock() {
  $("#s-ask")?.addEventListener("click", () => { closeSheet(); setTimeout(() => askSheet("premium"), 150); });
  $("#s-haslink")?.addEventListener("click", async () => {
    const v = await askText({ title: "Premium link", label: "Paste it here", ok: "Unlock" });
    if (v) useLink(v, (m) => toast(m, true));
  });
}

/* ---------- tutor styles ---------- */
const TUTOR_STYLES = [["", "Friendly tutor"], ["eli5", "Explain like I am 10"], ["coach", "Exam coach"], ["strict", "Strict Socratic"], ["buddy", "Funny buddy"]];
const tutorStyleOptions = () => TUTOR_STYLES.map(([v, l]) => `<option value="${v}" ${ls.get("cramly.style", "") === v ? "selected" : ""}>${l}</option>`).join("");

/* ---------- the owner's switches: banned, on a break, switched off ---------- */
function gateScreen(status, d) {
  if (status === 403 && d.banned) { showGate("banned", d); return true; }
  if (status === 403 && d.timeout) { showGate("timeout", d); return true; }
  if (status === 503 && d.maintenance) { showGate("maintenance", d); return true; }
  return false;
}
function showGate(kind, d = {}) {
  if ($("#paywall")) $("#paywall").remove();
  if ($("#gate")) return;
  window.leaveView?.();
  try { stopCall?.(); } catch { /* no call running */ }
  closeSheet();
  const reason = d.reason || d.ban_reason ? `<p class="gate-reason">${esc(d.reason || d.ban_reason)}</p>` : "";
  const mail = `<a class="btn primary big" href="mailto:${esc(contact())}?subject=${encodeURIComponent("About my Cramly account")}">${ic("mail")} Message Awsaa</a>`;
  const body = {
    banned: `<div class="gate-ico">🚫</div><h1>This account has been blocked</h1><p>You cannot use Cramly with this account right now.</p>${reason}<p class="muted">If you think this is a mistake, message ${esc(contact())}.</p>${mail}`,
    timeout: `<div class="gate-ico">⏸️</div><h1>You are on a short break</h1><p>This account is paused for a bit. It opens again in:</p><div class="gate-clock" id="gate-clock"></div>${reason}<p class="muted">Questions? Message ${esc(contact())}.</p>`,
    maintenance: `<div class="gate-ico">🛠️</div><h1>Cramly is switched off for a bit</h1><p>${esc(d.message || d.error || d.maintenance_msg || "It will be back soon.")}</p><button class="btn primary big" id="gate-retry" type="button">Check again</button><p class="muted small">This page checks by itself every 15 seconds.</p>`,
  }[kind];
  const el = document.createElement("div");
  el.id = "gate"; el.className = "gate-wrap"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="pw-card gate">${body}</div>`;
  document.body.append(el);
  document.documentElement.classList.add("pw-open");
  ["#app", "#welcome", "#tabbar"].forEach((s) => { const n = $(s); if (n) n.inert = true; });
  if (kind === "timeout") {
    const until = d.until || d.timeout_until, tick = () => {
      const s = Math.max(0, Math.round(until - Date.now() / 1000));
      $("#gate-clock").textContent = s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (!s) location.reload();
    };
    tick(); setInterval(tick, 1000);
  }
  if (kind === "maintenance") {
    const check = async () => { try { const s = await (await fetch("/api/status")).json(); if (!s.maintenance) location.reload(); } catch { /* still off */ } };
    $("#gate-retry").addEventListener("click", check); setInterval(check, 15000);
  }
}
async function checkStatus() {
  try { const s = await (await fetch("/api/status")).json(); if (s.maintenance) showGate("maintenance", s); } catch { /* offline */ }
}

/* ---------- notes from the owner ---------- */
let inboxOpen = false;
function showInbox() {
  const box = S.me?.inbox || [];
  if (!box.length || inboxOpen || $("#paywall") || $("#gate")) return;
  inboxOpen = true;
  sheet(`<div class="note-letter"><div class="gift-ico">💌</div><h3>A message from Awsaa</h3>
    ${box.map((m) => `<blockquote dir="auto">${esc(m.body)}</blockquote>`).join("")}
    <button class="btn primary big" data-close type="button">Got it</button></div>`);
  $("#sheet").addEventListener("close", async () => {
    inboxOpen = false;
    S.me.inbox = [];
    try { await api("/api/messages/read", { body: {} }); } catch { /* shown again next time */ }
  }, { once: true });
}

/* ---------- the three plans ---------- */
const PLAN_NAMES = { free: "Free", premium: "Premium", plus: "Premium Plus" };
const PLANS = [
  { id: "free", icon: "🌱", name: "Free", tag: "forever", items: ["Read and review everything you made", "Flashcard reviews and daily review", "Mind map, progress, calendar", "My notes, focus room with sounds", "Themes, search, daily goal", "1 free minute of every AI tool", "3 study sets, files up to 25 MB"] },
  { id: "premium", icon: "⭐", name: "Premium", tag: "normally $2.99", items: ["Everything in Free", "Unlimited AI tutor, notes, cards and quizzes", "Listen: two-host podcast of any topic", "Cheat sheets, snap and solve, exam builder", "Glossary and swipe game", "30 study sets, files up to 200 MB"] },
  { id: "plus", icon: "✨", name: "Premium Plus", tag: "the top plan", items: ["Everything in Premium", "Exam predictor with model answers", "Write and grade: your answer marked", "Mix-ups, memory boost, practice lab", "Share study sets by link", "A smarter AI model", "100 study sets, files up to 1 GB"] },
];
const planNow = () => S.me?.plan || (S.me?.premium ? "premium" : "free");
function plansHtml(highlight) {
  return `<div class="plan-cards">${PLANS.map((p) => `<article class="plan-card ${p.id} ${planNow() === p.id ? "now" : ""} ${highlight === p.id ? "hl" : ""}"><header><span>${p.icon}</span><div><b>${p.name}</b><small>${p.tag}</small></div>${planNow() === p.id ? '<em>Your plan</em>' : ""}</header>
    <ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></article>`).join("")}</div>`;
}
function plansSheet(highlight = "premium", lead = "") {
  sheet(`<h3>Choose your plan</h3>${lead ? `<p class="muted">${esc(lead)}</p>` : ""}${requestNote()}${plansHtml(highlight)}
    <p class="muted small">Premium normally costs $2.99 and Awsaa gifts it to people who ask. Message here in the app, or email ${esc(contact())}.</p>
    <div class="sheet-actions"><button class="btn" data-close>Not now</button>${askButtons(highlight)}</div>`, () => wireAsk(highlight === "plus" ? "plus" : "premium"));
}
function plusSheet(info = {}) {
  sheet(`<div class="gift"><div class="gift-ico">✨</div><h3>${esc(info.error || "This is a Premium Plus tool")}</h3>
    <p class="muted">${S.me?.premium ? "You have Premium. This tool is part of Premium Plus, the top plan." : "Free accounts can try it during the first minute. After that it is part of Premium Plus."}</p>
    ${plansHtml("plus")}<div class="sheet-actions"><button class="btn" data-close>Close</button>${askButtons("plus")}</div></div>`, () => wireAsk("plus"));
}

/* ---------- asking for a plan: in the app (it reaches the owner panel) or by email ---------- */
const TOOL_VIEW = /\/(listen|boost|lab|grade|cheat|exam|glossary|predictor|mixups)\b|#\/solve/;
const isToolView = () => TOOL_VIEW.test(location.hash);
function requestNote() {
  const r = S.me?.request;
  if (!r || S.me?.premium && r.status !== "pay") return "";
  const text = { pending: "Your request is with Awsaa. You will get the answer here.", pay: `Awsaa replied: ${PLAN_NAMES[r.plan] || "the plan"} is ${r.price || "$2.99"}. Check your messages for how to pay.`, declined: "Your last request was not approved. You can ask again.", free: "", paid: "" }[r.status];
  return text ? `<p class="note-card req-note">${esc(text)}</p>` : "";
}
function askSheet(plan = "premium") {
  let pick = plan === "plus" ? "plus" : "premium";
  sheet(`<h3>💌 Ask Awsaa for a plan</h3><p class="muted">Write a short message. Awsaa sees it in their panel and answers you right here in the app. Prefer email? <a href="${esc(mailLink())}">Send an email instead</a>.</p>
    <div class="seg" id="ask-plan"><button type="button" data-p="premium">⭐ Premium</button><button type="button" data-p="plus">✨ Premium Plus</button></div>
    ${S.me?.name ? "" : '<label>Your name<input id="ask-name" maxlength="40" autocomplete="given-name"></label>'}
    <label>Your message <span class="muted">(optional)</span><textarea id="ask-msg" rows="4" maxlength="800" placeholder="e.g. I am studying for my biology exam and Cramly helps a lot."></textarea></label>
    <div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ask-send" type="button">Send to Awsaa</button></div>`, () => {
    const mark = () => $$("#ask-plan button").forEach((b) => b.classList.toggle("on", b.dataset.p === pick));
    mark();
    $$("#ask-plan button").forEach((b) => b.addEventListener("click", () => { pick = b.dataset.p; mark(); }));
    $("#ask-send").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        await api("/api/request", { body: { plan: pick, message: $("#ask-msg").value, name: $("#ask-name")?.value || "" } });
        S.me = { ...S.me, request: { status: "pending", plan: pick } };
        closeSheet();
        sheet(`<div class="gift"><div class="gift-ico">📨</div><h3>Sent to Awsaa</h3><p class="muted">You will get the answer right here in the app, usually soon. Keep using the free tools meanwhile.</p><button class="btn primary big" data-close type="button">Great</button></div>`);
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
  });
}
const askButtons = (plan) => `<button class="btn primary" id="ask-open" type="button">${ic("mail")} Message Awsaa here</button><a class="btn" href="${esc(mailLink())}">Email instead</a>`;
function wireAsk(plan) { $("#ask-open")?.addEventListener("click", () => { closeSheet(); askSheet(plan); }); }

/* ---------- every 10 minutes of use, a free account gets a friendly nudge ---------- */
function startNudge() {
  setInterval(() => {
    if (!S.me || S.me.premium || document.hidden || !key) return;
    ls.set("cramly.nudgeSecs", ls.get("cramly.nudgeSecs", 0) + 20);
    if (ls.get("cramly.nudgeSecs", 0) < 600) return;
    if ($("#paywall") || $("#gate") || $("#palette") || $("#snack") || $("#sheet")?.open) return;
    ls.set("cramly.nudgeSecs", 0);
    if (S.me.request?.status === "pending") return;
    nudgeSheet();
  }, 20000);
}
function nudgeSheet() {
  sheet(`<div class="gift"><div class="gift-ico">⭐</div><h3>Want Premium?</h3>
    <p>Premium normally costs <b>$2.99</b>, but Awsaa gifts it to people who ask. Send a quick message and the answer comes back right here.</p>
    <div class="sheet-actions"><button class="btn" data-close>Maybe later</button>${askButtons("premium")}</div></div>`, () => wireAsk("premium"));
}
