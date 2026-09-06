#!/usr/bin/env python3
"""t/3239 promotion: flip node.logical_form status `proposed` -> `approved` after the v2 refresh +
gate clearance (formalization_accuracy 0.778, PI-authorized promote-as-is 2026-09-06). Idempotent.
Writes the 3 Origin POV files. Dry by default; --apply commits the status change."""
import argparse, json, os, sys
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")
D = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    before, after = Counter(), Counter()
    for fn in ("accelerationist.json", "safetyist.json", "skeptic.json"):
        p = os.path.join(O, fn)
        data = json.load(open(p, encoding="utf-8"))
        changed = 0
        for n in data["nodes"]:
            lf = n.get("logical_form")
            if not lf:
                continue
            before[lf.get("status", "?")] += 1
            if lf.get("status") != "approved":
                lf["status"] = "approved"; changed += 1
            after[lf.get("status", "?")] += 1
        if args.apply:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
        print(f"{fn}: {changed} flipped -> approved")
    print(f"\nbefore: {dict(before)}  ->  after: {dict(after)}")
    print("APPLIED" if args.apply else "DRY (use --apply)")

if __name__ == "__main__":
    raise SystemExit(main())
