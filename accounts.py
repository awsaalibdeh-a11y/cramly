"""Email and password accounts, the same account in every app (through the universal layer's hub.js).

  POST /api/uni/acct/signup {email, password, app}   make an account (or give the Cramly account you already have an email)
  POST /api/uni/acct/login  {email, password, app}   sign in; answers with a device key, like a pairing code does
  GET  /api/uni/acct/me                               who this key belongs to
  POST /api/uni/acct/forgot {email, app}              ask the owner for a new password; answers with a private ticket
  GET  /api/uni/acct/forgot?ticket=...                has the owner approved it yet?
  POST /api/uni/acct/reset  {ticket, password}        once approved: set the new password (signs out every other device)
  /api/admin/acct*                                    owner only (Cramly Control): every account's email, and the reset requests

Passwords are never stored or shown, only a salted hash (werkzeug's scrypt). The owner sees emails, never passwords.
A forgotten password is not emailed anywhere: the request waits in the owner's panel for Approve or Deny, and the
person who asked sets the new password on the same device once it is approved."""

import hashlib
import json
import re
import secrets
import time

from flask import jsonify, request
from sqlalchemy import Column, Float, Integer, String, Table, Text
from werkzeug.security import check_password_hash, generate_password_hash

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)
RESET_DAYS = 2                                     # an approved request can be used for this long


def register(core, admin_only, note, who):
    app, db = core.app, core.db
    select, insert, update, delete = core.select, core.insert, core.update, core.delete

    logins = Table("logins", db.meta,
        Column("id", Integer, primary_key=True),
        Column("user_id", Integer, unique=True, index=True),
        Column("email", String(254), unique=True, index=True),
        Column("pw_hash", String(255)),
        Column("created", Float),
        Column("last_login", Float, default=0),
        Column("apps", Text, default="[]"),                          # every app this account has signed in from
        extend_existing=True)
    resets = Table("pw_resets", db.meta,
        Column("id", Integer, primary_key=True),
        Column("login_id", Integer, index=True),
        Column("email", String(254)),
        Column("ticket_hash", String(64), unique=True),
        Column("code", String(8)),                                   # shown to the person and to the owner, so they can match them up
        Column("app", String(20), default=""),
        Column("status", String(10), default="pending"),             # pending | approved | denied | used
        Column("created", Float),
        Column("decided", Float, default=0),
        extend_existing=True)
    db.meta.create_all(db.engine, tables=[logins, resets])

    h = lambda s: hashlib.sha256(s.encode()).hexdigest()
    body = lambda: request.get_json(silent=True) or {}
    app_of = lambda b: re.sub(r"[^a-z]", "", str(b.get("app", "")).lower())[:20] or "web"
    bearer = lambda: (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()

    def clean_email(b):
        e = str(b.get("email", "")).strip().lower()[:254]
        return e if EMAIL.match(e) else ""

    def check_pw(pw):
        if len(pw) < 8:
            return "Use at least 8 characters for the password."
        if len(pw) > 128:
            return "That password is too long."
        if pw.isdigit() or pw.lower() in ("password", "password1", "12345678", "qwertyui"):
            return "Pick a harder password (not just numbers or 'password')."
        return ""

    def seen(row, app_id):
        try:
            apps = json.loads(row["apps"] or "[]")
        except ValueError:
            apps = []
        if app_id not in apps:
            apps.append(app_id)
        db.run(update(logins).where(logins.c.id == row["id"]).values(last_login=time.time(), apps=json.dumps(apps[-30:])))
        db.run(update(db.users).where(db.users.c.id == row["user_id"]).values(last_seen=time.time()))

    def answer(row, user, status=200):
        return jsonify(key=db.new_device(row["user_id"]), email=row["email"], name=(user["name"] or "") if user else ""), status

    @app.post("/api/uni/acct/signup")
    def acct_signup():
        if core.limited("signup", 12):
            return jsonify(error="Too many sign-ups from here. Try again later."), 429
        b = body(); email, pw = clean_email(b), str(b.get("password", ""))
        if not email:
            return jsonify(error="That email doesn't look right."), 400
        if (bad := check_pw(pw)):
            return jsonify(error=bad), 400
        if db.one(select(logins).where(logins.c.email == email)):
            return jsonify(error="There is already an account with that email. Sign in instead."), 409
        current = db.user_for(bearer()) if bearer() else None                # an account already open here (say, in Cramly) gets the email
        if current and db.one(select(logins).where(logins.c.user_id == current["id"])):
            current = None
        if current:
            uid = current["id"]
        else:
            uid = db.run(insert(db.users).values(name=email.split("@")[0][:40], created=time.time(), last_seen=time.time()))
        db.run(insert(logins).values(user_id=uid, email=email, pw_hash=generate_password_hash(pw), created=time.time(), apps=json.dumps([app_of(b)])))
        row = db.one(select(logins).where(logins.c.email == email))
        note(f"New account: {email} (from {app_of(b)})")
        return answer(row, db.one(select(db.users).where(db.users.c.id == uid)), 201)

    @app.post("/api/uni/acct/login")
    def acct_login():
        if core.limited("login", 25):
            return jsonify(error="Too many tries. Wait a while and try again."), 429
        b = body(); email, pw = clean_email(b), str(b.get("password", ""))
        row = db.one(select(logins).where(logins.c.email == email)) if email else None
        if not row or not check_password_hash(row["pw_hash"] or "", pw):
            return jsonify(error="Wrong email or password."), 401
        seen(row, app_of(b))
        return answer(row, db.one(select(db.users).where(db.users.c.id == row["user_id"])))

    @app.get("/api/uni/acct/me")
    def acct_me():
        user = db.user_for(bearer()) if bearer() else None
        if not user:
            return jsonify(error="Not signed in."), 401
        row = db.one(select(logins).where(logins.c.user_id == user["id"]))
        return jsonify(email=row["email"] if row else "", name=user["name"] or "", has_password=bool(row))

    @app.post("/api/uni/acct/forgot")
    def acct_forgot():
        if core.limited("forgot", 6):
            return jsonify(error="Too many requests. Try again later."), 429
        b = body(); email = clean_email(b)
        row = db.one(select(logins).where(logins.c.email == email)) if email else None
        if not row:
            return jsonify(error="No account uses that email."), 404
        db.run(update(resets).where(resets.c.login_id == row["id"], resets.c.status == "pending").values(status="denied", decided=time.time()))
        ticket, code = secrets.token_urlsafe(24), f"{secrets.randbelow(900000) + 100000}"
        db.run(insert(resets).values(login_id=row["id"], email=email, ticket_hash=h(ticket), code=code, app=app_of(b), status="pending", created=time.time()))
        note(f"Password reset asked for {email} (code {code})")
        return jsonify(ticket=ticket, code=code, status="pending")

    def by_ticket(t):
        return db.one(select(resets).where(resets.c.ticket_hash == h(str(t or "")))) if t else None

    @app.get("/api/uni/acct/forgot")
    def acct_forgot_status():
        r = by_ticket(request.args.get("ticket"))
        if not r:
            return jsonify(error="Unknown request."), 404
        expired = r["status"] == "approved" and time.time() - r["decided"] > RESET_DAYS * 86400
        return jsonify(status="expired" if expired else r["status"], code=r["code"], email=r["email"])

    @app.post("/api/uni/acct/reset")
    def acct_reset():
        b = body(); r = by_ticket(b.get("ticket")); pw = str(b.get("password", ""))
        if not r or r["status"] != "approved" or time.time() - r["decided"] > RESET_DAYS * 86400:
            return jsonify(error="This request isn't approved (or it expired). Ask again."), 403
        if (bad := check_pw(pw)):
            return jsonify(error=bad), 400
        row = db.one(select(logins).where(logins.c.id == r["login_id"]))
        if not row:
            return jsonify(error="That account is gone."), 404
        db.run(update(logins).where(logins.c.id == row["id"]).values(pw_hash=generate_password_hash(pw)))
        db.run(update(resets).where(resets.c.id == r["id"]).values(status="used"))
        db.run(delete(db.devices).where(db.devices.c.user_id == row["user_id"]))   # signed out everywhere else
        seen(row, app_of(b))
        note(f"Password changed for {row['email']}")
        return answer(row, db.one(select(db.users).where(db.users.c.id == row["user_id"])))

    # ---------------------------------------------------------------- the owner's side
    @app.get("/api/admin/acct")
    @admin_only
    def admin_accounts():
        now = time.time()
        rows = db.many(select(logins).order_by(logins.c.id.desc()))
        users = {u["id"]: u for u in db.many(select(db.users).where(db.users.c.id.in_([r["user_id"] for r in rows] or [0])))}
        out = []
        for r in rows:
            u = users.get(r["user_id"]) or {}
            try:
                apps = json.loads(r["apps"] or "[]")
            except ValueError:
                apps = []
            out.append({"id": r["id"], "user_id": r["user_id"], "email": r["email"], "created": r["created"], "last_login": r["last_login"], "apps": apps,
                        "banned": bool(u.get("banned")), "timeout": (u.get("timeout_until") or 0) > now, "name": u.get("name") or ""})
        reqs = [{"id": x["id"], "email": x["email"], "code": x["code"], "app": x["app"], "status": x["status"], "created": x["created"], "decided": x["decided"]}
                for x in db.many(select(resets).order_by(resets.c.id.desc()).limit(60))]
        return jsonify(accounts=out, resets=reqs, pending=sum(1 for x in reqs if x["status"] == "pending"))

    @app.post("/api/admin/acct/reset/<int:rid>")
    @admin_only
    def admin_reset_decide(rid):
        ok = bool(body().get("approve"))
        r = db.one(select(resets).where(resets.c.id == rid))
        if not r or r["status"] != "pending":
            return jsonify(error="That request was already decided."), 409
        db.run(update(resets).where(resets.c.id == rid).values(status="approved" if ok else "denied", decided=time.time()))
        note(f"{'Approved' if ok else 'Denied'} the password reset for {r['email']} (code {r['code']})")
        return jsonify(ok=True, status="approved" if ok else "denied")

    @app.delete("/api/admin/acct/<int:lid>")
    @admin_only
    def admin_acct_delete(lid):
        r = db.one(select(logins).where(logins.c.id == lid))
        if not r:
            return jsonify(error="No such account."), 404
        db.run(delete(logins).where(logins.c.id == lid)); db.run(delete(db.devices).where(db.devices.c.user_id == r["user_id"]))
        note(f"Removed the email login {r['email']}")
        return jsonify(ok=True)
