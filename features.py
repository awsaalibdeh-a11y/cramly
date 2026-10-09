"""Cramly's owner tools and premium extras, registered onto the main app (kept here so app.py stays readable).

  /admin and /api/admin/*   make, list and revoke premium links (needs the ADMIN_KEY environment variable)
  /join/<code>              what someone opens when you send them a premium link
"""

import hmac
import os
import secrets
import time

from flask import jsonify, render_template, request


def register(core):
    app, db = core.app, core.db
    select, insert, update, delete = core.select, core.insert, core.update, core.delete

    # ---------------------------------------------------------------- owner tools
    def admin_key_ok():
        want = os.environ.get("ADMIN_KEY", "")
        if len(want) < 12:                                              # no key set (or a weak one): the tools stay off
            return False
        return hmac.compare_digest(want.encode(), request.headers.get("X-Admin-Key", "").encode())

    def admin_only(fn):
        def wrapped(*a, **k):
            if core.limited("admin", 60):
                return jsonify(error="Too many tries. Wait a while."), 429
            if not admin_key_ok():
                return jsonify(error="Wrong admin key."), 403
            return fn(*a, **k)
        wrapped.__name__ = fn.__name__
        return wrapped

    @app.route("/admin")
    def admin_page():
        resp = app.make_response(render_template("admin.html", v=core._version(), configured=len(os.environ.get("ADMIN_KEY", "")) >= 12))
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["X-Robots-Tag"] = "noindex"
        return resp

    def link_for(code):
        return f"{request.host_url.rstrip('/')}/join/{code}"

    def invite_view(i):
        return {"id": i["id"], "code": i["code"], "label": i["label"], "uses": i["uses"], "uses_max": i["uses_max"], "days": i["days"],
                "revoked": bool(i["revoked"]), "created": i["created"], "link": link_for(i["code"]), "message": i["message"] or ""}

    @app.get("/api/admin/overview")
    @admin_only
    def admin_overview():
        now = time.time()
        users = db.many(select(db.users))
        invites = {i["id"]: i for i in db.many(select(db.invites))}

        def premium(u):
            i = invites.get(u["invite_id"])
            return bool(u["premium"]) and (not u["premium_until"] or u["premium_until"] > now) and (not u["invite_id"] or (i and not i["revoked"]))
        prem = [u for u in users if premium(u)]
        free = [u for u in users if not premium(u)]
        return jsonify(
            accounts=len(users), premium=len(prem), free=len(free), locked=sum(1 for u in free if (u["trial_used"] or 0) >= core.TRIAL_SECONDS),
            new_today=sum(1 for u in users if now - (u["created"] or 0) < 86400),
            active_today=sum(1 for u in users if now - (u["last_seen"] or 0) < 86400),
            trial_seconds=core.TRIAL_SECONDS, maintenance=db.setting("maintenance") == "1", banned=sum(1 for u in users if u["banned"]),
            invites=[invite_view(i) for i in sorted(invites.values(), key=lambda x: -x["created"])])

    @app.post("/api/admin/invites")
    @admin_only
    def admin_new_invite():
        b = request.get_json(silent=True) or {}
        label = str(b.get("label") or "").strip()[:80] or "Friend"
        try:
            uses = max(1, min(50, int(b.get("uses_max") or 3)))
            days = max(0, min(3650, int(b.get("days") or 0)))
        except (TypeError, ValueError):
            return jsonify(error="Uses and days should be numbers."), 400
        code = secrets.token_urlsafe(9)
        note = str(b.get("message") or "").strip()[:1200]
        iid = db.run(insert(db.invites).values(code=code, label=label, uses_max=uses, uses=0, days=days, revoked=0, created=time.time(), message=note))
        return jsonify(invite=invite_view(db.one(select(db.invites).where(db.invites.c.id == iid))))

    @app.post("/api/admin/invites/<int:iid>/revoke")
    @admin_only
    def admin_revoke(iid):
        revoked = 1 if (request.get_json(silent=True) or {}).get("revoked", True) else 0
        db.run(update(db.invites).where(db.invites.c.id == iid).values(revoked=revoked))
        return jsonify(ok=True, revoked=bool(revoked))

    @app.delete("/api/admin/invites/<int:iid>")
    @admin_only
    def admin_delete_invite(iid):
        db.run(update(db.users).where(db.users.c.invite_id == iid).values(premium=0))
        db.run(delete(db.invites).where(db.invites.c.id == iid))
        return jsonify(ok=True)

    # ---------------------------------------------------------------- accounts: see, ban, time out, message, delete
    def user_view(u, invites, set_counts):
        now = time.time()
        inv = invites.get(u["invite_id"])
        prem = bool(u["premium"]) and (not u["premium_until"] or u["premium_until"] > now) and (not u["invite_id"] or bool(inv and not inv["revoked"]))
        return {"id": u["id"], "name": u["name"] or "", "created": u["created"], "last_seen": u["last_seen"] or 0, "premium": prem,
                "premium_until": u["premium_until"] or 0, "invite": inv["label"] if inv else "", "trial_used": int(u["trial_used"] or 0),
                "trial_calls": u["trial_calls"] or 0, "banned": bool(u["banned"]), "ban_reason": u["ban_reason"] or "",
                "timeout_until": u["timeout_until"] if (u["timeout_until"] or 0) > now else 0, "sets": set_counts.get(u["id"], 0)}

    @app.get("/api/admin/users")
    @admin_only
    def admin_users():
        invites = {i["id"]: i for i in db.many(select(db.invites))}
        counts = {}
        for r in db.many(select(db.sets.c.user_id)):
            counts[r["user_id"]] = counts.get(r["user_id"], 0) + 1
        rows = [user_view(u, invites, counts) for u in db.many(select(db.users).order_by(db.users.c.id.desc()))]
        return jsonify(users=rows, now=time.time())

    def target_user(uid):
        return db.one(select(db.users).where(db.users.c.id == uid))

    @app.post("/api/admin/users/<int:uid>/ban")
    @admin_only
    def admin_ban(uid):
        if not target_user(uid):
            return jsonify(error="No such account."), 404
        b = request.get_json(silent=True) or {}
        on = 1 if b.get("banned", True) else 0
        db.run(update(db.users).where(db.users.c.id == uid).values(banned=on, ban_reason=str(b.get("reason") or "")[:300] if on else ""))
        return jsonify(ok=True, banned=bool(on))

    @app.post("/api/admin/users/<int:uid>/timeout")
    @admin_only
    def admin_timeout(uid):
        if not target_user(uid):
            return jsonify(error="No such account."), 404
        b = request.get_json(silent=True) or {}
        try:
            minutes = max(0, min(60 * 24 * 365, int(b.get("minutes") or 0)))
        except (TypeError, ValueError):
            return jsonify(error="Minutes should be a number."), 400
        until = time.time() + minutes * 60 if minutes else 0
        db.run(update(db.users).where(db.users.c.id == uid).values(timeout_until=until, ban_reason=str(b.get("reason") or "")[:300] if minutes else ""))
        return jsonify(ok=True, until=until)

    @app.post("/api/admin/users/<int:uid>/message")
    @admin_only
    def admin_message(uid):
        if not target_user(uid):
            return jsonify(error="No such account."), 404
        body = str((request.get_json(silent=True) or {}).get("body") or "").strip()[:1200]
        if not body:
            return jsonify(error="Write a message first."), 400
        db.run(insert(db.messages).values(user_id=uid, body=body, created=time.time(), seen=0))
        return jsonify(ok=True)

    @app.post("/api/admin/broadcast")
    @admin_only
    def admin_broadcast():
        b = request.get_json(silent=True) or {}
        body = str(b.get("body") or "").strip()[:1200]
        if not body:
            return jsonify(error="Write a message first."), 400
        days = max(0, min(365, int(b.get("active_days") or 0))) if str(b.get("active_days") or "0").isdigit() else 0
        cutoff = time.time() - days * 86400 if days else 0
        ids = [u["id"] for u in db.many(select(db.users)) if (u["last_seen"] or 0) >= cutoff]
        for uid in ids:
            db.run(insert(db.messages).values(user_id=uid, body=body, created=time.time(), seen=0))
        return jsonify(ok=True, sent=len(ids))

    @app.post("/api/admin/users/<int:uid>/premium")
    @admin_only
    def admin_premium(uid):
        if not target_user(uid):
            return jsonify(error="No such account."), 404
        b = request.get_json(silent=True) or {}
        if b.get("on", True):
            try:
                days = max(0, min(3650, int(b.get("days") or 0)))
            except (TypeError, ValueError):
                return jsonify(error="Days should be a number."), 400
            db.run(update(db.users).where(db.users.c.id == uid).values(premium=1, invite_id=0, premium_until=time.time() + days * 86400 if days else 0))
        else:
            db.run(update(db.users).where(db.users.c.id == uid).values(premium=0, premium_until=0))
        return jsonify(ok=True)

    @app.post("/api/admin/users/<int:uid>/reset-trial")
    @admin_only
    def admin_reset_trial(uid):
        db.run(update(db.users).where(db.users.c.id == uid).values(trial_used=0, trial_calls=0))
        return jsonify(ok=True)

    @app.delete("/api/admin/users/<int:uid>")
    @admin_only
    def admin_delete_user(uid):
        if not target_user(uid):
            return jsonify(error="No such account."), 404
        for st in db.many(select(db.sets.c.id).where(db.sets.c.user_id == uid)):
            core.purge_set(st["id"])
        for t in (db.activity, db.pair_codes, db.devices, db.messages):
            db.run(delete(t).where(t.c.user_id == uid))
        db.run(delete(db.users).where(db.users.c.id == uid))
        return jsonify(ok=True)

    # ---------------------------------------------------------------- the kill switch
    @app.get("/api/admin/settings")
    @admin_only
    def admin_get_settings():
        return jsonify(maintenance=db.setting("maintenance") == "1", message=db.setting("maintenance_msg"))

    @app.post("/api/admin/settings")
    @admin_only
    def admin_set_settings():
        b = request.get_json(silent=True) or {}
        if "maintenance" in b:
            db.set_setting("maintenance", "1" if b["maintenance"] else "0")
        if "message" in b:
            db.set_setting("maintenance_msg", str(b["message"] or "")[:300])
        return jsonify(maintenance=db.setting("maintenance") == "1", message=db.setting("maintenance_msg"))

    # ---------------------------------------------------------------- the link you send people
    @app.route("/join/<code>")
    def join_page(code):
        resp = app.make_response(render_template("index.html", v=core._version(), join=code[:60]))
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["X-Robots-Tag"] = "noindex"
        return resp

    import studytools                                                    # the study tools register themselves the same way
    studytools.register(core)
