import json, os, math, collections
SP = r"C:\Users\jsnov\AppData\Local\Temp\claude\C--Users-jsnov-repos-ai-triad-research-research-comp-linguist\01a0a9ce-3623-70e6-aaa4-77fcf8bac0d4\scratchpad"
STATES = ('core', 'adjacent', 'drifted')

def load(name):
    d = json.load(open(os.path.join(SP, name), encoding='utf-8'))
    if isinstance(d, dict) and 'items' in d: d = d['items']
    return {r['sample_id']: r for r in d}

A = load('drift-annotator-A.json')
B = load('drift-annotator-B.json')
items = {i['sample_id']: i for i in json.load(open(os.path.join(SP, 'drift-annotation-items.json'), encoding='utf-8'))['items']}
sig = json.load(open(os.path.join(SP, 'drift-signals.json'), encoding='utf-8'))['signals']
ids = sorted(set(A) & set(B))
print(f"scored: {len(ids)} (A={len(A)}, B={len(B)})")

# exclude items either marked uncodeable
use = [i for i in ids if not A[i].get('uncodeable') and not B[i].get('uncodeable')]
n = len(use)
la = [A[i]['topical_state'] for i in use]
lb = [B[i]['topical_state'] for i in use]

# distributions
print("A dist:", dict(collections.Counter(la)), "| B dist:", dict(collections.Counter(lb)), f"| N={n} ({len(ids)-n} uncodeable-excluded)")

# observed agreement + Cohen kappa (3-class)
agree = sum(1 for x, y in zip(la, lb) if x == y)
po = agree / n
pa = collections.Counter(la); pb = collections.Counter(lb)
pe = sum((pa[s]/n) * (pb[s]/n) for s in STATES)
kappa = (po - pe) / (1 - pe) if pe != 1 else float('nan')
print(f"\n3-class: observed agreement Po = {po:.3f} on N={n}")
print(f"3-class Cohen kappa = {kappa:.3f}   (chance pe={pe:.3f})")

# per-state one-vs-rest agreement (for skew)
print("per-state one-vs-rest agreement (Po_s):")
for s in STATES:
    xs = [1 if x == s else 0 for x in la]; ys = [1 if y == s else 0 for y in lb]
    ps = sum(1 for a, b in zip(xs, ys) if a == b) / n
    print(f"  {s}: {ps:.3f}  (A={sum(xs)}, B={sum(ys)})")

# non-degenerate check
deg = (len(set(la)) == 1) or (len(set(lb)) == 1)
print(f"non-degenerate (neither annotator all-one-state): {'FAIL' if deg else 'pass'}")

# confusion
print("\nconfusion (rows=A, cols=B):")
conf = collections.Counter((x, y) for x, y in zip(la, lb))
print("        " + "  ".join(f"{s:>8}" for s in STATES))
for a in STATES:
    print(f"{a:>8} " + "  ".join(f"{conf.get((a,b),0):>8}" for b in STATES))

# validity DIAGNOSTIC: do LLM labels track the cosine-based stratum? (NOT the human validation)
print("\n[diagnostic] LLM label vs cosine stratum (A):")
strat_label = collections.Counter((sig[i]['stratum'], A[i]['topical_state']) for i in use if i in sig)
for st in ('deepening_candidate', 'drift_candidate', 'core_control'):
    row = {s: strat_label.get((st, s), 0) for s in STATES}
    print(f"  {st:>20}: {row}")

# disagreement set -> B1.5-style human adjudication package
dis = [i for i in ids if not A[i].get('uncodeable') and not B[i].get('uncodeable') and A[i]['topical_state'] != B[i]['topical_state']]
pkg = []
for i in dis:
    it = items.get(i, {})
    pkg.append({'sample_id': i, 'round': it.get('round'), 'target_speaker': it.get('target_speaker'),
                'annotator_A': {'state': A[i]['topical_state'], 'note': A[i].get('note', '')},
                'annotator_B': {'state': B[i]['topical_state'], 'note': B[i].get('note', '')},
                'seeded_question': it.get('seeded_question', ''), 'active_cruxes': it.get('active_cruxes', []),
                'context_prior_turns': it.get('context_prior_turns', []), 'target_text': it.get('target_text', ''),
                'GOLD_topical_state': None, 'adjudicator_note': ''})
# spot-check sample of agreements (every 8th) for shared-LLM-bias probe
agr = [i for i in use if A[i]['topical_state'] == B[i]['topical_state']]
spot = [{'sample_id': i, 'both_agree': A[i]['topical_state'], 'seeded_question': items[i].get('seeded_question',''),
         'active_cruxes': items[i].get('active_cruxes',[]), 'target_text': items[i].get('target_text',''),
         'GOLD_topical_state': None, 'adjudicator_note': ''} for i in agr[::8]]
out = {'purpose': 'B1.5-style human adjudication for the drift-state study (t/3630). Adjudicate disagreements; spot-check agreements for shared-LLM bias.',
       'n_disagreements': len(pkg), 'n_spotcheck': len(spot),
       'caveat': 'LLM-applicability only. High inter-LLM agreement does not rule out correlated error; human sets GOLD_topical_state per the frozen codebook (core/adjacent/drifted; deepening-into-a-crux=adjacent).',
       'disagreements': pkg, 'agreement_spotcheck': spot}
json.dump(out, open(os.path.join(SP, 'drift-b15-package.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"\ndisagreements: {len(pkg)} | spot-check agreements: {len(spot)} -> drift-b15-package.json")
print("REMINDER: LLM-applicability/consistency, NOT human reliability. B1.5 (human) is the reliability ground; thresholds tune against GOLD.")
