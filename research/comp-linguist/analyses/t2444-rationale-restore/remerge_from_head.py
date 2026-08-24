#!/usr/bin/env python3
# Scoped twin-aware edge-rationale re-merge from committed HEAD (t/2946, t/2444).
#
# WHAT THIS IS FOR
#   The confirmed recurrence vector (t/2946#5) is the taxonomy-editor load-list /
#   save-whole-file round-trip: it loads edges with `rationale` stripped by the load-side
#   projection, then writes the whole file back through the TS serializer -- silently
#   dropping the field for every edge it round-tripped, while legitimately appending the
#   edges the user actually added.
#
#   The repair is a RE-MERGE, not a `git checkout`. A checkout would restore the stripped
#   rationales but also discard the newly appended edges, which are real user work. This
#   re-merges `rationale` from committed HEAD into the working-tree file, edge by edge,
#   and leaves everything else -- including the appended edges -- untouched.
#
#   This is the offline twin of the Option-1 site fix the AC prescribes (`save-edges` IPC +
#   `PUT /api/edges` re-merging rationale from HEAD before writing). It uses the SAME
#   twin-aware identity the restore uses, per TL e/120#37: one identity model across
#   guard + restore + re-merge.
#
# IDENTITY MODEL (TL-prescribed, e/120#37 -- shared with apply_restore.py)
#   Edges have no `id`. Primary key is the composite `(source, type, target)`.
#   That is a NEAR-key, not a key: on the live file 3 keys carry 2 genuinely distinct
#   edges each (t/2946#4). Where the key is non-unique in EITHER file, the twin is
#   disambiguated on `discovered_at` + `model`. If it is still ambiguous after that
#   tie-break, the edge is REFUSED and logged -- never guessed. A mis-attributed
#   rationale is invisible to the byte proofs below, so it has to be refused up front.
#
# SAFETY MODEL
#   * Round-trip self-check: the serializer must reproduce the current working-tree file
#     byte-for-byte before anything is trusted. Otherwise: abort, write nothing.
#   * `rationale` is inserted immediately after `confidence`, preserving every other key
#     in its exact current order (the live file has many distinct per-edge key orderings;
#     we never reorder).
#   * Edges that already carry a rationale are left byte-for-byte untouched.
#   * STRIP-BACK PROOF: removing only the rationales we added and re-serializing must
#     reproduce the pre-merge file byte-for-byte. If not: abort, write nothing.
#   * Scope is intrinsically bounded by what HEAD carries -- this re-merges only fields
#     that are already committed. It is NOT the ba3128f5 restore (t/2946 Phase 1), which
#     stays gated on the durability AC.
#
# Usage:
#   python remerge_from_head.py --data-repo <path-to-ai-triad-data>
#                               [--file taxonomy/Origin/edges.json]
#                               [--head-ref HEAD] [--out PATH | --write-in-place]

import argparse, collections, json, os, subprocess, sys


def has_rat(e):
    r = e.get("rationale")
    return isinstance(r, str) and r.strip() != ""


def ckey(e):
    return (e.get("source"), e.get("type"), e.get("target"))


def twin_id(e):
    return (e.get("source"), e.get("type"), e.get("target"),
            e.get("discovered_at"), e.get("model"))


def serialize(doc):
    """Byte-compatible with lib/edges/serializeEdges.ts (round-trip verified per run)."""
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
    ap.add_argument("--data-repo", required=True)
    ap.add_argument("--file", default="taxonomy/Origin/edges.json")
    ap.add_argument("--head-ref", default="HEAD")
    ap.add_argument("--out", default=None)
    ap.add_argument("--write-in-place", action="store_true")
    args = ap.parse_args()

    cur_path = os.path.join(args.data_repo, args.file)
    cur_blob = open(cur_path, encoding="utf-8", newline="").read()
    cur_doc = json.loads(cur_blob)

    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    head_blob = subprocess.run(
        ["git", "-C", args.data_repo, "show", f"{args.head_ref}:{args.file}"],
        capture_output=True, check=True, env=env,
    ).stdout.decode("utf-8")
    head_edges = json.loads(head_blob)["edges"]

    # Serializer must reproduce the CURRENT file byte-for-byte before we trust it.
    if serialize(cur_doc) != cur_blob:
        sys.exit("ABORT: serializer does not round-trip the working-tree file byte-for-byte; "
                 "the file's byte format has changed -- update serialize() before re-merging.")

    head_by_ck = collections.defaultdict(list)
    for e in head_edges:
        head_by_ck[ckey(e)].append(e)
    cur_by_ck = collections.defaultdict(list)
    for e in cur_doc["edges"]:
        cur_by_ck[ckey(e)].append(e)

    had = {twin_id(e) for e in cur_doc["edges"] if has_rat(e)}

    remerged = kept = absent = 0
    refused = []
    changed = []
    new_edges = []

    for e in cur_doc["edges"]:
        if has_rat(e):
            kept += 1
            new_edges.append(e)
            continue
        k = ckey(e)
        cands = head_by_ck.get(k, [])
        if not cands:
            absent += 1                       # appended in the working tree; nothing to merge
            new_edges.append(e)
            continue
        # Twin-aware disambiguation: only trust a bare composite-key match when that key
        # is unique on BOTH sides. Otherwise tie-break on discovered_at + model.
        if len(cands) == 1 and len(cur_by_ck[k]) == 1:
            match = cands[0]
        else:
            tw = [c for c in cands if twin_id(c) == twin_id(e)]
            if len(tw) == 1:
                match = tw[0]
            else:
                refused.append({"key": k, "discovered_at": e.get("discovered_at"),
                                "model": e.get("model"), "head_candidates": len(cands),
                                "twin_matches": len(tw)})
                new_edges.append(e)
                continue
        if has_rat(match):
            new_edges.append(insert_after_confidence(e, match["rationale"]))
            remerged += 1
            changed.append({"key": k, "discovered_at": e.get("discovered_at"),
                            "model": e.get("model")})
        else:
            absent += 1
            new_edges.append(e)

    cur_doc["edges"] = new_edges
    out_blob = serialize(cur_doc)

    # STRIP-BACK PROOF: strip only the rationales we added; must equal the pre-merge file.
    check = json.loads(out_blob)
    for e in check["edges"]:
        if twin_id(e) not in had:
            e.pop("rationale", None)
    if serialize(check) != cur_blob:
        sys.exit("ABORT: strip-back proof failed -- the re-merge changed more than rationale. "
                 "Nothing written.")

    print(f"re-merged={remerged}  kept_existing={kept}  "
          f"no_head_rationale_or_appended={absent}  refused_ambiguous={len(refused)}")
    for c in changed:
        print(f"  + {c['key'][0]} {c['key'][1]} {c['key'][2]}  "
              f"({c['discovered_at']}, {c['model']})")
    if refused:
        print("\nREFUSED (ambiguous twin -- rationale NOT attributed, needs manual "
              "disambiguation):")
        for r in refused:
            print(f"  ! {r['key']}  discovered_at={r['discovered_at']} model={r['model']} "
                  f"head_candidates={r['head_candidates']} twin_matches={r['twin_matches']}")

    final = sum(1 for e in new_edges if has_rat(e))
    print(f"\nedges with rationale: {len(had)} -> {final} / {len(new_edges)}")
    print("strip-back proof: PASS (only rationale changed)")

    if refused:
        sys.exit("\nABORT: refused-and-log is non-empty -- nothing written. Disambiguate the "
                 "twins above, then re-run.")

    out_path = cur_path if args.write_in_place else (args.out or cur_path + ".remerged")
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(out_blob)
    print(f"wrote: {out_path}")


if __name__ == "__main__":
    main()
