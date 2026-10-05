#!/usr/bin/env python3
"""t/3884 claim-path regression: compare logical_form frames written by Invoke-LogicalFormPass into two
scratch copies of the same summaries (v3 prompt vs v3.1b prompt). Pairs frames by JSON path.

Usage: python compare_claim_arms.py <claimroot_v3> <claimroot_v31b>
"""
import glob, json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")
DISC = re.compile(r"\b(discourse|the document|the view)\b", re.I)
STANCE = {"support", "oppose", "reject", "advocate", "endorse", "call", "believe", "think", "want", "desire",
          "aim", "intend", "view", "value", "prefer", "promote", "champion", "emphasize", "stress", "recognize",
          "acknowledge", "address", "discuss", "highlight", "note", "argue", "claim", "assert", "contend"}


def frames(path):
    """{json-path: (predicate, logical_form, text)} for every dict carrying a logical_form."""
    out = {}

    def walk(o, p):
        if isinstance(o, dict):
            lf = o.get("logical_form")
            if isinstance(lf, dict) and lf.get("predicate"):
                txt = o.get("canonical_proposition") or o.get("point") or o.get("claim") or o.get("text") or ""
                out[p] = (lf["predicate"].strip().lower(), lf, txt)
            for k, v in o.items():
                walk(v, f"{p}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{p}[{i}]")
    walk(json.load(open(path, encoding="utf-8")), "$")
    return out


def disc_agent(lf):
    return any(a.get("role") == "agent" and isinstance(a.get("ref"), str) and DISC.search(a["ref"]) for a in lf.get("args") or [])


a_root, b_root = sys.argv[1], sys.argv[2]
# The scratch copies start with the corpus's existing frames, and -MaxClaims re-formalizes only some
# claims. A frame identical to the original in BOTH arms was not re-run, so it is excluded: counting it
# would inflate agreement with frames neither prompt produced.
ORIG = sys.argv[3] if len(sys.argv) > 3 else r"C:\Users\jsnov\repos\ai-triad-data\summaries"
tot = same = skipped = 0
stats = {"v3": {"stance": 0, "disc": 0, "rejected": 0}, "v31b": {"stance": 0, "disc": 0, "rejected": 0}}
diffs = []
for fa in sorted(glob.glob(os.path.join(a_root, "summaries", "*.json"))):
    fb = os.path.join(b_root, "summaries", os.path.basename(fa))
    A, B = frames(fa), frames(fb)
    O = frames(os.path.join(ORIG, os.path.basename(fa)))
    for p in sorted(set(A) & set(B)):
        if p in O and A[p][1] == O[p][1] and B[p][1] == O[p][1]:
            skipped += 1
            continue
        tot += 1
        for arm, (pred, lf, _) in (("v3", A[p]), ("v31b", B[p])):
            stats[arm]["stance"] += pred in STANCE
            stats[arm]["disc"] += disc_agent(lf)
            stats[arm]["rejected"] += lf.get("status") == "rejected"
        if A[p][0] == B[p][0]:
            same += 1
        else:
            diffs.append((os.path.basename(fa)[:28], p[-38:], A[p][0], B[p][0], A[p][2][:150]))
    only = len(set(A) ^ set(B))
    if only:
        print(f"  [note] {os.path.basename(fa)}: {only} frame path(s) present in only one arm")
print(f"re-formalized paired claim frames: {tot}; same predicate: {same} ({same / max(1, tot):.0%}); "
      f"excluded as not re-run in either arm: {skipped}")
for arm, s in stats.items():
    print(f"  {arm:5} stance-verb predicates {s['stance']}  discourse-as-agent {s['disc']}  rejected {s['rejected']}")
print("\nDIFFERENCES (doc | path | v3 -> v3.1b | claim text)")
for d in diffs:
    print(f"  {d[0]} | {d[1]} | {d[2]} -> {d[3]} | {d[4]}")
