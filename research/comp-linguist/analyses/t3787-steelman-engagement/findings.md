# Steelman-engagement: pre-fix baseline + metric pre-registration

**Owner:** Computational Linguist. **Context:** PI-requested revisit of the opening-statement
steelman-engagement hypothesis (p/548#237), worked jointly with TL (e/230, e/231).
**Date:** 2026-09-30. **Instrument:** `measure_steelman_engagement.py` (this dir).

## The hypothesis

A charitable restatement of an opponent's position, present in an opening statement, gives
later turns a shared referent and raises engagement quality. The PI observed, from one live
debate, "nothing connected to those statements."

## Why a measured baseline was needed

The observation "nothing connected" does not, on its own, discriminate the three explanations
(work incomplete / insufficient data / hypothesis wrong), because a wiring defect (t/3787)
misfiles steelman nodes so that "nothing connected" is the expected observation whether the
hypothesis is true or false. Rather than reason from one debate, this measures the actual
connection rate across the recent corpus.

## Method

- **Window:** 120 most-recent debates by mtime (`debates/debate-*.json`); 72 contain ≥1 steelman node.
- **Steelman node:** an `argument_network.nodes[]` entry with a truthy `steelman_of` (names the
  steelmanned camp); `speaker` is the author camp; `turn_number` orders turns.
- **Engagement (primary metric):** a *later-turn inbound edge* — an `argument_network.edges[]`
  entry with `target` = the steelman node and a `source` whose `turn_number` is strictly greater.
  This is the direct operationalisation of "a later turn connected to the steelman."
- **Decompositions:** edge `type` (supports/attacks); source camp relative to the steelman
  (steelmanned camp / author camp / third camp).

## Results (PRE-FIX — t/3787 misfiling bug live; this is the deliberate "before")

n = 129 steelman nodes across 72 debates.

| measure | value |
|---|---|
| later-turn inbound edges per steelman node | mean **0.51**, median 0, max 4 |
| connection rate (≥1 later inbound edge) | **40/129 = 31%** |
| distribution (edges→nodes) | {0: 89, 1: 20, 2: 15, 3: 4, 4: 1} |
| later inbound edge types | supports 29 / attacks 37 |
| source camp of later inbound edges | third camp **57**, author camp 6, steelmanned camp **3** |
| steelmanned-camp **adoption** rate of its own steelman | **3/66 = 5%** |

## Interpretation

1. **Confounded, not severed.** The circuit is not dead: 31% of steelmans draw a later-turn edge.
   The PI's "nothing connected" was one debate's draw, not the corpus norm. So "work incomplete"
   (t/3787) is the leading explanation, but its effect is *distortion*, not *total severance*.
2. **The specific distortion.** Engagement is overwhelmingly by the **third camp** (57/66), almost
   never by the **steelmanned camp adopting its own charitably-stated position** (3/66 = 5%). That
   5% is the deficit the hypothesis is really about — the "shared referent for your own side" uptake.
   Under the t/3787 bug the steelman is surfaced to the steelmanned camp as an *opponent claim to
   attack* (author-camp keyed), which is exactly why adoption is near-zero.
3. **The `supports 29 / attacks 37` split** is consistent with steelmans being treated as ordinary
   opponent claims (attacked more than built upon), not as shared referents.

## Pre-registration (for the post-t/3787 re-run)

- **Primary metric:** later-turn inbound-edge **connection rate** into steelman nodes.
  Baseline = **31%** (95% CI ≈ 23–40%, n=129, Wilson). Report with n (statistic-provenance, t/3587).
- **Key secondary (the hypothesis's real target):** **steelmanned-camp adoption rate** — fraction of
  later inbound edges (or of steelman nodes) where the *steelmanned* camp engages its own steelman.
  Baseline = **5%** (3/66). This is the number t/3787 should move most.
- **Supporting (debate-level, confounded — exploratory only):** `crux_addressed_ratio` (neutral-
  evaluator LLM output, not AN-derived), compared steelman-present vs -absent. NOT confirmatory.
- **Do NOT use `qbaf_agreement_density`** as a steelman metric: it keys on `sourceNode.speaker` and
  miscounts steelman edges' cross-POV status (camp-misclassified pre-fix). Metric-integrity follow-up
  filed separately.
- **Non-degenerate guard (t/3587):** the adoption metric must distinguish "raters/camps constant"
  from "engaged" — a 0% and a 100% both need the n and the per-camp decomposition, not a bare rate.
- **Sample size:** the "does it connect at all" question is already answered (31% ≠ 0). The live
  question is whether t/3787 *raises the adoption rate* from 5%. Detecting 5% → ~25% at 80% power,
  α=.05 (two-proportion) needs ≈ 55 steelman nodes per arm ≈ **35–45 post-fix debates**. Stage it:
  a **10-debate pilot** to confirm direction + re-estimate variance, then scale to the powered n.
  Read as a distribution across debates, never a single draw (replication-gate R-1 spirit).

## Caveats

- Edges are LLM-extracted (argument-network extraction); edge recall is imperfect and is itself a
  shared source of noise across pre/post — acceptable for a within-instrument pre/post comparison.
- mtime-recency window, not a random sample; fine for a baseline, note it if generalising.
- Measured under the t/3787 bug by design — this is the "before", not a hypothesis test.

## Provenance-register note

When the connection-rate / adoption-rate metric is implemented in code (not just this analysis
script), add it to `research/comp-linguist/docs/metric-provenance-register.md` as **derived**
(empirical, AN-edge-based; baseline values above), in the same PR — per the maintenance rule.
