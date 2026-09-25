# Drift-state validation study: codebook + sampling frame (t/3630)

**Author:** Computational Linguist
**Status:** sampling frame + codebook landed (this milestone). Execution, two-blind annotation, per-state reliability, threshold tuning, is the next phase; the reliability estimate and tuning are **human-gated** (AC 2 needs a human annotator; AC 3 tunes against human labels). **Gates nothing until reliability-established.**
**Origin:** the surviving human-validation deliverable from t/3602 (which resolved the design + empirically confirmed the crux dimension via the deepening-cell check). Reuses the t/3611 validation machinery.

## What this validates

The drift-state estimator (t/3602 `design.md`) classifies each debate turn `core | adjacent | drifted` from three cosines: `s_seed` (turn vs `topic.scope.core_proposition`), `s_clause` (nearest topic clause), `s_crux` (max over active cruxes). This study establishes **human reliability** for those labels and **tunes the band thresholds**, until then the estimator is stipulated and gates nothing.

## Sampling frame (built)

`build_drift_sample.py` + `drift-annotation-manifest.json` (references only) + `drift-signals.json` (per-turn cosines, the tuning input; **annotators never see this**).

- **1,569 turns scored** across 148 debates (those carrying both `turn_embeddings` + `crux_tracker`). Signals recomputed via the deepening-cell path (embed seed + crux text through `embed_taxonomy.py`, cosine vs persisted turn vectors).
- **Stratified to force the discriminating comparison** (not a random draw, which the deepening-cell run showed is ~67% low-seed and would starve the contrast). Three cells, 40 each = **120 turns**:
  - `deepening_candidate`, low `s_seed` (<0.50) AND high `s_crux` (>=0.50): the cell the crux dimension must rescue from a false "drift" flag (pop. 718).
  - `drift_candidate`, low `s_seed` AND low `s_crux`: genuine-drift candidate (pop. 330).
  - `core_control`, high `s_seed`: on-topic control (pop. 521).
- Deterministic (sha256(debate|turn) sort + stride per stratum; no RNG). This is a **reliability sample, not a representative eval corpus** (the t/3587 stratification lesson), the cell sizes are engineered, so the observed state *rates* are not corpus prevalence.

## Codebook (frozen for the pass)

Annotators judge the **topical relationship** of the target turn to the debate's seeded question and its active cruxes. They see the turn, its prior-turn context, the debate's `core_proposition`, and the list of active crux descriptions. **They do NOT see `s_seed`/`s_crux` or any cosine**, do not smuggle the estimator's own signal into the human label (t/3587 discipline).

- **`core`**, the turn engages the **seeded question directly** (advances/attacks the core proposition or one of its clauses head-on).
- **`adjacent`**, the turn does not address the seed head-on but engages an **active contested crux** of the debate: a legitimate deepening into a sub-question the debate turns on. **Load-bearing rule: deepening into an active crux is `adjacent`, never `drifted`.**
- **`drifted`**, the turn is off the seeded question AND not on any active crux: a genuine topic departure (tangent, procedural, a different dispute).
- Uncodeable (turn too fragmentary/meta to judge) → flag, excluded, logged.

Anti-patterns (carried from t/3587): judge the move's topical relationship, not keyword overlap; do not infer the label from how "on-topic it sounds"; a turn can be substantive and still `drifted` if it left the seeded axis and the cruxes.

## Protocol (next phase)

Per the reusable operator manual (`validation-study-operator-manual.md` / t/3611 pattern):
1. **Two blind annotators**, independent, from the frozen codebook + the rehydrated worksheet (turn + context + core_proposition + active cruxes), no cosines, no hypothesis.
2. **Applicability/consistency pass**, per-state rate + agreement. If LLM annotators are used here, it is **LLM-applicability, not reliability**; correlated LLM error is not ruled out.
3. **Reliability (AC 2), requires >=1 human annotator.** Per-state agreement (Fleiss/Cohen κ if balanced; per-state one-vs-rest agreement + bootstrap CI if skewed), **each statistic carrying its N**; non-degenerate check (exclude all-one-state). Human is the reliability ground.
4. **Threshold tuning (AC 3)**, with human gold labels, tune `tau_core`/`tau_adj`/`tau_drift` on a train split from `drift-signals.json`; report the confusion matrix on held-out for the 3-band estimator **vs a TUNED ArCo-binary baseline** (per the t/3602 finding: the baseline must use a tuned seed cutoff, not 0.5, so the comparison isolates the crux dimension's contribution).
5. **Provenance**, `topical_state`/`topical_drift_score` move **stipulated → human-validated** (with N) in `metric-provenance-register.md`; gates nothing until then.

## Dependencies (why this milestone is frame + codebook, not done)

- **Second independent blind annotator** for the applicability pass (a peer CL instance or a blind sub-agent, clearly labeled LLM-applicability).
- **Human annotator (AC 2)**, the reliability ground; the study cannot produce a trustworthy reliability claim or tune thresholds without it. Surface to the PI once the applicability pass produces the disagreement set. This milestone delivers AC 1 (frame + codebook); AC 2–5 are the execution phase.

## Human-adjudication tooling (turnkey; t/3630)

The 19-item human step (4 LLM disagreements + 15 agreed-`core` spot-checks) is one-command turnkey, mirroring the t/3611 machinery:
1. `python make_drift_worksheet.py` -> `drift-worksheet.md` (readable: seeded question + active cruxes + prior context + target turn + codebook) and blank `drift-answers.csv`.
2. Human reads the worksheet, sets `GOLD_topical_state` (core|adjacent|drifted) per row in `drift-answers.csv`.
3. `python import_drift_answers.py --run` -> validates the 3-class label, writes GOLD into the package, and runs `finalize_drift.py`.

`finalize_drift.py` auto-resolves the pivotal verdict from the applicability finding (drift ~ 0 on the LLM pass): branch **(a)** if the human confirms ~0 drift (estimator premise fails; AC3 tuning moot), branch **(b)** if the human overturns agreed-`core` turns to drifted/adjacent (LLM core-bias; LLM-applicability does not transfer to human reliability; a fuller 120-item human label set is needed before reliability/tuning). Every reported statistic carries its N. The worksheet/answers/gold files are local-only (not committed), like the t/3611 gold set.
