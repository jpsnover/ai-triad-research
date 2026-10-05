#!/usr/bin/env python3
"""t/3883: score the class-A stance tests against labeled-stance-set.json. Reports COUNTS, not just
rates, and labels the result as in-sample single-annotator agreement (see the set's warnings).

  python eval_stance.py   # uses AI_TRIAD_DATA_ROOT (default ../ai-triad-data) for label/description
"""
import json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scan_lf_defects import stance_verdict, _node_text

ls = json.load(open(os.path.join(HERE, "labeled-stance-set.json"), encoding="utf-8"))
text = _node_text()
rows = []
for it in ls["items"]:
    label, desc = text.get(it["node"], ("", ""))
    leak, why = stance_verdict(it["predicate"], label, desc)
    rows.append((it, leak, why))

def score(name, pred_fn):
    tp = sum(1 for it, *_ in rows if pred_fn(it) and it["label"] == "leak")
    fp = sum(1 for it, *_ in rows if pred_fn(it) and it["label"] != "leak")
    fn = sum(1 for it, *_ in rows if not pred_fn(it) and it["label"] == "leak")
    tn = sum(1 for it, *_ in rows if not pred_fn(it) and it["label"] != "leak")
    print(f"  {name:28} flags={tp + fp:2}  TP={tp} FP={fp} FN={fn} TN={tn}")
    return tp, fp, fn

npos = sum(1 for it, *_ in rows if it["label"] == "leak")
print(f"labeled items: {len(rows)}  (leak={npos}, content={len(rows) - npos}); annotators={ls['annotators']}; "
      f"second annotator: {ls['second_annotator'].split(':')[0]}")
score("lexeme (old scanner)", lambda it: True)
verdict = {(it["node"], it["predicate"]): leak for it, leak, _ in rows}
score("role-based (new scanner)", lambda it: verdict[(it["node"], it["predicate"])])
print("\nper item (label -> role-based verdict):")
for it, leak, why in rows:
    mark = "OK " if (leak == (it["label"] == "leak")) else "XX "
    print(f"  {mark}{it['node']:20} {it['predicate']:10} label={it['label']:7} verdict={'leak' if leak else 'content':7} ({why})  conf={it['confidence']}")
print(f"\nIN-SAMPLE, single annotator, {npos} positive(s): this is agreement on the design set, not a validated "
      "precision/recall. With this few positives no rate is estimable; read the counts.")
