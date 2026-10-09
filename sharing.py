"""Sharing a study set: the owner makes a read-only link; anyone who opens it can preview the set and copy it into their own account."""

import secrets
import time

from flask import jsonify, render_template, request


def register(core, ai_error):
    app, db = core.app, core.db
    select, insert, update = core.select, core.insert, core.update
    need_user, need_plus, own_set, limited = core.need_user, core.need_plus, core.own_set, core.limited

    def shared(token):
        return db.one(select(db.sets).where(db.sets.c.share_token == token)) if token and len(token) >= 12 else None

    @app.post("/api/sets/<int:set_id>/share")
    @need_plus
    def share_set(user, set_id):
        s = own_set(user, set_id)
        if not s:
            return jsonify(error="Study set not found."), 404
        on = bool((request.get_json(silent=True) or {}).get("on", True))
        token = (s["share_token"] or secrets.token_urlsafe(12)) if on else ""
        db.run(update(db.sets).where(db.sets.c.id == set_id).values(share_token=token))
        return jsonify(token=token, link=f"{request.host_url.rstrip('/')}/s/{token}" if token else "")

    @app.get("/api/shared/<token>")
    def shared_preview(token):
        if limited("share", 120):
            return jsonify(error="Too many tries. Wait a while."), 429
        s = shared(token)
        if not s:
            return jsonify(error="This link is not shared any more."), 404
        topics = db.many(select(db.topics).where(db.topics.c.set_id == s["id"]).order_by(db.topics.c.idx))
        return jsonify(title=s["title"], emoji=s["emoji"], hue=s["hue"],
                       topics=[{"title": t["title"], "summary": t["summary"]} for t in topics])

    @app.post("/api/shared/<token>/import")
    @need_user
    def shared_import(user, token):
        s = shared(token)
        if not s:
            return jsonify(error="This link is not shared any more."), 404
        cap = core.limits_for(user)["sets"]
        if len(db.many(select(db.sets.c.id).where(db.sets.c.user_id == user["id"]))) >= cap:
            return jsonify(error=f"Your plan has room for {cap} study sets. Delete one to make room.", plan_limit=True), 400
        now = time.time()
        new_id = db.run(insert(db.sets).values(user_id=user["id"], title=s["title"], emoji=s["emoji"], hue=s["hue"], created=now, opened=now,
                                                cheat=s["cheat"] or "", glossary=s["glossary"] or "", mixups=s["mixups"] or "", predictor=s["predictor"] or ""))
        keep = [c.name for c in db.topics.columns if c.name not in ("id", "set_id", "status", "quiz_best", "studied", "mynotes")]
        for t in db.many(select(db.topics).where(db.topics.c.set_id == s["id"]).order_by(db.topics.c.idx)):
            tid = db.run(insert(db.topics).values(set_id=new_id, status=0, quiz_best=-1, studied=0, mynotes="", **{k: t[k] for k in keep}))
            for c in db.many(select(db.cards).where(db.cards.c.topic_id == t["id"])):
                db.run(insert(db.cards).values(topic_id=tid, set_id=new_id, front=c["front"], back=c["back"], box=0, due=0, reps=0))
        for m in db.many(select(db.materials).where(db.materials.c.set_id == s["id"])):
            db.run(insert(db.materials).values(set_id=new_id, name=m["name"], kind=m["kind"], text=m["text"], created=now))
        return jsonify(id=new_id)

    @app.route("/s/<token>")
    def share_page(token):
        resp = app.make_response(render_template("index.html", v=core._version(), join="", share=token[:60]))
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["X-Robots-Tag"] = "noindex"
        return resp
