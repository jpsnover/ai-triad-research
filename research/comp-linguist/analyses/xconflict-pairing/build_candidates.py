#!/usr/bin/env python3
"""t/3339 (TL-approved t/3339#6): build cross-conflict candidate pairs for the classify-before-merge
pipeline. For each of the 457 one_sided_stance singletons, take top-K=3 cross-conflict neighbors in the
topical band [0.55, 0.90) (MiniLM). No data write — emits a candidate-pair file for (a) PS's classifier
and (b) the blind precision golden. ≤1-cap is a MERGE-time rule (pick best confirmed contradict/stance),
NOT applied here — the classifier gets all K shots.
Output rows: {pair_id, stance_conflict_id, stance_text, cand_conflict_id, cand_inst_idx, cand_text, cosine}."""
import json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
SCRATCH = os.path.dirname(__file__)
D = r"C:\Users\jsnov\repos\ai-triad-data"
OUT = os.path.join(SCRATCH, "xconflict-candidates.json")
BAND_LO, BAND_HI, K = 0.55, 0.90, 3

cls = json.load(open(os.path.join(SCRATCH, "singleton-classified.json"), encoding="utf-8"))
oss = [r for r in cls if r.get("cls") == "one_sided_stance"]

conf = json.load(open(os.path.join(D, "conflicts", "conflicts.json"), encoding="utf-8"))["conflicts"]
pool = []  # (conflict_id, inst_idx, assertion)
for c in conf:
    cid = c.get("claim_id") or c.get("claim_label")
    for idx, it in enumerate(c.get("instances") or []):
        a = (it.get("assertion") or "").strip()
        if a and "placeholder" not in a.lower():
            pool.append((cid, idx, a))
print(f"one_sided_stance: {len(oss)} | corpus pool: {len(pool)}")

from sentence_transformers import SentenceTransformer
import numpy as np
m = SentenceTransformer("all-MiniLM-L6-v2")
pe = m.encode([p[2] for p in pool], normalize_embeddings=True, show_progress_bar=False)
oe = m.encode([r.get("assertion", "") for r in oss], normalize_embeddings=True, show_progress_bar=False)

cands = []
stances_with_cand = 0
for i, r in enumerate(oss):
    scid = r.get("conflict_id")
    sim = oe[i] @ pe.T
    order = np.argsort(-sim)
    picked = 0
    for j in order:
        s = float(sim[j])
        if s >= BAND_HI:
            continue          # near-dup/entail — skip
        if s < BAND_LO:
            break             # sorted desc — nothing left in band
        if pool[j][0] == scid:
            continue          # same conflict
        cands.append({
            "pair_id": f"xc-{i:04d}-{picked}",
            "stance_conflict_id": scid, "stance_text": r.get("assertion", ""),
            "cand_conflict_id": pool[j][0], "cand_inst_idx": pool[j][1], "cand_text": pool[j][2],
            "cosine": round(s, 4),
        })
        picked += 1
        if picked >= K:
            break
    if picked:
        stances_with_cand += 1

json.dump({"_meta": {"band": [BAND_LO, BAND_HI], "K": K, "n_stances": len(oss),
                     "stances_with_candidate": stances_with_cand, "n_pairs": len(cands)},
           "candidates": cands}, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"stances with ≥1 candidate: {stances_with_cand}/{len(oss)} ({stances_with_cand/len(oss):.0%})")
print(f"total candidate pairs: {len(cands)}  (≤{K}/stance)")
uniq_cand = len({(c['cand_conflict_id'], c['cand_inst_idx']) for c in cands})
print(f"distinct opposing claims referenced: {uniq_cand}")
print(f"cosine: min={min(c['cosine'] for c in cands):.2f} max={max(c['cosine'] for c in cands):.2f}")
print("wrote", OUT)
