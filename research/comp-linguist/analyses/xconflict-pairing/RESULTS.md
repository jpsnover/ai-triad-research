# Cross-conflict pairing — results (t/3339, Fork-B union lever)

Status as of 2026-09-05: **union measured, clears the bar; awaiting PI dual-verify of the 16 before the write.**

## Pipeline recap
Candidates (`candidates.json`, 1055 pairs) → PowerShell enrich classifier (`xconflict-predictions.json`)
→ blind precision golden (`build_golden_xc.py`) → CL census labels (`xconflict-golden-worksheet-labeled.md`)
→ topology-aware union measure (`measure_union.py`).

## 1. Precision golden — sampled gate FAILS; census rescues 16
Blind census (all 28 classifier-contradicts + 20 anchors, CL blind-labeled):
- **Full 28: precision 0.571 (16 TP / 12 FP), Wilson LB 0.391 → FAIL (<0.85).**
- Over-flagging concentrated in the **0.85-conf band**; the τ≥0.90 subset is 12/14 = 0.857 (underpowered: 14 positives can't reach LB 0.85).
- Recall OK: 0 contradicts among the 20 anchors.
- **Failure mode:** the classifier calls contradict on different-domain capability contrasts ("poor at common-sense" vs "good at scientific reasoning" @0.95 — worst error), remedy-vs-problem, same-event near-dups (Hegseth==DoD), and different-metric pairs. Surface/topical opposition, not logical contradiction.

**Finding (t/3341):** a same-doc-validated classifier does NOT generalize its precision to the cross-doc distribution — validate per distribution.

## 2. Census-verification (TL-permitted, t/3339#10)
Because there were only 28 to check, all were hand-labeled → **16 CL-verified-true contradicts across 12 distinct stance-conflicts**. Merging only these = zero false attacks by construction (stronger than a passing sampled LB). TL conditions: (1) PI dual-verifies the 16, merge only those; (2) measure the union on the ACTUAL verified set; (3) a measured miss → recalibrate the bar, don't extrapolate.

## 3. Union measure (`measure_union.py`) — PREVIEW on the full 16
Topology: each verified stance-conflict is single-instance/no-qbaf; a merge creates a NEW 2-node conflict (+1 conflict-with-attack, +2 adversarial nodes, +2 denominator). Same-doc adds within-conflict edges (no new nodes). Adversarial = has an incoming attack (symmetric contradiction → both endpoints).

| metric | baseline | +same-doc | +cross-conflict | bar |
|---|---|---|---|---|
| conflicts-with-attacks | 17 | 36 (×2.12) | **48 (×2.82)** | ≥2× ✓ |
| adversarial nodes | 35 (3.5%) | 96 (9.5%) | **120 / 1034 = 11.6%** | ≥10% ✓ |
| provenance split | — | — | **100% observed / 0% synthesized** | — |

- **Sanity check:** same-doc-only reconciles to the ratified 9.5% (t/3336#10) exactly.
- **Robustness:** conflicts bar already cleared by same-doc alone; cross-conflict only lifts nodes 9.5%→≥10%, needing just **≥3 of 12** surviving merges. Very robust to PI vetoes.

## Pending
PI dual-verify → re-run `measure_union.py --verified <confirmed-set>` → final union Δ + split → TL + PI → (if clears) PS 2-cycle DF-QuAD check → single corpus write. The 432-non-conflict-demotion ships as a SEPARATE diff.

## Files
- `xconflict-predictions.json` — PS enrich classifier output (1055 pairs).
- `build_golden_xc.py` — blind golden builder + Wilson-LB scorer.
- `xconflict-golden-worksheet-labeled.md` — the 48-pair census with CL blind labels.
- `fill_xc_verdicts.py` — CL label injector (provenance: single-annotator, judge-independent).
- `measure_union.py` — topology-aware union benefit measure.
