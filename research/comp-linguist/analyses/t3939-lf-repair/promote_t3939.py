#!/usr/bin/env python3
"""t/3939: re-promote the 2 replace_frame frames from "proposed" to "accepted" (status flip only).

Reads its targets from frozen-promote.json (never re-derived). For each target the live frame must equal
the frozen-ops.json new_frame exactly (i.e. nobody touched it since c289dfaf) and match before_sha16.
Proves 0-collateral before writing: serializer round-trips byte-identically, and after the flip every
node except the 2 targets' logical_form.status is deep-equal to the input.
Dry-run by default; --apply writes. Usage: AI_TRIAD_DATA_ROOT=<data worktree> python promote_t3939.py [--apply]
"""
import copy, hashlib, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
D = os.environ["AI_TRIAD_DATA_ROOT"]
O = os.path.join(D, "taxonomy", "Origin")
HERE = os.path.dirname(os.path.abspath(__file__))
APPLY = "--apply" in sys.argv


def dumps(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def sha16(lf):
    return hashlib.sha256(json.dumps(lf, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


frozen = json.load(open(os.path.join(HERE, "frozen-promote.json"), encoding="utf-8"))
new_frames = {o["id"]: o["new_frame"] for o in json.load(open(os.path.join(HERE, "frozen-ops.json"), encoding="utf-8"))["ops"]
              if o["op"] == "replace_frame"}
by_file = {}
for t in frozen["targets"]:
    by_file.setdefault(t["file"], []).append(t)

changed = 0
for fn, targets in by_file.items():
    path = os.path.join(O, fn)
    raw = open(path, encoding="utf-8", newline="").read()
    doc = json.loads(raw)
    assert dumps(doc) == raw, f"{fn}: serializer does not round-trip byte-identically"
    orig = copy.deepcopy(doc)
    nodes = {n["id"]: n for n in doc["nodes"]}
    for t in targets:
        lf = nodes[t["id"]]["logical_form"]
        assert sha16(lf) == t["before_sha16"], f"{t['id']}: frame changed since freeze ({sha16(lf)})"
        assert lf == new_frames[t["id"]], f"{t['id']}: live frame != frozen-ops new_frame"
        assert lf["status"] == "proposed", f"{t['id']}: status is {lf['status']!r}"
        lf["status"] = "accepted"
        changed += 1
    # 0-collateral: undo the flips on a copy and require deep equality with the input
    check = copy.deepcopy(doc)
    for n in check["nodes"]:
        if n["id"] in {t["id"] for t in targets}:
            n["logical_form"]["status"] = "proposed"
    assert check == orig, f"{fn}: collateral change outside the target status fields"
    out = dumps(doc)
    diff = [(a, b) for a, b in zip(raw.splitlines(), out.splitlines()) if a != b]
    assert len(raw.splitlines()) == len(out.splitlines()) and len(diff) == len(targets), f"{fn}: textual diff {diff}"
    assert all('"status": "proposed"' in a and '"status": "accepted"' in b for a, b in diff), f"{fn}: {diff}"
    print(f"{fn}: {len(targets)} status line(s) proposed -> accepted; 0-collateral OK")
    if APPLY:
        open(path, "w", encoding="utf-8", newline="").write(out)

assert changed == frozen["expected"], f"changed {changed} != expected {frozen['expected']}"
print(f"{'APPLIED' if APPLY else 'DRY-RUN'}: {changed} frame(s)")
