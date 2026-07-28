import json, os, re

RD = r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist"
GATE = 0.6

# Rebuild the v0.2 table exactly as the scorer did
props = []
for i in range(10):
    d = json.load(open(os.path.join(RD, f"_p02_out_B{i}.json"), encoding="utf-8"))
    props.extend(d["proposals"])
gated = {}
for p in props:
    if p.get("confidence", 0) >= GATE:
        k = p["name"].lower()
        if k not in gated or p["confidence"] > gated[k]["confidence"]:
            gated[k] = p
v01 = []
for b in "ABC":
    d = json.load(open(os.path.join(RD, "analyses", "p0-t1767", f"_p0_out_{b}.json"), encoding="utf-8"))
    v01 += [p for p in d["proposals"] if p.get("confidence", 0) >= GATE]
orgs = json.load(open(r"C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\organizations.json", encoding="utf-8-sig"))

alias_map = {}
def add(n, kind, canon):
    n = n.lower().strip()
    if len(n) >= 4:
        alias_map.setdefault(n, (kind, canon))
for p in list(gated.values()) + v01:
    for n in [p["name"]] + p.get("aliases", []):
        add(n, "proposal", p["name"])
for o in orgs["organizations"]:
    add(o.get("name", ""), "org", o["id"])
    if o.get("short_name"):
        add(o["short_name"], "org", o["id"])

stmts = json.load(open(os.path.join(RD, "analyses", "p0-t1767", "_p0_statements.json"), encoding="utf-8"))

# ---- POSITIVE CONTROL: does the detector fire when the table DOES contain a present string? ----
ctrl = dict(alias_map)
ctrl["red-teaming"] = ("control", "CONTROL-ENTITY")     # appears in stmt 1
ctrl["2008 financial crisis"] = ("control", "CONTROL-2008")  # appears in stmt 2
print("=== POSITIVE CONTROL (detector must fire) ===")
for i, s in enumerate(stmts, 1):
    t = s["content"].lower()
    hits = [(a, r[1]) for a, r in ctrl.items() if re.search(r"\b" + re.escape(a) + r"\b", t)]
    print(f"stmt {i}: {hits if hits else 'NO DETECTIONS -> detector is broken'}")

# ---- Was the annotated entity extracted at ANY confidence (coverage vs gate question)? ----
print("\n=== raw (ungated) proposals mentioning financial crisis / 2008 ===")
found = [(p["name"], p.get("confidence"), p.get("quote","")[:70]) for p in props
         if re.search(r"financial crisis|\b2008\b", (p["name"] + " " + " ".join(p.get("aliases", [])) + " " + p.get("quote","")), re.I)]
print(found if found else "NONE at any confidence")

# ---- How many table aliases are multiword proper names vs generic? sanity on table quality ----
print(f"\ntable size: {len(alias_map)}")
print("sample org entries:", [a for a, r in list(alias_map.items()) if r[0] == 'org'][:8])
