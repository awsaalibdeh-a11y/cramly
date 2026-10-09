"""Asking for a plan from inside the app. A person writes a short message (or emails you instead); it lands in the owner panel,
and the owner decides: give it free, ask them to pay, mark it paid, or decline. Every decision also reaches the person as a message."""

import time

from flask import jsonify, request

PLAN_NAME = {"premium": "Premium", "plus": "Premium Plus"}
KINDS = {"premium": "asked for a plan", "question": "sent a question", "bug": "reported a problem", "idea": "shared an idea"}


def register(core, admin_only, note, who):
    app, db = core.app, core.db
    select, insert, update = core.select, core.insert, core.update
    need_user_open = core.need_user_open

    def tell(uid, body):
        db.run(insert(db.messages).values(user_id=uid, body=body[:1200], created=time.time(), seen=0))

    def grant(uid, plan, days):
        until = time.time() + days * 86400 if days else 0
        db.run(update(db.users).where(db.users.c.id == uid).values(premium=1, invite_id=0, plus=1 if plan == "plus" else 0, premium_until=until))

    @app.post("/api/request")
    @need_user_open
    def ask_for_plan(user):
        b = request.get_json(silent=True) or {}
        kind = b.get("kind") if b.get("kind") in KINDS else "premium"
        plan = "plus" if b.get("plan") == "plus" else "premium"
        message = str(b.get("message") or "").strip()[:800]
        name = str(b.get("name") or "").strip()[:40]
        if kind == "premium" and user["is_premium"] and (plan == "premium" or user["is_plus"]):
            return jsonify(error="You already have that plan."), 400
        if kind != "premium" and len(message) < 3:
            return jsonify(error="Write a few words so Awsaa knows what you mean."), 400
        if name and not user["name"]:
            db.run(update(db.users).where(db.users.c.id == user["id"]).values(name=name))
        mine = db.many(select(db.plan_requests).where(db.plan_requests.c.user_id == user["id"]).order_by(db.plan_requests.c.id.desc()))
        if len([r for r in mine if time.time() - r["created"] < 86400]) >= 4:
            return jsonify(error="You have asked a few times today. Awsaa will answer here."), 429
        pending = next((r for r in mine if r["status"] == "pending" and (r["kind"] or "premium") == kind), None)
        if pending:
            db.run(update(db.plan_requests).where(db.plan_requests.c.id == pending["id"]).values(plan=plan, message=message, created=time.time()))
            rid = pending["id"]
        else:
            rid = db.run(insert(db.plan_requests).values(user_id=user["id"], plan=plan, kind=kind, message=message, status="pending", created=time.time()))
        who_ = name or user["name"] or "#" + str(user["id"])
        note(f"{who_} asked for {PLAN_NAME[plan]}" if kind == "premium" else f"{who_} {KINDS[kind]}")
        return jsonify(ok=True, id=rid, status="pending")

    @app.get("/api/admin/requests")
    @admin_only
    def admin_requests():
        users = {u["id"]: u for u in db.many(select(db.users))}
        rows = db.many(select(db.plan_requests).order_by(db.plan_requests.c.id.desc()))[:80]
        return jsonify(requests=[{"id": r["id"], "user_id": r["user_id"], "name": (users.get(r["user_id"]) or {}).get("name") or f"#{r['user_id']}",
                                  "exists": r["user_id"] in users, "plan": r["plan"], "kind": r["kind"] or "premium", "message": r["message"], "status": r["status"],
                                  "created": r["created"], "decided": r["decided"], "price": r["price"], "note": r["note"]} for r in rows],
                       pending=sum(1 for r in rows if r["status"] == "pending"))

    @app.post("/api/admin/requests/<int:rid>/decide")
    @admin_only
    def admin_decide(rid):
        r = db.one(select(db.plan_requests).where(db.plan_requests.c.id == rid))
        if not r:
            return jsonify(error="No such request."), 404
        if not db.one(select(db.users.c.id).where(db.users.c.id == r["user_id"])):
            return jsonify(error="That account was deleted."), 400
        b = request.get_json(silent=True) or {}
        decision = b.get("decision")
        plan = "plus" if b.get("plan") == "plus" else "premium" if b.get("plan") == "premium" else r["plan"]
        text, price = str(b.get("note") or "").strip()[:600], str(b.get("price") or "").strip()[:40]
        try:
            days = max(0, min(3650, int(b.get("days") or 0)))
        except (TypeError, ValueError):
            return jsonify(error="Days should be a number."), 400
        uid, label = r["user_id"], PLAN_NAME[plan]
        if decision == "free":
            grant(uid, plan, days)
            tell(uid, f"🎁 Good news! Awsaa is giving you {label} for free. It is unlocked now.{' ' + text if text else ''}")
            note(f"Gave {who(uid)} {label} free (their request)")
        elif decision == "pay":
            price = price or "$2.99"
            tell(uid, f"Thanks for asking! {label} is {price}.{' ' + text if text else ' Awsaa will send you the details.'} It unlocks as soon as it is paid.")
            note(f"Asked {who(uid)} to pay {price} for {label}")
        elif decision == "paid":
            grant(uid, plan, days)
            tell(uid, f"✅ Payment received. {label} is unlocked. Thank you!{' ' + text if text else ''}")
            note(f"Marked {who(uid)} as paid: {label} unlocked")
        elif decision == "declined":
            tell(uid, text or "Thanks for asking. Premium is not available for you right now, but the free tools are always open.")
            note(f"Declined {who(uid)}'s request")
        elif decision == "reply":
            if not text:
                return jsonify(error="Write your reply first."), 400
            tell(uid, f"💬 Awsaa replied: {text}")
            note(f"Replied to {who(uid)}")
            decision = "answered"
        elif decision == "close":
            note(f"Closed {who(uid)}'s message")
            decision = "closed"
        else:
            return jsonify(error="Choose free, pay, paid, declined, reply or close."), 400
        db.run(update(db.plan_requests).where(db.plan_requests.c.id == rid).values(status=decision, plan=plan, decided=time.time(), price=price, note=text))
        return jsonify(ok=True, status=decision)
