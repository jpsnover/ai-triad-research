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
#     rationale-bearing edge at ba3128f5, we insert `rationale` at ITS ORIGINAL PER-EDGE POSITION
#     — immediately after the key that preceded `rationale` in the ba3128f5 source edge — and
#     preserve every other key in its exact current order (the file has many per-edge key
#     orderings; we never reorder the other keys).
#     NOTE (t/2949, wrong-slot fix): rationale was NOT always after `confidence`. Empirically,
#     of 33,399 restorable edges, 3,761 had it after `weight` and 528 after `model`; a hardcoded
#     "after confidence" mis-slots 4,289 edges, producing spurious diff churn on the restore that
#     defeats the very diff-vs-HEAD signal Arm 2 relies on. Placing it after the SOURCE
#     predecessor restores the exact original position on 33,399/33,399.
#   * Edges already carrying a rationale in the current file are left byte-for-byte untouched.
#   * TWO PROOFS (run every invocation, abort + write nothing on failure):
#     - STRIP-BACK: removing only the rationales we added and re-serializing must reproduce the
#       current file byte-for-byte (guarantees the restore changes *only* rationale).
#     - POSITION: for every restored edge, `rationale`'s predecessor key must equal the source
#       edge's predecessor (whenever that predecessor exists in the current edge). Strip-back is
#       structurally BLIND to slot (it strips exactly what it inserted), so this second proof is
#       required to catch a wrong-slot insertion (t/2949).
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

import argparse, json, sys


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


def source_predecessor(src_edge):
    """The key immediately before `rationale` in the ba3128f5 source edge (None if first)."""
    sk = list(src_edge.keys())
    ri = sk.index("rationale")
    return sk[ri - 1] if ri > 0 else None


def restore_rationale(cur_edge, src_edge):
    """Insert the source rationale into cur_edge AT ITS ORIGINAL SLOT — immediately after the key
    that preceded `rationale` in the source. Preserve cur_edge's key order for everything else.
    Fall back to after `confidence`, then append, only when the source predecessor is not present
    in the current edge (differing field sets). Returns (new_edge, predecessor_used)."""
    rat = src_edge["rationale"]
    pred = source_predecessor(src_edge)
    if pred is not None and pred in cur_edge:
        out = {}
        for k, v in cur_edge.items():
            out[k] = v
            if k == pred:
                out["rationale"] = rat
        return out, pred
    # Fallbacks (predecessor absent from the current edge or rationale was first in source):
    if "confidence" in cur_edge:
        out = {}
        for k, v in cur_edge.items():
            out[k] = v
            if k == "confidence":
                out["rationale"] = rat
        return out, "confidence"
    out = dict(cur_edge)
    out["rationale"] = rat
    return out, None


def predecessor_of(edge):
    """The key immediately before `rationale` in `edge` (None if absent/first)."""
    ks = list(edge.keys())
    if "rationale" not in ks:
        return None
    ri = ks.index("rationale")
    return ks[ri - 1] if ri > 0 else None


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

    # Keep the whole source edge (not just its rationale text) so we can restore the original slot.
    src_by = {ckey(e): e for e in src if has_rat(e)}
    had = {ckey(e) for e in cur_doc["edges"] if has_rat(e)}

    restored = kept = gap = 0
    slot_mismatches = []   # (key, expected_pred, actual_pred) — must be empty
    new_edges = []
    from collections import Counter
    placement = Counter()
    for e in cur_doc["edges"]:
        if has_rat(e):
            kept += 1
            new_edges.append(e)
            continue
        k = ckey(e)
        if k in src_by:
            src_e = src_by[k]
            new_e, used_pred = restore_rationale(e, src_e)
            new_edges.append(new_e)
            restored += 1
            placement[f"after:{used_pred}"] += 1
            # POSITION PROOF (per edge): rationale must sit after the source predecessor whenever
            # that predecessor is present in the current edge.
            exp = source_predecessor(src_e)
            if exp is not None and exp in e:
                act = predecessor_of(new_e)
                if act != exp:
                    slot_mismatches.append((k, exp, act))
        else:
            new_edges.append(e)
            gap += 1
    cur_doc["edges"] = new_edges
    out_blob = serialize(cur_doc)

    # POSITION PROOF: no restored edge may sit in the wrong slot.
    if slot_mismatches:
        sample = "; ".join(f"{'|'.join(map(str, k))}: expected after {exp}, got after {act}"
                           for k, exp, act in slot_mismatches[:3])
        sys.exit(f"ABORT: position proof failed — {len(slot_mismatches)} restored edge(s) placed "
                 f"rationale in the wrong slot vs the ba3128f5 source. Nothing written. e.g. {sample}")

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
    print(f"rationale placement (at source-original slot): {dict(placement)}")
    print("position proof: PASS (every restored edge in its ba3128f5 slot)")
    print("strip-back proof: PASS (only rationale changed)")
    print(f"wrote: {out_path}")
    if gap:
        print(f"\n{gap} edges have no source in ba3128f5 (created after the wipe) and still need "
              f"generation — see gap breakdown in the spec doc.")


if __name__ == "__main__":
    main()
