/* Cramly call: ring your tutor on a full-screen phone-call screen. You talk, it talks back. Premium Plus gets a studio voice
   (OpenAI text to speech); everyone else gets the best voice the browser has, spoken a sentence at a time. Loaded after app.js. */
"use strict";

Object.assign(ICON, {
  phoneoff: '<path d="M3 15c4-4 14-4 18 0l-2 3-3-1.5V14c-2-.8-6-.8-8 0v2.5L5 18z"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  speakeroff: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>',
  micon: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micoff: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/>',
  chevdown: '<path d="M6 9l6 6 6-6"/>',
});

const VOICE_NAMES = { coral: "Coral", nova: "Nova", sage: "Sage", ash: "Ash" };
const hasStudio = () => S.me?.plan === "plus";
const callSecs = () => Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000));
const mmss = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/* ---------- the best voice the browser has ---------- */
function bestVoice(lang) {
  const pre = lang.slice(0, 2);
  const score = (v) => (v.lang === lang ? 4 : v.lang.startsWith(pre) ? 2 : -10) + (/natural|neural|online/i.test(v.name) ? 6 : 0)
    + (/google|samantha|aria|jenny|ava|allison|karen|moira|zira|serena/i.test(v.name) ? 2 : 0) - (/espeak|compact|desktop/i.test(v.name) ? 3 : 0) + (v.localService ? 0 : 1);
  return [...speechSynthesis.getVoices()].sort((a, b) => score(b) - score(a))[0];
}
function sentences(text) {
  const parts = stripMd(text).match(/[^.!?؟\n]+[.!?؟]*/g) || [stripMd(text)];
  const out = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && (out[out.length - 1].length < 40 || p.length < 14)) out[out.length - 1] += ` ${p}`; else out.push(p);
  }
  return out.slice(0, 14);
}

/* ---------- the ringing sound ---------- */
function ring() {
  try {
    const ctx = ambient.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
    [0, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 440; g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.4);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.45);
    });
  } catch { /* silent is fine */ }
}

/* ---------- the call screen ---------- */
const PHASES = { dialing: "Calling…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…", muted: "Mic is off" };
function setPhase(p) {
  call.phase = p;
  const el = $("#callscreen"); if (el) el.dataset.phase = p;
  const st = $("#cs-status"); if (st) st.textContent = PHASES[p] || "";
  const pill = $("#call-pill b"); if (pill) pill.textContent = PHASES[p] || "";
}
function caption(text) { const c = $("#cs-cap"); if (c) c.textContent = text || ""; }
function drawCallScreen() {
  $("#callscreen")?.remove(); $("#call-pill")?.remove();
  if (!call.on) return;
  if (call.minimized) {
    const pill = document.createElement("div");
    pill.id = "call-pill"; pill.className = "call-pill";
    pill.innerHTML = `<button id="pill-open" type="button" aria-label="Open the call"><span>🦉</span><div><b>${PHASES[call.phase] || ""}</b><small id="pill-time">${mmss(callSecs())}</small></div></button><button class="pill-end" id="pill-end" type="button" aria-label="Hang up">${ic("phoneoff")}</button>`;
    document.body.append(pill);
    $("#pill-open").addEventListener("click", () => { call.minimized = false; drawCallScreen(); });
    $("#pill-end").addEventListener("click", stopCall);
    return;
  }
  const set = S.cur?.set, topic = S.ctx?.topicId ? topicById(S.ctx.topicId) : null;
  const el = document.createElement("div");
  el.id = "callscreen"; el.className = "callscreen"; el.dataset.phase = call.phase; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Call with your tutor");
  el.innerHTML = `<button class="cs-min" id="cs-min" type="button" aria-label="Minimise the call">${ic("chevdown")}</button>
    <div class="cs-top"><button class="cs-avatar" id="cs-avatar" type="button" aria-label="Tap to interrupt"><span class="cs-rings"><i></i><i></i><i></i></span><span class="cs-owl">🦉</span></button>
      <h2>Cramly tutor</h2><p class="cs-sub">${esc(topic ? topic.title : set?.title || "Study call")}</p>
      <p class="cs-status" id="cs-status">${PHASES[call.phase] || ""}</p><small class="cs-time" id="cs-time"></small></div>
    <div class="cs-cap" id="cs-cap" dir="auto"></div>
    <div class="cs-voices" id="cs-voices">${hasStudio()
      ? Object.entries(VOICE_NAMES).map(([k, n]) => `<button type="button" data-v="${k}" class="${ls.get("cramly.voice", "coral") === k ? "on" : ""}">${n}</button>`).join("")
      : `<button type="button" class="cs-up" id="cs-up">✨ Get the studio voice with Premium Plus</button>`}</div>
    <div class="cs-actions"><button class="cs-btn ${call.voiceOn ? "" : "off"}" id="cs-spk" type="button" aria-label="Voice on or off">${ic(call.voiceOn ? "speaker" : "speakeroff")}</button>
      <button class="cs-btn end" id="cs-end" type="button" aria-label="Hang up">${ic("phoneoff")}</button>
      <button class="cs-btn ${call.muted ? "off" : ""}" id="cs-mic" type="button" aria-label="Mute the microphone">${ic(call.muted ? "micoff" : "micon")}</button></div>`;
  document.body.append(el);
  $("#cs-min").addEventListener("click", () => { call.minimized = true; drawCallScreen(); });
  $("#cs-end").addEventListener("click", stopCall);
  $("#cs-avatar").addEventListener("click", () => { if (call.speaking) { stopSpeaking(); listen(); } });
  $("#cs-spk").addEventListener("click", () => { call.voiceOn = !call.voiceOn; if (!call.voiceOn) stopSpeaking(); drawCallScreen(); });
  $("#cs-mic").addEventListener("click", () => { call.muted = !call.muted; if (call.muted) { try { call.rec?.abort(); } catch { /* ok */ } setPhase("muted"); } else listen(); drawCallScreen(); });
  $("#cs-up")?.addEventListener("click", () => plusSheet({ error: "The studio voice is part of Premium Plus" }));
  $$("#cs-voices [data-v]").forEach((b) => b.addEventListener("click", () => { ls.set("cramly.voice", b.dataset.v); $$("#cs-voices [data-v]").forEach((x) => x.classList.toggle("on", x === b)); }));
}
setInterval(() => { if (!call.on) return; const t = mmss(callSecs()); const a = $("#cs-time"); if (a) a.textContent = t; const b = $("#pill-time"); if (b) b.textContent = t; }, 1000);

/* ---------- talking and listening ---------- */
let audioEl = null, speakToken = 0;
function stopSpeaking() {
  speakToken++; call.speaking = false;
  try { speechSynthesis.cancel(); } catch { /* none */ }
  if (audioEl) { const a = audioEl; audioEl = null; a.pause(); a.onended?.(); }
}
function startCall() {
  if (!SR || !("speechSynthesis" in window)) { toast("Voice calls need Chrome or Edge.", true); return; }
  Object.assign(call, { on: true, speaking: false, muted: false, minimized: false, startedAt: Date.now(), studio: hasStudio() });
  setPhase("dialing"); drawCallScreen(); paintTutor();
  ring(); setTimeout(ring, 1700);
  setTimeout(() => {
    if (!call.on) return;
    if (!S.chat.msgs.length && S.ctx.topicId) {
      setPhase("thinking");
      sendChat(S.chat.mode === "guided" ? `Teach me: ${topicById(S.ctx.topicId)?.title || "this topic"}` : "Give me a quick overview.", { speak: true });
    } else listen();
  }, 2800);
}
function stopCall() {
  call.on = false; call.speaking = false;
  try { call.rec?.abort(); } catch { /* ignore */ }
  stopSpeaking();
  $("#callscreen")?.remove(); $("#call-pill")?.remove();
  paintTutor();
}
function listen() {
  if (!call.on) return;
  if (call.muted) return setPhase("muted");
  const rec = new SR();
  call.rec = rec; rec.lang = voiceLang(); rec.interimResults = true; rec.continuous = false;
  let finalText = "";
  rec.onresult = (e) => {
    let t = "";
    for (const r of e.results) t += r[0].transcript;
    caption(t);
    if (e.results[e.results.length - 1].isFinal) finalText = t;
  };
  rec.onend = () => {
    if (finalText.trim()) { caption(""); setPhase("thinking"); sendChat(finalText.trim(), { speak: true }); }
    else if (call.on && !call.muted && !S.chat?.busy && !call.speaking) setTimeout(listen, 350);
  };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Allow the microphone to call your tutor.", true); stopCall(); } };
  try { rec.start(); } catch { /* already running */ }
  setPhase("listening");
}
async function fetchClip(text) {
  try {
    const r = await fetch("/api/tts", { method: "POST", headers: { ...baseHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: ls.get("cramly.voice", "coral") }) });
    if (!r.ok) throw new Error("no studio voice");
    return URL.createObjectURL(await r.blob());
  } catch { call.studio = false; return null; }
}
const playClip = (url) => new Promise((done) => {
  const a = new Audio(url);
  audioEl = a;
  a.onended = a.onerror = () => { URL.revokeObjectURL(url); done(); };
  a.play().catch(done);
});
const speakBrowser = (text) => new Promise((done) => {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = isArabic(text) ? "ar-SA" : voiceLang().startsWith("ar") ? "en-US" : voiceLang();
  const v = bestVoice(u.lang); if (v) u.voice = v;
  u.rate = 1.02; u.onend = u.onerror = () => done();
  speechSynthesis.cancel(); speechSynthesis.speak(u);
});
async function speak(text) {
  if (!call.on) return;
  const parts = sentences(text), token = ++speakToken;
  if (!call.voiceOn) { caption(stripMd(text).slice(0, 300)); call.speaking = false; return listen(); }   // speaker off: captions only
  call.speaking = true; setPhase("speaking");
  let next = hasStudio() && call.studio !== false ? fetchClip(parts[0]) : null;
  for (let i = 0; i < parts.length; i++) {
    if (token !== speakToken || !call.on) return;
    caption(parts[i]);
    const clip = next ? await next : null;
    next = hasStudio() && call.studio !== false && i + 1 < parts.length ? fetchClip(parts[i + 1]) : null;
    if (token !== speakToken || !call.on) return;
    if (clip) await playClip(clip); else await speakBrowser(parts[i]);
  }
  if (token !== speakToken || !call.on) return;
  call.speaking = false; caption(""); listen();
}
