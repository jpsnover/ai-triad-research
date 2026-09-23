#!/usr/bin/env python3
"""Finalize the B1 gold set after B1.5 human adjudication (t/3611).

Runs in two modes automatically:
- **Pre-adjudication:** if `b1.5-adjudication-package.json` still has unfilled
  GOLD_* fields, it reports how many items await the human and exits 0 (safe to
  run any time; nothing to finalize yet).
- **Post-adjudication:** once every disagreement + spot-check item has GOLD_concession
  and GOLD_retained_hold set (0/1), it assembles the gold set, scores each LLM
  annotator against the human gold (validity), reports the spot-check overturn count
  (shared-LLM over-labeling signal), and prints a metric-provenance-register draft.

Gold rule per (item, class):
- item in the adjudication package (disagreement or spot-check) -> human GOLD_<class>.
- otherwise (A and B agreed, not spot-checked)                 -> the agreed value.

Reads siblings in this directory. Usage: python finalize_b1_gold.py
Writes: b1-gold-set.json, b1-reliability-report.json (only in post-adjudication mode).
"""
import json, os, sys, math

HERE = os.path.dirname(os.path.abspath(__file__))

def load(name):
    return json.load(open(os.path.join(HERE, name), encoding='utf-8'))

def as_map(labels):
    if isinstance(labels, dict) and 'items' in labels:
        labels = labels['items']
    return {r['sample_id']: r for r in labels}

A = as_map(load('applicability-annotator-A.json'))
B = as_map(load('applicability-annotator-B.json'))
pkg = load('b1.5-adjudication-package.json')
manifest = load('b1-sample-manifest.json')
all_ids = [r['sample_id'] for r in manifest['sample']]

CLASSES = ('concession', 'retained_hold')

# adjudicated items: union of disagreements + spot-check, keyed by sample_id
adj = {}
for r in pkg.get('disagreements', []) + pkg.get('agreement_spotcheck', []):
    adj[r['sample_id']] = r

# --- pre-adjudication guard -------------------------------------------------
pending = []
for sid, r in adj.items():
    for cls in CLASSES:
        if r.get(f'GOLD_{cls}') not in (0, 1):
            pending.append((sid, cls))
if pending:
    print(f"B1.5 NOT YET COMPLETE: {len(pending)} GOLD_* field(s) unfilled across {len(set(s for s,_ in pending))} item(s).")
    print("Fill GOLD_concession / GOLD_retained_hold (0 or 1) on every disagreement + spot-check in")
    print("  b1.5-adjudication-package.json, then re-run. Nothing finalized yet.")
    print("Sample of pending:", pending[:6])
    sys.exit(0)

# --- post-adjudication: assemble gold ---------------------------------------
def gold(sid, cls):
    if sid in adj:
        return int(adj[sid][f'GOLD_{cls}'])
    # not adjudicated -> A and B agreed by construction; use the agreed value
    return int(A[sid].get(cls, 0))

gold_set = {}
for sid in all_ids:
    gold_set[sid] = {cls: gold(sid, cls) for cls in CLASSES}
    gold_set[sid]['source'] = 'adjudicated' if sid in adj else 'agreement'

def kappa(x, y):
    n = len(x); po = sum(1 for a, b in zip(x, y) if a == b) / n
    p1x, p1y = sum(x)/n, sum(y)/n
    pe = p1x*p1y + (1-p1x)*(1-p1y)
    return (po - pe)/(1-pe) if pe != 1 else float('nan'), po

report = {'n': len(all_ids), 'classes': {}}
print(f"=== B1 gold set finalized (N={len(all_ids)}) ===")
for cls in CLASSES:
    g = [gold_set[s][cls] for s in all_ids]
    a = [int(A[s].get(cls, 0)) for s in all_ids]
    b = [int(B[s].get(cls, 0)) for s in all_ids]
    ka, poa = kappa(a, g)
    kb, pob = kappa(b, g)
    pos = sum(g)
    report['classes'][cls] = {
        'gold_positives': pos, 'gold_rate': round(pos/len(g), 3),
        'A_vs_gold': {'agreement': round(poa, 3), 'kappa': round(ka, 3)},
        'B_vs_gold': {'agreement': round(pob, 3), 'kappa': round(kb, 3)},
    }
    print(f"\n{cls}: gold positives {pos}/{len(g)} ({100*pos/len(g):.1f}%)")
    print(f"  A vs human gold: agreement {poa:.3f}, kappa {ka:.3f}  (N={len(g)})")
    print(f"  B vs human gold: agreement {pob:.3f}, kappa {kb:.3f}  (N={len(g)})")

# spot-check overturn: of the agreement spot-checks, how many did the human flip?
spot = pkg.get('agreement_spotcheck', [])
overturns = 0; spot_detail = []
for r in spot:
    sid = r['sample_id']
    agreed = r.get('both_agree', {})
    for cls in CLASSES:
        if agreed.get(cls) is not None and int(r[f'GOLD_{cls}']) != int(agreed[cls]):
            overturns += 1
            spot_detail.append({'sample_id': sid, 'class': cls, 'agreed': int(agreed[cls]), 'gold': int(r[f'GOLD_{cls}'])})
report['spotcheck'] = {'n_items': len(spot), 'overturns': overturns, 'detail': spot_detail}
print(f"\nspot-check overturns: {overturns} across {len(spot)} agreement items")
if overturns:
    print("  -> shared-LLM over-labeling detected; codebook likely needs a v2 before a real gold set:")
    for d in spot_detail: print("    ", d)
else:
    print("  -> no overturns: the LLM-agreed labels held up under human review.")

json.dump({'meta': {'ticket': 't/3611', 'n': len(all_ids)}, 'gold': gold_set}, open(os.path.join(HERE, 'b1-gold-set.json'), 'w'), indent=1)
json.dump(report, open(os.path.join(HERE, 'b1-reliability-report.json'), 'w'), indent=1)
print("\nwrote b1-gold-set.json + b1-reliability-report.json")

# --- register-entry draft ---------------------------------------------------
print("\n" + "="*70)
print("METRIC-PROVENANCE-REGISTER DRAFT (paste into metric-provenance-register.md):")
print("="*70)
for cls in CLASSES:
    c = report['classes'][cls]
    print(f"| `{cls}` (AIF move) | **human-validated** | Gold set t/3611: {c['gold_positives']} positives, "
          f"N={report['n']}, human-adjudicated (B1.5). LLM-annotator validity vs gold: "
          f"A kappa {c['A_vs_gold']['kappa']}, B kappa {c['B_vs_gold']['kappa']}. "
          f"Spot-check overturns: {report['spotcheck']['overturns']}/{report['spotcheck']['n_items']}. "
          f"Rate is stratum-inflated (round>=3 oversample), NOT a corpus base rate. |")
print("\nNOTE: if spot-check overturns > 0, mark provenance **stipulated-provisional** pending a codebook v2 + re-run, NOT human-validated.")
