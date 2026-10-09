"""Cramly: turn your notes, slides, PDFs and photos into a study plan with a tutor, notes, flashcards and quizzes.

No passwords: the first visit makes an account and this browser keeps a private key; other devices join with a 6-digit
code. The AI never sees anything but what you upload."""

import datetime as dt
import json
import logging
import math
import os
import queue
import random
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("cramly")

import ai  # noqa: E402
import db  # noqa: E402
import ingest  # noqa: E402
from db import delete, insert, select, update  # noqa: E402

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024
BASE = os.path.dirname(os.path.abspath(__file__))
MAX_SETS = 30
INTERVAL_DAYS = [0, 1, 3, 7, 14, 30]                                   # Leitner boxes 0..5

_hits, _hits_lock = {}, threading.Lock()
_topic_locks, _locks_lock = {}, threading.Lock()


def limited(bucket, per_hour):
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "?")).split(",")[0].strip()
    now = time.time()
    with _hits_lock:
        recent = [t for t in _hits.get((bucket, ip), []) if now - t < 3600]
        blocked = len(recent) >= per_hour
        if not blocked:
            recent.append(now)
        _hits[(bucket, ip)] = recent
    return blocked


def me():
    key = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    return db.user_for(key)


def need_user(fn):
    def wrapped(*a, **k):
        user = me()
        if not user:
            return jsonify(error="Not signed in."), 401
        return fn(user, *a, **k)
    wrapped.__name__ = fn.__name__
    return wrapped


def own_set(user, set_id):
    return db.one(select(db.sets).where(db.sets.c.id == set_id, db.sets.c.user_id == user["id"]))


def own_topic(user, topic_id):
    t = db.one(select(db.topics).where(db.topics.c.id == topic_id))
    return t if t and own_set(user, t["set_id"]) else None


def need_ai():
    if not os.environ.get("OPENAI_API_KEY"):
        return jsonify(error="The AI isn't connected yet."), 503
    return None


def _version():
    files = [os.path.join(BASE, "static", f) for f in os.listdir(os.path.join(BASE, "static"))]
    return str(int(max(os.path.getmtime(f) for f in files)))


@app.after_request
def headers(resp):
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
    if request.headers.get("X-Forwarded-Proto", request.scheme) == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    elif request.path.startswith("/static/"):
        h["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") else "public, max-age=3600"
    return resp


@app.route("/")
def index():
    resp = app.make_response(render_template("index.html", v=_version()))
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/manifest.webmanifest")
def manifest():
    icon = lambda f, size, purpose="any": {"src": f"/static/{f}", "sizes": size, "type": "image/png", "purpose": purpose}
    resp = jsonify(name="Cramly", short_name="Cramly", description="Study smarter from your own notes.", start_url="/", display="standalone",
                   background_color="#f7f2e8", theme_color="#f7f2e8",
                   icons=[icon("icon-192.png", "192x192"), icon("icon-512.png", "512x512"), icon("icon-maskable.png", "512x512", "maskable")])
    resp.mimetype = "application/manifest+json"
    return resp


@app.route("/sw.js")
def service_worker():
    resp = app.send_static_file("sw.js")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.route("/healthz")
def healthz():
    return "ok"


# ---------- days, streaks ----------
def local_today():
    """The student's today, from the browser's time-zone offset (minutes, as JavaScript reports it)."""
    try:
        off = int(request.headers.get("X-Tz-Offset", "0"))
    except ValueError:
        off = 0
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=off)).date()


def record_activity(user):
    day = local_today().isoformat()
    row = db.one(select(db.activity).where(db.activity.c.user_id == user["id"], db.activity.c.day == day))
    if row:
        db.run(update(db.activity).where(db.activity.c.id == row["id"]).values(n=row["n"] + 1))
    else:
        db.run(insert(db.activity).values(user_id=user["id"], day=day, n=1))


def streak(user):
    days = {r["day"] for r in db.many(select(db.activity.c.day).where(db.activity.c.user_id == user["id"]))}
    d, n = local_today(), 0
    if d.isoformat() not in days:
        d -= dt.timedelta(days=1)                                     # today isn't over: yesterday still counts
    while d.isoformat() in days:
        n += 1
        d -= dt.timedelta(days=1)
    return n


# ---------- account ----------
@app.post("/api/account")
def create_account():
    if limited("account", 10):
        return jsonify(error="Too many new accounts from here. Try again later."), 429
    b = request.get_json(silent=True) or {}
    uid = db.run(insert(db.users).values(name=re.sub(r"[^\w .'-]", "", str(b.get("name") or ""), flags=re.UNICODE).strip()[:40], created=time.time()))
    return jsonify(key=db.new_device(uid))


def _due_count(user_id):
    q = (select(db.func.count()).select_from(db.cards.join(db.sets, db.cards.c.set_id == db.sets.c.id))
         .where(db.sets.c.user_id == user_id, db.cards.c.due <= time.time()))
    with db.engine.connect() as c:
        return c.execute(q).scalar() or 0


@app.get("/api/me")
@need_user
def get_me(user):
    return jsonify(name=user["name"], streak=streak(user), due=_due_count(user["id"]), today=local_today().isoformat(),
                   ai=bool(os.environ.get("OPENAI_API_KEY")))


@app.patch("/api/me")
@need_user
def patch_me(user):
    b = request.get_json(silent=True) or {}
    if "name" in b:
        db.run(update(db.users).where(db.users.c.id == user["id"]).values(name=re.sub(r"[^\w .'-]", "", str(b["name"]), flags=re.UNICODE).strip()[:40]))
    return jsonify(ok=True)


def purge_set(set_id):
    """A study set and everything in it (explicitly: not every database enforces cascades)."""
    for t in (db.cards, db.topics, db.materials):
        db.run(delete(t).where(t.c.set_id == set_id))
    db.run(delete(db.sets).where(db.sets.c.id == set_id))


@app.delete("/api/me")
@need_user
def delete_me(user):
    for s in db.many(select(db.sets.c.id).where(db.sets.c.user_id == user["id"])):
        purge_set(s["id"])
    for t in (db.activity, db.pair_codes, db.devices):
        db.run(delete(t).where(t.c.user_id == user["id"]))
    db.run(delete(db.users).where(db.users.c.id == user["id"]))
    return jsonify(ok=True)


@app.post("/api/pair")
@need_user
def pair(user):
    code = f"{secrets.randbelow(10**6):06d}"
    db.run(delete(db.pair_codes).where(db.pair_codes.c.expires < time.time()))
    db.run(insert(db.pair_codes).values(code=code, user_id=user["id"], expires=time.time() + 600))
    return jsonify(code=code, expires_in=600)


@app.post("/api/pair/claim")
def pair_claim():
    if limited("pair", 20):
        return jsonify(error="Too many tries. Wait a while."), 429
    code = re.sub(r"\D", "", str((request.get_json(silent=True) or {}).get("code", "")))
    row = db.one(select(db.pair_codes).where(db.pair_codes.c.code == code))
    if not row or row["expires"] < time.time():
        return jsonify(error="That code is wrong or expired. Make a new one."), 400
    db.run(delete(db.pair_codes).where(db.pair_codes.c.code == code))
    return jsonify(key=db.new_device(row["user_id"]))


# ---------- sets ----------
def _stats(set_row, topics, due):
    n = len(topics)
    covered = sum(1 for t in topics if t["status"] >= 1)
    mastered = sum(1 for t in topics if t["status"] >= 2)
    return {"id": set_row["id"], "title": set_row["title"], "emoji": set_row["emoji"], "hue": set_row["hue"], "exam": set_row["exam"],
            "topics": n, "covered": covered, "mastered": mastered, "due": due, "opened": set_row["opened"]}


@app.get("/api/sets")
@need_user
def list_sets(user):
    out = []
    now = time.time()
    for s in db.many(select(db.sets).where(db.sets.c.user_id == user["id"]).order_by(db.sets.c.opened.desc(), db.sets.c.created.desc())):
        topics = db.many(select(db.topics.c.status).where(db.topics.c.set_id == s["id"]))
        with db.engine.connect() as c:
            due = c.execute(select(db.func.count()).select_from(db.cards).where(db.cards.c.set_id == s["id"], db.cards.c.due <= now)).scalar() or 0
        out.append(_stats(s, topics, due))
    return jsonify(sets=out)


def _topic_view(t, card_counts):
    total, due = card_counts.get(t["id"], (0, 0))
    return {"id": t["id"], "idx": t["idx"], "title": t["title"], "summary": t["summary"], "points": json.loads(t["points"] or "[]"),
            "status": t["status"], "has_notes": bool(t["notes"]), "has_quiz": bool(t["quiz"]), "quiz_best": t["quiz_best"],
            "cards": total, "due": due}


def _card_counts(set_id):
    now = time.time()
    out = {}
    for c in db.many(select(db.cards.c.topic_id, db.cards.c.due).where(db.cards.c.set_id == set_id)):
        total, due = out.get(c["topic_id"], (0, 0))
        out[c["topic_id"]] = (total + 1, due + (1 if c["due"] <= now else 0))
    return out


def schedule(exam, topics, today):
    """Spread the topics you haven't mastered over the days until the exam, keeping the last day free for review."""
    try:
        exam_day = dt.date.fromisoformat(exam)
    except (TypeError, ValueError):
        return []
    days = (exam_day - today).days
    todo = [t for t in topics if t["status"] < 2]
    if days <= 0 or not todo:
        return []
    study_days = max(1, days - 1) if days > 1 else 1
    per_day = math.ceil(len(todo) / study_days)
    return [(today + dt.timedelta(days=i // per_day), t) for i, t in enumerate(todo)]


@app.get("/api/sets/<int:set_id>")
@need_user
def get_set(user, set_id):
    s = own_set(user, set_id)
    if not s:
        return jsonify(error="Study set not found."), 404
    db.run(update(db.sets).where(db.sets.c.id == set_id).values(opened=time.time()))
    topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
    counts = _card_counts(set_id)
    views = [_topic_view(t, counts) for t in topics]
    mats = db.many(select(db.materials.c.id, db.materials.c.name, db.materials.c.kind, db.materials.c.text).where(db.materials.c.set_id == set_id).order_by(db.materials.c.id))
    plan = [{"date": d.isoformat(), "topic_id": t["id"]} for d, t in schedule(s["exam"], topics, local_today())]
    due = sum(v["due"] for v in views)
    return jsonify(set=_stats(s, topics, due), topics=views, plan=plan,
                   materials=[{"id": m["id"], "name": m["name"], "kind": m["kind"], "chars": len(m["text"])} for m in mats])


@app.patch("/api/sets/<int:set_id>")
@need_user
def patch_set(user, set_id):
    if not own_set(user, set_id):
        return jsonify(error="Study set not found."), 404
    b = request.get_json(silent=True) or {}
    vals = {}
    if "title" in b and str(b["title"]).strip():
        vals["title"] = str(b["title"]).strip()[:120]
    if "exam" in b:
        try:
            vals["exam"] = dt.date.fromisoformat(b["exam"]).isoformat() if b["exam"] else ""
        except (TypeError, ValueError):
            return jsonify(error="That date doesn't look right."), 400
    if vals:
        db.run(update(db.sets).where(db.sets.c.id == set_id).values(**vals))
    return jsonify(ok=True)


@app.delete("/api/sets/<int:set_id>")
@need_user
def delete_set(user, set_id):
    if not own_set(user, set_id):
        return jsonify(error="Study set not found."), 404
    purge_set(set_id)
    return jsonify(ok=True)


# ---------- building a set from files and text (streamed so the page can show progress) ----------
def ev(kind, **data):
    return json.dumps({"type": kind, **data}) + "\n"


def ndjson(gen):
    resp = Response(stream_with_context(gen), mimetype="application/x-ndjson")
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


def with_progress(fn, *args):
    """Run a slow function in a thread; yield its status lines as they come, then its result. Pings keep the stream alive."""
    q = queue.Queue()

    def target():
        try:
            q.put(("result", fn(*args, on_status=lambda s: q.put(("status", s)))))
        except Exception as exc:                                       # shown to the student by the caller
            q.put(("error", exc))
    threading.Thread(target=target, daemon=True).start()
    while True:
        try:
            kind, val = q.get(timeout=12)
        except queue.Empty:
            yield "ping", None
            continue
        if kind == "error":
            raise val
        yield kind, val
        if kind == "result":
            return


def friendly(exc):
    if isinstance(exc, ai.AIError):
        return str(exc)
    log.exception("generation failed")
    return "Something went wrong while building that. Try again."


def read_materials(files, pasted, label):
    """Yields status events, then ("mats", [(name, kind, text)...])."""
    mats = []
    for name, data in files:
        yield "status", f"Reading {name}…"
        kind, text = ingest.read_file(name, data)
        mats.append((name, kind, text))
    if pasted:
        mats.append((label, "lecture" if label.lower().startswith("lecture") else "text", pasted))
    yield "mats", mats


def _combined(mats):
    return "\n\n".join(f"=== {n} ===\n{t}" for n, _, t in mats)[:ingest.MAX_TEXT]


def _upload_inputs():
    files = [(f.filename or "file", f.read()) for f in request.files.getlist("files")[:8]]
    pasted = ingest.clean(request.form.get("text") or "")[:ingest.MAX_TEXT]
    label = (request.form.get("name") or "Pasted notes")[:80]
    return files, pasted, label


@app.post("/api/sets")
@need_user
def create_set(user):
    if (bad := need_ai()):
        return bad
    if limited("build", 12):
        return jsonify(error="That's a lot of new study sets in an hour. Try again a bit later."), 429
    if len(db.many(select(db.sets.c.id).where(db.sets.c.user_id == user["id"]))) >= MAX_SETS:
        return jsonify(error=f"You have {MAX_SETS} study sets already. Delete one to make room."), 400
    files, pasted, label = _upload_inputs()
    hint = (request.form.get("title") or "")[:80].strip()
    if not files and len(pasted) < 80:
        return jsonify(error="Add a file, a photo, or paste some notes (at least a few sentences)."), 400

    def work():
        try:
            mats = []
            for kind, val in read_materials(files, pasted, label):
                if kind == "status":
                    yield ev("status", text=val)
                elif kind == "mats":
                    mats = val
            plan = None
            yield ev("status", text="Reading everything…")
            for kind, val in with_progress(lambda text, h, on_status: ai.make_plan(text, h, on_status), _combined(mats), hint):
                if kind == "status":
                    yield ev("status", text=val)
                elif kind == "ping":
                    yield ev("ping")
                else:
                    plan = val
            now = time.time()
            set_id = db.run(insert(db.sets).values(user_id=user["id"], title=(hint or plan["title"])[:120], emoji=(plan["emoji"] or "📚")[:8],
                                                   hue=random.choice([265, 320, 28, 150, 200, 48]), created=now, opened=now))
            for name, kind, text in mats:
                db.run(insert(db.materials).values(set_id=set_id, name=name, kind=kind, text=text, created=now))
            for i, t in enumerate(plan["topics"]):
                db.run(insert(db.topics).values(set_id=set_id, idx=i, title=t["title"][:160], summary=t["summary"], points=json.dumps(t["points"][:8], ensure_ascii=False)))
            record_activity(user)
            yield ev("set", id=set_id, topics=len(plan["topics"]))
        except Exception as exc:
            yield ev("error", text=friendly(exc))
        yield ev("done")
    return ndjson(work())


@app.post("/api/sets/<int:set_id>/materials")
@need_user
def add_material(user, set_id):
    if (bad := need_ai()):
        return bad
    s = own_set(user, set_id)
    if not s:
        return jsonify(error="Study set not found."), 404
    if limited("build", 12):
        return jsonify(error="That's a lot of uploads in an hour. Try again a bit later."), 429
    files, pasted, label = _upload_inputs()
    if not files and len(pasted) < 80:
        return jsonify(error="Add a file, a photo, or some text."), 400

    def work():
        try:
            mats = []
            for kind, val in read_materials(files, pasted, label):
                if kind == "status":
                    yield ev("status", text=val)
                elif kind == "mats":
                    mats = val
            plan = None
            for kind, val in with_progress(lambda text, h, on_status: ai.make_plan(text, h, on_status), _combined(mats), s["title"]):
                if kind == "status":
                    yield ev("status", text=val)
                elif kind == "ping":
                    yield ev("ping")
                else:
                    plan = val
            now = time.time()
            for name, kind, text in mats:
                db.run(insert(db.materials).values(set_id=set_id, name=name, kind=kind, text=text, created=now))
            have = db.many(select(db.topics.c.title, db.topics.c.idx).where(db.topics.c.set_id == set_id))
            seen = {t["title"].strip().lower() for t in have}
            nxt = max([t["idx"] for t in have] + [-1]) + 1
            added = 0
            for t in plan["topics"]:
                if t["title"].strip().lower() in seen:
                    continue
                db.run(insert(db.topics).values(set_id=set_id, idx=nxt + added, title=t["title"][:160], summary=t["summary"], points=json.dumps(t["points"][:8], ensure_ascii=False)))
                added += 1
            record_activity(user)
            yield ev("added", topics=added)
        except Exception as exc:
            yield ev("error", text=friendly(exc))
        yield ev("done")
    return ndjson(work())


# ---------- inside a topic ----------
def _context(set_id, topic, extra_query=""):
    text = "\n\n".join(m["text"] for m in db.many(select(db.materials.c.text).where(db.materials.c.set_id == set_id).order_by(db.materials.c.id)))
    query = f"{topic['title']} {topic['summary']} {' '.join(json.loads(topic['points'] or '[]'))} {extra_query}"
    return ai.relevant(text, query, limit=9000)


def _topic_lock(topic_id, kind):
    with _locks_lock:
        return _topic_locks.setdefault((topic_id, kind), threading.Lock())


def ensure_notes(topic):
    with _topic_lock(topic["id"], "notes"):
        fresh = db.one(select(db.topics).where(db.topics.c.id == topic["id"]))
        if fresh["notes"]:
            return fresh["notes"]
        notes = ai.make_notes(fresh, _context(fresh["set_id"], fresh))
        db.run(update(db.topics).where(db.topics.c.id == topic["id"]).values(notes=notes))
        return notes


def ensure_cards(topic):
    with _topic_lock(topic["id"], "cards"):
        have = db.many(select(db.cards).where(db.cards.c.topic_id == topic["id"]).order_by(db.cards.c.id))
        if have:
            return have
        made = ai.make_cards(topic, _context(topic["set_id"], topic))
        for c in made[:14]:
            if c["front"].strip() and c["back"].strip():
                db.run(insert(db.cards).values(topic_id=topic["id"], set_id=topic["set_id"], front=c["front"].strip(), back=c["back"].strip(), box=0, due=0, reps=0))
        return db.many(select(db.cards).where(db.cards.c.topic_id == topic["id"]).order_by(db.cards.c.id))


def ensure_quiz(topic):
    with _topic_lock(topic["id"], "quiz"):
        fresh = db.one(select(db.topics).where(db.topics.c.id == topic["id"]))
        if fresh["quiz"]:
            return json.loads(fresh["quiz"])
        qs = ai.make_quiz(fresh, _context(fresh["set_id"], fresh))
        if not qs:
            raise ai.AIError("I couldn't write a good quiz for that topic. Try again.")
        db.run(update(db.topics).where(db.topics.c.id == topic["id"]).values(quiz=json.dumps(qs, ensure_ascii=False)))
        return qs


def _generate(kind):
    @need_user
    def route(user, topic_id):
        if (bad := need_ai()):
            return bad
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        if limited("generate", 150):
            return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429
        try:
            if kind == "notes":
                return jsonify(notes=ensure_notes(t))
            if kind == "cards":
                return jsonify(cards=[_card_view(c) for c in ensure_cards(t)])
            return jsonify(questions=ensure_quiz(t))
        except ai.AIError as exc:
            return jsonify(error=str(exc)), 502
        except Exception:
            log.exception("%s failed", kind)
            return jsonify(error="Couldn't make that just now. Try again."), 502
    route.__name__ = f"topic_{kind}"
    return route


for _kind in ("notes", "cards", "quiz"):
    app.add_url_rule(f"/api/topics/<int:topic_id>/{_kind}", view_func=_generate(_kind), methods=["GET"])


def _card_view(c):
    return {"id": c["id"], "topic_id": c["topic_id"], "front": c["front"], "back": c["back"], "box": c["box"], "due": c["due"] <= time.time()}


@app.post("/api/topics/<int:topic_id>/event")
@need_user
def topic_event(user, topic_id):
    t = own_topic(user, topic_id)
    if not t:
        return jsonify(error="Topic not found."), 404
    b = request.get_json(silent=True) or {}
    kind = b.get("kind")
    status = max(t["status"], 1)
    vals = {"studied": time.time()}
    if kind == "quiz":
        try:
            score, total = int(b.get("score")), max(1, int(b.get("total")))
        except (TypeError, ValueError):
            return jsonify(error="Bad score."), 400
        pct = round(100 * score / total)
        vals["quiz_best"] = max(t["quiz_best"], pct)
        if pct >= 80:
            status = 2
    elif kind not in ("read", "cards", "chat"):
        return jsonify(error="Unknown event."), 400
    vals["status"] = status
    db.run(update(db.topics).where(db.topics.c.id == topic_id).values(**vals))
    record_activity(user)
    return jsonify(status=status, quiz_best=vals.get("quiz_best", t["quiz_best"]))


@app.post("/api/cards/<int:card_id>/review")
@need_user
def review_card(user, card_id):
    c = db.one(select(db.cards).where(db.cards.c.id == card_id))
    if not c or not own_set(user, c["set_id"]):
        return jsonify(error="Card not found."), 404
    try:
        grade = max(0, min(3, int((request.get_json(silent=True) or {}).get("grade"))))     # 0 again, 1 hard, 2 good, 3 easy
    except (TypeError, ValueError):
        return jsonify(error="Bad grade."), 400
    box = c["box"]
    if grade == 0:
        box, wait = 0, 10 * 60
    elif grade == 1:
        wait = 12 * 3600
    else:
        box = min(5, box + (1 if grade == 2 else 2))
        wait = INTERVAL_DAYS[box] * 86400 or 600
    db.run(update(db.cards).where(db.cards.c.id == card_id).values(box=box, due=time.time() + wait, reps=c["reps"] + 1))
    status = None
    mine = db.many(select(db.cards.c.box).where(db.cards.c.topic_id == c["topic_id"]))
    t = db.one(select(db.topics).where(db.topics.c.id == c["topic_id"]))
    if mine and all(m["box"] >= 3 for m in mine):
        status = 2
    elif t["status"] < 1:
        status = 1
    if status and status > t["status"]:
        db.run(update(db.topics).where(db.topics.c.id == t["id"]).values(status=status, studied=time.time()))
    record_activity(user)
    return jsonify(box=box, status=max(status or 0, t["status"]))


@app.post("/api/sets/<int:set_id>/prepare")
@need_user
def prepare_set(user, set_id):
    """Make flashcards (or quizzes) for every topic that doesn't have them yet, in parallel."""
    if (bad := need_ai()):
        return bad
    if not own_set(user, set_id):
        return jsonify(error="Study set not found."), 404
    if limited("generate", 150):
        return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429
    what = (request.get_json(silent=True) or {}).get("what", "cards")
    topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
    fn = ensure_cards if what == "cards" else ensure_quiz
    todo = [t for t in topics if (not db.one(select(db.cards.c.id).where(db.cards.c.topic_id == t["id"]).limit(1)) if what == "cards" else not t["quiz"])][:12]

    def one_topic(t):
        try:
            fn(t)
            return True
        except Exception:
            log.exception("prepare failed for topic %s", t["id"])
            return False
    with ThreadPoolExecutor(max_workers=6) as pool:
        ok = list(pool.map(one_topic, todo))
    return jsonify(made=sum(ok), failed=len(ok) - sum(ok))


@app.get("/api/sets/<int:set_id>/cards")
@need_user
def set_cards(user, set_id):
    if not own_set(user, set_id):
        return jsonify(error="Study set not found."), 404
    rows = db.many(select(db.cards).where(db.cards.c.set_id == set_id).order_by(db.cards.c.topic_id, db.cards.c.id))
    if request.args.get("due"):
        rows = [r for r in rows if r["due"] <= time.time()]
    return jsonify(cards=[_card_view(r) for r in rows])


@app.get("/api/due")
@need_user
def due_cards(user):
    """Every card due today across all sets: the daily review."""
    q = (select(db.cards, db.sets.c.title.label("set_title"), db.sets.c.emoji.label("emoji"))
         .select_from(db.cards.join(db.sets, db.cards.c.set_id == db.sets.c.id))
         .where(db.sets.c.user_id == user["id"], db.cards.c.due <= time.time()).order_by(db.cards.c.due).limit(60))
    return jsonify(cards=[{**_card_view(r), "set_title": r["set_title"], "emoji": r["emoji"]} for r in db.many(q)])


@app.get("/api/sets/<int:set_id>/test")
@need_user
def set_test(user, set_id):
    """A mixed practice exam from every topic's quiz (making quizzes for topics that don't have one yet)."""
    if (bad := need_ai()):
        return bad
    if not own_set(user, set_id):
        return jsonify(error="Study set not found."), 404
    topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
    missing = [t for t in topics if not t["quiz"]]
    if missing:
        if limited("generate", 150):
            return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429

        def one_topic(t):
            try:
                ensure_quiz(t)
            except Exception:
                log.exception("test quiz failed for topic %s", t["id"])
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(one_topic, missing[:12]))
        topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
    pool_qs = [{**q, "topic_id": t["id"], "topic": t["title"]} for t in topics if t["quiz"] for q in json.loads(t["quiz"])]
    if len(pool_qs) < 4:
        return jsonify(error="I couldn't make a test yet. Try again in a moment."), 502
    random.shuffle(pool_qs)
    return jsonify(questions=pool_qs[:min(20, max(8, len(pool_qs) // 2))])


# ---------- the tutor ----------
@app.post("/api/chat")
@need_user
def chat(user):
    if (bad := need_ai()):
        return bad
    if limited("chat", 150):
        return jsonify(error="You've asked a lot of questions this hour. Take a short break and come back."), 429
    b = request.get_json(silent=True) or {}
    s = own_set(user, int(b.get("set_id") or 0))
    if not s:
        return jsonify(error="Study set not found."), 404
    history = []
    for m in (b.get("messages") or [])[-14:]:
        role, text = m.get("role"), str(m.get("content") or "")[:3000]
        if role in ("user", "assistant") and text.strip():
            history.append({"role": role, "content": text})
    if not history or history[-1]["role"] != "user":
        return jsonify(error="Ask me something."), 400
    mode = "guided" if b.get("mode") == "guided" else "ask"
    topic = own_topic(user, int(b.get("topic_id") or 0)) if b.get("topic_id") else None
    last = history[-1]["content"]
    if topic:
        ctx = f"STUDY SET: {s['title']}\nCURRENT TOPIC: {topic['title']}\nWHAT IT COVERS: {topic['summary']}\nKEY IDEAS: {'; '.join(json.loads(topic['points'] or '[]'))}\n"
        if topic["notes"]:
            ctx += f"\nTHE STUDENT'S NOTES PAGE:\n{topic['notes'][:3500]}\n"
        ctx += f"\nMATERIAL (most relevant parts):\n{_context(s['id'], topic, last)}"
    else:
        tl = db.many(select(db.topics.c.title, db.topics.c.summary).where(db.topics.c.set_id == s["id"]).order_by(db.topics.c.idx))
        text = "\n\n".join(m["text"] for m in db.many(select(db.materials.c.text).where(db.materials.c.set_id == s["id"])))
        ctx = (f"STUDY SET: {s['title']}\nTOPICS:\n" + "\n".join(f"- {t['title']}: {t['summary']}" for t in tl)
               + f"\n\nMATERIAL (most relevant parts):\n{ai.relevant(text, last, limit=9000)}")

    def work():
        try:
            for piece in ai.chat(mode, ctx, history):
                yield ev("delta", text=piece)
            if topic:
                record_activity(user)
        except ai.AIError as exc:
            yield ev("error", text=str(exc))
        except Exception:
            log.exception("chat failed")
            yield ev("error", text="Something went wrong. Try again.")
        yield ev("done")
    return ndjson(work())


# ---------- calendar ----------
@app.get("/api/calendar")
@need_user
def calendar(user):
    today = local_today()
    events = []
    for s in db.many(select(db.sets).where(db.sets.c.user_id == user["id"])):
        topics = db.many(select(db.topics).where(db.topics.c.set_id == s["id"]).order_by(db.topics.c.idx))
        for d, t in schedule(s["exam"], topics, today):
            events.append({"date": d.isoformat(), "kind": "study", "set_id": s["id"], "set": s["title"], "emoji": s["emoji"], "topic_id": t["id"], "topic": t["title"]})
        if s["exam"]:
            events.append({"date": s["exam"], "kind": "exam", "set_id": s["id"], "set": s["title"], "emoji": s["emoji"], "topic": "Exam day"})
    events.sort(key=lambda e: (e["date"], e["kind"] != "exam"))
    return jsonify(events=events, today=today.isoformat(), due=_due_count(user["id"]))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5115)), debug=False)
