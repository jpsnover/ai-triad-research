import json, glob, os
from collections import Counter
DR = os.path.abspath('../ai-triad-data')
mode_has = Counter(); mode_no = Counter()
for fp in glob.glob(DR + '/summaries/*.json'):
    try: d = json.load(open(fp, encoding='utf-8'))
    except Exception: continue
    mode = (d.get('model_info') or {}).get('extraction_mode', 'MISSING')
    def walk(o):
        if isinstance(o, dict):
            nid = o.get('taxonomy_node_id')
            if isinstance(nid, str) and nid[:4] in ('acc-','saf-','skp-'):
                (mode_has if o.get('attribution_text') else mode_no)[mode] += 1
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)
print('extraction_mode | with_attr | without_attr')
for m in sorted(set(mode_has)|set(mode_no)):
    print(f'  {m:14s} {mode_has.get(m,0):6d}   {mode_no.get(m,0):6d}')
