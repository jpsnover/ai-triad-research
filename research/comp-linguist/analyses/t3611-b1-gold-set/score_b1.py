import json, os, math
SP = r"C:\Users\jsnov\AppData\Local\Temp\claude\C--Users-jsnov-repos-ai-triad-research-research-comp-linguist\01a0a9ce-3623-70e6-aaa4-77fcf8bac0d4\scratchpad"

def load(name):
    d = json.load(open(os.path.join(SP, name), encoding='utf-8'))
    if isinstance(d, dict) and 'items' in d: d = d['items']
    return {r['sample_id']: r for r in d}

A = load('annotator-A-labels.json')
B = load('annotator-B-labels.json')
ids = sorted(set(A) & set(B))
print(f"items scored: {len(ids)} (A={len(A)}, B={len(B)})")

def stats(cls):
    # exclude items either annotator marked uncodeable for this pass
    use = [i for i in ids if not A[i].get('uncodeable') and not B[i].get('uncodeable')]
    a = [int(A[i].get(cls, 0)) for i in use]
    b = [int(B[i].get(cls, 0)) for i in use]
    n = len(use)
    posA, posB = sum(a), sum(b)
    agree = sum(1 for x, y in zip(a, b) if x == y)
    po = agree / n if n else 0
    # both marginals for kappa
    pa1 = posA / n; pb1 = posB / n
    pe = pa1 * pb1 + (1 - pa1) * (1 - pb1)
    kappa = (po - pe) / (1 - pe) if pe != 1 else float('nan')
    pabak = 2 * po - 1
    # both-positive count
    both_pos = sum(1 for x, y in zip(a, b) if x == 1 and y == 1)
    degenerate = (posA == 0 and posB == 0)
    disagreements = [i for i in use if int(A[i].get(cls, 0)) != int(B[i].get(cls, 0))]
    print(f"\n=== {cls} ===  (N={n}; {len(ids)-n} excluded uncodeable)")
    print(f"  positives: A={posA} ({100*pa1:.1f}%)  B={posB} ({100*pb1:.1f}%)  both=1: {both_pos}")
    print(f"  observed agreement Po = {po:.3f} on N={n}")
    print(f"  Cohen kappa = {kappa:.3f}   PABAK = {pabak:.3f}   (each on N={n})")
    print(f"  DEGENERATE (both all-negative)? {'YES - not a reliability pass' if degenerate else 'no'}")
    print(f"  disagreements: {len(disagreements)}  -> B1.5 adjudication set")
    # sizing: min positives seen; target 20/30
    minpos = min(posA, posB)
    print(f"  sizing: min positives observed = {minpos}; to reach 20/30 at rate {min(pa1,pb1):.3f} "
          f"need ~{('inf' if min(pa1,pb1)==0 else int(math.ceil(20/max(1e-9,min(pa1,pb1)))))}/"
          f"{('inf' if min(pa1,pb1)==0 else int(math.ceil(30/max(1e-9,min(pa1,pb1)))))} items")
    return {'cls': cls, 'n': n, 'posA': posA, 'posB': posB, 'Po': po, 'kappa': kappa,
            'pabak': pabak, 'degenerate': degenerate, 'disagreements': disagreements}

res = [stats('concession'), stats('retained_hold')]
# dump disagreement set for adjudication
dis = {r['cls']: r['disagreements'] for r in res}
json.dump(dis, open(os.path.join(SP, 'b1-disagreements.json'), 'w'), indent=1)
print(f"\nwrote disagreement set -> b1-disagreements.json")
print("\nREMINDER: these are LLM-applicability/consistency numbers, NOT human reliability. B1.5 (human adjudication) is the reliability ground.")
