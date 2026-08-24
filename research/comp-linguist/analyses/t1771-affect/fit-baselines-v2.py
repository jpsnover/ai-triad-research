#!/usr/bin/env python3
"""
t/2680 step 2-3: re-fit AFFECT_PHASE_BASELINES from logged affect_profile_by_phase
on the pruned-lexicon corpus (post-t/2677). Turn-weighted per-phase share means.

Input : C:/tmp/t2680-affect-batch/calibration/**/calibration-log.jsonl
Output: fitted-baselines-v2.json  (+ prints a report)

Dedup by debate_id (cal-log double-writes: 2 core + 2 users rows per debate).
Each phase's logged profile_mean is already the mean of share-normalized per-turn
profiles; the turn-weighted corpus mean is  sum(n_i * profile_mean_i) / sum(n_i).
"""
import json, glob, collections

CATS = ["urgency", "fear", "hope", "outrage", "empathy"]
PHASES = ["confrontation", "argumentation", "concluding"]

rows = []
for f in glob.glob("C:/tmp/t2680-affect-batch/calibration/**/calibration-log.jsonl", recursive=True):
    for line in open(f):
        rows.append(json.loads(line))

# Dedup by debate_id, keep first occurrence carrying the field.
by_id = {}
for r in rows:
    did = r.get("debate_id")
    prof = r.get("affect_profile_by_phase")
    if not prof:
        continue
    if did not in by_id:
        by_id[did] = prof

print(f"raw rows: {len(rows)} | unique debate_ids w/ affect_profile_by_phase: {len(by_id)}")

# Data-integrity check: within a debate_id, are all logged rows identical?
mismatch = 0
seen = collections.defaultdict(list)
for r in rows:
    if r.get("affect_profile_by_phase"):
        seen[r["debate_id"]].append(json.dumps(r["affect_profile_by_phase"], sort_keys=True))
for did, blobs in seen.items():
    if len(set(blobs)) > 1:
        mismatch += 1
print(f"debate_ids with non-identical duplicate rows: {mismatch} (expect 0 = clean double-write)")

# Accumulate turn-weighted and debate-weighted sums per phase.
tw_num = {p: {c: 0.0 for c in CATS} for p in PHASES}   # turn-weighted numerator
tw_den = {p: 0.0 for p in PHASES}                        # sum of n_turns
dw_sum = {p: {c: 0.0 for c in CATS} for p in PHASES}    # debate-weighted numerator
dw_cnt = {p: 0 for p in PHASES}                          # debates that have phase

for did, prof in by_id.items():
    for p in PHASES:
        if p not in prof:
            continue
        n = prof[p].get("n_turns", 0)
        pm = prof[p].get("profile_mean", {})
        if n <= 0:
            continue
        tw_den[p] += n
        dw_cnt[p] += 1
        for c in CATS:
            v = pm.get(c, 0.0)
            tw_num[p][c] += n * v
            dw_sum[p][c] += v

def renorm(d):
    s = sum(d.values())
    return {c: (round(d[c] / s, 4) if s > 0 else 0.0) for c in CATS}

fitted = {}
print("\n=== per-phase coverage ===")
for p in PHASES:
    print(f"  {p:14s}: debates={dw_cnt[p]:3d}  total_turns={int(tw_den[p]):4d}")

print("\n=== TURN-WEIGHTED fit (renormalized shares) ===")
for p in PHASES:
    if tw_den[p] == 0:
        print(f"  {p:14s}: NO DATA"); continue
    tw = {c: tw_num[p][c] / tw_den[p] for c in CATS}
    fitted[p] = renorm(tw)
    print(f"  {p:14s}: " + "  ".join(f"{c}={fitted[p][c]:.2f}" for c in CATS))

print("\n=== DEBATE-WEIGHTED cross-check (renormalized shares) ===")
for p in PHASES:
    if dw_cnt[p] == 0:
        print(f"  {p:14s}: NO DATA"); continue
    dw = {c: dw_sum[p][c] / dw_cnt[p] for c in CATS}
    dwn = renorm(dw)
    print(f"  {p:14s}: " + "  ".join(f"{c}={dwn[c]:.2f}" for c in CATS))

json.dump(fitted, open("research/comp-linguist/analyses/t1771-affect/fitted-baselines-v2.json", "w"), indent=2)
print("\nwrote fitted-baselines-v2.json")
