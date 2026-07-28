"""t/1669 AC#2 — signal-B PRE-SWEEP (de-risk before DebateTool builds t/1860).

Question: CAN a max-sentence embedding-similarity gate separate the 24 adjudicated from the 6
genuinely-undecided cruxes in the frozen 30 at precision >=0.90 AND recall >=4/6? If no threshold
does, signal B is refuted too and we rethink before implementation (signal A already cost a build).

Predicate replicated per CL's t/1860#2 recommendation: for each of the crux's speakers_involved
camps (excluding system/document pseudo-camps), a turn qualifies if the MAX cosine similarity of any
of its sentences vs the crux `description` >= tau. Camp engaged if it has >= minTurnsPerCamp
qualifying turns. Adjudicated (=> stays identified, NOT undecided) iff >=2 camps engaged.

Similarity: sentence-transformers all-MiniLM-L6-v2 (same weights as the project ONNX path; mean-pool
+ L2-norm cosine). Parity is adequate for finding a separating threshold — the derived tau is
re-confirmed against DebateTool's landed seam before any stipulated->derived flip.
Read-only over the data repo; embeddings are ephemeral (no writes to ai-triad-data)."""
import json, os, re, itertools
import numpy as np

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
OUT = r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t1669-crux-undecided/ac2-signalB-presweep.json"

SAMPLE = [
    ("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5","AN-12"),("debate-0b5dee92-4837-4bff-bd20-206aeef9b118","AN-24"),
    ("debate-1418ee11-5641-4033-a400-c26c9f5e4f45","AN-29"),("debate-1685da89-0e7b-432b-8827-fc927200dbd5","AN-35"),
    ("debate-1be82941-4020-478a-b334-64bb5c23e015","AN-13"),("debate-1ffff43a-4aff-4f58-b126-f020de713f8a","AN-29"),
    ("debate-3210eb8a-e4a4-4421-8150-56a06fc4aaed","AN-14"),("debate-396208e0-60d6-4d60-a9e4-3af6b4cf9501","AN-66"),
    ("debate-39d97d44-0a48-4da6-87d7-80a1763e6db0","AN-51"),("debate-400f834d-50c8-45f8-ba30-9936fb0e8b28","AN-13"),
    ("debate-4c766822-edf7-43a1-b27b-413c554d6efd","D-1"),("debate-57c14a81-9e4a-45d6-91d4-db23b61bdb86","AN-18"),
    ("debate-5c33db20-2135-4360-b269-e61d7ad8d89f","AN-15"),("debate-5ff58b8b-8097-402c-bd32-6e0573f7e022","AN-10"),
    ("debate-6502276d-8247-40b0-8f37-44342ea5a339","AN-11"),("debate-7490d9c2-74d3-4e6d-8064-d15d8f821f11","AN-11"),
    ("debate-835bff57-5a78-454e-b263-2e51fc3e1832","AN-8"),("debate-9152a7fd-d477-44d3-a5e1-29fa06943ba4","AN-44"),
    ("debate-9dccfcbe-14d8-46d2-b363-6b2962fbe5c7","AN-2"),("debate-a0eaaca9-3732-43f6-b386-44d049c065d1","AN-62"),
    ("debate-aa493447-2b1a-42b8-93cd-5f64f982e86b","AN-1"),("debate-ad01203f-b1db-4425-8682-32fb2dd4f41a","AN-5"),
    ("debate-bd1d6c61-83ea-4029-9efd-1444c5cb1975","AN-22"),("debate-c4fe24f0-f967-4378-baa6-a845c4d768fc","AN-8"),
    ("debate-cbf5bb79-b02b-47af-9e4a-d1baa79373b0","AN-1"),("debate-cff6b797-64fb-447c-b738-b5b67b0ede37","AN-26"),
    ("debate-d6a1b446-8e05-4873-8422-3a16763a3b7d","AN-25"),("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8","AN-23"),
    ("debate-f2a29ea0-b7a3-4b93-8ece-85b8ae8e9ad4","AN-22"),("debate-f9c54c70-dfc3-4255-b125-0c49da39c519","AN-9"),
]
TRUE_UNDECIDED = {("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5","AN-12"),
    ("debate-0b5dee92-4837-4bff-bd20-206aeef9b118","AN-24"),("debate-1418ee11-5641-4033-a400-c26c9f5e4f45","AN-29"),
    ("debate-1ffff43a-4aff-4f58-b126-f020de713f8a","AN-29"),("debate-4c766822-edf7-43a1-b27b-413c554d6efd","D-1"),
    ("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8","AN-23")}
PSEUDO = {"system", "document", "moderator"}

def sentences(txt):
    parts = re.split(r"(?<=[.!?])\s+", (txt or "").strip())
    return [s for s in (p.strip() for p in parts) if len(s) >= 15]

print("loading all-MiniLM-L6-v2 ...")
from sentence_transformers import SentenceTransformer
import sentence_transformers as st
print("sentence_transformers", st.__version__)
model = SentenceTransformer("all-MiniLM-L6-v2")

# Per-crux: compute, for each involved camp, the list of per-turn max-sentence similarities to the crux.
per_crux = []
emb_cache = {}
def embed(strs):
    todo = [s for s in strs if s not in emb_cache]
    if todo:
        vecs = model.encode(todo, normalize_embeddings=True, batch_size=64, show_progress_bar=False)
        for s, v in zip(todo, vecs):
            emb_cache[s] = v
    return np.array([emb_cache[s] for s in strs])

for fn, cid in SAMPLE:
    d = json.load(open(os.path.join(DEB, fn + ".json"), encoding="utf-8"))
    crux = next((c for c in (d.get("crux_tracker") or []) if c.get("id") == cid), None)
    desc = (crux.get("description") or "").strip()
    cvec = embed([desc])[0] if desc else None
    camps = [c for c in dict.fromkeys(crux.get("speakers_involved") or []) if c not in PSEUDO]
    camp_turn_maxsims = {}
    for camp in camps:
        turn_max = []
        for t in (d.get("transcript") or []):
            if t.get("speaker") != camp:
                continue
            c = t.get("content")
            if isinstance(c, dict):
                c = c.get("text") or c.get("content") or ""
            sents = sentences(str(c))
            if not sents or cvec is None:
                turn_max.append(0.0); continue
            svecs = embed(sents)
            turn_max.append(float(np.max(svecs @ cvec)))
        camp_turn_maxsims[camp] = turn_max
    per_crux.append({"file": fn[:15], "crux": cid,
                     "truth": "undecided" if (fn, cid) in TRUE_UNDECIDED else "adjudicated",
                     "camps": camps, "camp_turn_maxsims": camp_turn_maxsims})

def gate_adjudicated(rec, tau, min_turns):
    engaged = 0
    for camp, sims in rec["camp_turn_maxsims"].items():
        if sum(1 for s in sims if s >= tau) >= min_turns:
            engaged += 1
    return engaged >= 2

def score(tau, min_turns):
    tp = fp = fn = tn = 0
    for rec in per_crux:
        adj = gate_adjudicated(rec, tau, min_turns)
        label_und = not adj
        true_und = rec["truth"] == "undecided"
        if true_und and label_und: tp += 1
        elif not true_und and label_und: fp += 1
        elif true_und and not label_und: fn += 1
        else: tn += 1
    prec = tp / (tp + fp) if (tp + fp) else float("nan")
    rec_ = tp / (tp + fn) if (tp + fn) else float("nan")
    return prec, rec_, tp, fp, fn, tn

print("\n=== signal-B sweep: precision/recall of the `undecided` label vs frozen hand-labels ===")
print("(promotion gate: precision >= 0.90 AND recall >= 4/6 = 0.667)\n")
results = []
best = None
for min_turns in (1, 2):
    print(f"--- minTurnsPerCamp={min_turns} ---")
    print(f"{'tau':>5} {'prec':>6} {'recall':>7} {'TP':>3}{'FP':>3}{'FN':>3}{'TN':>3}  gate")
    for tau in [round(x, 2) for x in np.arange(0.30, 0.86, 0.05)]:
        prec, rec_, tp, fp, fn, tn = score(tau, min_turns)
        passes = (not np.isnan(prec) and prec >= 0.90 and not np.isnan(rec_) and rec_ >= 4/6)
        flag = "  <== PASS" if passes else ""
        print(f"{tau:5.2f} {prec:6.3f} {rec_:7.3f} {tp:3d}{fp:3d}{fn:3d}{tn:3d}{flag}")
        results.append({"min_turns": min_turns, "tau": tau, "precision": prec, "recall": rec_,
                        "tp": tp, "fp": fp, "fn": fn, "tn": tn, "passes": bool(passes)})
        if passes and (best is None or prec > best["precision"]):
            best = results[-1]
    print()

print("BEST passing (precision, then recall):", best if best else "NONE — no tau separates the classes at the gate")
json.dump({"model": "all-MiniLM-L6-v2 (sentence-transformers)", "granularity": "max-sentence-per-turn",
           "per_crux": per_crux, "sweep": results, "best_passing": best},
          open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"wrote -> {OUT}")
