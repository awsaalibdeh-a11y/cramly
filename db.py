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
    have = {c["name"] for c in inspect(engine).get_columns("topics")}
    with engine.begin() as c:
        if "swipes" not in have:
            c.execute(text("ALTER TABLE topics ADD COLUMN swipes TEXT DEFAULT ''"))


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


__all__ = ["engine", "users", "devices", "pair_codes", "sets", "materials", "topics", "cards", "activity", "one", "many",
           "run", "new_device", "user_for", "select", "insert", "update", "delete", "func"]
