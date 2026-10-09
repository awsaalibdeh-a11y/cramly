"""Cramly's storage: SQLite on your computer, Postgres in production (DATABASE_URL).

No passwords: the first visit makes an account and gives that browser a private key; more devices join with a
6-digit code (see app.py)."""

import hashlib
import os
import secrets
import time

from sqlalchemy import (Boolean, Column, Float, ForeignKey, Integer, MetaData, String, Table, Text, create_engine,
                        delete, func, insert, select, update)

BASE = os.path.dirname(os.path.abspath(__file__))
url = os.environ.get("DATABASE_URL") or f"sqlite:///{os.path.join(BASE, 'cramly.db')}"
if url.startswith("postgres://"):
    url = "postgresql://" + url[len("postgres://"):]
if url.startswith("postgresql://"):
    url = "postgresql+psycopg://" + url[len("postgresql://"):]
engine = create_engine(url, pool_pre_ping=True, future=True)
meta = MetaData()

users = Table("users", meta,
    Column("id", Integer, primary_key=True),
    Column("name", String(60), default=""),
    Column("created", Float),
    Column("premium", Integer, default=0),                         # 1 = joined through a premium link
    Column("premium_until", Float, default=0),                     # 0 = no end date
    Column("invite_id", Integer, default=0),                       # which link unlocked it (revoking the link revokes this)
    Column("trial_used", Float, default=0),                        # seconds of the free minute already used
    Column("trial_calls", Integer, default=0),                     # AI jobs run during the free minute
    Column("last_seen", Float, default=0),
    Column("trial_at", Float, default=0),                          # when premium tools were last used (the free minute only runs then)
    Column("banned", Integer, default=0),                          # owner switch: 1 = locked out
    Column("ban_reason", Text, default=""),
    Column("timeout_until", Float, default=0),                     # owner switch: locked out until this time
    Column("plus", Integer, default=0),                            # 1 = Premium Plus (granted directly, or through a Plus link)
)
invites = Table("invites", meta,
    Column("id", Integer, primary_key=True),
    Column("code", String(40), unique=True),
    Column("label", String(80), default=""),                       # who the link is for
    Column("uses_max", Integer, default=3),                        # how many devices can open it
    Column("uses", Integer, default=0),
    Column("days", Integer, default=0),                            # how long premium lasts once joined (0 = forever)
    Column("revoked", Integer, default=0),
    Column("created", Float),
    Column("message", Text, default=""),                           # a personal note shown to whoever opens the link
    Column("plus", Integer, default=0),                            # 1 = the link gives Premium Plus
)

messages = Table("messages", meta,                                   # notes from the owner to one account (or everyone)
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, index=True),
    Column("body", Text),
    Column("created", Float),
    Column("seen", Integer, default=0),
)

plan_requests = Table("plan_requests", meta,                         # "can I have premium?" messages sent from inside the app
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, index=True),
    Column("plan", String(10), default="premium"),                 # premium | plus
    Column("message", Text, default=""),
    Column("status", String(12), default="pending"),               # pending | free | pay | paid | declined
    Column("created", Float),
    Column("decided", Float, default=0),
    Column("price", String(40), default=""),                       # what the owner asked for, when they chose "pay"
    Column("note", Text, default=""),                              # the owner's reply (payment instructions, a kind word...)
)

settings = Table("settings", meta,                                   # owner switches, like the kill switch
    Column("key", String(40), primary_key=True),
    Column("value", Text, default=""),
)
devices = Table("devices", meta,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True),
    Column("key_hash", String(64), unique=True),
    Column("created", Float),
)
pair_codes = Table("pair_codes", meta,
    Column("code", String(12), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE")),
    Column("expires", Float),
)
sets = Table("sets", meta,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True),
    Column("title", String(120)),
    Column("emoji", String(8), default="📚"),
    Column("hue", Integer, default=260),                           # card colour
    Column("exam", String(10), default=""),                        # YYYY-MM-DD
    Column("created", Float),
    Column("opened", Float, default=0),
    Column("cheat", Text, default=""),                             # the one-page cheat sheet (markdown)
    Column("glossary", Text, default=""),                          # JSON key terms and definitions
    Column("mixups", Text, default=""),                            # JSON pairs of easily confused ideas
    Column("predictor", Text, default=""),                         # JSON likely exam questions with model answers
    Column("share_token", String(40), default=""),                 # set when the owner shares the set by link
)
materials = Table("materials", meta,
    Column("id", Integer, primary_key=True),
    Column("set_id", Integer, ForeignKey("sets.id", ondelete="CASCADE"), index=True),
    Column("name", String(200)),
    Column("kind", String(20)),                                    # pdf | docx | pptx | image | text | lecture
    Column("text", Text),
    Column("created", Float),
)
topics = Table("topics", meta,
    Column("id", Integer, primary_key=True),
    Column("set_id", Integer, ForeignKey("sets.id", ondelete="CASCADE"), index=True),
    Column("idx", Integer),
    Column("title", String(160)),
    Column("summary", Text, default=""),
    Column("points", Text, default="[]"),                          # JSON list of key ideas from the plan
    Column("status", Integer, default=0),                          # 0 new, 1 covered, 2 mastered
    Column("notes", Text, default=""),                             # the "Read" page (markdown), made on first open
    Column("quiz", Text, default=""),                              # JSON questions, made on first open
    Column("quiz_best", Integer, default=-1),                      # best score in percent
    Column("swipes", Text, default=""),                            # JSON swipe-game cards (a question with two answers)
    Column("podcast", Text, default=""),                           # JSON two-host audio episode
    Column("boost", Text, default=""),                             # JSON analogies, mnemonics and a real-world example
    Column("lab", Text, default=""),                               # JSON fill-in-the-blank and true/false items
    Column("mynotes", Text, default=""),                           # the student own notes on the topic
    Column("studied", Float, default=0),
)
cards = Table("cards", meta,
    Column("id", Integer, primary_key=True),
    Column("topic_id", Integer, ForeignKey("topics.id", ondelete="CASCADE"), index=True),
    Column("set_id", Integer, ForeignKey("sets.id", ondelete="CASCADE"), index=True),
    Column("front", Text),
    Column("back", Text),
    Column("box", Integer, default=0),                             # Leitner box 0..5
    Column("due", Float, default=0),
    Column("reps", Integer, default=0),
)
activity = Table("activity", meta,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True),
    Column("day", String(10), index=True),                         # YYYY-MM-DD (the student's day)
    Column("n", Integer, default=0),
)
meta.create_all(engine)


def _migrate():
    """create_all adds new tables but not new columns, so older databases get them added here (safe to run every start)."""
    from sqlalchemy import inspect, text
    wanted = {
        "topics": [("swipes", "TEXT DEFAULT ''"), ("podcast", "TEXT DEFAULT ''"), ("boost", "TEXT DEFAULT ''"), ("lab", "TEXT DEFAULT ''"), ("mynotes", "TEXT DEFAULT ''")],
        "sets": [("cheat", "TEXT DEFAULT ''"), ("glossary", "TEXT DEFAULT ''"), ("mixups", "TEXT DEFAULT ''"), ("predictor", "TEXT DEFAULT ''"), ("share_token", "VARCHAR(40) DEFAULT ''")],
        "users": [("premium", "INTEGER DEFAULT 0"), ("premium_until", "FLOAT DEFAULT 0"), ("invite_id", "INTEGER DEFAULT 0"),
                  ("trial_used", "FLOAT DEFAULT 0"), ("trial_calls", "INTEGER DEFAULT 0"), ("last_seen", "FLOAT DEFAULT 0"), ("trial_at", "FLOAT DEFAULT 0"),
                  ("banned", "INTEGER DEFAULT 0"), ("ban_reason", "TEXT DEFAULT ''"), ("timeout_until", "FLOAT DEFAULT 0"),
                  ("plus", "INTEGER DEFAULT 0")],
        "invites": [("message", "TEXT DEFAULT ''"), ("plus", "INTEGER DEFAULT 0")],
    }
    insp = inspect(engine)
    for table, cols in wanted.items():
        if table not in insp.get_table_names():
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols:
            if name not in have:
                with engine.begin() as c:
                    c.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


_migrate()


def hash_key(key):
    return hashlib.sha256(key.encode()).hexdigest()


def one(query):
    with engine.connect() as c:
        row = c.execute(query).mappings().first()
        return dict(row) if row else None


def many(query):
    with engine.connect() as c:
        return [dict(r) for r in c.execute(query).mappings().all()]


def run(stmt):
    with engine.begin() as c:
        res = c.execute(stmt)
        return res.inserted_primary_key[0] if stmt.is_insert and res.inserted_primary_key else res.rowcount


def new_device(user_id):
    key = secrets.token_urlsafe(32)
    run(insert(devices).values(user_id=user_id, key_hash=hash_key(key), created=time.time()))
    return key


def user_for(key):
    if not key:
        return None
    d = one(select(devices).where(devices.c.key_hash == hash_key(key)))
    return d and one(select(users).where(users.c.id == d["user_id"]))


__all__ = ["engine", "users", "invites", "devices", "pair_codes", "sets", "materials", "topics", "cards", "activity", "one", "many",
           "run", "new_device", "user_for", "select", "insert", "update", "delete", "func"]


def setting(key, default=""):
    row = one(select(settings).where(settings.c.key == key))
    return row["value"] if row else default


def set_setting(key, value):
    if one(select(settings).where(settings.c.key == key)):
        run(update(settings).where(settings.c.key == key).values(value=str(value)))
    else:
        run(insert(settings).values(key=key, value=str(value)))
