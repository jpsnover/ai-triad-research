"""t/3126 D3a — inventory the REAL pool of entity_refs-bearing claims across the summaries corpus,
so the golden set is stratified against what actually exists (t/2294), not assumed. Read-only."""
import json, glob, os, collections

DATA = r"C:/Users/jsnov/repos/ai-triad-data"
SUM = os.path.join(DATA, "summaries")

def claims_with_refs(obj, ctx=None):
    """Yield dicts that carry a non-empty entity_refs (a claim), recursively."""
    if isinstance(obj, dict):
        er = obj.get("entity_refs")
        if isinstance(er, list) and er:
            yield obj
        for v in obj.values():
            yield from claims_with_refs(v)
    elif isinstance(obj, list):
        for x in obj:
            yield from claims_with_refs(x)

files = sorted(glob.glob(os.path.join(SUM, "*.json")))
n_files_with = 0
by_cat = collections.Counter()
ml_dist = collections.Counter()
method_dist = collections.Counter()
rows = []
for f in files:
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    got = list(claims_with_refs(d))
    if got:
        n_files_with += 1
    for c in got:
        cat = c.get("category") or "factual?"
        by_cat[cat] += 1
        for er in c["entity_refs"]:
            ml_dist[er.get("match_level")] += 1
            method_dist[er.get("method")] += 1
        rows.append({
            "file": os.path.basename(f),
            "category": cat,
            "taxonomy_node_id": c.get("taxonomy_node_id"),
            "stance": c.get("stance"),
            "canonical_proposition": (c.get("canonical_proposition") or c.get("point") or "")[:400],
            "entity_refs": [{"ref": e.get("ref"), "surface": e.get("surface"),
                             "match_level": e.get("match_level"), "method": e.get("method")}
                            for e in c["entity_refs"]],
        })

print(f"summary files scanned: {len(files)}")
print(f"files with >=1 entity_refs-bearing claim: {n_files_with}")
print(f"total entity_refs-bearing claims: {len(rows)}")
print(f"by category: {dict(by_cat)}")
print(f"entity_ref match_level distribution: {dict(ml_dist)}")
print(f"entity_ref method distribution: {dict(method_dist)}")
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_pool.json")
json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"wrote pool -> {out}")
