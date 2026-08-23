import json, re, subprocess, random
DATA = r"C:\Users\jsnov\repos\ai-triad-data"
OUT = r"C:\Users\jsnov\repos\ai-triad-research\.worktrees\rat-degrade\research\comp-linguist\analyses\rationale-degradation\labelled_sample.json"

def edges_at(ref):
    return json.loads(subprocess.run(["git","-C",DATA,"show",f"{ref}:taxonomy/Origin/edges.json"],
                                     capture_output=True,text=True).stdout)["edges"]
def rat(e):
    r=e.get("rationale"); return r if isinstance(r,str) and r.strip() else None
def key(e): return (e.get("source"),e.get("target"),e.get("type"))
_ID=re.compile(r"\b(?:acc|saf|skp|cc|sit|pol)-[a-z]+-\d+\b",re.I)

src=edges_at("ba3128f5")
rats=[(key(e),rat(e)) for e in src if rat(e)]
# deterministic pick: sort by key, take a spread of 25 diverse real rationales (some with referents, some without)
rats.sort(key=lambda kr: "|".join(kr[0]))
with_ref=[kr for kr in rats if _ID.search(kr[1])]
without_ref=[kr for kr in rats if not _ID.search(kr[1])]
picks = with_ref[:8] + without_ref[:17]   # 25 real, CL-labelled clean

sample=[]
for k,r in picks:
    sample.append({"label":"clean","provenance":"observed","source_key":"|".join(k),
                   "text":r,"note":"real ba3128f5 rationale, CL-labelled substantive"})

# the 3 real non-empty->non-empty revisions (all ENrichments) — must stay CLEAN under diff mode
older={key(e):rat(e) for e in edges_at("3673d3ee") if rat(e)}
enrich=[(k,older[k],r) for k,r in rats if k in older and older[k]!=r]
for k,o,n in enrich:
    sample.append({"label":"clean","provenance":"observed","source_key":"|".join(k),
                   "old":o,"new":n,"note":"real revision (enrichment: new ~2x longer) — must NOT flag as degradation"})

# CONSTRUCTED degraded cases (FIRE arm) — degrade a handful of the real ones, label constructed
base = picks[0][1]  # a real substantive rationale w/ referent
ref_pick = with_ref[1][1]
sample += [
 {"label":"degraded","provenance":"constructed","old":base,"new":"Related.","note":"total collapse to a stub"},
 {"label":"degraded","provenance":"constructed","old":ref_pick,"new":"This edge supports the target.","note":"generic shell, referent lost"},
 {"label":"degraded","provenance":"constructed","old":base,"new":base[:38],"note":"truncated fragment (<40 chars)"},
 {"label":"degraded","provenance":"constructed","old":ref_pick,"new":re.sub(_ID,'the node',ref_pick)[:55],"note":"referent-stripped + truncated"},
 {"label":"degraded","provenance":"constructed","text":"Cross-category link.","note":"standalone boilerplate shell"},
 {"label":"degraded","provenance":"constructed","text":"Supports.","note":"standalone one-word stub"},
 # CLEAN constructed controls (must NOT flag):
 # (1) a genuine SAME-SCALE paraphrase — reworded, comparable length + content words, no collapse.
 {"label":"clean","provenance":"constructed",
  "old":"The source node's belief that observable, falsifiable metrics are the only reliable basis for judgment directly grounds the intention to build empirical safety evaluations for advanced systems.",
  "new":"Because the source treats measurable, testable indicators as the sole trustworthy basis for judgement, it directly motivates constructing rigorous empirical safety evaluations for advanced AI systems.",
  "note":"legitimate same-scale paraphrase (reworded, comparable length + content) — must NOT flag"},
 # (2) a legitimately concise-but-substantive rationale that simply carries no node-id referent.
 {"label":"clean","provenance":"constructed",
  "new":"The belief in unbounded compute-driven scaling directly underwrites the desire for transformative, abundance-creating artificial intelligence.",
  "note":"substantive, referent-free, above the short floor — must NOT flag"},
]

json.dump(sample, open(OUT,"w",encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
print("wrote",len(sample),"rows ->",OUT)
print("labels:",dict(Counter(r["label"] for r in sample)),
      "provenance:",dict(Counter(r["provenance"] for r in sample)))
