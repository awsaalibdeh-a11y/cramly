"""The universal layer: one Cramly account works in every app, and the owner can ban, time out, message, troll or switch off
any app (or all of them) from one place. Cramly is the authority; the other apps just ask it.

  GET  /api/uni/guard?app=alibi&dev=<device id>&since=<last note id>   what should this visitor see? (public, bearer key optional)
  POST /api/uni/link {code}      claim a pairing code from Cramly (Settings > Use Cramly on another device) so this app knows the same account
  POST /api/uni/ack              the person has read their inbox
  /api/admin/uni*                owner only (through Cramly Control): apps on/off, notes and trolls, device bans

State is JSON in the settings table, so there is no schema to migrate."""

import json
import re
import time

from flask import jsonify, request

APPS = {"cramly": "Cramly", "homebase": "Homebase", "alibi": "Alibi", "scout": "Scout", "unwritten": "Unwritten", "cookify": "Cookify",
        "crosswind": "Crosswind", "platter": "Platter", "tripmate": "Tripmate", "showcase": "Showcase"}
EFFECTS = ["confetti", "flip", "shake", "rainbow", "disco", "spin", "emoji", "fakecrash", "blur", "typewriter"]
EXEMPT = ("/api/admin", "/api/uni", "/api/status", "/api/me", "/api/beat")


def register(core, admin_only, note, who):
    app, db = core.app, core.db
    select, insert, update = core.select, core.insert, core.update

    def load():
        try:
            st = json.loads(db.setting("uni_state") or "{}")
        except ValueError:
            st = {}
        st.setdefault("apps", {})
        st.setdefault("notes", [])
        st.setdefault("devs", {})
        st.setdefault("seq", 0)
        return st

    def save(st):
        now = time.time()
        st["notes"] = [n for n in st["notes"] if n["expires"] > now][-60:]
        st["devs"] = {k: v for k, v in st["devs"].items() if v.get("banned") or v.get("until", 0) > now}
        db.set_setting("uni_state", json.dumps(st))

    def off_of(st, app_id):
        for key in (app_id, "*"):
            a = st["apps"].get(key) or {}
            if a.get("off"):
                return True, a.get("msg") or ""
        return False, ""

    # ---- cramly itself obeys the same switches
    @app.before_request
    def uni_switch():
        p = request.path
        if p.startswith("/api/") and not p.startswith(EXEMPT):
            off, msg = off_of(load(), "cramly")
            if off:
                return jsonify(error=msg or "Cramly is switched off for a bit. Back soon.", maintenance=True), 503
        return None

    @app.before_request
    def uni_cors_preflight():
        if request.method == "OPTIONS" and request.path.startswith("/api/uni/"):
            return ("", 204)
        return None

    @app.after_request
    def uni_cors(resp):
        if request.path.startswith("/api/uni/"):
            resp.headers["Access-Control-Allow-Origin"] = "*"                    # no cookies are used: the key travels in a header
            resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            resp.headers["Cache-Control"] = "no-store"
        return resp

    # ---------------------------------------------------------------- what an app asks
    @app.get("/api/uni/guard")
    def uni_guard():
        app_id = re.sub(r"[^a-z]", "", request.args.get("app", "").lower())[:20]
        dev = re.sub(r"[^\w-]", "", request.args.get("dev", ""))[:48]
        try:
            since = int(request.args.get("since") or 0)
        except ValueError:
            since = 0
        now = time.time()
        st = load()
        off, msg = off_of(st, app_id)
        key = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        user = db.user_for(key) if key else None
        out = {"app": app_id, "off": off, "message": msg, "linked": bool(user), "name": (user["name"] or "") if user else "",
               "banned": False, "timeout_until": 0, "reason": "", "contact": core.CONTACT, "notes": [], "inbox": [], "now": now}
        if user:
            out["banned"] = bool(user["banned"])
            if (user["timeout_until"] or 0) > now:
                out["timeout_until"] = user["timeout_until"]
            out["reason"] = user["ban_reason"] or ""
            if app_id != "cramly":                                               # Cramly shows its own inbox
                rows = db.many(select(db.messages).where(db.messages.c.user_id == user["id"], db.messages.c.seen == 0).order_by(db.messages.c.id))
                out["inbox"] = [{"id": m["id"], "body": m["body"]} for m in rows][:5]
        d = st["devs"].get(dev) if dev else None
        if d:
            if d.get("banned"):
                out["banned"], out["reason"] = True, d.get("reason", "")
            elif d.get("until", 0) > now:
                out["timeout_until"], out["reason"] = d["until"], d.get("reason", "")
        out["notes"] = [{k: n[k] for k in ("id", "kind", "body", "effect")} for n in st["notes"]
                        if n["id"] > since and n["app"] in ("*", app_id) and n["expires"] > now]
        out["last"] = st["seq"]
        return jsonify(out)

    @app.post("/api/uni/link")
    def uni_link():
        if core.limited("pair", 20):
            return jsonify(error="Too many tries. Wait a while."), 429
        code = re.sub(r"\D", "", str((request.get_json(silent=True) or {}).get("code", "")))
        row = db.one(select(db.pair_codes).where(db.pair_codes.c.code == code))
        if not row or row["expires"] < time.time():
            return jsonify(error="That code is wrong or expired. In Cramly open Settings, Use Cramly on another device, and make a new one."), 400
        db.run(core.delete(db.pair_codes).where(db.pair_codes.c.code == code))
        u = db.one(select(db.users).where(db.users.c.id == row["user_id"]))
        return jsonify(key=db.new_device(row["user_id"]), name=(u["name"] or "") if u else "")

    @app.post("/api/uni/ack")
    def uni_ack():
        key = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        user = db.user_for(key) if key else None
        if user:
            db.run(update(db.messages).where(db.messages.c.user_id == user["id"], db.messages.c.seen == 0).values(seen=1))
        return jsonify(ok=True)

    # ---------------------------------------------------------------- the owner's side
    @app.get("/api/uni/verify")
    @admin_only
    def uni_verify():
        """Other apps (Homebase) ask: is this the owner's key? Wrong keys count toward the same lockout as everywhere else."""
        return jsonify(ok=True)

    @app.get("/api/admin/uni")
    @admin_only
    def uni_state():
        st = load()
        now = time.time()
        return jsonify(apps=[{"id": k, "name": v, **{"off": bool((st["apps"].get(k) or {}).get("off")), "msg": (st["apps"].get(k) or {}).get("msg", "")}} for k, v in APPS.items()],
                       all={"off": bool((st["apps"].get("*") or {}).get("off")), "msg": (st["apps"].get("*") or {}).get("msg", "")},
                       notes=[n for n in st["notes"] if n["expires"] > now][::-1], effects=EFFECTS,
                       devs=[{"dev": k, **v} for k, v in st["devs"].items()], now=now)

    @app.post("/api/admin/uni/app")
    @admin_only
    def uni_app():
        b = request.get_json(silent=True) or {}
        app_id = str(b.get("app") or "")
        if app_id != "*" and app_id not in APPS:
            return jsonify(error="Unknown app."), 404
        st = load()
        st["apps"][app_id] = {"off": bool(b.get("off")), "msg": str(b.get("msg") or "")[:300]}
        save(st)
        label = "ALL apps" if app_id == "*" else APPS[app_id]
        note(("Switched OFF " if b.get("off") else "Switched back ON ") + label)
        return jsonify(ok=True)

    @app.post("/api/admin/uni/note")
    @admin_only
    def uni_note():
        b = request.get_json(silent=True) or {}
        app_id = str(b.get("app") or "*")
        if app_id != "*" and app_id not in APPS:
            return jsonify(error="Unknown app."), 404
        kind = "troll" if b.get("kind") == "troll" else "message"
        effect = str(b.get("effect") or "")
        if kind == "troll" and effect not in EFFECTS:
            effect = "confetti"
        body = str(b.get("body") or "").strip()[:400]
        if kind == "message" and not body:
            return jsonify(error="Write a message first."), 400
        try:
            mins = max(1, min(60 * 24 * 7, int(b.get("minutes") or 60)))
        except (TypeError, ValueError):
            mins = 60
        st = load()
        st["seq"] += 1
        st["notes"].append({"id": st["seq"], "app": app_id, "kind": kind, "body": body, "effect": effect, "created": time.time(), "expires": time.time() + mins * 60})
        save(st)
        note(f"Sent a {kind}{' (' + effect + ')' if kind == 'troll' else ''} to " + ("everyone" if app_id == "*" else APPS[app_id]))
        return jsonify(ok=True, id=st["seq"])

    @app.delete("/api/admin/uni/note/<int:nid>")
    @admin_only
    def uni_note_delete(nid):
        st = load()
        st["notes"] = [n for n in st["notes"] if n["id"] != nid]
        save(st)
        return jsonify(ok=True)

    @app.post("/api/admin/uni/device")
    @admin_only
    def uni_device():
        """Ban or time out someone who never linked a Cramly account, by the device id the panel shows."""
        b = request.get_json(silent=True) or {}
        dev = re.sub(r"[^\w-]", "", str(b.get("dev") or ""))[:48]
        if not dev:
            return jsonify(error="Give a device id."), 400
        st = load()
        try:
            mins = max(0, min(60 * 24 * 365, int(b.get("minutes") or 0)))
        except (TypeError, ValueError):
            mins = 0
        if b.get("clear"):
            st["devs"].pop(dev, None)
        elif mins:
            st["devs"][dev] = {"until": time.time() + mins * 60, "reason": str(b.get("reason") or "")[:300]}
        else:
            st["devs"][dev] = {"banned": True, "reason": str(b.get("reason") or "")[:300]}
        save(st)
        note(("Lifted the block on device " if b.get("clear") else "Blocked device ") + dev[:8])
        return jsonify(ok=True)
