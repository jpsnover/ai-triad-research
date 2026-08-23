#!/usr/bin/env python3
# Scoped twin-aware edge-rationale RE-MERGE from committed HEAD (t/2946).
#
# PURPOSE — this is the *working-tree repair* half of t/2444, not the 33.4k restore.
# `apply_restore.py` (sibling) restores the bulk historical rationales from ba3128f5.
# This tool enforces a narrower, continuously-checkable invariant:
#
#     THE RE-MERGE INVARIANT
#     No edge that carries a `rationale` at committed HEAD may lack one in the working tree.
#
# That is exactly the damage class of the confirmed recurrence vector (t/2945): the
# taxonomy-editor load-list/save-whole-file round-trip re-serializes edges.json through the
# TS writer with NO rationale re-merge, so a save silently drops every rationale the renderer's
# stripping load path never saw. The observed 2026-08-20 specimen
# (`observed-specimen-2026-08-20.json`) is 6 debate-reflection edges stripped that way while 2
# newly-appended edges kept theirs.
#
# WHY RE-MERGE AND NOT `git checkout --`:
#   A checkout restores the 6 stripped rationales but DISCARDS legitimately appended edges (the
#   2 skp-beliefs-303 edges in the specimen). The repair must be additive: take rationale from
#   HEAD, keep everything the working tree added.
#
# TWIN-AWARE IDENTITY (TL-prescribed, e/120#37 — one identity model across guard/restore/re-merge):
#   Primary key is the composite `source|type|target`. That is a NEAR-key, not a key: the live
#   file carries 33,577 distinct keys over 33,580 edges — 3 keys hold 2 genuinely distinct edges
#   each (different discovery run, different confidence). Where the key is non-unique we
#   disambiguate the twin on (`discovered_at`, `model`). If it is STILL ambiguous after the
#   tie-break we REFUSE AND LOG — never guess. Silent mis-attribution is the failure mode this
#   guards, and neither proof below can see it: a rationale copied onto the wrong twin satisfies
#   both "only rationale changed" and the byte-exact strip-back.
#
# SAFETY MODEL (identical byte discipline to apply_restore.py):
#   * `rationale` is inserted immediately AFTER `confidence`, every other key left in its exact
#     current order (the live file has many distinct per-edge key orderings; we never reorder).
#   * Edges already carrying a rationale are left byte-for-byte untouched.
#   * ROUND-TRIP SELF-CHECK: our serializer must reproduce the target file byte-for-byte before
#     we trust it to write. Abort otherwise.
#   * STRIP-BACK PROOF: removing only the rationales we added must reproduce the target file
#     byte-for-byte. Abort otherwise. Guarantees the re-merge changed *only* rationale.
#
# Default mode is CHECK-ONLY and non-destructive: it reports and exits 1 if the invariant is
# violated, 0 if clean. `--apply` writes `<target>.remerged`; add `--write-in-place` to repair
# the live file. The tool never commits.
#
# Usage:
#   python remerge_from_head.py --data-repo ../../../../ai-triad-data          # check
#   python remerge_from_head.py --data-repo ../../../../ai-triad-data --apply --write-in-place

import argparse
import json
import os
import subprocess
import sys

REL = "taxonomy/Origin/edges.json"


def read_text(path):
    """Read a file verbatim: no newline translation (byte proofs depend on it), handle closed."""
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def has_rat(e):
    r = e.get("rationale")
    return isinstance(r, str) and r.strip() != ""


def ckey(e):
    """Primary composite near-key. Twin disambiguation is handled separately."""
    return (e.get("source"), e.get("type"), e.get("target"))


def twin_sig(e):
    """Tie-break signature used only where the composite key is non-unique."""
    return (e.get("discovered_at"), e.get("model"))


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


def insert_rationale(wt_edge, head_edge):
    """Re-insert `rationale` at the slot it occupies in the HEAD counterpart.

    Do NOT assume a fixed slot. The live file places `rationale` after `weight`
    (source,target,type,bidirectional,confidence,weight,rationale,status,...), and the file
    carries many distinct per-edge key orderings — a hardcoded "after confidence" insert puts the
    field one position early, producing a same-length but non-identical file.

    Crucially, the strip-back proof CANNOT catch that: it removes exactly the key it added, so a
    correctly-valued rationale in the wrong slot round-trips perfectly. Deriving the slot from
    HEAD is what makes the repair byte-reproduce the original.
    """
    head_keys = list(head_edge.keys())
    predecessor = None
    if "rationale" in head_keys:
        i = head_keys.index("rationale")
        if i > 0:
            predecessor = head_keys[i - 1]

    out = {}
    for k, v in wt_edge.items():
        out[k] = v
        if k == predecessor:
            out["rationale"] = head_edge["rationale"]
    if "rationale" not in out:
        # Predecessor absent from the working-tree edge — fall back to the conventional slot,
        # then to the end. Both are order-only fallbacks; the value is unaffected.
        out = {}
        for k, v in wt_edge.items():
            out[k] = v
            if k == "confidence":
                out["rationale"] = head_edge["rationale"]
        if "rationale" not in out:
            out["rationale"] = head_edge["rationale"]
    return out


def refuse(goal, problem, location, next_steps):
    """Project error convention: Goal / Problem / Location / Next Steps (never a bare throw)."""
    sys.exit(
        "REFUSED — twin-aware re-merge aborted.\n"
        f"  Goal:       {goal}\n"
        f"  Problem:    {problem}\n"
        f"  Location:   {location}\n"
        f"  Next Steps: {next_steps}"
    )


def group_by_key(edges):
    buckets = {}
    for e in edges:
        buckets.setdefault(ckey(e), []).append(e)
    return buckets


def pair_bucket(key, wt_bucket, head_bucket, ambiguous):
    """Return [(wt_edge, head_edge_or_None)] for one composite-key bucket, twin-aware.

    Unique-vs-unique is the overwhelmingly common case and pairs directly. Where either side is
    non-unique we require an exact (discovered_at, model) tie-break producing exactly ONE
    unclaimed HEAD candidate; anything else is logged as ambiguous and left untouched.
    """
    if len(wt_bucket) == 1 and len(head_bucket) == 1:
        return [(wt_bucket[0], head_bucket[0])]
    if not head_bucket:
        return [(w, None) for w in wt_bucket]

    pairs = []
    claimed = set()
    for w in wt_bucket:
        cands = [
            i for i, h in enumerate(head_bucket)
            if i not in claimed and twin_sig(h) == twin_sig(w)
        ]
        if len(cands) == 1:
            claimed.add(cands[0])
            pairs.append((w, head_bucket[cands[0]]))
        elif len(cands) == 0:
            # No HEAD counterpart for this twin — treat as working-tree-added, never restore.
            pairs.append((w, None))
        else:
            ambiguous.append({
                "key": "|".join(str(x) for x in key),
                "discovered_at": w.get("discovered_at"),
                "model": w.get("model"),
                "head_candidates": len(cands),
            })
            pairs.append((w, None))
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-repo", required=True, help="path to the ai-triad-data repo")
    ap.add_argument("--ref", default="HEAD", help="source-of-truth ref (default: HEAD)")
    ap.add_argument("--target", default=None,
                    help="override the file to repair (default: <data-repo>/" + REL + "). "
                         "Used by the two-arm test to run against a scratch copy.")
    ap.add_argument("--apply", action="store_true", help="write the re-merged file")
    ap.add_argument("--write-in-place", action="store_true", help="repair the live file directly")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    repo = os.path.abspath(args.data_repo)
    target = os.path.abspath(args.target) if args.target else os.path.join(repo, *REL.split("/"))
    if not os.path.exists(target):
        refuse(
            "re-merge committed rationales into the live edges.json",
            f"target file not found at {target}",
            f"--data-repo {repo}",
            "pass the ai-triad-data repo root via --data-repo",
        )

    proc = subprocess.run(
        ["git", "-C", repo, "show", f"{args.ref}:{REL}"],
        capture_output=True,
    )
    if proc.returncode != 0:
        refuse(
            f"read the source-of-truth edges.json at {args.ref}",
            f"git show failed: {proc.stderr.decode('utf-8', 'replace').strip()}",
            f"{repo} @ {args.ref}:{REL}",
            "verify the ref exists; on Windows agents a spurious 'unknown revision' can be "
            "MSYS path mangling — retry with MSYS_NO_PATHCONV=1 or via PowerShell",
        )

    head_edges = json.loads(proc.stdout.decode("utf-8"))["edges"]
    wt_blob = read_text(target)
    wt_doc = json.loads(wt_blob)
    wt_edges = wt_doc["edges"]

    # Round-trip self-check before we trust the serializer to write anything.
    if serialize(wt_doc) != wt_blob:
        refuse(
            "prove the re-merge can only change `rationale`",
            "our serializer does not reproduce the target file byte-for-byte, so any write "
            "would introduce unrelated formatting churn",
            target,
            "the file's byte format changed — reconcile serialize() with "
            "lib/edges/serializeEdges.ts before re-running",
        )

    head_buckets = group_by_key(head_edges)
    wt_buckets = group_by_key(wt_edges)

    ambiguous = []
    restore_map = {}  # id(wt_edge) -> HEAD counterpart (supplies both value and key slot)
    lost, appended, already = 0, 0, 0

    for key, wt_bucket in wt_buckets.items():
        for w, h in pair_bucket(key, wt_bucket, head_buckets.get(key, []), ambiguous):
            # Classify by provenance first: an edge with no HEAD counterpart is working-tree-added
            # regardless of whether it carries a rationale. Conflating it with "already had one"
            # would hide the very edges the re-merge must PRESERVE (vs `git checkout --`).
            if h is None:
                appended += 1
                continue
            if has_rat(w):
                already += 1
                continue
            if has_rat(h):
                restore_map[id(w)] = h
                lost += 1

    dropped = [k for k in head_buckets if k not in wt_buckets]
    dropped_with_rat = [
        k for k in dropped if any(has_rat(h) for h in head_buckets[k])
    ]

    print(f"source of truth : {args.ref} ({len(head_edges)} edges, "
          f"{sum(1 for e in head_edges if has_rat(e))} with rationale)")
    print(f"working tree    : {target} ({len(wt_edges)} edges, "
          f"{sum(1 for e in wt_edges if has_rat(e))} with rationale)")
    print(f"twin keys       : HEAD={sum(1 for v in head_buckets.values() if len(v) > 1)}  "
          f"WT={sum(1 for v in wt_buckets.values() if len(v) > 1)}")
    print()
    print(f"REGRESSED (rationale at {args.ref}, absent in working tree) : {lost}")
    print(f"working-tree-added edges (no {args.ref} counterpart)        : {appended}")
    print(f"already carrying rationale (untouched)                     : {already}")
    print(f"twin-ambiguous, REFUSED (left untouched)                   : {len(ambiguous)}")
    print(f"edges present at {args.ref} but absent from working tree    : {len(dropped)} "
          f"({len(dropped_with_rat)} of them rationale-bearing)")

    if ambiguous:
        print("\n-- twin-ambiguous keys (not re-merged; report these, never guess) --")
        for a in ambiguous:
            print(f"   {a['key']}  discovered_at={a['discovered_at']} model={a['model']} "
                  f"head_candidates={a['head_candidates']}")

    if lost:
        print(f"\n-- regressed keys ({lost}) --")
        for key, wt_bucket in wt_buckets.items():
            for w in wt_bucket:
                if id(w) in restore_map:
                    print("   %s  model=%s discovered_at=%s"
                          % ("|".join(str(x) for x in key), w.get("model"), w.get("discovered_at")))

    if not lost:
        print("\nRE-MERGE INVARIANT: HOLDS — every rationale committed at "
              f"{args.ref} is present in the working tree. Nothing to re-merge.")
        return 0

    if not args.apply:
        print("\nRE-MERGE INVARIANT: VIOLATED. Check-only mode — nothing written. "
              "Re-run with --apply (and --write-in-place to repair the live file).")
        return 1

    new_edges = []
    added_positions = set()
    for e in wt_edges:
        if id(e) in restore_map:
            added_positions.add(len(new_edges))
            new_edges.append(insert_rationale(e, restore_map[id(e)]))
        else:
            new_edges.append(e)

    out_doc = dict(wt_doc)
    out_doc["edges"] = new_edges
    out_blob = serialize(out_doc)

    # STRIP-BACK PROOF: remove only what we added; must reproduce the pre-repair file exactly.
    check = json.loads(out_blob)
    for i, e in enumerate(check["edges"]):
        if i in added_positions:
            e.pop("rationale", None)
    if serialize(check) != wt_blob:
        refuse(
            "prove the re-merge changed only `rationale`",
            "strip-back proof failed — re-serializing without the added rationales did not "
            "reproduce the pre-repair file byte-for-byte",
            target,
            "do NOT apply; investigate the diff before any write. Nothing was written.",
        )

    out_path = target if args.write_in_place else (args.out or target + ".remerged")
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(out_blob)

    print("\nstrip-back proof: PASS (only rationale changed)")
    print(f"re-merged {lost} edge(s); wrote: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
