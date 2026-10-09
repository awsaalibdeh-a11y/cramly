s = open("ai.py", encoding="utf-8").read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
rep("        parts = _chunks(text)\n", "        parts = _chunks(text, max(12000, -(-len(text) // 24)))          # long documents: at most about 24 bigger sections, outlined side by side\n")
rep('"Outline this section of study material in about 200 words: every topic, term and fact worth learning. "', '"Outline this section of study material in about 250 words: every topic, term and fact worth learning. "')
rep("with ThreadPoolExecutor(max_workers=6) as pool:\n            source = \"\n\n\".join(f\"[Section {i + 1}]\n{o}\" for i, o in enumerate(pool.map(outline, parts[:40])))",
    "with ThreadPoolExecutor(max_workers=12) as pool:\n            source = \"\n\n\".join(f\"[Section {i + 1}]\n{o}\" for i, o in enumerate(pool.map(outline, parts[:30])))")
open("ai.py", "w", encoding="utf-8").write(s)
