"""Everything Cramly asks the AI to do. One small function per job, each with its own strict JSON shape, so the page
always gets data it can draw.

  outline  : a quick map of one chunk of a long document (cheap model, run in parallel)
  make_plan: the study plan: a title and 5-14 topics, each with a summary and key ideas
  make_notes / make_cards / make_quiz: what's inside a topic (made the first time it's opened, then kept)
  chat     : the tutor, streamed; "guided" teaches step by step, "ask" answers directly
  image_text / pdf_text: reading photos and scanned pages
"""

import base64
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

import requests

log = logging.getLogger("cramly")
URL = "https://api.openai.com/v1/responses"
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-nano")
FAST = os.environ.get("FAST_MODEL", "gpt-5-nano")
PLUS_MODEL = os.environ.get("OPENAI_MODEL_PLUS", "gpt-5-mini")      # Premium Plus accounts get a step up, still cheap


def _pick(model=None):
    if model:
        return model
    try:
        from flask import g, has_request_context
        if has_request_context() and (getattr(g, "user", None) or {}).get("is_plus"):
            return PLUS_MODEL
    except Exception:
        pass
    return MODEL


class AIError(RuntimeError):
    """Something the student should read: the message is already friendly."""


def _headers():
    return {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}", "Content-Type": "application/json"}


def _call(body, timeout=150):
    last = None
    for attempt in range(2):
        try:
            r = requests.post(URL, headers=_headers(), json=body, timeout=(10, timeout))
            if r.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                time.sleep(3)
                continue
            if not r.ok:
                log.error("openai %s: %s", r.status_code, r.text[:400])
                raise AIError("The AI is busy right now. Try again in a moment.")
            data = r.json()
            if data.get("status") == "incomplete":
                raise AIError("That was too much for the AI at once. Try a shorter file or fewer files.")
            return data
        except requests.RequestException as exc:
            last = exc
            time.sleep(1)
    log.error("openai unreachable: %s", last)
    raise AIError("Couldn't reach the AI. Check your connection and try again.")


def _text(resp):
    msgs = [o for o in resp.get("output", []) if o.get("type") == "message"]
    return msgs[-1]["content"][0]["text"] if msgs else ""


def ask_json(system, user, schema, name, model=None, effort="minimal", extra_parts=None):
    content = [{"type": "input_text", "text": user}] + (extra_parts or [])
    model = _pick(model)
    body = {"model": model,
            "input": [{"role": "system", "content": system}, {"role": "user", "content": content}],
            "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}}}
    if model.startswith(("gpt-5", "o")):
        body["reasoning"] = {"effort": effort}
    return json.loads(_text(_call(body)))


LANG = ("Write in the language of the study material (if it is Arabic, write Arabic; if mixed, use the main one). "
        "Keep technical terms, names and formulas exactly as in the material.")


# ---------- reading files ----------
def image_text(data, mime):
    """Photos of notes, whiteboards, textbook pages: read everything on it."""
    b64 = base64.b64encode(data).decode()
    body = {"model": MODEL, "reasoning": {"effort": "minimal"}, "input": [{"role": "user", "content": [
        {"type": "input_text", "text": "Transcribe all the text on this page of study material, in reading order. Describe any diagram or "
                                       "table in one short line in [brackets]. Output only the content."},
        {"type": "input_image", "image_url": f"data:{mime};base64,{b64}"}]}]}
    return _text(_call(body)).strip()


def pdf_text(data, name):
    """A scanned PDF (no text layer): let the AI read the pages."""
    b64 = base64.b64encode(data).decode()
    body = {"model": MODEL, "reasoning": {"effort": "minimal"}, "input": [{"role": "user", "content": [
        {"type": "input_file", "filename": name, "file_data": f"data:application/pdf;base64,{b64}"},
        {"type": "input_text", "text": "Transcribe all the text in this document in reading order. Describe any diagram in one short line in [brackets]. Output only the content."}]}]}
    return _text(_call(body, timeout=170)).strip()


# ---------- the plan ----------
PLAN_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["title", "emoji", "topics"],
    "properties": {
        "title": {"type": "string", "description": "a short name for this study set, max 6 words"},
        "emoji": {"type": "string", "description": "one emoji that fits the subject"},
        "topics": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["title", "summary", "points"],
            "properties": {
                "title": {"type": "string", "description": "topic name, max 8 words"},
                "summary": {"type": "string", "description": "1-2 sentences: what the student will learn"},
                "points": {"type": "array", "items": {"type": "string"}, "description": "4-7 key ideas, terms or facts in this topic"},
            }}},
    },
}

OUTLINE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["outline"], "properties": {"outline": {"type": "string"}}}

PLAN_SYSTEM = f"""You are a study coach turning a student's material into a study plan.
Split it into 5-14 topics in the order they should be learned (fewer for short material). Each topic is one sitting
(10-20 minutes): not too broad, not a single fact. Cover everything the material covers and invent nothing it doesn't.
{LANG}"""


def _chunks(text, size=12000):
    out, cur = [], ""
    for para in re.split(r"\n{2,}", text):
        if len(cur) + len(para) > size and cur:
            out.append(cur)
            cur = ""
        cur += para + "\n\n"
        while len(cur) > size * 1.5:                                 # one gigantic paragraph
            out.append(cur[:size]); cur = cur[size:]
    if cur.strip():
        out.append(cur)
    return out


def make_plan(text, hint="", on_status=None):
    """Material -> {title, emoji, topics[]}. Long material is outlined in parallel first."""
    say = on_status or (lambda s: None)
    source = text
    if len(text) > 45000:
        parts = _chunks(text, max(12000, -(-len(text) // 24)))          # long documents: at most about 24 bigger sections, outlined side by side
        say(f"Reading {len(parts)} sections…")
        def outline(part):
            return ask_json("Outline this section of study material in about 250 words: every topic, term and fact worth learning. " + LANG,
                            part, OUTLINE_SCHEMA, "outline", model=FAST, effort="minimal")["outline"]
        with ThreadPoolExecutor(max_workers=12) as pool:
            source = "\n\n".join(f"[Section {i + 1}]\n{o}" for i, o in enumerate(pool.map(outline, parts[:30])))
    say("Planning your topics…")
    plan = ask_json(PLAN_SYSTEM, (f"Student's hint about it: {hint}\n\n" if hint else "") + source[:60000], PLAN_SCHEMA, "plan", effort="minimal")
    plan["topics"] = [t for t in plan["topics"] if t["title"].strip()][:16]
    if not plan["topics"]:
        raise AIError("I couldn't find anything to study in that. Try a file with more text.")
    return plan


# ---------- retrieval: the parts of the material that matter for a question ----------
_WORD = re.compile(r"\w{3,}", re.UNICODE)


def relevant(text, query, limit=6000, size=1100):
    """The chunks of `text` that share the most (rarer) words with `query`: a small, dependable stand-in for a vector search."""
    if len(text) <= limit:
        return text
    chunks = [text[i:i + size] for i in range(0, len(text), size - 150)]
    q = set(_WORD.findall(query.lower()))
    df = {}
    toks = []
    for c in chunks:
        t = set(_WORD.findall(c.lower()))
        toks.append(t)
        for w in t:
            df[w] = df.get(w, 0) + 1
    n = len(chunks)
    scored = sorted(range(n), key=lambda i: -sum(1.0 / df[w] ** 0.5 for w in q & toks[i]))
    picked = sorted(scored[:max(1, limit // size)])
    return "\n…\n".join(chunks[i] for i in picked)


# ---------- inside a topic ----------
NOTES_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["notes"], "properties": {"notes": {"type": "string"}}}
CARDS_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["cards"], "properties": {"cards": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["front", "back"],
    "properties": {"front": {"type": "string"}, "back": {"type": "string"}}}}}}
QUIZ_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["questions"], "properties": {"questions": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["q", "options", "answer", "why"],
    "properties": {"q": {"type": "string"}, "options": {"type": "array", "items": {"type": "string"}},
                   "answer": {"type": "integer", "description": "index (0-3) of the right option"},
                   "why": {"type": "string", "description": "one sentence on why that is right"}}}}}}


def _topic_prompt(topic, context):
    pts = "; ".join(json.loads(topic.get("points") or "[]"))
    return f"TOPIC: {topic['title']}\nWHAT IT COVERS: {topic['summary']}\nKEY IDEAS: {pts}\n\nSTUDY MATERIAL:\n{context}"


def make_notes(topic, context):
    system = f"""You write a clear, friendly study page for ONE topic, from the student's own material.
Use markdown: a one-line hook, then short ## sections, bullets, **bold** key terms, a tiny example when it helps, and end with a
"## Remember" section of 3 bullets. 350-550 words. Teach it so it's easy to understand the first time. Never add facts the material
doesn't support. {LANG}"""
    return ask_json(system, _topic_prompt(topic, context), NOTES_SCHEMA, "notes")["notes"].strip()


def make_cards(topic, context, n=10, avoid=()):
    system = f"""You write flashcards for ONE topic from the student's material. {n} cards: each front is a question, term or prompt
(never a yes/no question); each back is a short, complete answer (1-2 sentences). Cover the most important ideas first. No two cards
asking the same thing. {LANG}"""
    note = ("\nThe student already has cards for: " + " | ".join(list(avoid)[:40]) + "\nWrite DIFFERENT ones.") if avoid else ""
    return ask_json(system, _topic_prompt(topic, context) + note, CARDS_SCHEMA, "cards", effort="minimal")["cards"]


LEVELS = {
    "easy": "Difficulty: EASY: straight recall of definitions and key facts.",
    "medium": "Difficulty: MEDIUM: a mix of recall and understanding.",
    "hard": "Difficulty: HARD: application, comparison and 'what would happen if' reasoning; wrong options built on subtle mix-ups.",
    "mixed": "Difficulty: MIXED: some easy, mostly medium, a few hard.",
}


def make_quiz(topic, context, n=6, level="medium"):
    system = f"""You write a multiple-choice quiz for ONE topic from the student's material: {n} questions, exactly 4 options each,
one clearly right answer, the wrong ones plausible but clearly wrong to someone who studied. {LEVELS.get(level, LEVELS["medium"])}
Spread the right answer over positions A-D. No "all of the above". `why` explains the answer in one sentence. {LANG}"""
    good = []
    for _ in range(2):                                               # a short or broken quiz gets one more try
        qs = ask_json(system, _topic_prompt(topic, context), QUIZ_SCHEMA, "quiz", effort="minimal")["questions"]
        good = [q for q in qs if len(q["options"]) == 4 and 0 <= q["answer"] < 4 and q["q"].strip()]
        if len(good) >= min(n, 5):
            break
    return good


SWIPE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["cards"], "properties": {"cards": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["q", "options", "answer", "why"],
    "properties": {"q": {"type": "string"}, "options": {"type": "array", "items": {"type": "string"}},
                   "answer": {"type": "integer", "description": "0 or 1: which of the two options is right"},
                   "why": {"type": "string", "description": "one short sentence on why"}}}}}}


def make_swipes(topic, context, n=14, avoid=()):
    system = f"""You write cards for a swipe game that tests ONE topic from the student's material. A character shows a card; the student
swipes toward one of TWO answers. Write {n} cards. Each card: `q` is a short question or claim (max 18 words); `options` is exactly two
short answers (max 6 words each): one right, and one TEMPTING wrong answer built on a common mix-up or misconception, never silly.
About one card in three can be a true/false claim with options "True" and "False" (then `q` is a one-sentence claim; make about half
of those claims FALSE: subtly wrong versions of real facts).
Put the right answer first about half the time and second the other half (`answer` is its index, 0 or 1). `why` is one short sentence.
Cover different ideas; ask only what the material supports. {LANG}"""
    note = ("\nAlready used (don't repeat): " + " | ".join(list(avoid)[:20])) if avoid else ""
    cards = ask_json(system, _topic_prompt(topic, context) + note, SWIPE_SCHEMA, "swipes", effort="minimal")["cards"]
    return [c for c in cards if len(c["options"]) == 2 and c["answer"] in (0, 1) and c["q"].strip() and all(o.strip() for o in c["options"])]


EXPLAIN_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["score", "verdict", "got", "missing", "tip"], "properties": {
    "score": {"type": "integer", "description": "0-100: how accurate and complete the explanation is"},
    "verdict": {"type": "string", "description": "a short encouraging headline"},
    "got": {"type": "array", "items": {"type": "string"}, "description": "2-4 things they explained well"},
    "missing": {"type": "array", "items": {"type": "string"}, "description": "1-4 important ideas they missed or got wrong, each with the correct idea"},
    "tip": {"type": "string", "description": "one sentence on how to explain it better next time"}}}


def grade_explanation(topic, context, text):
    system = f"""A student is explaining ONE topic in their own words (the Feynman technique). Grade it against their study material:
score 0-100 for accuracy and completeness (a good, simple, mostly complete explanation is 80-90; vague is 40-60). Be kind and specific.
`got`: what they explained well. `missing`: important ideas they left out or got wrong, each stated correctly in a short phrase.
Never penalise simple wording. Reply in the language the student wrote in."""
    r = ask_json(system, _topic_prompt(topic, context) + f"\n\nTHE STUDENT'S EXPLANATION:\n{text}", EXPLAIN_SCHEMA, "explain", effort="minimal")
    r["score"] = max(0, min(100, r["score"]))
    return r


PODCAST_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["title", "lines"], "properties": {
    "title": {"type": "string"},
    "lines": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["host", "text"],
                                          "properties": {"host": {"type": "string", "enum": ["A", "B"]}, "text": {"type": "string"}}}}}}


def make_podcast(topic, context):
    """A short two-host episode about one topic: easy to listen to on a walk."""
    system = f"""You write a short, friendly audio episode (a podcast) for a student, about ONE topic from their material.
Two hosts: A (curious, asks the questions a student would ask, a little funny) and B (knows the material, explains with simple
examples and analogies). About 450-550 words in total: 22-28 lines of 15-35 words each, spoken language (contractions, no bullet points, no markdown).
Flow: a quick hook, then 3-4 key ideas one at a time, an everyday example, a 2-question recap where A asks and B answers, a warm
sign-off. Say only what the material supports. `title` is a catchy episode name. {LANG}"""
    ep = ask_json(system, _topic_prompt(topic, context), PODCAST_SCHEMA, "podcast", effort="minimal")
    ep["lines"] = [l for l in ep["lines"] if l["text"].strip()]
    return ep


SHEET_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["sheet"], "properties": {"sheet": {"type": "string"}}}


def make_cheatsheet(title, digest):
    """One page of the most exam-relevant things across the whole study set."""
    system = f"""You make a ONE-PAGE exam cheat sheet from a student's study set. Markdown: for each topic a ## heading and 3-6 tight
bullets (key definitions, formulas, rules, dates, steps) with **bold** key terms, at most about 60 words per topic; add a final
"## Common mistakes" with 3-5 bullets and a "## Memory tricks" with 2-3 mnemonics or one-liners. It must fit on one printed page
(around 600-800 words in total, fewer for small sets): dense, scannable, no filler. Use only what the material says. {LANG}"""
    return ask_json(system, f"STUDY SET: {title}\n\n{digest}", SHEET_SCHEMA, "sheet", effort="minimal")["sheet"].strip()


SOLVE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["solution", "final"], "properties": {
    "solution": {"type": "string", "description": "the worked solution in markdown, step by step"},
    "final": {"type": "string", "description": "the final answer in one short line"}}}


def solve(question, image=None, mime="image/png", context=""):
    """A question typed or photographed (a textbook problem, a past paper): worked out step by step, using the student's own material."""
    system = f"""You are a patient tutor. The student sends a question (typed, as a photo, or both). Solve it step by step: show each step in
plain language, name the idea or formula used at each step, and finish with a clear final answer. Then add one line on the concept to review.
If the question is about the student's material, use their material (below) and its notation. If you cannot read part of the photo, say which
part. Reply in the language of the question. Markdown.

THE STUDENT'S MATERIAL (may help):
{context[:7000]}"""
    parts = []
    if question.strip():
        parts.append({"type": "input_text", "text": question.strip()})
    if image:
        b64 = base64.b64encode(image).decode()
        parts.append({"type": "input_image", "image_url": f"data:{mime};base64,{b64}"})
    body = {"model": MODEL, "reasoning": {"effort": "minimal"},
            "input": [{"role": "system", "content": system}, {"role": "user", "content": parts or [{"type": "input_text", "text": "(no question)"}]}],
            "text": {"format": {"type": "json_schema", "name": "solve", "schema": SOLVE_SCHEMA, "strict": True}}}
    return json.loads(_text(_call(body, timeout=170)))


# ---------- the tutor ----------
def _sse(resp):
    for raw in resp.iter_lines():
        line = raw.decode("utf-8", "replace")
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            yield json.loads(data)
        except ValueError:
            continue


GUIDED = """You are Cramly, a warm, encouraging tutor teaching ONE student from THEIR material (below). Teach step by step:
explain one small idea in 2-4 sentences, then ask ONE short question to check they got it, then wait. When they answer, say what's right,
fix what's wrong kindly, and move on. If they say they don't understand, try a different way (an example, an analogy). Praise effort,
not cleverness. Keep every reply under 110 words. Use the material first; if it doesn't cover something, say so before adding general knowledge."""

ASK = """You are Cramly, a clear, friendly tutor answering a student's question using THEIR study material (below) first. Answer directly
and briefly (under 150 words unless they ask for more): lead with the answer, then the why. If the material doesn't cover it, say so, then
help from general knowledge and mark it "(beyond your notes)". Use markdown lightly: bullets and **bold** terms."""


STYLES = {
    "eli5": "STYLE: explain like the student is 10 years old: tiny words, everyday comparisons, short sentences, then one real term.",
    "coach": "STYLE: be an exam coach: focus on what examiners ask, point out common traps, give a mark-scheme style answer, keep it brisk.",
    "strict": "STYLE: be a strict Socratic tutor: don't give the answer straight away, ask a guiding question first, and only explain after two tries.",
    "buddy": "STYLE: be a funny study buddy: casual, light jokes, emojis now and then, but always accurate.",
}


def chat(mode, context, messages, style=""):
    """Yield the tutor's reply piece by piece."""
    system = (GUIDED if mode == "guided" else ASK) + "\n" + STYLES.get(style, "") + "\nReply in the language the student writes in.\n\n" + context
    body = {"model": _pick(), "stream": True, "reasoning": {"effort": "minimal"},
            "input": [{"role": "system", "content": system}] + messages[-14:]}
    with requests.post(URL, headers=_headers(), json=body, stream=True, timeout=(10, 120)) as resp:
        if not resp.ok:
            log.error("chat %s: %s", resp.status_code, resp.text[:300])
            raise AIError("The tutor is busy right now. Try again in a moment.")
        for ev in _sse(resp):
            if ev.get("type") == "response.output_text.delta":
                yield ev.get("delta", "")


# ---------- more study tools: glossary, exam predictor, mix-ups, boosters, practice lab, grader ----------
def _obj(props, req=None):
    return {"type": "object", "additionalProperties": False, "required": req or list(props), "properties": props}


def _arr(item):
    return {"type": "array", "items": item}


S = {"type": "string"}
GLOSSARY_SCHEMA = _obj({"terms": _arr(_obj({"term": S, "definition": S}))})
PREDICTOR_SCHEMA = _obj({"questions": _arr(_obj({"q": S, "answer": S, "marks": {"type": "integer"}, "topic": S, "why_likely": S}))})
MIXUPS_SCHEMA = _obj({"pairs": _arr(_obj({"a": S, "b": S, "difference": S, "tip": S}))})
BOOST_SCHEMA = _obj({"analogies": _arr(S), "mnemonics": _arr(S), "example": S, "common_mistake": S})
LAB_SCHEMA = _obj({"cloze": _arr(_obj({"text": S, "answer": S, "hint": S})),
                   "tf": _arr(_obj({"statement": S, "answer": {"type": "boolean"}, "why": S}))})
GRADE_SCHEMA = _obj({"score": {"type": "integer"}, "verdict": S, "strengths": _arr(S), "fixes": _arr(S), "improved": S})
PROMPT_SCHEMA = _obj({"prompt": S})


def make_glossary(title, digest):
    system = f"""You build a glossary for a student's study set: the 20-30 most important terms, names and concepts, each with a
short, clear definition (1-2 sentences) that uses only what the material says. Order them the way the material introduces them.
No duplicates. {LANG}"""
    terms = ask_json(system, f"STUDY SET: {title}\n\n{digest}", GLOSSARY_SCHEMA, "glossary", effort="minimal")["terms"]
    return [t for t in terms if t["term"].strip() and t["definition"].strip()][:40]


def make_predictor(title, digest, n=10):
    system = f"""You are an experienced examiner. From the student's material, predict the {n} questions most likely to appear on an
exam: a mix of define, explain, compare and apply. For each give a model answer worth full marks (2-5 sentences, using only the
material), the marks (1-6), the topic, and one short line on why it is likely to be asked. {LANG}"""
    qs = ask_json(system, f"STUDY SET: {title}\n\n{digest}", PREDICTOR_SCHEMA, "predictor", effort="minimal")["questions"]
    return [q for q in qs if q["q"].strip() and q["answer"].strip()][:n + 4]


def make_mixups(title, digest):
    system = f"""From the student's material pick 6-10 pairs of ideas that students most often mix up (similar names, similar
processes, opposite effects). For each pair: the two items (a, b), the key difference in one or two sentences, and a memory tip
that keeps them apart. Only pairs the material actually supports. {LANG}"""
    pairs = ask_json(system, f"STUDY SET: {title}\n\n{digest}", MIXUPS_SCHEMA, "mixups", effort="minimal")["pairs"]
    return [p for p in pairs if p["a"].strip() and p["b"].strip()][:12]


def make_boost(topic, context):
    system = f"""You help a student remember ONE topic. Give 2 analogies from everyday life, 2 memorable mnemonics or rhymes (or
vivid mental pictures), one concrete real-world example, and the single most common mistake students make with it. Accurate first,
fun second. Short: each item at most 2 sentences. {LANG}"""
    return ask_json(system, _topic_prompt(topic, context), BOOST_SCHEMA, "boost", effort="minimal")


def make_lab(topic, context):
    system = f"""You write quick-fire practice for ONE topic. 8 fill-in-the-blank sentences: `text` is a sentence from the material with
the key term replaced by ____ (exactly one blank), `answer` is the missing word or short phrase, `hint` is a short clue.
Then 8 true/false statements (about half false, the false ones plausible), each with the answer and a one-sentence explanation.
Use only the material. {LANG}"""
    d = ask_json(system, _topic_prompt(topic, context), LAB_SCHEMA, "lab", effort="minimal")
    d["cloze"] = [c for c in d["cloze"] if "____" in c["text"] and c["answer"].strip()]
    return d


def make_prompt(topic, context):
    system = f"""Write ONE good written-answer exam question for this topic, the kind that needs 3-6 sentences (explain, compare or
apply; not a yes/no or one-word question). Only the question. {LANG}"""
    return ask_json(system, _topic_prompt(topic, context), PROMPT_SCHEMA, "prompt", model=FAST, effort="minimal")["prompt"].strip()


def grade_answer(topic, context, prompt, answer):
    system = f"""You are a fair, encouraging examiner marking a student's written answer against THEIR study material.
Give `score` 0-100, a one-sentence `verdict`, up to 3 `strengths` (what they got right), up to 4 `fixes` (what is missing, wrong or
unclear, each one concrete), and `improved`: a better version of their answer in their own voice, kept about the same length,
using only the material. Never invent facts that are not in the material. Reply in the language of the student's answer."""
    user = f"{_topic_prompt(topic, context)}\n\nQUESTION: {prompt}\n\nSTUDENT'S ANSWER:\n{answer[:3000]}"
    d = ask_json(system, user, GRADE_SCHEMA, "grade", effort="minimal")
    d["score"] = max(0, min(100, int(d["score"])))
    return d


# ---------- a natural voice for the tutor call (Premium Plus) ----------
TTS_MODEL = os.environ.get("TTS_MODEL", "gpt-4o-mini-tts")
VOICES = ("coral", "nova", "sage", "ash")


def speech(text, voice="coral"):
    """MP3 bytes of `text` read aloud in a warm, human voice."""
    body = {"model": TTS_MODEL, "voice": voice if voice in VOICES else "coral", "input": str(text)[:600], "response_format": "mp3"}
    if TTS_MODEL.startswith("gpt-4o"):
        body["instructions"] = "Speak like a warm, encouraging tutor on a phone call: natural, relaxed pace, clear and friendly."
    try:
        r = requests.post("https://api.openai.com/v1/audio/speech", headers=_headers(), json=body, timeout=(10, 40))
    except requests.RequestException:
        raise AIError("The voice is unavailable right now.")
    if not r.ok:
        raise AIError("The voice is unavailable right now.")
    return r.content


# ---------- summariser, quick cards, essay outline, weak-card improver ----------
SUMMARY_SCHEMA = _obj({"short": S, "bullets": _arr(S), "detailed": S, "terms": _arr(S)})
OUTLINE_SCHEMA2 = _obj({"thesis": S, "sections": _arr(_obj({"heading": S, "points": _arr(S)})), "evidence": _arr(S), "conclusion": S})
IMPROVE_SCHEMA = _obj({"cards": _arr(_obj({"id": {"type": "integer"}, "front": S, "back": S, "tip": S}))})


def summarize(text):
    system = f"""Summarise the text the student pasted. Give: `short` (one or two sentences), `bullets` (5-8 tight bullets with the
facts that matter), `detailed` (3-4 short paragraphs a student could revise from), and `terms` (up to 8 key terms worth learning).
Use only what the text says. {LANG}"""
    return ask_json(system, text[:30000], SUMMARY_SCHEMA, "summary", effort="minimal")


def quick_cards(text, n=10):
    system = f"""Turn the pasted text into {n} flashcards: each front is a question or prompt (never yes/no), each back a short, complete
answer (1-2 sentences). Cover the most important ideas first, no duplicates, only what the text says. {LANG}"""
    return ask_json(system, text[:20000], CARDS_SCHEMA, "cards", effort="minimal")["cards"]


def make_essay_outline(title, digest, question):
    system = f"""You help a student plan a written answer. From THEIR material only, build an outline for the question: a one-sentence
`thesis`, 3-5 `sections` (a heading and 2-4 points each, in the order a good answer would make them), the `evidence` from the material
worth quoting or citing, and a one-sentence `conclusion`. {LANG}"""
    return ask_json(system, f"QUESTION: {question[:400]}\n\nSTUDY SET: {title}\n\n{digest}", OUTLINE_SCHEMA2, "outline", effort="minimal")


def improve_cards(topic, context, cards):
    system = f"""These flashcards keep being forgotten. Rewrite each so it is easier to remember: a clearer, shorter question on the front,
a crisp answer on the back (at most 2 sentences), and a `tip` (a memory hook, picture or mnemonic). Keep the same id and the same
fact; do not add facts that are not in the material. {LANG}"""
    listing = "\n".join(f"[{c['id']}] FRONT: {c['front']} | BACK: {c['back']}" for c in cards)
    return ask_json(system, f"{_topic_prompt(topic, context)}\n\nCARDS TO IMPROVE:\n{listing}", IMPROVE_SCHEMA, "improve", effort="minimal")["cards"]


# ---------- rewrite the notes: simpler, shorter, deeper or translated (Premium Plus) ----------
REWRITE_SCHEMA = _obj({"text": S})
REWRITE_MODES = {
    "simpler": "Rewrite the notes in much simpler words for someone new to the topic: short sentences, everyday comparisons, define every term the first time.",
    "shorter": "Rewrite the notes as a tight revision version: about a third of the length, bullets for facts, **bold** key terms, nothing that is not essential.",
    "deeper": "Rewrite the notes at a more advanced level: add the reasoning behind each fact, how the parts connect, and one worked example, using only what the material supports.",
    "translate": "Translate the notes faithfully into {lang}. Keep the structure, headings, bullets and formulas. Keep technical terms recognisable (add the original in brackets the first time).",
}


def rewrite_notes(topic, notes, mode, lang="English"):
    system = f"""You rewrite a student's study notes. {REWRITE_MODES[mode].format(lang=lang)} Output markdown with the same kind of headings
and bullets the notes use. Never invent facts that are not in the notes."""
    return ask_json(system, f"TOPIC: {topic['title']}\n\nNOTES:\n{notes[:12000]}", REWRITE_SCHEMA, "rewrite", effort="minimal")["text"].strip()
