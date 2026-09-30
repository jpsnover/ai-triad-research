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

## Pre-registered abandonment rule (what would count AGAINST the hypothesis)

Stated **before** the data, per TL (e/230#3). Rationale: today produced four real fixes to this
feature (t/3781, t/3786, t/3787, t/3755), so when the data disappoints the path of least resistance
is to hunt a fifth wiring bug rather than accept disconfirmation. A stopping rule written now is
cheap; written after the data, it isn't credible.

- **Wiring-correct precondition — now THREE surfaces, not one (TL p/349, re t/3791/t/3792).** The
  abandonment reading is valid ONLY if the mechanism is demonstrably correct across every surface that
  camps a steelman:
  - **Turn-context presentation (t/3787):** the helper applied at every enumerated site (derived from
    code, not the count of six — the corrected predicate found `crossRespond.ts:509`, unnamed by either
    analysis), AND the structural positive control passes. Control = **P1∧P2∧P3** (t/3790#3): P1 the
    steelman lands in the current speaker's own-position grouping; P2 its entry renders *differently*
    from a plain claim (a diff, not a phrase — rewording-robust); P3 both camp identifiers appear in
    the entry. None satisfiable by routing alone; none an exact-string assertion (avoids green-by-erosion).
  - **Belief-state camp (t/3791) and utility-scoring camp (t/3792):** both `beliefTracking.ts:116` and
    `agentUtility.ts:48,54` still miscamp the steelmanned camp's own steelman as an opponent. Neither
    feeds the instrument (verified — they write belief-state / a utility score, not the AN nodes/edges
    the metric reads), so **measurement is clean without them**. But both shape debater *behavior*,
    biasing the steelmanned camp *away* from its own steelman → biasing measured adoption **downward**.
  - **So the abandonment branch is gated on all three (t/3787 ∧ t/3791 ∧ t/3792); the confirm branch is
    gated on t/3787 only** (see the asymmetry below). Without all three, a null is ambiguous — it could
    be residual belief/utility suppression masking a real effect, not a false hypothesis — and THEN
    looking for the remaining defect is legitimate, not defect-hunting.
- **Abandonment condition.** With **all three surfaces correct** (t/3787 ∧ t/3791 ∧ t/3792, per the
  precondition above), if the **pilot (10–15 debates)** shows the steelmanned-camp adoption rate
  **statistically indistinguishable from the ~3–5% pre-fix baseline** (CI overlapping baseline, no
  upward shift), that is **evidence against** the hypothesis — steelmans do not drive own-camp uptake
  even when correctly presented AND correctly camped in belief/utility. Report the null; do NOT
  escalate to a further wiring hunt. (If t/3791/t/3792 are still open, this branch is unavailable —
  see the precondition; a null there routes to "ambiguous", not "abandon".)
- **Continue-to-confirm condition.** If the pilot shows a clear upward shift (adoption materially
  above baseline, CI excluding ~5%), proceed to the ~50-debate confirmatory arm. **The confirm branch
  is SAFE to run before t/3791/t/3792 land** — belief/utility suppression only biases adoption down,
  so a positive result under it is *stronger*, not weaker.
  - **Effect size is a FLOOR, not an estimate, while t/3791/t/3792 are open (TL p/349#458).** A positive
    pilot effect measured under active downward suppression is a **lower bound** on the fully-wired
    effect. Do NOT re-estimate the confirmatory-arm n from it as if it were the true effect — that
    *over-powers* the arm (larger effect ⇒ smaller n needed; the floor understates the effect ⇒
    overstates the n). Record the pilot effect **as a floor**; re-estimate n after t/3791/t/3792 land,
    or accept the over-powered (conservative, wasteful-not-wrong) n.
- **Ambiguous (underpowered) condition.** If the pilot is directionally positive but CI-wide, that is
  "insufficient data" (explanation 2), not support — proceed to the confirmatory arm; do not conclude
  from the pilot either way. **But weight the direction: under known downward suppression (t/3791/t/3792
  open), a *marginal* positive leans toward continue more than the bare CI implies** — the true effect
  is likely larger than measured. A marginal positive is a reason to continue (and re-check once the
  suppression is removed), never to abandon.
- **Non-degenerate guard (t/3587).** Report adoption with its n and the per-camp decomposition; a flat
  ~3% and a jump to ~30% are distinguished by the decomposition, not a bare rate.

## Caveats

- Edges are LLM-extracted (argument-network extraction); edge recall is imperfect and is itself a
  shared source of noise across pre/post — acceptable for a within-instrument pre/post comparison.
- mtime-recency window, not a random sample; fine for a baseline, note it if generalising.
- Measured under the t/3787 bug by design — this is the "before", not a hypothesis test.

## Provenance-register note

When the connection-rate / adoption-rate metric is implemented in code (not just this analysis
script), add it to `research/comp-linguist/docs/metric-provenance-register.md` as **derived**
(empirical, AN-edge-based; baseline values above), in the same PR — per the maintenance rule.
