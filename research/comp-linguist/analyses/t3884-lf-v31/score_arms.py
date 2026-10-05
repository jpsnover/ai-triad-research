#!/usr/bin/env python3
"""Score the t/3884 dry-run arms.

In-sample (23 nodes): gold-match rate against gold-predicates.json, registered before any v3.1 run.
Out-of-sample (20 nodes, seed 3884): no gold; report draft-to-draft stability, agreement with arm A,
and the scan_lf_defects class A/B counts, so v3.1 regressions outside the defect set are visible.

Usage: python score_arms.py <dir with {A_v3,B_v3_clean,C_v31_clean}_d{1,2,3}.json> <ids.json>
"""
import collections, importlib.util, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
RUNS, IDS = sys.argv[1], json.load(open(sys.argv[2], encoding="utf-8"))
# A = v3 prompt + v3 node input; B = v3 prompt + cleaned input; C = full v3.1 prompt + cleaned;
# D = v3 + the main-clause rule only (v3.1b) + cleaned. Arms are scored when their 3 draft files exist.
ARMS = tuple(a for a in ("A_v3", "B_v3_clean", "C_v31_clean", "D_v31b_clean")
             if all(os.path.exists(os.path.join(RUNS, f"{a}_d{d}.json")) for d in (1, 2, 3)))
GOLD = json.load(open(os.path.join(HERE, "gold-predicates.json"), encoding="utf-8"))["nodes"]

spec = importlib.util.spec_from_file_location("scan", os.path.join(HERE, "..", "t3351-lf-v3", "scan_lf_defects.py"))
scan = importlib.util.module_from_spec(spec); spec.loader.exec_module(scan)
TEXT = scan._node_text()


def load(arm):
    """{node: [pred_d1, pred_d2, pred_d3]} plus the raw frames, None where a draft failed."""
    preds, frames = collections.defaultdict(list), collections.defaultdict(list)
    for d in (1, 2, 3):
        blob = json.load(open(os.path.join(RUNS, f"{arm}_d{d}.json"), encoding="utf-8"))
        got = blob.get("all") or {}
        for nid in IDS["in_sample"] + IDS["out_of_sample"]:
            lf = got.get(nid)
            preds[nid].append((lf or {}).get("predicate", "").strip().lower() or None)
            frames[nid].append(lf)
    return preds, frames


def defects(frames, ids):
    leak = disc = 0
    for nid in ids:
        label, desc = TEXT.get(nid, ("", ""))
        for lf in frames[nid]:
            if not lf:
                continue
            p = scan.norm_pred(lf.get("predicate", "").strip().lower())
            raw = lf.get("predicate", "").strip().lower()
            if (raw in scan.BAN_STANCE or p in scan.BAN_STANCE) and scan.stance_verdict(raw if raw in scan.BAN_STANCE else p, label, desc)[0]:
                leak += 1
            if any(isinstance(a.get("ref"), str) and scan.DISCOURSE_AGENT_RE.search(a["ref"]) for a in lf.get("args") or []):
                disc += 1
    return leak, disc


data = {a: load(a) for a in ARMS}
ins, oos = IDS["in_sample"], IDS["out_of_sample"]
print("IN-SAMPLE (23 nodes x 3 drafts = 69 per arm)")
for a in ARMS:
    preds = data[a][0]
    hit = sum(1 for n in ins for p in preds[n] if p and p in GOLD[n]["ok"])
    fail = sum(1 for n in ins for p in preds[n] if p is None)
    bad = sum(1 for n in ins for p in preds[n] if p and p in GOLD[n].get("not", []))
    print(f"  {a:12} gold-match {hit}/69   known-defect {bad}/69   failed {fail}")
print("\nPER NODE (drafts d1/d2/d3; * = not gold)")
for n in ins:
    row = []
    for a in ARMS:
        row.append("/".join((p or "-") + ("" if (p and p in GOLD[n]["ok"]) else "*") for p in data[a][0][n]))
    print(f"  {n:20} " + "  |  ".join(f"{a[:1]}: {r}" for a, r in zip(ARMS, row)))

print("\nOUT-OF-SAMPLE (20 nodes x 3 drafts = 60 per arm; no gold)")
for a in ARMS:
    preds, frames = data[a]
    stable = sum(1 for n in oos if len(set(preds[n])) == 1 and preds[n][0])
    agree = sum(1 for n in oos for i in range(3) if preds[n][i] and preds[n][i] == data["A_v3"][0][n][i])
    leak, disc = defects(frames, oos)
    print(f"  {a:12} stable nodes {stable}/20   agree-with-A {agree}/60   class-A leaks {leak}   class-B discourse {disc}")
print("\nOOS PREDICATES (A | B | C, majority of 3)")
for n in oos:
    maj = [collections.Counter(p for p in data[a][0][n] if p).most_common(1) for a in ARMS]
    print(f"  {n:20} " + " | ".join((m[0][0] if m else "-") for m in maj))
