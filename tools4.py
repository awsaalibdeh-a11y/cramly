"""More tools. Premium: the daily challenge (a question from your own quizzes, no AI), the smart drill (your weakest flashcards from every
study set), and flashcard import from pasted text. Premium Plus: rewrite the notes (simpler, shorter, deeper, or translated)."""

import datetime as dt
import json
import random
import re

from flask import jsonify, request


def register(core, ai_error):
    app, db, ai = core.app, core.db, core.ai
    select, insert = core.select, core.insert
    need_premium, need_plus, need_ai, own_topic, limited = core.need_premium, core.need_plus, core.need_ai, core.own_topic, core.limited

    @app.get("/api/daily")
    @need_premium
    def daily(user):
        """One question a day, picked from the quizzes you already have. It is the same all day, and it costs nothing."""
        sets = {s["id"]: s for s in db.many(select(db.sets).where(db.sets.c.user_id == user["id"]))}
        pool = []
        for t in db.many(select(db.topics).where(db.topics.c.set_id.in_(list(sets) or [0]))):
            if t["quiz"]:
                for i, q in enumerate(json.loads(t["quiz"])):
                    pool.append((t, i, q))
        if not pool:
            return jsonify(none=True)
        day = core.local_today().isoformat()
        t, i, q = random.Random(f"{user['id']}-{day}").choice(sorted(pool, key=lambda p: (p[0]["id"], p[1])))
        return jsonify(day=day, q=q["q"], options=q["options"], answer=q["answer"], why=q["why"], topic=t["title"], topic_id=t["id"],
                       set_id=t["set_id"], set_title=sets[t["set_id"]]["title"])

    @app.get("/api/drill")
    @need_premium
    def drill(user):
        """Your weakest flashcards (the lowest boxes) from every study set, 25 at a time."""
        sets = {s["id"]: s for s in db.many(select(db.sets).where(db.sets.c.user_id == user["id"]))}
        cards = db.many(select(db.cards).where(db.cards.c.set_id.in_(list(sets) or [0])).order_by(db.cards.c.box, db.cards.c.due))
        weak = [c for c in cards if (c["box"] or 0) <= 1]
        pick = weak[:25]
        return jsonify(cards=[{**core._card_view(c), "set_title": sets[c["set_id"]]["title"]} for c in pick], weak=len(weak), total=len(cards))

    @app.post("/api/topics/<int:topic_id>/cards/bulk")
    @need_premium
    def bulk_cards(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        text = str((request.get_json(silent=True) or {}).get("text") or "")[:60000]
        have = db.many(select(db.cards).where(db.cards.c.topic_id == topic_id))
        seen = {c["front"].strip().lower() for c in have}
        room, added, skipped = max(0, 60 - len(have)), 0, 0
        for line in text.splitlines():
            parts = re.split(r"\t| \| |;", line.strip(), maxsplit=1) if line.strip() else []
            if len(parts) < 2:
                parts = line.strip().split(",", 1) if "," in line else parts
            if len(parts) < 2 or not parts[0].strip() or not parts[1].strip():
                skipped += 1 if line.strip() else 0
                continue
            front, back = parts[0].strip().strip('"')[:500], parts[1].strip().strip('"')[:800]
            if front.lower() in seen or added >= room:
                skipped += 1
                continue
            seen.add(front.lower())
            db.run(insert(db.cards).values(topic_id=topic_id, set_id=t["set_id"], front=front, back=back, box=0, due=0, reps=0))
            added += 1
        if not added:
            return jsonify(error="I could not find any cards. Put one card per line: question, then a tab, a | or a ; and the answer.", added=0, skipped=skipped), 400
        return jsonify(added=added, skipped=skipped)

    @app.post("/api/topics/<int:topic_id>/rewrite")
    @need_plus
    def rewrite(user, topic_id):
        t = own_topic(user, topic_id)
        if not t:
            return jsonify(error="Topic not found."), 404
        b = request.get_json(silent=True) or {}
        mode = b.get("mode") if b.get("mode") in ai.REWRITE_MODES else None
        lang = re.sub(r"[^A-Za-z؀-ۿ ]", "", str(b.get("lang") or "English"))[:24].strip() or "English"
        if not mode:
            return jsonify(error="Choose simpler, shorter, deeper or translate."), 400
        if not t["notes"]:
            return jsonify(error="Open this topic's Read page first so Cramly writes the notes."), 400
        if (bad := need_ai()):
            return bad
        if limited("generate", 150):
            return jsonify(error="That's a lot of study material in an hour. Take a short break and come back."), 429
        try:
            return jsonify(text=ai.rewrite_notes(t, t["notes"], mode, lang), mode=mode, lang=lang)
        except Exception as exc:
            return ai_error(exc)
