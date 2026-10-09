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
  if (S.me.premium) return `<span class="chip-btn prem" id="acc-chip" title="Premium is on">${ic("star")}<b>Premium</b></span>`;
  const left = Math.max(0, Math.round(S.me.trial_left ?? 0));
  return `<button class="chip-btn trial ${left <= 15 ? "hot" : ""}" id="acc-chip" title="Free time left">${ic("timer")}<b id="acc-left">${clock(left)}</b><span class="lbl">free</span></button>`;
}
function wireAccess() {
  $("#acc-chip")?.addEventListener("click", () => { if (!S.me?.premium) upgradeSheet(); });
  if (S.me?.locked && !S.me?.premium) showPaywall();
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
  if (!key || S.me?.premium || document.hidden || $("#paywall")) return;
  try {
    const r = await fetch("/api/beat", { method: "POST", headers: baseHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    S.me = { ...S.me, ...d };
    paintLeft();
    if (d.locked && !d.premium) showPaywall(d);
  } catch { /* offline: the next beat will catch up */ }
}
function startBeat() {
  if (beatTimer) return;
  beatTimer = setInterval(beat, 5000);
  tickTimer = setInterval(() => {
    if (!S.me || S.me.premium || document.hidden || $("#paywall")) return;
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
function showPaywall(info = {}) {
  if (S.me) { S.me.locked = true; S.me.trial_left = 0; }
  if ($("#paywall")) return;
  window.leaveView?.();
  try { stopCall?.(); } catch { /* no call running */ }
  closeSheet();
  const el = document.createElement("div");
  el.id = "paywall";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "pw-title");
  el.innerHTML = `<div class="pw-card">
      <span class="pw-badge">${ic("timer")} Free minute used</span>
      <h1 id="pw-title">Your free minute is up</h1>
      <p class="pw-lead">You have tried the premium tools. To keep studying with Cramly, <b>message Awsaa for premium</b>. Premium normally costs <b>$2.99</b>, but it is a <b>free gift</b> when you are invited. Message and you will get a personal link that unlocks everything.</p>
      <a class="btn primary big pw-mail" id="pw-mail" href="${esc(mailLink())}">${ic("mail")} Message Awsaa for premium</a>
      <div class="pw-addr"><code>${esc(info.contact || contact())}</code><button class="btn small" id="pw-copy" type="button">${ic("copy")} Copy</button></div>
      <ul class="pw-list">${FEATURES.map(([e, t]) => `<li><span>${e}</span>${esc(t)}</li>`).join("")}</ul>
      <details class="pw-have"><summary>I already have a premium link</summary>
        <div class="pw-row"><input id="pw-link" placeholder="Paste your link here" aria-label="Premium link" autocomplete="off"><button class="btn" id="pw-go" type="button">Unlock</button></div>
        <p class="pw-err" id="pw-err" hidden></p><p class="muted small">Or just open the link on this device and it unlocks by itself.</p></details>
      <p class="muted small pw-safe">Your study sets are safe. They will be right here when you unlock.</p></div>`;
  document.body.append(el);
  document.documentElement.classList.add("pw-open");
  ["#app", "#welcome", "#tabbar"].forEach((s) => { const n = $(s); if (n) n.inert = true; });
  $("#pw-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(contact()); toast("Email copied"); } catch { prompt("Copy this email:", contact()); }
  });
  const unlock = () => useLink($("#pw-link").value, (m) => { const e = $("#pw-err"); e.hidden = false; e.textContent = m; });
  $("#pw-go").addEventListener("click", unlock);
  $("#pw-link").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
  setTimeout(() => $("#pw-mail")?.focus(), 80);
}

/* ---------- opening a premium link ---------- */
async function redeemJoin(code, { quiet = true } = {}) {
  try {
    const d = await api("/api/join", { body: { code } });
    if (d.key) { key = d.key; ls.set("cramly.key", key); }
    S.me = { ...S.me, premium: true, locked: false };
    return { ok: true, fresh: !!d.key };
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
  giftSheet();
  if (r.fresh) $("#sheet").addEventListener("close", async () => {
    const name = await askText({ title: "What should I call you?", label: "Your name", ok: "Continue" });
    if (name?.trim()) { await api("/api/me", { method: "PATCH", body: { name } }).catch(() => {}); S.me = { ...S.me, name }; route(); }
  }, { once: true });
}
function giftSheet() {
  sheet(`<div class="gift"><div class="gift-ico">🎁</div><div class="price"><s>$2.99</s><b>FREE</b></div>
    <h3>Cramly Premium is a gift for you</h3>
    <p>Premium normally costs <b>$2.99</b>. You are getting it <b>completely free</b>, as a gift from Awsaa. Nothing to pay, now or ever.</p>
    <button class="btn primary big" data-close type="button">Start studying 🎉</button></div>`);
  try { confetti(); } catch { /* decoration only */ }
}

/* ---------- the upgrade sheet (the chip) and the account block in Settings ---------- */
function upgradeSheet() {
  const left = Math.max(0, Math.round(S.me?.trial_left ?? 0));
  sheet(`<h3>${ic("timer")} ${clock(left)} of free time left</h3>
    <p class="muted">Everything in Cramly works for your first minute. After that, premium keeps it going. It is by invitation: message Awsaa and you will get a personal link.</p>
    <ul class="pw-list tight">${FEATURES.map(([e, t]) => `<li><span>${e}</span>${esc(t)}</li>`).join("")}</ul>
    <div class="sheet-actions"><button class="btn" data-close>Keep studying</button><a class="btn primary" href="${esc(mailLink())}">${ic("mail")} Message Awsaa</a></div>`);
}
function accountBlock() {
  if (S.me?.premium) return `<div class="acc-card prem">${ic("star")}<div><b>Premium</b><small>${S.me.premium_until ? `Until ${new Date(S.me.premium_until * 1000).toLocaleDateString()}` : "Everything is unlocked, with no time limit."} A gift from Awsaa (normally $2.99).</small></div></div>`;
  return `<div class="acc-card">${ic("timer")}<div><b>Free: ${clock(S.me?.trial_left ?? 0)} left</b><small>Premium is by invitation. Message ${esc(contact())}.</small></div>
    <a class="btn small primary" href="${esc(mailLink())}">Get premium</a></div>
    <button class="link" id="s-haslink" type="button">I have a premium link</button>`;
}
function wireAccountBlock() {
  $("#s-haslink")?.addEventListener("click", async () => {
    const v = await askText({ title: "Premium link", label: "Paste it here", ok: "Unlock" });
    if (v) useLink(v, (m) => toast(m, true));
  });
}

/* ---------- tutor styles ---------- */
const TUTOR_STYLES = [["", "Friendly tutor"], ["eli5", "Explain like I am 10"], ["coach", "Exam coach"], ["strict", "Strict Socratic"], ["buddy", "Funny buddy"]];
const tutorStyleOptions = () => TUTOR_STYLES.map(([v, l]) => `<option value="${v}" ${ls.get("cramly.style", "") === v ? "selected" : ""}>${l}</option>`).join("");
