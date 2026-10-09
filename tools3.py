"""Even more tools. Premium: summariser, quick cards (turn any pasted text into flashcards). Premium Plus: essay outline, weak-card
improver, and the printable study guide that gathers everything about a study set into one document."""

import json

from flask import jsonify, request


def register(core, ai_error, digest):
    app, db, ai = core.app, core.db, core.ai
    select, insert, update = core.select, core.insert, core.update
    need_premium, need_plus, need_ai, own_set, own_topic, limited = core.need_premium, core.need_plus, core.need_ai, core.own_set, core.own_topic, core.limited

    def too_much():
        return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429

    def pasted(min_len=80):
        text = str((request.get_json(silent=True) or {}).get("text") or "").strip()
        return text if len(text) >= min_len else None

    @app.post("/api/summarize")
    @need_premium
    def summarize(user):
        text = pasted()
        if not text:
            return jsonify(error="Paste at least a few sentences to summarise."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return too_much()
        try:
            r = ai.summarize(text)
            core.record_activity(user)
            return jsonify(**r)
        except Exception as exc:
            return ai_error(exc)

    @app.post("/api/quickcards")
    @need_premium
    def quick_cards(user):
        b = request.get_json(silent=True) or {}
        text = pasted()
        if not text:
            return jsonify(error="Paste at least a few sentences to make cards from."), 400
        topic = own_topic(user, int(b.get("topic_id") or 0)) if str(b.get("topic_id") or "").isdigit() else None
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return too_much()
        try:
            cards = [c for c in ai.quick_cards(text) if c["front"].strip() and c["back"].strip()]
            if topic and b.get("save"):
                have = {c["front"].strip().lower() for c in db.many(select(db.cards).where(db.cards.c.topic_id == topic["id"]))}
                room = max(0, 60 - len(have))
                fresh = [c for c in cards if c["front"].strip().lower() not in have][:room]
                for c in fresh:
                    db.run(insert(db.cards).values(topic_id=topic["id"], set_id=topic["set_id"], front=c["front"].strip()[:500], back=c["back"].strip()[:800], box=0, due=0, reps=0))
                return jsonify(cards=fresh, saved=len(fresh))
            return jsonify(cards=cards, saved=0)
        except Exception as exc:
            return ai_error(exc)

    @app.post("/api/sets/<int:set_id>/outline")
    @need_plus
    def essay_outline(user, set_id):
        s = own_set(user, set_id)
        if not s:
            return jsonify(error="Study set not found."), 404
        question = str((request.get_json(silent=True) or {}).get("question") or "").strip()
        if len(question) < 8:
            return jsonify(error="Type the essay question first."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return too_much()
        text, topics = digest(set_id)
        if not topics:
            return jsonify(error="Add some material first."), 400
        try:
            return jsonify(**ai.make_essay_outline(s["title"], text, question))
        except Exception as exc:
            return ai_error(exc)

    @app.post("/api/topics/<int:topic_id>/cards/improve")
    @need_plus
    def improve(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        cards = db.many(select(db.cards).where(db.cards.c.topic_id == topic_id).order_by(db.cards.c.box, db.cards.c.id))
        weak = [c for c in cards if (c["box"] or 0) <= 1][:8] or cards[:6]
        if not weak:
            return jsonify(error="This topic has no flashcards yet."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return too_much()
        try:
            made = ai.improve_cards(t, core._context(t["set_id"], t), weak)
            ids = {c["id"] for c in weak}
            out = []
            for m in made:
                if m["id"] in ids and m["front"].strip() and m["back"].strip():
                    db.run(update(db.cards).where(db.cards.c.id == m["id"]).values(front=m["front"].strip()[:500], back=m["back"].strip()[:800]))
                    out.append({"id": m["id"], "front": m["front"].strip(), "back": m["back"].strip(), "tip": m["tip"].strip()})
            return jsonify(cards=out)
        except Exception as exc:
            return ai_error(exc)

    @app.get("/api/sets/<int:set_id>/guide")
    @need_plus
    def guide(user, set_id):
        s = own_set(user, set_id)
        if not s:
            return jsonify(error="Study set not found."), 404
        topics = db.many(select(db.topics).where(db.topics.c.set_id == set_id).order_by(db.topics.c.idx))
        parts = [f"# {s['title']}", f"{len(topics)} topics"]
        for i, t in enumerate(topics, 1):
            pts = json.loads(t["points"] or "[]")
            parts.append(f"## {i}. {t['title']}\n{t['summary']}")
            if pts:
                parts.append("**Key ideas**\n" + "\n".join(f"- {p}" for p in pts))
            if t["notes"]:
                parts.append(t["notes"][:2500])
            if t["mynotes"]:
                parts.append("**My notes**\n" + t["mynotes"][:1500])
        if s["glossary"]:
            terms = json.loads(s["glossary"])
            parts.append("## Glossary\n" + "\n".join(f"- **{x['term']}**: {x['definition']}" for x in terms))
        if s["mixups"]:
            pairs = json.loads(s["mixups"])
            parts.append("## Easy to mix up\n" + "\n".join(f"- **{p['a']}** vs **{p['b']}**: {p['difference']}" for p in pairs))
        return jsonify(title=s["title"], guide="\n\n".join(parts), topics=len(topics))
