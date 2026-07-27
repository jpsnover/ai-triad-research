import json, os, re

RD = r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist"
DATA = r"C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin"
GATE = 0.6

# Load batches
props = []
for b in "ABC":
    d = json.load(open(os.path.join(RD, f"_p0_out_{b}.json"), encoding="utf-8"))
    for p in d["proposals"]:
        p["batch"] = b
        props.append(p)

gated = [p for p in props if p.get("confidence", 0) >= GATE]
# cross-batch exact-name dedup
seen = {}
for p in gated:
    k = p["name"].lower()
    if k not in seen or p["confidence"] > seen[k]["confidence"]:
        seen[k] = p
gated = list(seen.values())
print(f"total proposals: {len(props)} | gated (>= {GATE}) after dedup: {len(gated)}")
print(f"yield: {len(gated)}/161 = {len(gated)/161:.3f}  (threshold >= 0.15)")

# Excluded-class tables
excl = json.load(open(os.path.join(RD, "_p0_excluded.json"), encoding="utf-8"))
org = {n.lower() for n in excl["org_names"]}
dic = {n.lower() for n in excl["dictionary_colloquial"]}
pol = {n.lower() for n in excl["pol_actions"]}

# Taxonomy labels
labels = set()
for f in os.listdir(DATA):
    if not f.endswith(".json") or f.startswith("_") or f in ("embeddings.json", "edges.json", "embeddings-orgstance-6733.json", "organization_edges.json", "organization_stance_claims.json", "org-edge.json"):
        continue
    try:
        d = json.load(open(os.path.join(DATA, f), encoding="utf-8-sig"))
    except Exception:
        continue
    if isinstance(d, dict):
        for cat in ("beliefs", "desires", "intentions", "nodes", "situations"):
            for n in d.get(cat, []) or []:
                if isinstance(n, dict) and n.get("label"):
                    labels.add(n["label"].lower())
print(f"taxonomy labels loaded: {len(labels)}")

leak = []
for p in gated:
    names = [p["name"].lower()] + [a.lower() for a in p.get("aliases", [])]
    for n in names:
        if n in org: leak.append((p["name"], n, "org"))
        if n in dic: leak.append((p["name"], n, "dictionary"))
        if n in pol: leak.append((p["name"], n, "policy"))
        if n in labels: leak.append((p["name"], n, "taxonomy-label"))
print("LEAKAGE:", leak if leak else "0 (none)")

# Detect->link over the 3 statements
stmts = json.load(open(os.path.join(RD, "_p0_statements.json"), encoding="utf-8"))
alias_map = {}
for p in gated:
    for n in [p["name"]] + p.get("aliases", []):
        alias_map[n.lower()] = ("proposal", p["name"], p["entity_type"])
for n in excl["org_names"]:
    alias_map[n.lower()] = ("org", n, "organization")

print("\n=== detect->link scan ===")
for i, s in enumerate(stmts, 1):
    text = s["content"].lower()
    hits = []
    for alias, ref in alias_map.items():
        if len(alias) < 4:
            continue
        if re.search(r"\b" + re.escape(alias) + r"\b", text):
            hits.append((alias, ref))
    print(f"stmt {i} [{s['speaker']}]: {hits if hits else 'no detections'}")
