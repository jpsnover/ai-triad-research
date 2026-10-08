#!/usr/bin/env python3
"""t/4036: append proposals for Skeptic nodes added after the t/3962 run to taxonomy/Origin/pov-tag-proposals.json.

Frozen inputs (both committed in the code repo):
  - ../t3962-tag-proposals/out/pov-tag-proposals.t4036.json   (5 proposals, prompt v1, same model as the full run)
  - the live side file at data `02c0c2c9` (372 proposals), pinned by sha256 below.

The merge only ADDS items. Existing items are carried over byte-for-byte as parsed values, so any review
decisions already recorded stay. The supplement's run block goes in `supplement_runs`, which keeps
provenance without changing the spec's single `run` field.

Refuses unless: the base file's sha256 matches the pin; every appended id is absent from the base; and
after the merge every node in skeptic.json has exactly one proposal.

Usage: python append_proposals.py <data_root> [--write]   (dry run without --write)
"""
import hashlib, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SUPPLEMENT = os.path.join(HERE, "..", "t3962-tag-proposals", "out", "pov-tag-proposals.t4036.json")
BASE_SHA256 = "06adb25e67882f5911dfdf82b4f70926f148c4facd12ad8179021769aefec550"  # data 02c0c2c9


def main():
    data, write = sys.argv[1], "--write" in sys.argv[2:]
    path = os.path.join(data, "taxonomy", "Origin", "pov-tag-proposals.json")
    raw = open(path, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != BASE_SHA256:
        sys.exit(f"REFUSE: base sha256 {sha} != pinned {BASE_SHA256} (the file changed since the freeze)")
    base = json.loads(raw)
    sup = json.load(open(SUPPLEMENT, encoding="utf-8"))
    have = {p["node_id"] for p in base["proposals"]}
    dup = [p["node_id"] for p in sup["proposals"] if p["node_id"] in have]
    if dup:
        sys.exit(f"REFUSE: already present in the base: {dup}")
    order = {n["id"]: i for i, n in enumerate(json.load(open(os.path.join(data, "taxonomy", "Origin", "skeptic.json"), encoding="utf-8"))["nodes"])}
    merged = dict(base)
    merged["supplement_runs"] = list(base.get("supplement_runs", [])) + [sup["run"]]
    merged["proposals"] = sorted(base["proposals"] + sup["proposals"], key=lambda r: order.get(r["node_id"], len(order)))
    ids = [p["node_id"] for p in merged["proposals"]]
    if len(ids) != len(set(ids)) or set(ids) != set(order):
        sys.exit(f"REFUSE: coverage mismatch: proposals {len(ids)} (unique {len(set(ids))}) vs skeptic nodes {len(order)}; "
                 f"uncovered {sorted(set(order) - set(ids))}")
    out = json.dumps(merged, indent=2, ensure_ascii=False) + "\n"
    print(f"base {len(base['proposals'])} + appended {len(sup['proposals'])} = {len(ids)} (= skeptic nodes {len(order)})")
    print(f"new sha256 {hashlib.sha256(out.encode('utf-8')).hexdigest()}")
    if write:
        open(path, "w", encoding="utf-8", newline="\n").write(out)
        print(f"WROTE {path}")
    else:
        print("dry run (no --write)")


if __name__ == "__main__":
    main()
