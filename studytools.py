"""Cramly's study tools beyond the basics (all open to premium accounts, and to everyone during the free minute):

  podcast      a two-host audio episode for a topic
  cheat sheet  one printable page for a whole study set
  mind map     the plan drawn as a tree (built from the plan, no AI needed)
  snap & solve a photographed or typed question, worked out step by step from your material
  exam builder a fresh quiz on the topics you pick, at the difficulty you pick
  stats        a year-style activity heatmap, streaks, weak topics
  card editor  add, edit, delete and AI-extend flashcards
"""

import datetime as dt
import json
import math
import os
import random
from concurrent.futures import ThreadPoolExecutor

from flask import jsonify, request

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


def register(core):
    app, db, ai = core.app, core.db, core.ai
    select, insert, update, delete = core.select, core.insert, core.update, core.delete
    need_user, need_ai, own_set, own_topic, limited, log = core.need_user, core.need_ai, core.own_set, core.own_topic, core.limited, core.log

    def busy_limit():
        return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429

    def ai_error(exc):
        if isinstance(exc, ai.AIError):
            return jsonify(error=str(exc)), 502
        log.exception("study tool failed")
        return jsonify(error="Couldn't make that just now. Try again."), 502

    # ---------------------------------------------------------------- podcast
    @app.get("/api/topics/<int:topic_id>/podcast")
    @need_user
    def podcast(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        if t["podcast"]:
            return jsonify(**json.loads(t["podcast"]), topic=t["title"])
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return busy_limit()
        try:
            with core._topic_lock(topic_id, "podcast"):
                fresh = db.one(select(db.topics).where(db.topics.c.id == topic_id))
                if not fresh["podcast"]:
                    ep = ai.make_podcast(fresh, core._context(fresh["set_id"], fresh))
                    if len(ep["lines"]) < 6:
                        raise ai.AIError("I couldn't write a good episode for that topic. Try again.")
                    db.run(update(db.topics).where(db.topics.c.id == topic_id).values(podcast=json.dumps(ep, ensure_ascii=False)))
                    fresh["podcast"] = json.dumps(ep)
            return jsonify(**json.loads(fresh["podcast"]), topic=t["title"])
        except Exception as exc:
            return ai_error(exc)

    # ---------------------------------------------------------------- cheat sheet
    @app.get("/api/sets/<int:set_id>/cheatsheet")
    @need_user
    def cheatsheet(user, set_id):
        s = own_set(user, set_id)
        if not s:
            return jsonify(error="Study set not found."), 404
        if s["cheat"] and not request.args.get("fresh"):
            return jsonify(sheet=s["cheat"], title=s["title"])
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return busy_limit()
        topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
        if not topics:
            return jsonify(error="Add some material first."), 400
        digest = "\n\n".join(f"## {t['title']}\n{t['summary']}\nKey ideas: {'; '.join(json.loads(t['points'] or '[]'))}"
                             + (f"\nNotes: {t['notes'][:600]}" if t["notes"] else "") for t in topics)[:16000]
        try:
            sheet = ai.make_cheatsheet(s["title"], digest)
            db.run(update(db.sets).where(db.sets.c.id == set_id).values(cheat=sheet))
            return jsonify(sheet=sheet, title=s["title"])
        except Exception as exc:
            return ai_error(exc)

    # ---------------------------------------------------------------- mind map (from the plan: instant, free)
    @app.get("/api/sets/<int:set_id>/mindmap")
    @need_user
    def mindmap(user, set_id):
        s = own_set(user, set_id)
        if not s:
            return jsonify(error="Study set not found."), 404
        topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
        return jsonify(title=s["title"], emoji=s["emoji"], hue=s["hue"], children=[
            {"id": t["id"], "title": t["title"], "status": t["status"], "children": [{"title": p} for p in json.loads(t["points"] or "[]")[:6]]} for t in topics])

    # ---------------------------------------------------------------- snap & solve
    @app.post("/api/solve")
    @need_user
    def solve(user):
        question = (request.form.get("text") or "").strip()[:3000]
        f = request.files.get("image")
        image, mime = None, "image/png"
        if f:
            ext = os.path.splitext((f.filename or "").lower())[1]
            mime = IMAGE_TYPES.get(ext) or (f.mimetype if f.mimetype in IMAGE_TYPES.values() else "")
            if not mime:
                return jsonify(error="Use a photo (PNG, JPG or WebP)."), 400
            image = f.read()
            if len(image) > 8 * 1024 * 1024:
                return jsonify(error="That photo is bigger than 8 MB. Try a smaller one."), 400
        if not image and len(question) < 5:
            return jsonify(error="Take a photo of the question, or type it."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return busy_limit()
        context = ""
        try:
            s = own_set(user, int(request.form.get("set_id") or 0))
        except ValueError:
            s = None
        if s:
            text = "\n\n".join(m["text"] for m in db.many(select(db.materials.c.text).where(db.materials.c.set_id == s["id"])))
            context = f"Study set: {s['title']}\n" + ai.relevant(text, question or s["title"], limit=6000)
        try:
            r = ai.solve(question, image, mime, context)
            core.record_activity(user)
            return jsonify(**r)
        except Exception as exc:
            return ai_error(exc)

    # ---------------------------------------------------------------- exam builder: a fresh quiz on the topics you pick
    @app.post("/api/sets/<int:set_id>/quiz")
    @need_user
    def custom_quiz(user, set_id):
        if not own_set(user, set_id):
            return jsonify(error="Study set not found."), 404
        b = request.get_json(silent=True) or {}
        topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
        wanted = {int(i) for i in (b.get("topic_ids") or []) if str(i).isdigit()}
        chosen = [t for t in topics if not wanted or t["id"] in wanted][:10]
        if not chosen:
            return jsonify(error="Pick at least one topic."), 400
        try:
            n = max(4, min(30, int(b.get("n") or 10)))
        except (TypeError, ValueError):
            n = 10
        level = b.get("level") if b.get("level") in ai.LEVELS else "mixed"
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return busy_limit()
        per = max(2, math.ceil(n / len(chosen)))

        def one(t):
            try:
                return [{**q, "topic_id": t["id"], "topic": t["title"]} for q in ai.make_quiz(t, core._context(set_id, t), n=per, level=level)]
            except Exception:
                log.exception("custom quiz failed for topic %s", t["id"])
                return []
        with ThreadPoolExecutor(max_workers=6) as pool:
            qs = [q for part in pool.map(one, chosen) for q in part]
        if len(qs) < 4:
            return jsonify(error="I couldn't write that exam. Try again in a moment."), 502
        random.shuffle(qs)
        return jsonify(questions=qs[:n], level=level)

    # ---------------------------------------------------------------- stats
    @app.get("/api/stats")
    @need_user
    def stats(user):
        today = core.local_today()
        by_day = {r["day"]: r["n"] for r in db.many(select(db.activity).where(db.activity.c.user_id == user["id"]))}
        days = [{"day": (today - dt.timedelta(days=i)).isoformat(), "n": by_day.get((today - dt.timedelta(days=i)).isoformat(), 0)} for i in range(118, -1, -1)]
        best, run, prev = 0, 0, None
        for d in sorted(by_day):
            cur = dt.date.fromisoformat(d)
            run = run + 1 if prev and (cur - prev).days == 1 else 1
            best, prev = max(best, run), cur
        sets = db.many(select(db.sets).where(db.sets.c.user_id == user["id"]))
        ids = [s["id"] for s in sets]
        topics = db.many(select(db.topics).where(db.topics.c.set_id.in_(ids))) if ids else []
        cards = db.many(select(db.cards.c.box, db.cards.c.reps).where(db.cards.c.set_id.in_(ids))) if ids else []
        set_name = {s["id"]: s["title"] for s in sets}
        weak = sorted([t for t in topics if t["status"] < 2 and 0 <= t["quiz_best"] < 80], key=lambda t: t["quiz_best"])[:6]
        return jsonify(
            days=days, streak=core.streak(user), best_streak=best, active_days=sum(1 for d in by_day.values() if d),
            totals={"sets": len(sets), "topics": len(topics), "mastered": sum(1 for t in topics if t["status"] >= 2),
                    "covered": sum(1 for t in topics if t["status"] >= 1), "cards": len(cards), "reviews": sum(c["reps"] or 0 for c in cards),
                    "cards_strong": sum(1 for c in cards if c["box"] >= 3), "quizzes": sum(1 for t in topics if t["quiz_best"] >= 0)},
            weak=[{"topic_id": t["id"], "topic": t["title"], "set_id": t["set_id"], "set": set_name.get(t["set_id"], ""), "quiz_best": t["quiz_best"]} for t in weak],
            by_set=[{"id": s["id"], "title": s["title"], "emoji": s["emoji"], "hue": s["hue"],
                     "mastered": sum(1 for t in topics if t["set_id"] == s["id"] and t["status"] >= 2),
                     "topics": sum(1 for t in topics if t["set_id"] == s["id"])} for s in sets])

    # ---------------------------------------------------------------- flashcard editor
    def own_card(user, card_id):
        c = db.one(select(db.cards).where(db.cards.c.id == card_id))
        return c if c and own_set(user, c["set_id"]) else None

    def clean_card(b):
        front, back = str(b.get("front") or "").strip()[:500], str(b.get("back") or "").strip()[:800]
        return (front, back) if front and back else (None, None)

    @app.post("/api/topics/<int:topic_id>/cards/add")
    @need_user
    def add_card(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        front, back = clean_card(request.get_json(silent=True) or {})
        if not front:
            return jsonify(error="A card needs both a question and an answer."), 400
        if len(db.many(select(db.cards.c.id).where(db.cards.c.topic_id == topic_id))) >= 60:
            return jsonify(error="That topic already has 60 cards. Delete some first."), 400
        cid = db.run(insert(db.cards).values(topic_id=topic_id, set_id=t["set_id"], front=front, back=back, box=0, due=0, reps=0))
        return jsonify(card=core._card_view(db.one(select(db.cards).where(db.cards.c.id == cid))))

    @app.patch("/api/cards/<int:card_id>")
    @need_user
    def edit_card(user, card_id):
        if not own_card(user, card_id):
            return jsonify(error="Card not found."), 404
        front, back = clean_card(request.get_json(silent=True) or {})
        if not front:
            return jsonify(error="A card needs both a question and an answer."), 400
        db.run(update(db.cards).where(db.cards.c.id == card_id).values(front=front, back=back))
        return jsonify(ok=True)

    @app.delete("/api/cards/<int:card_id>")
    @need_user
    def remove_card(user, card_id):
        if not own_card(user, card_id):
            return jsonify(error="Card not found."), 404
        db.run(delete(db.cards).where(db.cards.c.id == card_id))
        return jsonify(ok=True)

    @app.post("/api/topics/<int:topic_id>/cards/more")
    @need_user
    def more_cards(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        have = db.many(select(db.cards).where(db.cards.c.topic_id == topic_id))
        if len(have) >= 40:
            return jsonify(error="That topic already has plenty of cards (40)."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return busy_limit()
        try:
            made = ai.make_cards(t, core._context(t["set_id"], t), n=6, avoid=[c["front"] for c in have])
            seen = {c["front"].strip().lower() for c in have}
            out = []
            for c in made:
                if c["front"].strip() and c["back"].strip() and c["front"].strip().lower() not in seen:
                    cid = db.run(insert(db.cards).values(topic_id=topic_id, set_id=t["set_id"], front=c["front"].strip(), back=c["back"].strip(), box=0, due=0, reps=0))
                    out.append(core._card_view(db.one(select(db.cards).where(db.cards.c.id == cid))))
            return jsonify(cards=out)
        except Exception as exc:
            return ai_error(exc)
