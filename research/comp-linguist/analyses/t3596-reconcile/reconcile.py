#!/usr/bin/env python3
"""t/3596 independent second-agent reconcile (CL).
Re-derive source_index.json totals from the cleaned summaries + live taxonomy,
WITHOUT reading Build-NodeSourceIndex — then compare to the committed index.
Spec (from t/3596 SO-locked, e/192): invert summary links onto live belief nodes,
filter to live ids, dedup 4-tuple (source_id, quote, link_source, doc_position)
keeping max extraction_confidence; all 959 live nodes present (explicit []).
"""
import json, glob, os, collections
DATA = r"C:/Users/jsnov/repos/ai-triad-data"
SRC  = r"C:/Users/jsnov/repos/ai-triad-sources"
POVS = ['accelerationist', 'safetyist', 'skeptic']

def _h(x):
    """Stable, hashable form for a dedup-key component (lists/dicts -> canonical JSON)."""
    return json.dumps(x, sort_keys=True, ensure_ascii=False) if isinstance(x, (list, dict)) else x

# --- live belief-node id set (the index's key domain) ---
live = set()
for f in POVS:
    doc = json.load(open(f"{DATA}/taxonomy/Origin/{f}.json", encoding='utf-8'))
    for n in doc['nodes']:
        live.add(str(n['id']))
print(f"live belief nodes (acc+saf+skp): {len(live)}")

# --- committed index ---
idx = json.load(open(f"{DATA}/taxonomy/Origin/source_index.json", encoding='utf-8'))
index = idx['index']
hdr_tot = idx['totals']

# --- independent inversion from summaries ---
# per-node dict: dedup-key -> extraction_confidence (keep max)
per_node = collections.defaultdict(dict)
raw_kp = raw_fc = 0
dropped_dead = 0
for path in glob.glob(f"{DATA}/summaries/*.json"):
    s = json.load(open(path, encoding='utf-8'))
    sid = str(s.get('doc_id'))
    # key_points (per POV)
    for pov, block in (s.get('pov_summaries') or {}).items():
        for kp in (block.get('key_points') or []):
            nid = kp.get('taxonomy_node_id')
            if not nid:
                continue
            nid = str(nid)
            if nid not in live:
                dropped_dead += 1; continue
            raw_kp += 1
            key = (sid, _h(kp.get('verbatim')), 'key_point', None)
            ec = kp.get('extraction_confidence')
            if key not in per_node[nid] or (ec is not None and (per_node[nid][key] is None or ec > per_node[nid][key])):
                per_node[nid][key] = ec
    # factual_claims (top-level)
    for fc in (s.get('factual_claims') or []):
        for nid in (fc.get('linked_taxonomy_nodes') or []):
            nid = str(nid)
            if nid not in live:
                dropped_dead += 1; continue
            raw_fc += 1
            key = (sid, _h(fc.get('claim')), 'factual_claim', _h(fc.get('doc_position')))
            ec = fc.get('extraction_confidence')
            if key not in per_node[nid] or (ec is not None and (per_node[nid][key] is None or ec > per_node[nid][key])):
                per_node[nid][key] = ec

# deduped totals
dd_kp = sum(1 for n in per_node for k in per_node[n] if k[2] == 'key_point')
dd_fc = sum(1 for n in per_node for k in per_node[n] if k[2] == 'factual_claim')
my_entries = dd_kp + dd_fc
print(f"\nRAW link occurrences (live-filtered): key_point={raw_kp} factual_claim={raw_fc} (dead/non-belief dropped={dropped_dead})")
print(f"DEDUPED (my recompute):  key_point={dd_kp} factual_claim={dd_fc} total={my_entries}")
print(f"COMMITTED header totals:  key_point={hdr_tot['byLinkSource']['key_point']} factual_claim={hdr_tot['byLinkSource']['factual_claim']} total={hdr_tot['entries']}")

# --- reconcile checks ---
print("\n=== RECONCILE ===")
ok = True
def chk(name, a, b):
    global ok
    r = (a == b); ok = ok and r
    print(f"  [{'OK' if r else 'MISMATCH'}] {name}: mine={a} committed={b}")
chk("key count == live nodes", len(index), len(live))
chk("header nodes == live", hdr_tot['nodes'], len(live))
chk("all live nodes present as keys", set(index.keys()) == live, True)
chk("total entries", my_entries, hdr_tot['entries'])
chk("key_point entries", dd_kp, hdr_tot['byLinkSource']['key_point'])
chk("factual_claim entries", dd_fc, hdr_tot['byLinkSource']['factual_claim'])
# committed file's own Σ len(entries) == header
sigma = sum(len(v) for v in index.values())
chk("Σ len(index entries) == header.entries", sigma, hdr_tot['entries'])

# --- per-node spot-check: my dedup count vs committed len, for 5 heaviest nodes ---
print("\n=== per-node spot-check (5 heaviest committed nodes) ===")
heavy = sorted(index.items(), key=lambda kv: -len(kv[1]))[:5]
for nid, entries in heavy:
    mine = len(per_node.get(nid, {}))
    r = mine == len(entries)
    ok = ok and r
    print(f"  [{'OK' if r else 'MISMATCH'}] {nid}: mine={mine} committed={len(entries)}")

# --- leg (b) source resolvability spot-check: 20 distinct source_ids ---
print("\n=== source_id resolvability (leg b) spot-check ===")
srcs = []
for v in index.values():
    for e in v:
        srcs.append(e['source_id'])
distinct = sorted(set(srcs))
import itertools
sample = distinct[:: max(1, len(distinct)//20)][:20]
missing = [sid for sid in sample if not os.path.exists(f"{SRC}/{sid}/metadata.json")]
print(f"  distinct source_ids={len(distinct)}; sampled {len(sample)}; missing metadata.json: {missing if missing else 'NONE'}")
ok = ok and not missing

print("\n" + ("=== ALL RECONCILE CHECKS PASS ===" if ok else "=== RECONCILE FAILED ==="))
