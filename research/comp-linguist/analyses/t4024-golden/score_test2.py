#!/usr/bin/env python3
"""t/4024 second test (pre-registered at t/4024#4 before any draft ran): 5 fresh drafts per arm on the 43-node set.

PASS requires all three:
  1. gold-match rate: cand >= base - 0.03            (115 gold frames per arm)
  2. class A rate:    cand <= base + 0.02 per frame  (215 frames per arm)
  3. class B count:   cand <= base + 1
"""
import collections, importlib.util, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "test2")
V31 = os.path.join(HERE, "..", "t3884-lf-v31")
IDS = json.load(open(os.path.join(V31, "dryrun-ids.json"), encoding="utf-8"))
GOLD = json.load(open(os.path.join(V31, "gold-predicates.json"), encoding="utf-8"))["nodes"]
spec = importlib.util.spec_from_file_location("scan", os.path.join(HERE, "..", "t3351-lf-v3", "scan_lf_defects.py"))
scan = importlib.util.module_from_spec(spec); spec.loader.exec_module(scan)
TEXT = scan._node_text()
ALL = IDS["in_sample"] + IDS["out_of_sample"]
D = 5
TRANSFER = {"give", "grant", "assign", "provide", "allocate"}


def score(arm):
    s = collections.Counter()
    for d in range(1, D + 1):
        got = json.load(open(os.path.join(RUN, f"{arm}_d{d}.json"), encoding="utf-8")).get("all") or {}
        for nid in ALL:
            lf = got.get(nid)
            if nid in GOLD:
                s["gold_frames"] += 1
                if lf and lf["predicate"].strip().lower() in GOLD[nid]["ok"]:
                    s["gold_match"] += 1
            if not lf:
                s["failed"] += 1; continue
            s["frames"] += 1
            raw = lf["predicate"].strip().lower(); p = scan.norm_pred(raw); label, desc = TEXT.get(nid, ("", ""))
            args = lf.get("args") or []
            if (raw in scan.BAN_STANCE or p in scan.BAN_STANCE) and scan.stance_verdict(raw if raw in scan.BAN_STANCE else p, label, desc)[0]:
                s["classA"] += 1
            if any(isinstance(a.get("ref"), str) and scan.DISCOURSE_AGENT_RE.search(a["ref"]) for a in args):
                s["classB"] += 1
            s["perdurant_agent"] += sum(1 for a in args if a.get("role") == "agent" and a.get("sort") == "perdurant")
            s["cause_args"] += sum(1 for a in args if a.get("role") == "cause")
            if raw in TRANSFER:
                s["transfer"] += 1; s["transfer_recipient"] += int(any(a.get("role") == "recipient" for a in args))
    return s


b, c = score("base"), score("cand")
gm = lambda s: s["gold_match"] / s["gold_frames"]
ca = lambda s: s["classA"] / max(1, s["frames"])
print(f"{'measure':22} {'base':>14} {'cand':>14}")
print(f"{'gold-match rate':22} {b['gold_match']}/{b['gold_frames']}={gm(b):.3f}".ljust(37) + f"{c['gold_match']}/{c['gold_frames']}={gm(c):.3f}")
print(f"{'class A rate':22} {b['classA']}/{b['frames']}={ca(b):.3f}".ljust(37) + f"{c['classA']}/{c['frames']}={ca(c):.3f}")
for k in ("classB", "failed", "perdurant_agent", "cause_args", "transfer", "transfer_recipient"):
    print(f"{k:22} {b[k]:>14} {c[k]:>14}")
checks = {"1 gold-match": gm(c) >= gm(b) - 0.03, "2 class A rate": ca(c) <= ca(b) + 0.02, "3 class B count": c["classB"] <= b["classB"] + 1}
print("\n" + "  ".join(f"{k}: {'PASS' if v else 'FAIL'}" for k, v in checks.items()))
print("OVERALL:", "PASS" if all(checks.values()) else "FAIL")
