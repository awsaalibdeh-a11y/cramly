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
                "revoked": bool(i["revoked"]), "created": i["created"], "link": link_for(i["code"])}

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
            trial_seconds=core.TRIAL_SECONDS,
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
        iid = db.run(insert(db.invites).values(code=code, label=label, uses_max=uses, uses=0, days=days, revoked=0, created=time.time()))
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
