#!/usr/bin/env python3
"""t/3351 (copied from t/3939 apply_t3939.py): apply the frozen logical_form operations in frozen-ops.json. /data-mutation discipline: the target set
comes ONLY from frozen-ops.json, every frame must still hash to its frozen before_sha16, and 0 collateral is proven
before anything is written. Dry-run is the default.

  python apply_t3939.py --data <ai-triad-data root>            # dry-run
  python apply_t3939.py --data <ai-triad-data root> --apply    # write

Ops (scope.md):
  drop_discourse_agent  remove exactly the one args[] entry equal to op.drop_arg; nothing else in the frame changes
  replace_frame         the frame becomes op.new_frame exactly (status: proposed)
"""
import argparse, copy, difflib, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FROZEN = json.load(open(os.path.join(HERE, "frozen-ops.json"), encoding="utf-8"))
FILES = ["accelerationist.json"]


def dumps(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def sha16(lf):  # identical to build_frozen_ops.py
    return hashlib.sha256(json.dumps(lf, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    tax = os.path.join(a.data, "taxonomy", "Origin")
    ops = FROZEN["ops"]
    if len(ops) != FROZEN["expected_ops"]:
        sys.exit(f"ABORT: {len(ops)} ops in frozen list, expected {FROZEN['expected_ops']}")

    raw, docs = {}, {}
    for fn in FILES:
        raw[fn] = open(os.path.join(tax, fn), encoding="utf-8", newline="").read()
        docs[fn] = json.loads(raw[fn])
        if dumps(docs[fn]) != raw[fn]:
            sys.exit(f"ABORT: {fn} does not round-trip byte-identically")
    before = copy.deepcopy(docs)
    index = {(fn, n["id"]): n for fn in FILES for n in docs[fn]["nodes"]}

    for o in ops:
        node = index.get((o["file"], o["id"]))
        if node is None:
            sys.exit(f"ABORT: {o['id']} not found in {o['file']}")
        lf = node.get("logical_form")
        if sha16(lf) != o["before_sha16"]:
            sys.exit(f"ABORT: {o['id']} frame changed since freeze ({sha16(lf)} != {o['before_sha16']})")
        if o["op"] == "drop_discourse_agent":
            hits = [i for i, x in enumerate(lf["args"]) if x == o["drop_arg"]]
            if len(hits) != 1:
                sys.exit(f"ABORT: {o['id']}: expected exactly 1 arg equal to drop_arg, found {len(hits)}")
            del lf["args"][hits[0]]
            if not lf["args"]:
                sys.exit(f"ABORT: {o['id']}: dropping would leave no arguments")
        elif o["op"] == "replace_frame":
            if lf.get("predicate") != o["live_predicate"]:
                sys.exit(f"ABORT: {o['id']}: live predicate {lf.get('predicate')!r} != frozen {o['live_predicate']!r}")
            node["logical_form"] = copy.deepcopy(o["new_frame"])
        else:
            sys.exit(f"ABORT: unknown op {o['op']}")

    # ── 0-collateral proof (structural) ──
    targets = {(o["file"], o["id"]): o for o in ops}
    for fn in FILES:
        b, d = before[fn], docs[fn]
        if list(b) != list(d) or [n["id"] for n in b["nodes"]] != [n["id"] for n in d["nodes"]]:
            sys.exit(f"ABORT: {fn} structure or node order changed")
        if {k: v for k, v in b.items() if k != "nodes"} != {k: v for k, v in d.items() if k != "nodes"}:
            sys.exit(f"ABORT: {fn} file-level fields changed")
        for nb, nd in zip(b["nodes"], d["nodes"]):
            o = targets.get((fn, nb["id"]))
            if o is None:
                if nb != nd:
                    sys.exit(f"ABORT: non-target node {nb['id']} changed")
                continue
            if {k: v for k, v in nb.items() if k != "logical_form"} != {k: v for k, v in nd.items() if k != "logical_form"}:
                sys.exit(f"ABORT: {nb['id']} changed outside logical_form")
            lb, ld = nb["logical_form"], nd["logical_form"]
            if o["op"] == "drop_discourse_agent":
                if {k: v for k, v in lb.items() if k != "args"} != {k: v for k, v in ld.items() if k != "args"}:
                    sys.exit(f"ABORT: {nb['id']} frame changed outside args")
                if [x for x in lb["args"] if x != o["drop_arg"]] != ld["args"]:
                    sys.exit(f"ABORT: {nb['id']} args changed beyond the one drop")
            elif ld != o["new_frame"]:
                sys.exit(f"ABORT: {nb['id']} frame is not exactly new_frame")

    # ── textual footprint + post-state counts ──
    for fn in FILES:
        diff = [l for l in difflib.unified_diff(raw[fn].splitlines(), dumps(docs[fn]).splitlines(), lineterm="", n=0)
                if l[:1] in "+-" and l[:3] not in ("+++", "---")]
        print(f"{fn}: {sum(l[0] == '-' for l in diff)} lines removed, {sum(l[0] == '+' for l in diff)} added")
    discourse_agents = sum(1 for fn in FILES for n in docs[fn]["nodes"] for x in (n.get("logical_form") or {}).get("args", [])
                           if x.get("role") == "agent" and str(x.get("ref", "")).endswith(' discourse"'))
    print(f"0-collateral: PASS | ops: {sum(o['op'] == 'drop_discourse_agent' for o in ops)} drop + "
          f"{sum(o['op'] == 'replace_frame' for o in ops)} replace | discourse-as-agent args remaining: {discourse_agents}")
    if not a.apply:
        print("dry-run: nothing written (pass --apply to write)")
        return
    for fn in FILES:
        if dumps(docs[fn]) != raw[fn]:
            open(os.path.join(tax, fn), "w", encoding="utf-8", newline="").write(dumps(docs[fn]))
            print(f"APPLIED: {fn}")


if __name__ == "__main__":
    main()
