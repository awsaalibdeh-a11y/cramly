"""Turning an uploaded file into plain text: PDF, Word, PowerPoint, text, and photos of notes."""

import io
import os
import re

import ai

MAX_FILE = 18 * 1024 * 1024
MAX_TEXT = 400_000
IMAGES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


def clean(text):
    text = text.replace("\x00", " ").replace("\r", "\n")
    text = re.sub(r"[ \t ]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _pdf(data, name):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    text = "\n\n".join((p.extract_text() or "") for p in reader.pages[:300])
    if len(clean(text)) < 200 and len(data) < 12 * 1024 * 1024:       # scanned pages: have the AI read them
        text = ai.pdf_text(data, name)
    return text


def _docx(data):
    import docx
    d = docx.Document(io.BytesIO(data))
    lines = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            lines.append(" | ".join(c.text.strip() for c in row.cells))
    return "\n".join(lines)


def _pptx(data):
    from pptx import Presentation
    out = []
    for i, slide in enumerate(Presentation(io.BytesIO(data)).slides, 1):
        parts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
            if getattr(shape, "has_table", False) and shape.has_table:
                parts.extend(" | ".join(c.text for c in r.cells) for r in shape.table.rows)
        if slide.has_notes_slide:
            parts.append("Speaker notes: " + slide.notes_slide.notes_text_frame.text)
        out.append(f"[Slide {i}]\n" + "\n".join(p for p in parts if p.strip()))
    return "\n\n".join(out)


def read_file(name, data):
    """Returns (kind, text). Raises ai.AIError with a friendly message when it can't."""
    ext = os.path.splitext(name.lower())[1]
    if len(data) > MAX_FILE:
        raise ai.AIError(f"{name} is bigger than 18 MB. Try a smaller file.")
    try:
        if ext == ".pdf":
            kind, text = "pdf", _pdf(data, name)
        elif ext == ".docx":
            kind, text = "docx", _docx(data)
        elif ext == ".pptx":
            kind, text = "pptx", _pptx(data)
        elif ext in IMAGES:
            kind, text = "image", ai.image_text(data, IMAGES[ext])
        elif ext in (".txt", ".md", ".csv", ".srt", ".vtt", ""):
            kind, text = "text", data.decode("utf-8", "replace")
        else:
            raise ai.AIError(f"{name}: I can read PDF, Word, PowerPoint, text files and photos.")
    except ai.AIError:
        raise
    except Exception:
        raise ai.AIError(f"I couldn't open {name}. Is it a normal, unlocked file?")
    text = clean(text)
    if len(text) < 40:
        raise ai.AIError(f"I couldn't find any text in {name}.")
    return kind, text[:MAX_TEXT]
