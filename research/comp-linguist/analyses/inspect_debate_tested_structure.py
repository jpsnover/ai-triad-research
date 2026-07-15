"""Inspect debate_tested field structure for one node per tier."""
import json, pathlib

DATA_ROOT = pathlib.Path("C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin")
POV_FILES = ["accelerationist.json", "safetyist.json", "skeptic.json"]

samples = {t: None for t in ("untested", "cited", "contested", "well_tested")}

for fname in POV_FILES:
    data = json.loads((DATA_ROOT / fname).read_text(encoding="utf-8"))
    for node in data["nodes"]:
        if node.get("category") != "Beliefs":
            continue
        dt = (node.get("graph_attributes") or {}).get("debate_tested")
        tier = dt["tier"] if dt else "untested"
        if samples[tier] is None:
            samples[tier] = (node, dt)
    if all(v is not None for v in samples.values()):
        break

for tier, pair in samples.items():
    if pair is None:
        print(f"\n=== {tier} === NOT FOUND")
        continue
    node, dt = pair
    print(f"\n=== {tier} === ({node['id']})")
    print(f"  label: {node.get('label','')[:60]}")
    if dt:
        print(f"  tier={dt['tier']}, sort_key={dt.get('sort_key')}")
        print(f"  engagements={dt.get('engagements')}, challenges={dt.get('challenges')}")
        records = dt.get("record", [])
        print(f"  record count: {len(records)}")
        if records:
            print(f"  record[0] keys: {list(records[0].keys())}")
            print(f"  record[0] sample: {json.dumps(records[0], indent=4)[:400]}")
    else:
        print(f"  debate_refs count: {len(node.get('debate_refs', []))}")
