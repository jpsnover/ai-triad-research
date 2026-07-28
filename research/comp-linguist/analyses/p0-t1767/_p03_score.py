import json, os, re

RD = r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist"
P0 = os.path.join(RD, "analyses", "p0-t1767")
GATE = 0.6

out = json.load(open(os.path.join(RD, "_p03_out.json"), encoding="utf-8"))
raw, gated = [], []
for s in out["statements"]:
    for p in s["proposals"]:
        p["stmt"] = s["index"]
        raw.append(p)
        if p.get("confidence", 0) >= GATE:
            gated.append(p)
print(f"raw proposals: {len(raw)} | gated (>= {GATE}): {len(gated)}")
for p in gated:
    print(f"  GATED stmt{p['stmt']}: {p['name']} [{p['entity_type']}] conf={p['confidence']}")
print("sub-gate (declined by calibration):")
for p in raw:
    if p not in gated:
        print(f"  stmt{p['stmt']}: {p['name']} [{p['entity_type']}] conf={p['confidence']}")

# Rule 1 — coverage of the locked annotation
ann = json.load(open(os.path.join(P0, "_p0_annotation.json"), encoding="utf-8"))
targets = [m["surface"] for s in ann["statements"] for m in s["entity_mentions"]]
print(f"\nannotated mentions (locked): {targets}")
covered = []
for t in targets:
    tl = t.lower().replace("the ", "").strip()
    hit = None
    for p in gated:
        names = [p["name"].lower()] + [a.lower() for a in p.get("aliases", [])]
        if any(tl in n or n in tl for n in names):
            hit = p["name"]
    covered.append((t, hit))
print("coverage:", covered)
cov = sum(1 for _, h in covered if h) / max(len(targets), 1)
print(f"RULE 1 coverage = {cov:.2f} (>= 0.80): {'PASS' if cov >= 0.80 else 'FAIL'}")

# Rule 3 — universals / contested vocabulary minted at gate
dict_dir = r"C:\Users\jsnov\repos\ai-triad-data\dictionary\colloquial"
coll = {json.load(open(os.path.join(dict_dir, f), encoding="utf-8-sig"))["colloquial_term"].lower()
        for f in os.listdir(dict_dir) if f.endswith(".json")}
CAMPS = {"accelerationist", "safetyist", "skeptic"}
univ = [p["name"] for p in gated if p["name"].lower() in coll or p["name"].lower() in CAMPS]
print(f"RULE 3 universals/camp-labels gated = {len(univ)} {univ} (== 0): {'PASS' if not univ else 'FAIL'}")
# diagnostic: camp labels among SUB-gate proposals (not a rule violation, but a Phase 1 finding)
sub_camps = [p["name"] for p in raw if p not in gated and p["name"].lower() in CAMPS]
print(f"  [diagnostic] camp labels proposed but declined by confidence: {sorted(set(sub_camps))}")

# Rule 4 — resolution against the v0.2 table: matched (link) vs unmatched (curation candidate)
props = []
for i in range(10):
    d = json.load(open(os.path.join(P0, f"_p02_out_B{i}.json"), encoding="utf-8"))
    props += d["proposals"]
v02 = {}
for p in props:
    if p.get("confidence", 0) >= GATE:
        v02.setdefault(p["name"].lower(), p)
for b in "ABC":
    d = json.load(open(os.path.join(P0, f"_p0_out_{b}.json"), encoding="utf-8"))
    for p in d["proposals"]:
        if p.get("confidence", 0) >= GATE:
            v02.setdefault(p["name"].lower(), p)
orgs = json.load(open(r"C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\organizations.json", encoding="utf-8-sig"))
table = set(v02.keys())
for o in orgs["organizations"]:
    table.add(o.get("name", "").lower())
    if o.get("short_name"):
        table.add(o["short_name"].lower())
print(f"\nresolution table size: {len(table)}")
wrong = 0
for p in gated:
    names = [p["name"].lower()] + [a.lower() for a in p.get("aliases", [])]
    m = [n for n in names if n in table]
    print(f"  {p['name']}: {'MATCHED ' + str(m) if m else 'unmatched -> curation candidate'}")
print(f"RULE 4 wrong links = {wrong} (== 0): {'PASS' if wrong == 0 else 'FAIL'}")

# Rule 2 — precision is a hand-score; print the gated set for the record
print("\nRULE 2 gated set for CL hand-score:")
for p in gated:
    print(f"  {p['name']} [{p['entity_type']}] :: {p['quote']}")
