#!/usr/bin/env python3
"""t/3962 step 2: draw the blind validation sample from the full proposal run.

60 nodes, stratified by PROPOSED label (so every label has >= 5 items, the t/3587 floor for reporting kappa) and,
inside each label, spread across categories. The 12 dry-run nodes are excluded: CL Main saw their proposals, so
annotating them would not be blind.

Writes:
  validation/sample-ids.json     the frozen sample with each node's proposal (the KEY; annotators must not read it)
  validation/annotate-<who>.json one blind sheet per annotator: id, category, label, description, empty "tags"

Annotators fill "tags" with [], ["critical"], ["institutional"] or ["critical", "institutional"], using
propose.prompt's rules, without opening sample-ids.json or the proposals file.
"""
import json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("AI_TRIAD_DATA_ROOT", r"C:\Users\jsnov\ai-triad-data-t3962")
SEED = 39620
QUOTA = {"critical": 18, "critical+institutional": 18, "institutional": 18, "untagged": 6}

props = json.load(open(os.path.join(HERE, "out", "pov-tag-proposals.full.json"), encoding="utf-8"))["proposals"]
seen = {p["node_id"] for p in json.load(open(os.path.join(HERE, "out", "pov-tag-proposals.sample.json"), encoding="utf-8"))["proposals"]}
nodes = {n["id"]: n for n in json.load(open(os.path.join(DATA, "taxonomy", "Origin", "skeptic.json"), encoding="utf-8"))["nodes"]}
label = lambda p: "+".join(sorted(p["proposed"])) or "untagged"

rnd = random.Random(SEED)
sample = []
for lab, k in QUOTA.items():
    pool = [p for p in props if label(p) == lab and p["node_id"] not in seen]
    by_cat = {}
    for p in pool: by_cat.setdefault(nodes[p["node_id"]]["category"], []).append(p)
    for c in by_cat.values(): rnd.shuffle(c)
    picked, cats = [], sorted(by_cat)
    while len(picked) < min(k, len(pool)):  # round-robin over categories so each label spans B/D/I
        for c in cats:
            if by_cat[c] and len(picked) < k: picked.append(by_cat[c].pop())
    sample += picked
rnd.shuffle(sample)

os.makedirs(os.path.join(HERE, "validation"), exist_ok=True)
json.dump({"ticket": "t/3962", "seed": SEED, "quota": QUOTA, "excluded_dry_run": sorted(seen),
           "sample": [{"node_id": p["node_id"], "proposed": p["proposed"], "crux": p["crux"]} for p in sample]},
          open(os.path.join(HERE, "validation", "sample-ids.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
sheet = [{"node_id": p["node_id"], "category": nodes[p["node_id"]]["category"], "label": nodes[p["node_id"]]["label"],
          "description": nodes[p["node_id"]]["description"], "tags": None} for p in sample]
for who in ("cl-main", "cl-investigate1"):
    json.dump({"ticket": "t/3962", "annotator": who,
               "instructions": "Fill tags with [], [\"critical\"], [\"institutional\"] or [\"critical\", \"institutional\"] per "
                               "analyses/t3962-tag-proposals/propose.prompt rules. Do NOT open sample-ids.json or out/.",
               "items": sheet}, open(os.path.join(HERE, "validation", f"annotate-{who}.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)
from collections import Counter
print(len(sample), "sampled;", Counter(label(p) for p in sample), Counter(nodes[p["node_id"]]["category"] for p in sample))
