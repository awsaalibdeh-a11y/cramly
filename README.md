# Cramly

Study smarter from your own notes. Upload a PDF, Word file, PowerPoint, photos of notes, or a recorded lecture:
Cramly builds a study plan, then teaches it.

- **Study sets** → a plan of 5-14 topics (`ai.make_plan`; long documents are outlined in parallel first).
- **Per topic**: a guided tutor (Socratic, one question at a time) or plain Q&A, a short "Read" page, flashcards with
  spaced repetition (Leitner boxes 1/3/7/14/30 days), a 6-question quiz. Score 80% or get every card to box 3 = mastered.
- **Swipe game** (the "aura" game): a character asks a question, you swipe toward one of two answers (drag, or tap, or ←/→).
  Right = +aura with a combo bonus, wrong = -aura; levels from NPC to Legend. Cards come from `ai.make_swipes` and are
  cached per topic (`topics.swipes`); more are written in the background so a replay is fresh.
- **Explain it back** (Feynman): write the topic in your own words, the AI grades it against your material (what you got,
  what's missing); 85+ masters the topic.
- **Focus timer**, a **next best step** suggestion, a dashboard (streak, aura, due cards, mastered, focus minutes),
  light/dark theme, CSV export of flashcards (opens in Excel, imports into Anki).
- **Whole set**: flashcards, mixed practice test, match game, a day-by-day plan from the exam date, a calendar, a daily
  review of every card that's due, streaks.
- **Tutor panel**: streams answers from *your* material (a small TF-IDF retrieval picks the relevant chunks), voice
  calls (browser speech recognition + voices), dictation, English or Arabic.
- **Record a lecture**: live transcription in the browser, then it becomes a study set or adds topics to one.
- **Works offline** (`static/offline.js`): sets, topics, notes and cards you have opened are kept for offline study; flashcard reviews and topic progress made offline are queued and synced on reconnect; AI features say they need a connection.
- No passwords: the first visit makes an account and keeps a private key in the browser; other devices join with a
  6-digit code. Installable as an app (PWA).

Reading files (`ingest.py`): PDF (scanned PDFs are read by the AI), DOCX (tables too), PPTX (speaker notes too),
text, and photos (vision).

## Run it

```bash
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5115
python -m unittest discover tests
```

Environment: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (default gpt-5-mini), `FAST_MODEL` (default gpt-5-nano, used
to outline long documents), `DATABASE_URL` (Postgres in production; SQLite locally if unset).
Older databases are upgraded at startup (`db._migrate` adds new columns). Per-visitor limits keep costs in check: 12 set builds, 150 generations and 150 tutor messages per hour.
