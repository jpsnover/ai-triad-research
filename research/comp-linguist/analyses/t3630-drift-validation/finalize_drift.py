#!/usr/bin/env python3
"""Finalize the B1.5 drift-state adjudication (t/3630): assemble human GOLD, compute
LLM-vs-human agreement (statistic-provenance: every stat carries its N), and AUTO-RESOLVE
the pivotal (a)-vs-(b) verdict:
  (a) human confirms drift ~ 0  -> the estimator's premise fails; cosine over-flags.
  (b) human overturns agreed-`core` to drifted/adjacent -> LLM annotation has a core-bias;
      LLM-applicability does NOT transfer to human reliability; fuller human labeling needed.

Threshold tuning (AC 3) is intentionally NOT run here: it is moot under (a) and, under (b),
needs a fuller human-labeled set than the 19-item adjudication package. This finalizer states
which branch holds and what that implies. Writes drift-gold-verdict.md + drift-gold.json (LOCAL).

Usage: python finalize_drift.py
"""
import json, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
STATES = ('core', 'adjacent', 'drifted')
pkg = json.load(open(os.path.join(HERE, 'drift-b15-package.json'), encoding='utf-8'))
dis, spot = pkg['disagreements'], pkg['agreement_spotcheck']

def gold(it):
    g = it.get('GOLD_topical_state')
    return g.strip().lower() if isinstance(g, str) and g.strip() else None

unresolved = [it['sample_id'] for it in dis + spot if gold(it) not in STATES]
if unresolved:
    raise SystemExit(f"{len(unresolved)} items still lack a valid GOLD_topical_state: {unresolved}\n"
                     "Fill drift-answers.csv and run import_drift_answers.py first.")

N_dis, N_spot, N = len(dis), len(spot), len(dis) + len(spot)

# --- LLM-vs-human agreement, with N (statistic provenance) ---
# disagreements: exactly one LLM can match (A != B by construction); count which side human backs.
a_hits = sum(1 for it in dis if it['annotator_A']['state'] == gold(it))
b_hits = sum(1 for it in dis if it['annotator_B']['state'] == gold(it))
neither = sum(1 for it in dis if gold(it) not in (it['annotator_A']['state'], it['annotator_B']['state']))
# spot-checks: both LLMs agreed (both_agree); human confirms or overturns.
spot_confirm = sum(1 for it in spot if gold(it) == it['both_agree'])
spot_overturn = N_spot - spot_confirm
# full 19-item consensus-vs-human where a consensus exists (spot-checks + any dis, but dis has no consensus):
# report A and B each vs GOLD across all 19 (dis: their own call; spot: both_agree for both).
def llm_call(it, side):
    return it['annotator_A']['state'] if 'annotator_A' in it else it['both_agree'] if side == 'A' else it['both_agree']
a_all = sum(1 for it in dis if it['annotator_A']['state'] == gold(it)) + spot_confirm
b_all = sum(1 for it in dis if it['annotator_B']['state'] == gold(it)) + spot_confirm

# --- GOLD distribution (the sample is drift-OVERSAMPLED by strata design) ---
gdist = collections.Counter(gold(it) for it in dis + spot)
n_drifted = gdist['drifted']; n_adjacent = gdist['adjacent']; n_core = gdist['core']
n_noncore = n_drifted + n_adjacent

# --- verdict ---
# spot-checks were all agreed-`core`; overturns to drifted/adjacent are the core-bias signal.
spot_overturn_noncore = sum(1 for it in spot if gold(it) in ('adjacent', 'drifted'))
if n_drifted == 0 and spot_overturn_noncore == 0:
    branch = "(a) DRIFT ~ 0 CONFIRMED"
    implication = ("Even on a drift-OVERSAMPLED sample the human found zero `drifted` turns and confirmed the "
                   "agreed-`core` spot-checks. The estimator's premise (a measurable `drifted` population) is not "
                   "supported. RECOMMEND: reconsider whether the drift-state estimator (t/3602/t/3603) addresses a "
                   "real phenomenon before investing in thresholds; nothing to validate/tune, so provenance stays "
                   "stipulated. Close AC2-reliability as 'no drift class to be reliable about'; AC3 tuning moot.")
elif spot_overturn_noncore >= 2 or (n_drifted > 0 and b_all < N * 0.6 and a_all < N * 0.6):
    branch = "(b) LLM CORE-BIAS INDICATED"
    implication = ("The human overturned agreed-`core` turns to adjacent/drifted, so the LLM pass under-detects "
                   "departure from topic (core-bias). LLM-applicability does NOT transfer to human reliability here. "
                   "RECOMMEND: do NOT tune thresholds on LLM labels; commission a fuller human-labeled set (the full "
                   "120-item stratified sample, not just the 19-item adjudication package) before AC2-reliability and "
                   "AC3 tuning. Report LLM annotation as invalid for this construct.")
else:
    branch = "(mixed) INCONCLUSIVE"
    implication = ("Some non-core GOLD present but below the core-bias bar. RECOMMEND: expand the human-labeled set "
                   "before drawing a reliability conclusion; treat the 19-item result as directional only.")

L = []
L.append("# Drift-state B1.5 adjudication - finalized verdict (t/3630)\n")
L.append(f"**Adjudicated N = {N}** ({N_dis} LLM disagreements + {N_spot} agreed-`core` spot-checks). "
         "Statistic provenance: every figure below carries its N; this is the *adjudicated subset*, not the full 120-item sample.\n")
L.append("## Human GOLD distribution (sample is drift-oversampled by design)\n")
L.append(f"- core: {n_core}/{N}\n- adjacent: {n_adjacent}/{N}\n- drifted: {n_drifted}/{N}\n- non-core total: {n_noncore}/{N}\n")
L.append("## LLM-vs-human agreement (statistic provenance: N attached)\n")
L.append(f"- On the {N_dis} disagreements: A matched GOLD {a_hits}/{N_dis}, B matched {b_hits}/{N_dis}, neither {neither}/{N_dis}.\n")
L.append(f"- On the {N_spot} agreed-`core` spot-checks: human confirmed {spot_confirm}/{N_spot}, overturned {spot_overturn}/{N_spot} "
         f"(of which {spot_overturn_noncore}/{N_spot} to adjacent/drifted - the core-bias signal).\n")
L.append(f"- Across all {N}: annotator A vs GOLD = {a_all}/{N} ({a_all/N:.1%}); annotator B vs GOLD = {b_all}/{N} ({b_all/N:.1%}).\n")
L.append("## Verdict\n")
L.append(f"### {branch}\n\n{implication}\n")
L.append("\n## Discipline notes\n")
L.append("- LLM-applicability != human reliability: high inter-LLM agreement (measured in the applicability pass) does "
         "not rule out correlated LLM error; that is exactly what these spot-check overturns test.\n")
L.append("- Threshold tuning (AC3) is deliberately not computed here (moot under (a); underpowered on 19 items under (b)).\n")
open(os.path.join(HERE, 'drift-gold-verdict.md'), 'w', encoding='utf-8').write("".join(L))

json.dump({'N': N, 'n_disagreements': N_dis, 'n_spotcheck': N_spot,
           'gold_distribution': dict(gdist),
           'llm_vs_gold': {'A_all': a_all, 'B_all': b_all, 'N': N,
                           'A_on_disagreements': a_hits, 'B_on_disagreements': b_hits,
                           'spot_confirm': spot_confirm, 'spot_overturn': spot_overturn,
                           'spot_overturn_to_noncore': spot_overturn_noncore},
           'branch': branch, 'implication': implication,
           'items': [{'sample_id': it['sample_id'], 'GOLD': gold(it),
                      'A': it.get('annotator_A', {}).get('state'), 'B': it.get('annotator_B', {}).get('state'),
                      'both_agree': it.get('both_agree')} for it in dis + spot]},
          open(os.path.join(HERE, 'drift-gold.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"N={N} | GOLD {dict(gdist)} | A {a_all}/{N} B {b_all}/{N} | branch: {branch}")
print("wrote drift-gold-verdict.md + drift-gold.json")
