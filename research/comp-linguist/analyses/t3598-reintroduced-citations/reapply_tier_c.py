#!/usr/bin/env python3
"""Re-apply the t/3595 Tier-C dispositions to citations that push f9cb8ef4 (2026-09-29) reintroduced.

Each frozen (summary, dead id) pair gets exactly the op t/3595 (9241c64b) applied:
  key_points[].taxonomy_node_id == dead id      -> null
  factual_claims[].linked_taxonomy_nodes[] has it -> drop that element
Nothing else may change. Default DRY-RUN: proves serializer byte-identity per file and
0-collateral (only those two link fields differ). --apply refuses while the frozen file's
authorization is PENDING, then writes and re-verifies the written files.
"""
import json, os, sys, copy, collections
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = r"C:/Users/jsnov/repos/ai-triad-data/.worktrees/t3886-bdi"
FROZEN = os.path.join(HERE, "frozen-citations.json")
MAP = os.path.join(HERE, "..", "t3595-stale-citation-links", "worksheet.json")
APPLY = "--apply" in sys.argv
POVS = ("accelerationist.json", "safetyist.json", "skeptic.json")

def fail(m): print("ABORT:", m); sys.exit(1)

frozen_doc = json.load(open(FROZEN, encoding="utf-8"))
if APPLY and str(frozen_doc.get("authorization", "")).upper().startswith("PENDING"):
    fail("frozen-citations.json authorization is PENDING; record it on the anchor ticket and in the file first.")
pairs = [(p["docId"], p["ref"]) for p in frozen_doc["citations"]]

# Re-validate the frozen pairs against the t/3595 map and TODAY's taxonomy (never trust the snapshot).
tier = {e["orphan"]: e for e in json.load(open(MAP, encoding="utf-8"))["entries"]}
live = set()
for fn in POVS:
    live |= {n["id"] for n in json.load(open(os.path.join(DATA, "taxonomy", "Origin", fn), encoding="utf-8"))["nodes"]}
for doc, ref in pairs:
    e = tier.get(ref)
    if not e: fail(f"{ref} not in the t/3595 map")
    if e["tier"] != "C": fail(f"{ref} is tier {e['tier']}, this script only re-applies tier C")
    if ref in live: fail(f"{ref} is LIVE again; its citation is no longer dead")
    if any(s in live for s in (e.get("live_descendants") or [])): fail(f"{ref} now has a live successor; tier C no longer applies")
print(f"[OK] {len(pairs)} frozen pairs re-validated: all tier C, all still dead, no live successor")

by_doc = collections.defaultdict(set)
for doc, ref in pairs: by_doc[doc].add(ref)

def link_strip(d):
    """Copy of the doc with ONLY the two link fields blanked, for the 0-collateral compare."""
    d = copy.deepcopy(d)
    for pov in (d.get("pov_summaries") or {}).values():
        for kp in (pov or {}).get("key_points") or []:
            if "taxonomy_node_id" in kp: kp["taxonomy_node_id"] = "<link>"
    for fc in d.get("factual_claims") or []:
        if "linked_taxonomy_nodes" in fc: fc["linked_taxonomy_nodes"] = "<links>"
    return d

ops = collections.Counter(); out = {}
for doc, refs in sorted(by_doc.items()):
    path = os.path.join(DATA, "summaries", f"{doc}.json")
    raw = open(path, encoding="utf-8", newline="").read()
    orig = json.loads(raw, object_pairs_hook=collections.OrderedDict)
    nl = "\r\n" if "\r\n" in raw else "\n"
    trail = raw[len(raw.rstrip("\r\n")):]
    def ser(o):
        s = json.dumps(o, indent=2, ensure_ascii=False)
        return (s.replace("\n", nl) if nl != "\n" else s) + trail
    if ser(orig) != raw: fail(f"{doc}: serializer not byte-identical to the current file")
    new = copy.deepcopy(orig); hit = collections.Counter()
    for pov in (new.get("pov_summaries") or {}).values():
        for kp in (pov or {}).get("key_points") or []:
            if kp.get("taxonomy_node_id") in refs:
                hit[("key_points", kp["taxonomy_node_id"])] += 1; kp["taxonomy_node_id"] = None
    for fc in new.get("factual_claims") or []:
        lst = fc.get("linked_taxonomy_nodes")
        if isinstance(lst, list) and any(x in refs for x in lst):
            for x in lst:
                if x in refs: hit[("factual_claims", x)] += 1
            fc["linked_taxonomy_nodes"] = [x for x in lst if x not in refs]
    found = {r for (_, r) in hit}
    if found != refs: fail(f"{doc}: expected to find {sorted(refs)}, found {sorted(found)}")
    if link_strip(new) != link_strip(orig): fail(f"{doc}: a field other than the two link fields changed")
    for (field, r), n in hit.items(): ops[field] += n; print(f"  {doc[:56]:56} {r:20} {field:15} x{n}")
    out[path] = ser(new)
print(f"[OK] {len(out)} files; ops by field: {dict(ops)}; only the two link fields change; serializer byte-identical")

if not APPLY:
    print("\nDRY RUN: all asserts passed, no write."); sys.exit(0)

for path, text in out.items():
    open(path, "w", encoding="utf-8", newline="").write(text)
# re-verify the written files: none of the frozen refs remain
for doc, refs in by_doc.items():
    d = json.load(open(os.path.join(DATA, "summaries", f"{doc}.json"), encoding="utf-8"))
    left = {kp.get("taxonomy_node_id") for pov in (d.get("pov_summaries") or {}).values() for kp in (pov or {}).get("key_points") or []}
    left |= {x for fc in d.get("factual_claims") or [] for x in (fc.get("linked_taxonomy_nodes") or [])}
    if left & refs: fail(f"post-write: {doc} still cites {sorted(left & refs)}")
print(f"\n[APPLIED] {len(out)} summaries rewritten; post-write check: 0 frozen refs remain")
