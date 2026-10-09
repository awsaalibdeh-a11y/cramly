"""More premium study tools (all open to premium accounts, and to everyone during the free minute):

  glossary   key terms with definitions for a whole study set
  predictor  the exam questions most likely to come up, with model answers
  mix-ups    pairs of ideas that students confuse, and how to tell them apart
  boost      analogies, mnemonics and a real-world example for one topic
  lab        fill-in-the-blank and true/false rounds for one topic
  grader     write an answer to an exam-style question and get it marked
  my notes   the student's own notes on a topic
  share      a read-only link that lets a friend copy a study set
"""

import json
import secrets
import time

from flask import jsonify, render_template, request


def register(core):
    app, db, ai = core.app, core.db, core.ai
    select, insert, update = core.select, core.insert, core.update
    need_user, need_premium, need_plus, need_ai, own_set, own_topic, limited, log = core.need_user, core.need_premium, core.need_plus, core.need_ai, core.own_set, core.own_topic, core.limited, core.log

    def ai_error(exc):
        if isinstance(exc, ai.AIError):
            return jsonify(error=str(exc)), 502
        log.exception("lab tool failed")
        return jsonify(error="Couldn't make that just now. Try again."), 502

    def digest(set_id):
        topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
        return "\n\n".join(f"## {t['title']}\n{t['summary']}\nKey ideas: {'; '.join(json.loads(t['points'] or '[]'))}"
                           + (f"\nNotes: {t['notes'][:600]}" if t["notes"] else "") for t in topics)[:16000], topics

    def cached_set(user, set_id, col, make, key):
        """One AI result per study set, kept in the database; ?fresh=1 makes a new one."""
        s = own_set(user, set_id)
        if not s:
            return jsonify(error="Study set not found."), 404
        if s[col] and not request.args.get("fresh"):
            return jsonify(**{key: json.loads(s[col])}, title=s["title"])
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429
        text, topics = digest(set_id)
        if not topics:
            return jsonify(error="Add some material first."), 400
        try:
            result = make(s["title"], text)
            db.run(update(db.sets).where(db.sets.c.id == set_id).values(**{col: json.dumps(result, ensure_ascii=False)}))
            return jsonify(**{key: result}, title=s["title"])
        except Exception as exc:
            return ai_error(exc)

    def cached_topic(user, topic_id, col, make, key):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        if t[col]:
            return jsonify(**{key: json.loads(t[col])}, topic=t["title"])
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429
        try:
            with core._topic_lock(topic_id, col):
                fresh = db.one(select(db.topics).where(db.topics.c.id == topic_id))
                if not fresh[col]:
                    result = make(fresh, core._context(fresh["set_id"], fresh))
                    db.run(update(db.topics).where(db.topics.c.id == topic_id).values(**{col: json.dumps(result, ensure_ascii=False)}))
                    fresh[col] = json.dumps(result)
            return jsonify(**{key: json.loads(fresh[col])}, topic=t["title"])
        except Exception as exc:
            return ai_error(exc)

    @app.get("/api/sets/<int:set_id>/glossary")
    @need_premium
    def glossary(user, set_id):
        return cached_set(user, set_id, "glossary", ai.make_glossary, "terms")

    @app.get("/api/sets/<int:set_id>/predictor")
    @need_plus
    def predictor(user, set_id):
        return cached_set(user, set_id, "predictor", ai.make_predictor, "questions")

    @app.get("/api/sets/<int:set_id>/mixups")
    @need_plus
    def mixups(user, set_id):
        return cached_set(user, set_id, "mixups", ai.make_mixups, "pairs")

    @app.get("/api/topics/<int:topic_id>/boost")
    @need_plus
    def boost(user, topic_id):
        return cached_topic(user, topic_id, "boost", ai.make_boost, "boost")

    @app.get("/api/topics/<int:topic_id>/lab")
    @need_plus
    def lab(user, topic_id):
        return cached_topic(user, topic_id, "lab", ai.make_lab, "lab")

    @app.post("/api/topics/<int:topic_id>/prompt")
    @need_plus
    def written_prompt(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        if (bad := need_ai()):
            return bad
        try:
            return jsonify(prompt=ai.make_prompt(t, core._context(t["set_id"], t)))
        except Exception as exc:
            return ai_error(exc)

    @app.post("/api/topics/<int:topic_id>/grade")
    @need_plus
    def grade(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        b = request.get_json(silent=True) or {}
        prompt, answer = str(b.get("prompt") or "").strip()[:500], str(b.get("answer") or "").strip()
        if len(answer) < 20:
            return jsonify(error="Write a little more first (at least a couple of sentences)."), 400
        if not prompt:
            return jsonify(error="There is no question to answer."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429
        try:
            result = ai.grade_answer(t, core._context(t["set_id"], t), prompt, answer)
            core.record_activity(user)
            return jsonify(**result)
        except Exception as exc:
            return ai_error(exc)

    @app.route("/api/topics/<int:topic_id>/mynotes", methods=["GET", "PUT"])
    @need_premium
    def mynotes(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        if request.method == "GET":
            return jsonify(text=t["mynotes"] or "")
        text = str((request.get_json(silent=True) or {}).get("text") or "")[:20000]
        db.run(update(db.topics).where(db.topics.c.id == topic_id).values(mynotes=text))
        return jsonify(ok=True)

    import sharing                                                       # sharing lives next door
    sharing.register(core, ai_error)
