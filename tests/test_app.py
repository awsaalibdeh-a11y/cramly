"""Cramly's server without the internet: the AI is faked."""

import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
os.environ["OPENAI_API_KEY"] = "test"

import ai  # noqa: E402
import app as server  # noqa: E402
import ingest  # noqa: E402

PLAN = {"title": "Cells", "emoji": "🔬", "topics": [
    {"title": "Cell basics", "summary": "What cells are", "points": ["nucleus", "membrane"]},
    {"title": "Organelles", "summary": "Parts of a cell", "points": ["mitochondria", "ribosome"]},
    {"title": "Cell division", "summary": "Mitosis", "points": ["mitosis"]}]}
QUIZ = [{"q": f"Question {i}?", "options": ["a", "b", "c", "d"], "answer": i % 4, "why": "because"} for i in range(6)]
CARDS = [{"front": f"term {i}", "back": f"meaning {i}"} for i in range(10)]
NOTES = "Hook line.\n\n## What it is\n- **Cell**: unit of life\n\n## Remember\n- one\n- two"
TEXT = "The cell is the basic unit of life. " * 12


def fake_plan(text, hint="", on_status=None):
    if on_status:
        on_status("Planning your topics…")
    return json.loads(json.dumps(PLAN))


class Cramly(unittest.TestCase):
    def setUp(self):
        self.c = server.app.test_client()
        server._hits.clear()
        self.key = self.c.post("/api/account", json={"name": "Aws"}).get_json()["key"]
        self.h = {"Authorization": f"Bearer {self.key}", "X-Tz-Offset": "-180"}

    def events(self, resp):
        return [json.loads(x) for x in resp.get_data(as_text=True).splitlines() if x.strip()]

    def make_set(self, text=TEXT):
        with mock.patch.object(ai, "make_plan", fake_plan):
            ev = self.events(self.c.post("/api/sets", headers=self.h, data={"text": text}))
        return next(e["id"] for e in ev if e["type"] == "set")

    def topics(self, sid):
        return self.c.get(f"/api/sets/{sid}", headers=self.h).get_json()["topics"]

    def test_needs_a_key(self):
        self.assertEqual(self.c.get("/api/sets").status_code, 401)
        self.assertEqual(self.c.get("/api/sets", headers={"Authorization": "Bearer nope"}).status_code, 401)

    def test_create_set_streams_progress_then_builds_topics(self):
        with mock.patch.object(ai, "make_plan", fake_plan):
            ev = self.events(self.c.post("/api/sets", headers=self.h, data={"text": TEXT, "title": ""}))
        self.assertEqual([e["type"] for e in ev if e["type"] != "ping"], ["status", "status", "set", "done"])
        sid = next(e["id"] for e in ev if e["type"] == "set")
        d = self.c.get(f"/api/sets/{sid}", headers=self.h).get_json()
        self.assertEqual((d["set"]["title"], d["set"]["topics"], len(d["materials"])), ("Cells", 3, 1))
        self.assertEqual([t["title"] for t in d["topics"]], ["Cell basics", "Organelles", "Cell division"])

    def test_empty_upload_is_refused(self):
        self.assertEqual(self.c.post("/api/sets", headers=self.h, data={"text": "too short"}).status_code, 400)

    def test_a_friendly_error_is_streamed_when_the_ai_fails(self):
        with mock.patch.object(ai, "make_plan", side_effect=ai.AIError("The AI is busy right now. Try again in a moment.")):
            ev = self.events(self.c.post("/api/sets", headers=self.h, data={"text": TEXT}))
        self.assertEqual(ev[-2], {"type": "error", "text": "The AI is busy right now. Try again in a moment."})
        self.assertEqual(self.c.get("/api/sets", headers=self.h).get_json()["sets"], [])

    def test_sets_are_private_to_their_owner(self):
        sid = self.make_set()
        other = self.c.post("/api/account", json={}).get_json()["key"]
        self.assertEqual(self.c.get(f"/api/sets/{sid}", headers={"Authorization": f"Bearer {other}"}).status_code, 404)
        tid = self.topics(sid)[0]["id"]
        self.assertEqual(self.c.get(f"/api/topics/{tid}/notes", headers={"Authorization": f"Bearer {other}"}).status_code, 404)
        self.assertEqual(self.c.delete(f"/api/sets/{sid}", headers={"Authorization": f"Bearer {other}"}).status_code, 404)

    def test_notes_cards_quiz_are_made_once_then_kept(self):
        tid = self.topics(self.make_set())[0]["id"]
        with mock.patch.object(ai, "make_notes", return_value=NOTES) as notes, mock.patch.object(ai, "make_cards", return_value=CARDS) as cards, \
                mock.patch.object(ai, "make_quiz", return_value=QUIZ) as quiz:
            for _ in range(2):
                self.assertIn("Remember", self.c.get(f"/api/topics/{tid}/notes", headers=self.h).get_json()["notes"])
                self.assertEqual(len(self.c.get(f"/api/topics/{tid}/cards", headers=self.h).get_json()["cards"]), 10)
                self.assertEqual(len(self.c.get(f"/api/topics/{tid}/quiz", headers=self.h).get_json()["questions"]), 6)
        self.assertEqual((notes.call_count, cards.call_count, quiz.call_count), (1, 1, 1))

    def test_mastery_comes_from_quiz_80_percent(self):
        sid = self.make_set()
        tid = self.topics(sid)[0]["id"]
        post = lambda **b: self.c.post(f"/api/topics/{tid}/event", headers=self.h, json=b).get_json()
        self.assertEqual(post(kind="read")["status"], 1)
        self.assertEqual(post(kind="quiz", score=3, total=6)["status"], 1)
        r = post(kind="quiz", score=5, total=6)
        self.assertEqual((r["status"], r["quiz_best"]), (2, 83))
        self.assertEqual(post(kind="quiz", score=1, total=6)["status"], 2)       # never goes back down
        self.assertEqual(self.c.get(f"/api/sets/{sid}", headers=self.h).get_json()["set"]["mastered"], 1)

    def test_flashcard_review_schedules_and_masters(self):
        tid = self.topics(self.make_set())[0]["id"]
        with mock.patch.object(ai, "make_cards", return_value=CARDS[:2]):
            cards = self.c.get(f"/api/topics/{tid}/cards", headers=self.h).get_json()["cards"]
        rv = lambda cid, g: self.c.post(f"/api/cards/{cid}/review", headers=self.h, json={"grade": g}).get_json()
        self.assertEqual(rv(cards[0]["id"], 0)["box"], 0)
        self.assertEqual(rv(cards[0]["id"], 2)["box"], 1)
        self.assertEqual(rv(cards[0]["id"], 3)["box"], 3)
        self.assertEqual(rv(cards[1]["id"], 3)["box"], 2)
        self.assertEqual(rv(cards[1]["id"], 3)["status"], 2)                      # every card in box >= 3: mastered
        due = self.c.get("/api/due", headers=self.h).get_json()["cards"]
        self.assertEqual(due, [])                                                  # all pushed into the future

    def test_chat_streams_and_uses_the_material(self):
        sid = self.make_set()
        tid = self.topics(sid)[0]["id"]
        seen = {}

        def fake_chat(mode, context, messages):
            seen.update(mode=mode, context=context)
            yield "Hello "
            yield "there"
        with mock.patch.object(ai, "chat", fake_chat):
            r = self.c.post("/api/chat", headers=self.h, json={"set_id": sid, "topic_id": tid, "mode": "guided", "messages": [{"role": "user", "content": "teach me"}]})
        text = "".join(e.get("text", "") for e in self.events(r) if e["type"] == "delta")
        self.assertEqual(text, "Hello there")
        self.assertEqual(seen["mode"], "guided")
        self.assertIn("CURRENT TOPIC: Cell basics", seen["context"])
        self.assertIn("basic unit of life", seen["context"])
        bad = self.c.post("/api/chat", headers=self.h, json={"set_id": sid, "messages": [{"role": "assistant", "content": "x"}]})
        self.assertEqual(bad.status_code, 400)

    def test_exam_date_makes_a_day_by_day_plan(self):
        sid = self.make_set()
        exam = (dt.date.today() + dt.timedelta(days=4)).isoformat()
        self.assertEqual(self.c.patch(f"/api/sets/{sid}", headers=self.h, json={"exam": exam}).status_code, 200)
        d = self.c.get(f"/api/sets/{sid}", headers=self.h).get_json()
        self.assertEqual(len(d["plan"]), 3)
        self.assertTrue(all(p["date"] < exam for p in d["plan"]))                  # the exam day itself stays free
        ev = self.c.get("/api/calendar", headers=self.h).get_json()["events"]
        self.assertEqual([e["kind"] for e in ev].count("exam"), 1)
        self.assertEqual(self.c.patch(f"/api/sets/{sid}", headers=self.h, json={"exam": "banana"}).status_code, 400)

    def test_schedule_spreads_topics_and_skips_mastered(self):
        today = dt.date(2026, 10, 1)
        topics = [{"id": i, "status": 2 if i == 0 else 0} for i in range(7)]
        plan = server.schedule("2026-10-05", topics, today)
        self.assertEqual(len(plan), 6)
        self.assertEqual(max(d for d, _ in plan), dt.date(2026, 10, 3))
        self.assertEqual(server.schedule("2026-09-01", topics, today), [])
        self.assertEqual(server.schedule("", topics, today), [])

    def test_streak_counts_consecutive_days(self):
        sid = self.make_set()
        uid = server.db.one(server.select(server.db.sets.c.user_id).where(server.db.sets.c.id == sid))["user_id"]
        today = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=3)).date()           # the test's browser is UTC+3
        for back in (1, 2, 3):
            server.db.run(server.insert(server.db.activity).values(user_id=uid, day=(today - dt.timedelta(days=back)).isoformat(), n=1))
        with server.app.test_request_context(headers={"X-Tz-Offset": "-180"}):
            self.assertGreaterEqual(server.streak({"id": uid}), 4)

    def test_add_material_only_adds_new_topics(self):
        sid = self.make_set()
        more = {**PLAN, "topics": [PLAN["topics"][0], {"title": "Genetics", "summary": "DNA", "points": ["gene"]}]}
        with mock.patch.object(ai, "make_plan", lambda t, h="", on_status=None: json.loads(json.dumps(more))):
            ev = self.events(self.c.post(f"/api/sets/{sid}/materials", headers=self.h, data={"text": TEXT + " Genetics adds DNA and genes."}))
        self.assertIn({"type": "added", "topics": 1}, ev)
        self.assertEqual([t["title"] for t in self.topics(sid)][-1], "Genetics")

    def test_practice_test_mixes_topic_quizzes(self):
        sid = self.make_set()
        with mock.patch.object(ai, "make_quiz", return_value=QUIZ):
            qs = self.c.get(f"/api/sets/{sid}/test", headers=self.h).get_json()["questions"]
        self.assertGreaterEqual(len(qs), 8)
        self.assertEqual({q["topic"] for q in qs} <= {t["title"] for t in PLAN["topics"]}, True)

    def test_pairing_a_second_device(self):
        code = self.c.post("/api/pair", headers=self.h).get_json()["code"]
        key2 = self.c.post("/api/pair/claim", json={"code": code}).get_json()["key"]
        self.assertEqual(self.c.get("/api/me", headers={"Authorization": f"Bearer {key2}"}).get_json()["name"], "Aws")
        self.assertEqual(self.c.post("/api/pair/claim", json={"code": code}).status_code, 400)       # one use

    def test_delete_account_removes_everything(self):
        sid = self.make_set()
        self.assertEqual(self.c.delete("/api/me", headers=self.h).status_code, 200)
        self.assertEqual(self.c.get("/api/me", headers=self.h).status_code, 401)
        for table in (server.db.topics, server.db.materials, server.db.sets):
            col = table.c.set_id if "set_id" in table.c else table.c.id
            self.assertEqual(server.db.many(server.select(table).where(col == sid)), [])    # no orphans left behind

    def test_install_files(self):
        self.assertEqual(self.c.get("/manifest.webmanifest").get_json()["short_name"], "Cramly")
        sw = self.c.get("/sw.js")
        self.assertEqual(sw.headers["Service-Worker-Allowed"], "/")
        sw.close()


class Reading(unittest.TestCase):
    def test_text_and_unknown_files(self):
        kind, text = ingest.read_file("notes.txt", ("Photosynthesis uses light. " * 5).encode())
        self.assertEqual(kind, "text")
        with self.assertRaises(ai.AIError):
            ingest.read_file("virus.exe", b"MZ" * 40)
        with self.assertRaises(ai.AIError):
            ingest.read_file("empty.txt", b"hi")

    def test_docx_tables_and_pptx_notes(self):
        import docx
        import pptx
        d = docx.Document()
        d.add_paragraph("Organelles do the work of the cell, each with a job.")
        t = d.add_table(rows=1, cols=2)
        t.cell(0, 0).text, t.cell(0, 1).text = "Ribosome", "Makes protein"
        buf = io.BytesIO(); d.save(buf)
        self.assertIn("Ribosome | Makes protein", ingest.read_file("a.docx", buf.getvalue())[1])
        p = pptx.Presentation()
        s = p.slides.add_slide(p.slide_layouts[1])
        s.shapes.title.text, s.placeholders[1].text = "Newton", "F = ma tells us force is mass times acceleration."
        s.notes_slide.notes_text_frame.text = "Mention net force."
        buf = io.BytesIO(); p.save(buf)
        self.assertIn("net force", ingest.read_file("a.pptx", buf.getvalue())[1].lower())

    def test_retrieval_prefers_relevant_chunks(self):
        text = ("Bananas are yellow fruit grown in warm places. " * 80) + ("Mitochondria produce ATP by cellular respiration. " * 5) + ("Cats sleep a lot every day. " * 80)
        got = ai.relevant(text, "How do mitochondria make ATP?", limit=1500, size=400)
        self.assertIn("Mitochondria", got)
        self.assertLess(len(got), len(text))


if __name__ == "__main__":
    unittest.main()
