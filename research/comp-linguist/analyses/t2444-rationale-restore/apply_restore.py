#!/usr/bin/env python3
# Edge-rationale restore (t/2444). Restores discovery-time `rationale` fields that the
# workflow-app data pipeline wiped from edges.json on 2026-08-08 and again on 2026-08-20.
#
# Source of truth for the original rationales: git commit ba3128f5 (2026-07-24) in the
# ai-triad-data repo, the last state before wipe #1 — 33,448/33,454 edges carried a rationale.
#
# Design & evidence: research/comp-linguist/designs/edge-rationale-restore-and-gate-spec.md
#
# SAFETY MODEL (why this is a minimal, reversible data edit):
#   * Edges have NO `id` field. Identity is the composite (source, target, type).
#   * For each CURRENT edge that lacks a non-empty rationale but whose composite key matches a
#     rationale-bearing edge at ba3128f5, we insert `rationale` immediately AFTER `confidence`,
#     preserving every other key in its exact current order (the current file has 17 distinct
#     per-edge key orderings — we never reorder).
#   * Edges already carrying a rationale in the current file are left byte-for-byte untouched.
#   * STRIP-BACK PROOF (run every invocation): removing only the rationales we added and
#     re-serializing must reproduce the current file byte-for-byte. If it does not, we abort
#     and write nothing. This guarantees the restore changes *only* rationale.
#   * Output uses the compact hybrid contract of lib/edges/serializeEdges.ts (one compact
#     edge per line at 4-space indent, `,`/`:` separators, LF, single trailing newline),
#     verified to round-trip the current file byte-for-byte.
#
# This script does NOT commit. It writes <current>.restored next to the target and prints a
# report. The data-repo owner applies it (out of CL scope), AFTER the pipeline destroyer is
# fixed — restoring without fixing the pipeline just resets the clock (both prior wipes proved
# the field is destroyed on the next full-tree pipeline run).
#
# Usage:
#   1. Extract the source snapshot from the data repo:
#        git -C <ai-triad-data> show ba3128f5:taxonomy/Origin/edges.json > /tmp/edges_ba3128f5.json
#   2. python apply_restore.py --current <ai-triad-data>/taxonomy/Origin/edges.json \
#                              --source /tmp/edges_ba3128f5.json
#      (optional: --out <path>  default: <current>.restored ; --write-in-place to overwrite)

import argparse, json, sys, os


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def has_rat(e):
    r = e.get("rationale")
    return isinstance(r, str) and r.strip() != ""


def ckey(e):
    return (e.get("source"), e.get("target"), e.get("type"))


def serialize(doc):
    """Byte-compatible with lib/edges/serializeEdges.ts (verified round-trip on the live file)."""
    parts = []
    for k in doc:
        v = doc[k]
        if k == "edges" and isinstance(v, list):
            if not v:
                parts.append('  "edges": []')
                continue
            lines = ",\n".join(
                "    " + json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in v
            )
            parts.append('  "edges": [\n' + lines + "\n  ]")
        else:
            pretty = json.dumps(v, ensure_ascii=False, indent=2).replace("\n", "\n  ")
            parts.append("  " + json.dumps(k) + ": " + pretty)
    return "{\n" + ",\n".join(parts) + "\n}\n"


def insert_after_confidence(e, rat):
    out = {}
    for k, v in e.items():
        out[k] = v
        if k == "confidence":
            out["rationale"] = rat
    if "rationale" not in out:  # no `confidence` key: append at end
        out["rationale"] = rat
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--current", required=True, help="path to live edges.json to restore into")
    ap.add_argument("--source", required=True, help="edges.json extracted from ba3128f5")
    ap.add_argument("--out", default=None)
    ap.add_argument("--write-in-place", action="store_true")
    args = ap.parse_args()

    cur_doc = load(args.current)
    cur_blob = open(args.current, encoding="utf-8", newline="").read()
    src = load(args.source)["edges"]

    # Self-check: our serializer must reproduce the current file byte-for-byte before we trust it.
    if serialize(cur_doc) != cur_blob:
        sys.exit("ABORT: serializer does not round-trip the current file byte-for-byte; "
                 "the file's byte format has changed — update serialize() before restoring.")

    old_by = {ckey(e): e["rationale"] for e in src if has_rat(e)}
    had = {ckey(e) for e in cur_doc["edges"] if has_rat(e)}

    restored = kept = gap = 0
    new_edges = []
    for e in cur_doc["edges"]:
        if has_rat(e):
            kept += 1
            new_edges.append(e)
            continue
        k = ckey(e)
        if k in old_by:
            new_edges.append(insert_after_confidence(e, old_by[k]))
            restored += 1
        else:
            new_edges.append(e)
            gap += 1
    cur_doc["edges"] = new_edges
    out_blob = serialize(cur_doc)

    # STRIP-BACK PROOF: strip only the rationales we added; must equal the original current file.
    check = json.loads(out_blob)
    for e in check["edges"]:
        if ckey(e) not in had:
            e.pop("rationale", None)
    if serialize(check) != cur_blob:
        sys.exit("ABORT: strip-back proof failed — the restore changed more than rationale. "
                 "Nothing written.")

    out_path = args.current if args.write_in_place else (args.out or args.current + ".restored")
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(out_blob)

    final = sum(1 for e in new_edges if has_rat(e))
    print(f"restored={restored}  kept_existing={kept}  generation_gap(new edges)={gap}")
    print(f"final edges with rationale = {final} / {len(new_edges)}")
    print("strip-back proof: PASS (only rationale changed)")
    print(f"wrote: {out_path}")
    if gap:
        print(f"\n{gap} edges have no source in ba3128f5 (created after the wipe) and still need "
              f"generation — see gap breakdown in the spec doc.")


if __name__ == "__main__":
    main()
