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
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
FAST = os.environ.get("FAST_MODEL", "gpt-5-nano")


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


def ask_json(system, user, schema, name, model=None, effort="low", extra_parts=None):
    content = [{"type": "input_text", "text": user}] + (extra_parts or [])
    body = {"model": model or MODEL,
            "input": [{"role": "system", "content": system}, {"role": "user", "content": content}],
            "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}}}
    if (model or MODEL).startswith(("gpt-5", "o")):
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
        parts = _chunks(text)
        say(f"Reading {len(parts)} sections…")
        def outline(part):
            return ask_json("Outline this section of study material in about 200 words: every topic, term and fact worth learning. " + LANG,
                            part, OUTLINE_SCHEMA, "outline", model=FAST, effort="minimal")["outline"]
        with ThreadPoolExecutor(max_workers=6) as pool:
            source = "\n\n".join(f"[Section {i + 1}]\n{o}" for i, o in enumerate(pool.map(outline, parts[:40])))
    say("Planning your topics…")
    plan = ask_json(PLAN_SYSTEM, (f"Student's hint about it: {hint}\n\n" if hint else "") + source[:60000], PLAN_SCHEMA, "plan", effort="low")
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


def make_cards(topic, context, n=10):
    system = f"""You write flashcards for ONE topic from the student's material. {n} cards: each front is a question, term or prompt
(never a yes/no question); each back is a short, complete answer (1-2 sentences). Cover the most important ideas first. No two cards
asking the same thing. {LANG}"""
    return ask_json(system, _topic_prompt(topic, context), CARDS_SCHEMA, "cards", effort="minimal")["cards"]


def make_quiz(topic, context, n=6):
    system = f"""You write a multiple-choice quiz for ONE topic from the student's material: {n} questions, exactly 4 options each,
one clearly right answer, the wrong ones plausible but clearly wrong to someone who studied. Mix recall and understanding. Spread the
right answer over positions A-D. No "all of the above". `why` explains the answer in one sentence. {LANG}"""
    good = []
    for _ in range(2):                                               # a short or broken quiz gets one more try
        qs = ask_json(system, _topic_prompt(topic, context), QUIZ_SCHEMA, "quiz", effort="low")["questions"]
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
    cards = ask_json(system, _topic_prompt(topic, context) + note, SWIPE_SCHEMA, "swipes", effort="low")["cards"]
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
    r = ask_json(system, _topic_prompt(topic, context) + f"\n\nTHE STUDENT'S EXPLANATION:\n{text}", EXPLAIN_SCHEMA, "explain", effort="low")
    r["score"] = max(0, min(100, r["score"]))
    return r


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


def chat(mode, context, messages):
    """Yield the tutor's reply piece by piece."""
    system = (GUIDED if mode == "guided" else ASK) + "\nReply in the language the student writes in.\n\n" + context
    body = {"model": MODEL, "stream": True, "reasoning": {"effort": "minimal"},
            "input": [{"role": "system", "content": system}] + messages[-14:]}
    with requests.post(URL, headers=_headers(), json=body, stream=True, timeout=(10, 120)) as resp:
        if not resp.ok:
            log.error("chat %s: %s", resp.status_code, resp.text[:300])
            raise AIError("The tutor is busy right now. Try again in a moment.")
        for ev in _sse(resp):
            if ev.get("type") == "response.output_text.delta":
                yield ev.get("delta", "")
