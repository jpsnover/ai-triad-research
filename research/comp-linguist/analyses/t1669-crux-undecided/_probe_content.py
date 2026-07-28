"""Probe transcript `content` shape + turn length across the frozen 30 — informs the signal-B
τ answer (long turns dilute whole-turn cosine) and the content-field confirmation. Read-only."""
import json, os, collections

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
FILES = ["debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5","debate-0b5dee92-4837-4bff-bd20-206aeef9b118",
    "debate-1418ee11-5641-4033-a400-c26c9f5e4f45","debate-400f834d-50c8-45f8-ba30-9936fb0e8b28",
    "debate-4c766822-edf7-43a1-b27b-413c554d6efd","debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8"]

shape = collections.Counter()
lengths = []
for fn in FILES:
    d = json.load(open(os.path.join(DEB, fn + ".json"), encoding="utf-8"))
    for t in (d.get("transcript") or []):
        if (t.get("speaker") or "") in ("system", "moderator", ""):
            continue
        c = t.get("content")
        shape[type(c).__name__] += 1
        if isinstance(c, str):
            lengths.append(len(c))
        elif isinstance(c, dict):
            lengths.append(len(str(c.get("text") or c.get("content") or "")))

lengths.sort()
n = len(lengths)
print("content type distribution (non-system turns):", dict(shape))
if n:
    print(f"turn char-length: min={lengths[0]} p50={lengths[n//2]} p90={lengths[int(n*0.9)]} max={lengths[-1]}")
    print(f"~tokens (chars/4): p50~{lengths[n//2]//4} p90~{lengths[int(n*0.9)]//4} "
          f"(all-MiniLM truncates ~256 tok => turns over ~1024 chars are truncated)")
