import json, os, re

RD = r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist"
GATE = 0.6

# v0.2 batch proposals
props = []
total_facts = 0
for i in range(10):
    d = json.load(open(os.path.join(RD, f"_p02_out_B{i}.json"), encoding="utf-8"))
    total_facts += d.get("facts_processed", 0)
    for p in d["proposals"]:
        props.append(p)
print(f"v0.2: facts={total_facts}, raw proposals={len(props)}")

gated = {}
for p in props:
    if p.get("confidence", 0) >= GATE:
        k = p["name"].lower()
        if k not in gated or p["confidence"] > gated[k]["confidence"]:
            gated[k] = p
print(f"v0.2 gated after dedup: {len(gated)}")

# v0.1 gated (from committed artifacts)
v01 = []
for b in "ABC":
    d = json.load(open(os.path.join(RD, "analyses", "p0-t1767", f"_p0_out_{b}.json"), encoding="utf-8"))
    for p in d["proposals"]:
        if p.get("confidence", 0) >= GATE:
            v01.append(p)
print(f"v0.1 gated carried over: {len(v01)}")

# Alias table: v0.2 ∪ v0.1 ∪ org registry
orgs = json.load(open(r"C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\organizations.json", encoding="utf-8-sig"))
alias_map = {}
def add(name, ref_kind, canonical, etype):
    n = name.lower().strip()
    if len(n) >= 4:
        alias_map.setdefault(n, (ref_kind, canonical, etype))
for p in list(gated.values()) + v01:
    for n in [p["name"]] + p.get("aliases", []):
        add(n, "proposal", p["name"], p["entity_type"])
for o in orgs["organizations"]:
    add(o.get("name", ""), "org", o["id"], "organization")
    if o.get("short_name"):
        add(o["short_name"], "org", o["id"], "organization")
print(f"alias table size: {len(alias_map)}")

# Scan the 3 statements
stmts = json.load(open(os.path.join(RD, "analyses", "p0-t1767", "_p0_statements.json"), encoding="utf-8"))
print("\n=== v0.2 detect->link scan ===")
for i, s in enumerate(stmts, 1):
    text = s["content"].lower()
    hits = []
    for alias, ref in alias_map.items():
        if re.search(r"\b" + re.escape(alias) + r"\b", text):
            hits.append((alias, ref[0], ref[1]))
    print(f"stmt {i} [{s['speaker']}]: {hits if hits else 'no detections'}")

# Was the annotated mention's entity extracted at all?
print("\n=== annotated-mention table check ===")
cands = [k for k in alias_map if "2008" in k or "financial crisis" in k]
print("table entries containing '2008'/'financial crisis':", cands if cands else "NONE")

# Drift-check sample: every Nth of sorted v0.2 gated names, 20 items
names = sorted(gated.keys())
step = max(1, len(names) // 20)
sample = names[::step][:20]
print("\n=== drift-check sample (20) ===")
for n in sample:
    p = gated[n]
    print(f"- {p['name']} [{p['entity_type']}] conf={p['confidence']} | {p.get('quote','')[:90]}")
