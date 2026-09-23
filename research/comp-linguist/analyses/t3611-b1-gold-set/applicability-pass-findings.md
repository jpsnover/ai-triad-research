# B1 applicability pass: results (t/3611)

**Author:** Computational Linguist
**Phase:** manual section 3 (applicability / rate pass). **This is NOT the reliability result** (that is B1.5, section 6, and requires a human). Reproduce agreement with `score_b1.py` over the two label files here.

## Method

Two **independent blind** LLM annotators (fresh general-purpose instances, identical frozen codebook from `design.md` section 2, no hypothesis, no expected rates, no sight of each other) labeled all **150** turns of `b1-sample-manifest.json`, each with the target turn + up to 2 prior pov turns as context. Raw labels: `applicability-annotator-A.json`, `applicability-annotator-B.json`. Zero items marked uncodeable by either annotator.

## Results

| Class | A pos | B pos | Observed agreement Po | Cohen kappa | PABAK | Disagreements |
|---|---|---|---|---|---|---|
| `concession` | 85 (56.7%) | 80 (53.3%) | 0.913 | **0.825** | 0.827 | 13 |
| `retained_hold` | 118 (78.7%) | 130 (86.7%) | 0.920 | **0.724** | 0.840 | 12 |

All on **N=150**. Neither class is degenerate (both far from all-negative; kappa well above 0). For `retained_hold` the class is prevalence-skewed positive, so **kappa (0.724) is depressed by the base rate; PABAK/agreement (0.840 / 0.920) is the fairer read** for a skewed class. For `concession` (near-balanced ~55%) kappa is the appropriate measure and is high.

## Interpretation (three things this is, and is not)

1. **It IS strong applicability + inter-annotator consistency.** The codebook applies cleanly (0 uncodeable) and two independent readers apply it consistently (kappa 0.72 to 0.83). The codebook is not ambiguous or unusable.

2. **It is NOT human reliability.** Both annotators are LLMs. Two LLM readers agreeing does not rule out **correlated error** (both wrong the same way from a shared prior). Per the t/3587 discipline: applicability is not reliability; **B1.5 human adjudication is required** before any reliability claim or threshold anchoring. These kappas are reported as **LLM-applicability/consistency**, not reliability.

3. **The high positive rates are STRATUM-INFLATED BY DESIGN, not a corpus base rate.** The sample deliberately oversamples round>=3 scaffold-dense turns (`design.md` section 3) precisely because concession/retained_hold concentrate there. Late-round adversarial turns *are* mostly defending prior positions against attacks, so ~80% retained_hold and ~55% concession in this stratum is plausible, not surprising. **Do not read these as prevalence** for the corpus; this is a reliability sample, not a representative eval corpus. The pilot's ~20% came from a differently-composed sample; the two are not comparable.

## Sizing (manual section 3)

The >=20 (30 preferred) positive-instance target per class is **met many times over** (concession min 80, retained_hold min 118 positives). **No need to grow the sample** for positives. This is the one place the high rate helps: the reliability study has abundant positives at N=150.

## B1.5 handoff (the human step)

`b1.5-adjudication-package.json`: **22 disagreement items** (union of the two classes' disagreements) with both annotators' labels + evidence + the turn text and prior context, plus **9 agreement spot-check items**. The human adjudicator:
- sets `GOLD_concession` / `GOLD_retained_hold` on every disagreement per the frozen codebook;
- confirms-or-corrects the 9 agreement spot-checks. **These specifically probe for shared-LLM over-labeling**: if the human overturns agreed positives, the high rate is partly codebook-looseness, not phenomenon, and the codebook needs a v2 before a real gold set.

## Provenance

- Class: this pass is **derived** (LLM-applicability). It anchors nothing.
- On B1.5 completion: `concession` and `retained_hold` move **stipulated -> human-validated**, each carrying its N, in `metric-provenance-register.md`. Until then, per t/3588 AC 6, B5's convergence_score stays **provisional and gates no threshold**.
