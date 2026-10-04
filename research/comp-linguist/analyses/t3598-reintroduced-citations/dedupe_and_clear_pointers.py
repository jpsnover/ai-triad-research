#!/usr/bin/env python3
"""t/3893 (re-scoped per TL t/3893#3, Rosetta t/3900#1): remove 17 backfill-appended duplicate
key_points and clear the 17 dead unmapped_concepts[].resolved_node_id pointers that re-arm them.

Mechanism (verified entry-by-entry, 17/17): the t/3595 cleanup nulled each key_point's
taxonomy_node_id but left the SOURCE pointer unmapped_concepts[].resolved_node_id on the dead id.
Repair-ResolvedBackfill counts only NON-null key_point ids as "already linked", so it appended a
duplicate key_point (same `point`, the dead id, its fingerprint). Re-nulling would leave a duplicate
and a live re-arm; this script removes the duplicate AND the pointer.

Per frozen op:
  1. DELETE the appended entry: pov key_points entry with taxonomy_node_id == dead id, the backfill
     fingerprint, and exactly one same-`point` twin whose taxonomy_node_id is null. The twin is KEPT.
  2. REMOVE the key `resolved_node_id` from the top-level unmapped_concept whose value is the dead id
     (and whose suggested_pov is that POV). Removing the key (not setting null) matches the shape of
     the corpus's unresolved concepts and the editor's type (`resolved_node_id?: string`); every
     reader treats absent and null alike, so the backfill skips it either way.
Entries are matched by identity, never by raw index (one file has two deletions in the same POV).

Default DRY-RUN: re-validates every op against TODAY's file and taxonomy, proves per-file serializer
byte-identity, 0-collateral, twin-kept, and simulates Repair-ResolvedBackfill's selection on the
result (must re-append nothing). --apply refuses while the frozen authorization is PENDING.
"""
import json, os, sys, copy, collections
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = r"C:/Users/jsnov/repos/ai-triad-data/.worktrees/t3886-bdi"
FROZEN = os.path.join(HERE, "frozen-ops.json")
MAP = os.path.join(HERE, "..", "t3595-stale-citation-links", "worksheet.json")
APPLY = "--apply" in sys.argv
POVS = ("accelerationist", "safetyist", "skeptic")
FP = {"verbatim": None, "excerpt_context": "unmapped_concept_backfill", "extraction_confidence": 0.7}

def fail(m): print("ABORT:", m); sys.exit(1)

frozen = json.load(open(FROZEN, encoding="utf-8"))
if APPLY and str(frozen.get("authorization", "")).upper().startswith("PENDING"):
    fail("frozen-ops.json authorization is PENDING; record it on t/3893 and in the file first.")
ops = frozen["ops"]

# --- re-validate ids against the t/3595 map and TODAY's taxonomy ---
tier = {e["orphan"]: e for e in json.load(open(MAP, encoding="utf-8"))["entries"]}
live = set()
for fn in ("accelerationist.json", "safetyist.json", "skeptic.json"):
    live |= {n["id"] for n in json.load(open(os.path.join(DATA, "taxonomy", "Origin", fn), encoding="utf-8"))["nodes"]}
for op in ops:
    e, ref = tier.get(op["dead_id"]), op["dead_id"]
    if not e or e["tier"] != "C": fail(f"{ref}: not tier C in the t/3595 map")
    if ref in live: fail(f"{ref} is LIVE again")
    if any(s in live for s in (e.get("live_descendants") or [])): fail(f"{ref} now has a live successor (repoint, don't clear)")
print(f"[OK] {len(ops)} ops re-validated: all tier C, all still dead, no live successor")

def ser(o, nl, trail):
    s = json.dumps(o, indent=2, ensure_ascii=False)
    return (s.replace("\n", nl) if nl != "\n" else s) + trail

def would_backfill(d):
    """Mirror Repair-ResolvedBackfill's selection (ps1 lines ~120-229): concepts with a non-empty
    resolved_node_id, a valid suggested_pov present in pov_summaries, whose id is not already a
    NON-null key_point id in that POV -> would be appended. Returns the list."""
    existing = {p: {kp.get("taxonomy_node_id") for kp in ((d.get("pov_summaries") or {}).get(p) or {}).get("key_points") or []
                    if kp.get("taxonomy_node_id")} for p in POVS}
    out = []
    for c in d.get("unmapped_concepts") or []:
        nid, pov = c.get("resolved_node_id"), c.get("suggested_pov")
        if not nid or not str(nid).strip(): continue
        if pov not in POVS or not (d.get("pov_summaries") or {}).get(pov): continue
        if nid not in existing[pov]: out.append((pov, nid))
    return out

by_doc = collections.defaultdict(list)
for op in ops: by_doc[op["docId"]].append(op)
writes, n_del, n_ptr = {}, 0, 0
for doc, dops in sorted(by_doc.items()):
    path = os.path.join(DATA, "summaries", f"{doc}.json")
    raw = open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in raw else "\n"; trail = raw[len(raw.rstrip("\r\n")):]
    orig = json.loads(raw, object_pairs_hook=collections.OrderedDict)
    if ser(orig, nl, trail) != raw: fail(f"{doc}: serializer not byte-identical")
    new = copy.deepcopy(orig)
    drop = collections.defaultdict(set)  # pov -> set(id(entry)) in `new`
    for op in dops:
        pov, ref = op["pov"], op["dead_id"]
        kps = new["pov_summaries"][pov]["key_points"]
        hits = [k for k in kps if k.get("taxonomy_node_id") == ref]
        if len(hits) != 1: fail(f"{doc}/{pov}: {len(hits)} entries carry {ref} (expected 1)")
        dup = hits[0]
        if any(dup.get(k) != v for k, v in FP.items()): fail(f"{doc}/{pov}/{ref}: entry lacks the backfill fingerprint")
        if dup.get("point") != op["point"]: fail(f"{doc}/{pov}/{ref}: `point` text differs from the frozen op")
        twins = [k for k in kps if k is not dup and k.get("point") == dup.get("point") and k.get("taxonomy_node_id") is None]
        if len(twins) != 1: fail(f"{doc}/{pov}/{ref}: {len(twins)} null twins (expected exactly 1, which is kept)")
        drop[pov].add(id(dup))
        ucs = [c for c in new.get("unmapped_concepts") or [] if c.get("resolved_node_id") == ref]
        if len(ucs) != 1: fail(f"{doc}: {len(ucs)} unmapped_concepts point at {ref} (expected 1)")
        if ucs[0].get("suggested_pov") != pov: fail(f"{doc}: pointer for {ref} has suggested_pov {ucs[0].get('suggested_pov')} != {pov}")
        del ucs[0]["resolved_node_id"]; n_ptr += 1
    for pov, ids in drop.items():
        before = new["pov_summaries"][pov]["key_points"]
        new["pov_summaries"][pov]["key_points"] = [k for k in before if id(k) not in ids]
        n_del += len(before) - len(new["pov_summaries"][pov]["key_points"])

    # --- 0-collateral: rebuild the expected doc from ORIG by applying exactly the frozen ops ---
    exp = copy.deepcopy(orig)
    for op in dops:
        kps = exp["pov_summaries"][op["pov"]]["key_points"]
        exp["pov_summaries"][op["pov"]]["key_points"] = [k for k in kps if not (k.get("taxonomy_node_id") == op["dead_id"] and all(k.get(a) == b for a, b in FP.items()))]
        for c in exp.get("unmapped_concepts") or []:
            if c.get("resolved_node_id") == op["dead_id"]: del c["resolved_node_id"]
    if exp != new: fail(f"{doc}: result differs from the frozen ops applied to the original (collateral)")
    # --- twin kept: every deleted entry's null twin is still present ---
    for op in dops:
        kept = [k for k in new["pov_summaries"][op["pov"]]["key_points"] if k.get("point") == op["point"]]
        if len(kept) != 1 or kept[0].get("taxonomy_node_id") is not None: fail(f"{doc}/{op['pov']}/{op['dead_id']}: null twin not kept exactly once")
    # --- durable: no dead id remains, and the backfill would append nothing for these ids ---
    dead = {op["dead_id"] for op in dops}
    left = {k.get("taxonomy_node_id") for p in POVS for k in ((new.get("pov_summaries") or {}).get(p) or {}).get("key_points") or []}
    left |= {c.get("resolved_node_id") for c in new.get("unmapped_concepts") or []}
    if left & dead: fail(f"{doc}: still references {sorted(left & dead)}")
    rearm = [x for x in would_backfill(new) if x[1] in dead]
    if rearm: fail(f"{doc}: backfill would re-append {rearm}")
    other = would_backfill(new)
    if other: print(f"  note {doc}: backfill would append {other} (NOT frozen ids; pre-existing, untouched)")
    writes[path] = ser(new, nl, trail)
    print(f"  {doc[:58]:58} deleted {sum(len(v) for v in drop.values())}, pointers cleared {len(dops)}")

print(f"[OK] {len(writes)} files: {n_del} duplicate key_points deleted (null twins kept), {n_ptr} resolved_node_id keys removed;")
print("     0-collateral vs frozen ops; byte-identical serializer; backfill simulation re-appends none of the frozen ids")
if n_del != len(ops) or n_ptr != len(ops): fail(f"expected {len(ops)} deletions and {len(ops)} pointer clears")
if not APPLY:
    print("\nDRY RUN: all asserts passed, no write."); sys.exit(0)
for path, text in writes.items():
    open(path, "w", encoding="utf-8", newline="").write(text)
print(f"\n[APPLIED] {len(writes)} summaries rewritten.")
