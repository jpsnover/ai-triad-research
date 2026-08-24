#!/usr/bin/env python3
"""
t/2713: fit the CONCLUDING AFFECT_PHASE_BASELINES row from the moderate-pacing,
no-early-termination batch (DebateTool run, 30 debates) that actually reaches the
concluding phase — the gap the t/2680 v2 tight-pacing corpus (0 concluding turns)
could not fill.

Method is IDENTICAL to fit-baselines-v2.py (turn-weighted per-phase share means,
dedup by debate_id). conf/arg are recomputed here too, but ONLY as a regime
cross-check — the v2 conf/arg rows (tight pacing) remain the shipped values; this
ticket lands the CONCLUDING row only.

Input : C:/tmp/t2713-affect-batch/calibration/**/calibration-log.jsonl
Output: fitted-baselines-t2713.json (+ prints a report)
"""
import json, glob, collections

CATS = ["urgency", "fear", "hope", "outrage", "empathy"]
PHASES = ["confrontation", "argumentation", "concluding"]

rows = []
for f in glob.glob("C:/tmp/t2713-affect-batch/calibration/**/calibration-log.jsonl", recursive=True):
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

tw_num = {p: {c: 0.0 for c in CATS} for p in PHASES}
tw_den = {p: 0.0 for p in PHASES}
dw_sum = {p: {c: 0.0 for c in CATS} for p in PHASES}
dw_cnt = {p: 0 for p in PHASES}

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

json.dump(fitted, open("research/comp-linguist/analyses/t1771-affect/fitted-baselines-t2713.json", "w"), indent=2)
print("\nwrote fitted-baselines-t2713.json")
