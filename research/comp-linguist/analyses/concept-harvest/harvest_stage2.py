#!/usr/bin/env python3
"""t/3234 concept-harvest — STAGE 2: apply the reuse-gate (freq threshold) + a stronger drop-generic
filter, then EMBEDDING near-variant dedup (MiniLM): nearest existing dictionary concept per candidate +
intra-candidate near-dup clustering. Emits the PI curation WORKSHEET (propose only — never auto-add).

Reuse gate: freq>=3 (concept appears in >=3 source records → reusable, not a one-off) — the PI
'well-structured space, not an infinite dictionary' rule. 193 candidates at freq>=3.
"""
import json, os, sys, glob, re
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8")
SCRATCH = os.path.dirname(__file__)
D = r"C:\Users\jsnov\repos\ai-triad-data"
MINFREQ = 3
NEAR_EXISTING = 0.80   # candidate cosine >= this vs an existing concept -> likely already covered
DUP_CLUSTER = 0.85     # intra-candidate cosine >= this -> near-duplicate surface, keep top-freq rep

cand = json.load(open(os.path.join(SCRATCH, "harvest_candidates.json"), encoding="utf-8"))["candidates"]

# stronger drop-generic: umbrella "AI/ML + noun", bare "generative ai", single generic nouns
GENERIC_HEADS = {"ai", "a.i.", "ml", "generative ai", "genai", "artificial intelligence"}
GENERIC_WHOLE = {"ai agents", "ai systems", "ai models", "generative ai", "ai adoption", "ai development",
                 "ai deployment", "ai capabilities", "ai technology", "ai tools", "ai applications",
                 "ai governance", "ai regulation", "ai safety", "ai risk", "ai ethics", "model performance",
                 "autonomous systems", "machine learning", "large language models", "language models",
                 "economic growth", "productivity gains", "business transformation"}


def too_generic(key):
    n = key.lower().strip()
    if n in GENERIC_WHOLE:
        return True
    words = n.split()
    # "AI <single generic noun>" umbrella
    if len(words) == 2 and words[0] in ("ai", "generative", "autonomous", "digital") and len(words[1]) < 12:
        return True
    if len(words) == 1:
        return True   # single bare word at concept level is usually too broad
    return False


gated = [c for c in cand if c["freq"] >= MINFREQ and not too_generic(c["key"])]
dropped_generic = [c["surface"] for c in cand if c["freq"] >= MINFREQ and too_generic(c["key"])]
print(f"freq>={MINFREQ}: {sum(1 for c in cand if c['freq']>=MINFREQ)} | after drop-generic: {len(gated)} "
      f"(dropped {len(dropped_generic)} generic)")

# existing dictionary concepts (canonical_form + characteristic phrases)
existing = []
for f in glob.glob(D + r"\dictionary\standardized\*.json"):
    d = json.load(open(f, encoding="utf-8"))
    cf = d["canonical_form"].replace("_", " ")
    existing.append(cf)
existing = sorted(set(existing))
print(f"existing dictionary concepts: {len(existing)}")

from sentence_transformers import SentenceTransformer
import numpy as np
model = SentenceTransformer("all-MiniLM-L6-v2")
cand_txt = [c["surface"] for c in gated]
ce = model.encode(cand_txt, normalize_embeddings=True, show_progress_bar=False)
ee = model.encode(existing, normalize_embeddings=True, show_progress_bar=False)

# nearest existing per candidate
sim_ex = ce @ ee.T
near_idx = sim_ex.argmax(axis=1)
near_score = sim_ex.max(axis=1)

# intra-candidate near-dup clustering (greedy, by descending freq)
order = sorted(range(len(gated)), key=lambda i: (-gated[i]["freq"], gated[i]["key"]))
sim_cc = ce @ ce.T
assigned = {}
clusters = []
for i in order:
    if i in assigned:
        continue
    members = [i]
    assigned[i] = i
    for j in order:
        if j != i and j not in assigned and sim_cc[i][j] >= DUP_CLUSTER:
            assigned[j] = i
            members.append(j)
    clusters.append(members)

rows = []
for members in clusters:
    rep = members[0]
    c = gated[rep]
    variants = [gated[m]["surface"] for m in members[1:]]
    ne, ns = existing[near_idx[rep]], float(near_score[rep])
    suggest = "NEAR-EXISTING (merge?)" if ns >= NEAR_EXISTING else "NEW candidate"
    rows.append({"surface": c["surface"], "freq": c["freq"], "sources": c["sources"],
                 "variants_merged": variants, "nearest_existing": ne, "nearest_cosine": round(ns, 3),
                 "suggested": suggest})
rows.sort(key=lambda r: -r["freq"])

# worksheet
lines = [
    "# t/3234 concept-harvest — PI curation worksheet (PROPOSE ONLY, never auto-add)", "",
    f"Mined {1240} conflicts + {443} situations → 8280 raw → freq>={MINFREQ} reuse-gate + drop-generic + "
    f"embedding dedup → **{len(rows)} candidate concepts** for curation.", "",
    "Reuse gate: a concept must appear in >=3 source records (PI 'structured space, not infinite dictionary').",
    "`NEAR-EXISTING` = MiniLM cosine >= 0.80 vs an existing dictionary concept (likely already covered — merge or reject).",
    "Set VERDICT per row: `accept` (new) | `merge` (into nearest_existing) | `reject` (generic/dup/not-a-concept).", "",
    "| # | candidate | freq | nearest existing (cosine) | suggested | merged variants | VERDICT |",
    "|---|---|---|---|---|---|---|",
]
for i, r in enumerate(rows, 1):
    v = ", ".join(r["variants_merged"][:4]) + (" …" if len(r["variants_merged"]) > 4 else "")
    lines.append(f"| {i} | {r['surface']} | {r['freq']} | {r['nearest_existing']} ({r['nearest_cosine']}) "
                 f"| {r['suggested']} | {v} | |")
ws = os.path.join(SCRATCH, "concept-harvest-worksheet.md")
open(ws, "w", encoding="utf-8").write("\n".join(lines))
json.dump({"ticket": "t/3234", "min_freq": MINFREQ, "candidates": rows, "dropped_generic": dropped_generic},
          open(os.path.join(SCRATCH, "concept-harvest-final.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)

new_n = sum(1 for r in rows if r["suggested"].startswith("NEW"))
print(f"clusters: {len(rows)} | NEW: {new_n} | NEAR-EXISTING: {len(rows)-new_n}")
print(f"worksheet: {ws}")
print("\ntop 25 NEW candidates:")
for r in [r for r in rows if r['suggested'].startswith('NEW')][:25]:
    print(f"  {r['freq']:>3}  {r['surface']:38} (nearest {r['nearest_existing']} {r['nearest_cosine']})")
