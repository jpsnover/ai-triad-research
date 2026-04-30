# Adaptive Debate Staging: A Signal-Driven Phase Transition Model

**Status:** Proposal (rev 3 — incorporates two rounds of architectural review)  
**Author:** Claude (computational dialectician), Jeffrey Snover  
**Date:** 2026-04-30

## Problem Statement

The current debate engine uses a fixed round count (`config.rounds`, default 3) and a positional formula to assign phases:

```typescript
function getDebatePhase(round: number, totalRounds: number): DebatePhase {
  if (round <= 2) return 'thesis-antithesis';
  if (round > totalRounds - 2) return 'synthesis';
  return 'exploration';
}
```

This has three problems:

1. **Arbitrary duration.** A 3-round debate gets 2 rounds of thesis-antithesis and 1 of synthesis, with zero exploration. A 10-round debate gets 6 rounds of exploration whether or not the debate needs them.
2. **No convergence awareness.** The debate doesn't know when positions have calcified (debaters recycling arguments) or when genuine cruxes have emerged that synthesis could resolve. It runs the clock regardless.
3. **No early termination.** A debate that reaches substantive agreement in round 4 of 8 will produce 4 rounds of filler.

## Theoretical Foundation

### Dialectical Stage Theory

Formal dialectics (van Eemeren & Grootendorst, pragma-dialectics) identifies four stages of critical discussion:

1. **Confrontation** — parties establish they disagree and on what
2. **Opening** — parties commit to shared procedural and material starting points
3. **Argumentation** — parties advance, attack, and defend arguments
4. **Concluding** — parties assess what was resolved

Critically, pragma-dialectics recognizes that these stages are not strictly linear — attempting resolution can surface new confrontations, requiring regression to the argumentation stage. Our architecture must support this recursion.

Our three-phase model (thesis-antithesis / exploration / synthesis) is *informed by* this framework but does not faithfully reproduce it — pragma-dialectics prescribes normative rules for rational discussion that our LLM debate cannot enforce. Specifically: we compress confrontation + opening into one phase, our "exploration" conflates argumentation sub-stages, and we lack the procedural commitments (e.g., burden-of-proof allocation) that pragma-dialectics requires. What we borrow is the insight that productive disagreement has a discoverable phase structure with identifiable transitions, and that synthesis attempted too early produces shallow convergence. The proposal below makes these transitions signal-driven rather than position-based, with a back-edge from synthesis to exploration.

### The Saturation Principle

A debate phase has served its purpose when its *characteristic signals saturate* — when additional rounds in that phase produce diminishing returns on the behaviors the phase is designed to elicit. Each phase has a different saturation signature:

| Phase | Purpose | Characteristic Signal | Saturation = |
|-------|---------|----------------------|-------------|
| thesis-antithesis | Establish positions, identify disagreement points | New claims per turn, position staking | Claim rate drops; all POVs have staked core positions |
| exploration | Probe deeper, find cruxes, test edge cases | Crux identification, concession rate, engagement depth | Recycling rate rises; crux rate plateaus; no new concessions |
| synthesis | Converge, narrow disagreements, propose integrations | Cross-POV QBAF support edges, position stability | Agreement density plateaus; remaining disagreements are irreducible |

### Measurement Separation (Goodhart Mitigation)

A core design constraint: **the signals that drive phase transitions must be measured separately from the behaviors prompted by phase-specific instructions.** If we tell debaters to use INTEGRATE moves during synthesis and then measure collaborative move ratio to decide when synthesis is complete, we create a Goodhart feedback loop where the prompt causes the signal that ends the debate.

We claim *measurement separation*, not measurement independence — full independence is unachievable since all signals originate from the same LLM output stream. The goal is to maximize structural indirection: transition predicates measure post-hoc structural properties of the argument network (topology, embedding distances, citation grounding), not self-reported move labels from the debaters. Residual coupling exists wherever an LLM can learn that producing certain argument structures (not just move labels) accelerates phase transitions. Phase 5 includes a **coupling audit** to quantify this residual and adjust if needed.

Specifically:

- **Use** `recycling_rate` (word overlap, structural), `position_delta` (semantic drift), `engagement_depth` (argument network edges), QBAF `computed_strength` and cross-POV support edges (grounded in taxonomy citations)
- **Do not use** `move_disposition.ratio` or move-type counts as transition signals, since move types are prompted behaviors

Move weights in the plan stage remain useful for guiding debater strategy — they just can't be inputs to the transition scorer.

## Proposed Architecture

### Phase Topology

The phase model is a directed graph with a single back-edge, not a linear pipeline:

```
                    ┌─────────────────────┐
                    │  thesis-antithesis   │
                    │  (min: 2, max: 4)   │
                    └─────────┬───────────┘
                              │ EXIT when:
                              │  • all POVs have made opening + ≥1 cross-respond
                              │  • claim_rate_delta ≤ 0.3 (new claims declining)
                              │  • OR max rounds hit
                    ┌─────────▼───────────┐
             ┌─────→│    exploration       │
             │      │  (min: 2, max: 8)   │
             │      └─────────┬───────────┘
             │                │ EXIT when:
             │                │  • saturation predicate satisfied
             │                │  • OR max rounds hit
             │      ┌─────────▼───────────┐
             │      │     synthesis        │
             │      │  (min: 2, max: 3)   │
             │      └──┬──────────────┬───┘
             │         │              │
             │  REGRESS│       EXIT   │
             │  (max 1)│       when:  │
             └─────────┘       │  • convergence predicate satisfied
                               │  • OR synthesis_stall detected
                               │  • OR max rounds hit
                               ▼
                           DEBATE ENDS
```

**Regression from synthesis → exploration** is permitted at most once per debate. When regression fires, the exploration exit threshold ratchets up by +0.10 to demand stronger saturation before re-entering synthesis. Regression rounds count against `maxTotalRounds`.

### Transition Predicates

Transitions use a **predicate hierarchy**: override predicates (veto/force) take precedence over composite scores. This prevents a single important event (a late crux, a sudden concession) from being averaged away by a composite formula.

#### 1. Thesis-Antithesis Exit

```
thesis_antithesis_exit(signals, network, transcript) :=
    round >= min_thesis_rounds                             # floor: 2
  AND all_povs_responded(transcript)                       # every active POV has ≥1 cross-respond
  AND (
    claim_rate_declining(signals, window=2)                 # new argument nodes/turn < 30% of peak
    OR crux_identified(network)                             # structural crux detector (see below)
    OR round >= max_thesis_rounds                           # hard cap: 4
  )
```

**`claim_rate_declining`**: Compare argument network node count added this round vs. prior round. If the delta drops below 30% of the peak delta seen in any round, positions are established.

**`crux_identified`**: A *structural* detector, not a move-label check. A crux is identified when a node in the argument network has ≥2 attack edges from different POVs AND `computed_strength > 0.5` — i.e., it's a shared target of substantial attacks. This avoids Goodhart coupling with the IDENTIFY-CRUX move label: the debater may or may not label their move as IDENTIFY-CRUX, but the network topology reveals the crux regardless.

#### 2. Exploration Exit

The exploration exit uses a composite saturation score as the default, with override predicates for edge cases.

**Saturation score** [0, 1] — weights are **provisional defaults** pending Phase 5 validation (see Validation Methodology below). Adaptive mode is opt-in behind a `useAdaptiveStaging` flag until validation is complete:

```
saturation_score =
    0.35 * recycling_pressure
  + 0.25 * crux_maturity
  + 0.20 * concession_plateau
  + 0.20 * engagement_fatigue
```

Where:

- **`recycling_pressure`** = rolling 3-round average of `recycling_rate.avg_self_overlap`. Already computed by `convergenceSignals.ts`. When debaters start echoing prior arguments, exploration is exhausted.

- **`crux_maturity`** = `min(1, cumulative_crux_count / expected_cruxes) * follow_through_ratio`. A debate that has identified its expected cruxes and followed through on them (engaged the crux rather than pivoting away) has mature exploration. `expected_cruxes = max(1, active_povs - 1)` — scales with the number of active POVs rather than being hardcoded (2 for a 3-POV debate, 1 for a 2-POV debate, etc.).

- **`concession_plateau`** = 1 if last 2 rounds had `concession_opportunity.outcome == 'missed'` despite `strong_attacks_faced > 0`. Debaters are ignoring strong attacks rather than engaging — a signal that positions have hardened.

- **`engagement_fatigue`** = 1 − (current `engagement_depth.ratio` / peak `engagement_depth.ratio`). When targeted engagement drops relative to the debate's own peak, the conversation is becoming less interactive.

**Predicate hierarchy:**

Vetoes are **time-bounded**: each veto can delay transition by at most 1 round. If the same veto fires on two consecutive rounds, the second firing is overridden — the debate progresses regardless. This prevents a debater from gaming vetoes (e.g., injecting a shallow crux every round to stall indefinitely).

```
exploration_exit :=
    # Default: composite score above threshold
    saturation_score >= exploration_exit_threshold

    # Veto: fresh crux resets the clock (don't exit mid-discovery)
    # Each veto delays at most 1 round; consecutive same-veto is overridden
    AND NOT (crux_discovered_this_round AND NOT crux_veto_fired_last_round)
    AND NOT (concession_this_round AND NOT concession_veto_fired_last_round)

# Force exit regardless of score:
force_exploration_exit :=
    round_in_phase >= max_exploration_rounds                # hard cap: 8
    OR (recycling_pressure > 0.8 AND engagement_fatigue > 0.8)
       # debate is dead: high repetition + low engagement
```

**The saturation signal weights (0.35 / 0.25 / 0.20 / 0.20) are provisional defaults** — see Validation Methodology below for the empirical protocol to replace them.

#### 3. Synthesis Exit

**Convergence score** [0, 1]:

```
convergence_score =
    0.40 * qbaf_agreement_density
  + 0.30 * position_stability
  + 0.30 * irreducible_disagreement_ratio
```

Where:

- **`qbaf_agreement_density`** = count of cross-POV *support* edges in the argument network added in the last 2 rounds, weighted by the cite stage's `grounding_confidence`. This measures semantic convergence through the argument network — two claims from different POVs with a support edge grounded in taxonomy nodes represent genuine agreement that is structurally harder to fake than a move label. Replaces the previously proposed `collaborative_ratio` to avoid Goodhart coupling with synthesis-phase move prompts.

- **`position_stability`** = 1 − mean(`position_delta.drift`) over last 2 rounds. When drift approaches 0, positions have stabilized (either in agreement or irreducible disagreement).

- **`irreducible_disagreement_ratio`** = (attack edges with both endpoints at `computed_strength > 0.6` in last 2 rounds) / (total cross-POV edges in last 2 rounds). When this is high, the remaining disagreements are between strongly-supported positions — they won't resolve with more rounds.

**Predicate hierarchy:**

```
synthesis_exit :=
    convergence_score >= synthesis_exit_threshold           # default: 0.70

# Force exit:
force_synthesis_exit :=
    round_in_phase >= max_synthesis_rounds                  # hard cap: 3
    OR synthesis_stall                                      # 2 consecutive rounds with
                                                            # convergence_score delta < 0.05
                                                            # AND recycling_pressure > 0.5
```

**Regression trigger** (synthesis → exploration, max 1 per *crux*):

Regression is capped at 1 per crux, not 1 per debate — a debate with N cruxes can regress at most N times (though in practice N ≤ 2 given typical 3-POV structure). Two consecutive regressions for structurally similar cruxes (>50% shared grounding nodes) count as the same crux.

```
synthesis_regression :=
    NOT regression_used_for_similar_crux(current_crux)
    AND (
      # Convergence drop: sustained decline, not single-round noise
      convergence_score_drop_over_2_rounds > 0.10
      OR
      # Novel crux: a new argument node with no ancestors in prior crux clusters
      novel_crux_discovered(network, prior_crux_clusters)
    )
```

**`novel_crux_discovered`**: A node qualifies as a novel crux if it has ≥2 cross-POV attack edges, `computed_strength > 0.5`, AND none of its supporting/grounding nodes overlap with previously identified crux clusters.

**`regression_used_for_similar_crux`**: Two cruxes are "similar" if >50% of the argument nodes in their grounding subgraphs are shared.

On regression: `exploration_exit_threshold += 0.10` (ratchet to demand stronger saturation before re-entering synthesis). Each regression adds its own +0.10, so a debate that regresses twice demands +0.20 above baseline.

#### 4. Global Early Termination

Independent of phase, the debate terminates early if:

```
early_termination :=
    health_score.value < 0.20 AND health_score.consecutive_decline >= 3
    # Gradual collapse — health below floor for 3 straight rounds

    OR health_score.value < 0.10
    # Catastrophic collapse — single round below 0.10 is immediate termination
```

The 0.10 single-round floor catches cases where the LLM produces degenerate output (empty responses, hallucinated format, complete off-topic). The 0.20 sustained-decline check catches gradual deterioration.

#### 5. API Call Budget (Shadow Limit)

The user-facing budget is denominated in rounds (semantically meaningful). Internally, the engine tracks a shadow API call budget with two thresholds:

```
soft_budget  = maxTotalRounds * 6    # soft limit: force transition to synthesis
hard_ceiling = maxTotalRounds * 10   # hard limit: terminate immediately
```

- At `apiCallsUsed >= soft_budget`: if not already in synthesis, force transition to synthesis. If already in synthesis, lower `synthesisExitThreshold` by 0.10 to encourage faster convergence.
- At `apiCallsUsed >= hard_ceiling`: terminate the debate immediately regardless of phase.
- The engine tracks `actual_calls_per_round` across debates to calibrate the multiplier over time. If the rolling average exceeds 6 calls/round, the soft multiplier auto-adjusts upward (capped at 8×).

Both thresholds are reported in diagnostics but not exposed as user parameters.

### Round Limits

Each phase has a **min** (to prevent premature transitions from noisy signals) and a **max** (to prevent runaway debates).

| Phase | Min Rounds | Max Rounds |
|-------|-----------|-----------|
| thesis-antithesis | 2 | 4 |
| exploration | 2 | 8 |
| synthesis | 2 | 3 |
| **Total** | **6** | **15** |

The `maxTotalRounds` parameter (default: 12) provides an absolute ceiling. If the debate hasn't exited synthesis by this limit, it terminates.

## Debater Stage Awareness

**Debaters should factor the stage into their response — and they already do.** The current system passes `phase` into every stage of the turn pipeline. The proposal strengthens this in two ways:

### 1. Richer Phase Context

Currently the debater receives a phase name (`'thesis-antithesis' | 'exploration' | 'synthesis'`). We add a **phase rationale** — a one-line explanation of *why* we're in this phase and what's expected:

```typescript
interface PhaseContext {
  phase: DebatePhase;
  rationale: string;       // "Exploration entered because all POVs have staked positions 
                           //  and a crux was identified around compute scaling claims.
                           //  Focus on testing this crux."
  rounds_in_phase: number; // how many rounds we've been in this phase
  phase_progress: number;  // 0–1, how close to exit threshold
  approaching_transition: boolean; // true if within 0.1 of exit threshold
}
```

When `approaching_transition` is true, the draft envelope includes a nudge:

> *"The debate is approaching the transition to synthesis. Begin orienting toward integration."*

The nudge does not mention "remaining exploration moves" — that phrasing would encourage debaters to pad exploration to delay transition, which is a Goodhart-adjacent incentive.

### 2. Phase-Specific Move Guidance

The plan stage already filters available moves by phase. We make this more granular with a **move weight** signal that the plan stage uses to bias strategy:

| Move | thesis-antithesis | exploration | synthesis |
|------|:---:|:---:|:---:|
| DISTINGUISH | 1.0 | 0.7 | 0.3 |
| COUNTEREXAMPLE | 1.0 | 0.8 | 0.2 |
| EMPIRICAL CHALLENGE | 0.8 | 1.0 | 0.3 |
| IDENTIFY-CRUX | 0.3 | 1.0 | 0.5 |
| CONCEDE-AND-PIVOT | 0.3 | 0.8 | 1.0 |
| INTEGRATE | 0.0 | 0.3 | 1.0 |
| CONDITIONAL-AGREE | 0.0 | 0.5 | 1.0 |
| REFRAME | 0.8 | 0.8 | 0.6 |

These weights don't hard-block moves — they appear in the plan prompt as guidance: *"Preferred moves this phase: CONCEDE-AND-PIVOT (1.0), INTEGRATE (1.0). Available but discouraged: COUNTEREXAMPLE (0.2)."*

**Important:** Move weights are inputs to the *debater's plan stage* only. They are deliberately excluded from transition predicate computation to maintain measurement separation (see Goodhart Mitigation above). The debater is guided to behave appropriately for the phase, but the system's judgment of whether the phase is complete relies on structural argument-network properties, not on whether the debater followed the guidance.

### 3. Transition Awareness in the Moderator

The moderator's intervention selection already respects `PHASE_ALLOWED_FAMILIES`. We add transition-specific interventions:

- **On exploration → synthesis transition:** Moderator issues a `TRANSITION_SUMMARY` intervention listing identified cruxes, concessions made, and open questions — framing the synthesis.
- **On approaching synthesis exit:** Moderator issues a `FINAL_COMMIT` intervention asking each debater to state their final position on each crux.
- **On synthesis → exploration regression:** Moderator issues a `REGRESSION_NOTICE` explaining the new crux that triggered regression and directing debaters to address it.

## User-Configurable Parameters

### Parameters Exposed to Users

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `useAdaptiveStaging` | bool | false | Enable signal-driven transitions (opt-in until Phase 5 validates weights) |
| `maxTotalRounds` | int | 12 | Absolute ceiling on debate length (user-facing budget) |
| `pacing` | `'tight' \| 'moderate' \| 'thorough'` | `'moderate'` | Preset that adjusts thresholds (see below) |
| `explorationExitThreshold` | float (0–1) | 0.65 | How saturated exploration must be before synthesis |
| `synthesisExitThreshold` | float (0–1) | 0.70 | How converged synthesis must be before termination |
| `allowEarlyTermination` | bool | true | Whether the debate can end before synthesis completes |

### Pacing Presets

For users who don't want to tune thresholds:

| Preset | maxTotalRounds | explorationExit | synthesisExit | Character |
|--------|:-:|:-:|:-:|---|
| `tight` | 8 | 0.55 | 0.60 | Get to the point. Shorter debates, earlier transitions. |
| `moderate` | 12 | 0.65 | 0.70 | Balanced. Default for most topics. |
| `thorough` | 15 | 0.80 | 0.80 | Deep dive. Lets exploration run longer, demands stronger convergence. |

### Parameters That Should Be Fixed (Not User-Configurable)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Min rounds per phase | 2 | Fewer than 2 rounds gives the LLM no chance to respond to feedback. |
| Max thesis-antithesis | 4 | Opening positions don't need more than 4 rounds in a 3-POV debate. |
| Max synthesis | 3 | If synthesis hasn't converged in 3 rounds, it won't. |
| Saturation signal weights | See above | Subject to empirical validation against debate corpus; not a user concern. |
| Health floor for early termination | 0.20 (sustained), 0.10 (single-round) | Sustained: 3 consecutive rounds. Single-round: catastrophic collapse. |
| Expected cruxes for maturity calc | `max(1, active_povs - 1)` | Scales with debate size: 2 for 3-POV, 1 for 2-POV. |
| Max regressions | 1 per crux | Prevents infinite loops; structurally similar cruxes (>50% shared grounding) count as one. |
| Regression threshold ratchet | +0.10 per regression | Cumulative: two regressions demand +0.20 above baseline. |
| API call soft budget | 6× rounds | Force synthesis. Auto-adjusts based on rolling actual calls/round. |
| API call hard ceiling | 10× rounds | Terminate immediately. |

### Per-Phase Debater Rotation

The moderator selects one responder per round (not all POVs). The thesis-antithesis exit predicate requires that every active POV has responded at least once before it can fire — this is a precondition, not a per-round mandate.

Silence from a POV is tracked via `rounds_since_last_response[pov]` and available to the moderator as a selection signal. **In thesis-antithesis, the moderator MUST select unheard POVs before any POV can speak a second time** — this is mandatory, not a suggestion. After thesis-antithesis, the moderator should prioritize selecting silent POVs if `rounds_since_last_response[pov] >= 3`, but this is a soft signal, not a hard constraint.

## Validation Methodology

The saturation and convergence weights are provisional. Before shipping adaptive staging as the default, the following protocol must be completed:

1. **Held-out test set.** Split the debate corpus (~50 debates) into 70% training / 30% held-out. All weight tuning uses training set only; final evaluation on held-out.
2. **Human annotation.** Three annotators independently mark where they would place the exploration→synthesis transition and debate termination point in each training debate. Inter-annotator agreement (Krippendorff's α ≥ 0.6) establishes the ground truth.
3. **Single-signal baselines.** For each signal (recycling_pressure, crux_maturity, concession_plateau, engagement_fatigue), compute transition accuracy using that signal alone. Any signal that doesn't beat random on its own is dropped before composite tuning.
4. **Leave-one-out cross-validation.** On the training set, tune weight vectors using LOOCV. Report mean and variance of transition-point error (rounds off from human annotation).
5. **Coupling audit.** For each transition signal, measure correlation between the signal's value and the presence of phase-specific move prompts in the preceding turn. If r > 0.5 for any signal-prompt pair, flag it as residually Goodhart-coupled and either replace the signal or add a debiasing correction.

Adaptive staging ships behind `useAdaptiveStaging: true` until this validation is complete. The fixed-round fallback remains the default.

## Adversarial Debater Robustness

An LLM debater can learn (within-context or across fine-tuning) to manipulate transition signals — producing structural patterns that trigger or delay phase transitions to its advantage.

### Per-Debater Signal Attribution

Each transition signal is decomposed per-debater. If one debater's contributions dominate a signal (>60% of the signal's value comes from one speaker), the signal is flagged and the moderator can intervene with a `BALANCE_CHECK`.

### Anomaly Detection

Track per-signal moving averages. If any signal spikes or drops >2σ from its debate-level mean in a single round, flag the round for moderator review. Flagged rounds do not contribute to transition predicate evaluation until the moderator clears them.

### Model Version Sensitivity

When the underlying LLM version changes (model swap, fine-tune update), the first 5 debates under the new model run in **shadow mode**: adaptive transitions are computed but not enacted; the fixed-round fallback controls the debate. Signal distributions from shadow mode are compared against the validation baseline. If any signal's distribution shifts by >0.15 (KL divergence), the coupling audit reruns before adaptive mode activates.

## Implementation Plan

### Phase 1: Transition Predicates (core change)

1. Add `PhaseTransitionConfig` and `PhaseContext` types to `types.ts`
2. Create `phaseTransitions.ts` with `evaluatePhaseTransition()`, `computeSaturationScore()`, `computeConvergenceScore()`, and override predicates
3. Refactor `debateEngine.ts` main loop: replace fixed `for` loop with `while` loop that calls `evaluatePhaseTransition()` after each round; track phase in engine state
4. Deprecate positional `getDebatePhase()` — replace callers with engine state lookup
5. Add `PhaseContext` to `StagePromptInput` and update envelope builders in `envelopes.ts`

### Phase 2: Debater Awareness (prompt changes)

6. Add phase rationale string generation to `phaseTransitions.ts`
7. Add move weight table to `prompts.ts`, inject into plan stage only
8. Add transition nudge to draft envelope when `approaching_transition` is true

### Phase 3: Moderator Transition Actions

9. Add `TRANSITION_SUMMARY` intervention type — fired once on exploration→synthesis transition
10. Add `FINAL_COMMIT` intervention type — fired when approaching synthesis exit
11. Add `REGRESSION_NOTICE` intervention type — fired on synthesis→exploration regression

### Phase 4: UI Integration

12. Surface phase progress indicator in `DebateWorkspace.tsx` (progress bar per phase)
13. Add pacing selector to `NewDebateDialog.tsx`
14. Display phase transition events (including regression) in the debate transcript

### Phase 5: Empirical Validation

15. Annotate debate corpus (3 annotators, inter-annotator agreement ≥ 0.6 α)
16. Compute single-signal baselines; drop signals that don't beat random
17. LOOCV weight tuning on training set; evaluate on held-out set
18. Coupling audit: measure signal-prompt correlations, flag r > 0.5 pairs
19. Compare adaptive staging vs. fixed-round debates on convergence quality metrics
20. Run adversarial debater shadow mode on first 5 debates per model version

## Compatibility

- **Backward compatible.** Setting `pacing: 'moderate'` with `maxTotalRounds` equal to the old `rounds` value produces similar behavior to the current system, just with adaptive transitions within the budget.
- **Protocol-aware.** The `DEBATE_PROTOCOLS` definitions can set per-protocol defaults: `socratic` might use `tight` pacing (it's already exploratory by nature), `deliberation` might use `thorough` (consensus-seeking needs room).
- **Fixed-round fallback.** If a user sets `explorationExitThreshold: 1.0` and `synthesisExitThreshold: 1.0`, transitions only happen at the hard caps, reproducing positional behavior.

## Design Decisions Log

### Rev 2 Changes (architectural review feedback)

| Issue Raised | Resolution |
|---|---|
| **Goodhart coupling** — measuring collaborative_ratio while prompting for collaborative moves creates a feedback loop | Replaced `collaborative_ratio` with `qbaf_agreement_density` (cross-POV support edges weighted by grounding confidence) in synthesis convergence score. Added measurement independence as an explicit design constraint. |
| **Linear scoring rigidity** — a single late crux can invalidate a composite score | Added predicate hierarchy: override predicates (veto/force) take precedence over composite scores. `crux_discovered_this_round` vetoes exploration exit; `recycling + fatigue > 0.8` forces it. |
| **Unidirectional progression** — dialectics is recursive, synthesis can surface new contradictions | Added synthesis → exploration regression (max 1 per debate) with convergence drop + new crux as trigger. Threshold ratchet (+0.10) prevents oscillation. |
| **Budget denomination** — rounds are user-meaningful but don't reflect variable API costs | User-facing budget in rounds; shadow `apiCallBudget = maxTotalRounds × 6` forces synthesis if hit. Reported in diagnostics. |
| **Forced rotation** — requiring all POVs per round is wasteful | Keep moderator-driven selection. Thesis exit precondition requires all POVs responded ≥1. Track `rounds_since_last_response` as moderator signal. |
| **Signal weight validation** — weights should not be set a priori | Added Phase 5 (empirical validation) to implementation plan. Backtest against debate corpus before shipping. |

### Rev 3 Changes (second architectural review)

| Issue Raised | Resolution |
|---|---|
| **Residual Goodhart coupling** — "measurement independence" is an overclaim; `crux_identified` uses a move label | Replaced "measurement independence" with "measurement separation" — acknowledged residual coupling is inevitable; added coupling audit to Phase 5. Replaced `crux_identified` move-label check with structural detector (≥2 cross-POV attacks on a node with strength > 0.5). |
| **Numerology in weights** — provisional weights stated with false precision; no validation methodology | Labeled all weights as "provisional defaults." Added Validation Methodology section: held-out test, inter-annotator agreement, single-signal baselines, LOOCV, coupling audit. Made adaptive mode opt-in behind `useAdaptiveStaging` flag until validation completes. |
| **Predicate deadlock** — vetoes can stall transitions indefinitely if a debater keeps injecting cruxes | Time-bounded vetoes: each veto delays at most 1 round; if the same veto fires on two consecutive rounds, the second firing is overridden. |
| **Phase taxonomy mismatch** — claiming faithful pragma-dialectics mapping overstates the formal grounding | Replaced "maps to" with "informed by." Added explicit disclaimer listing what we borrow (phase structure insight) and what we don't reproduce (normative rules, burden-of-proof allocation, procedural commitments). |
| **Regression under-specification** — "max 1 per debate" is ad hoc; no definition of structural novelty | Regression capped at 1 per *crux* (not per debate). Added structural similarity test (>50% shared grounding nodes = same crux). Regression trigger uses 2-round convergence drop window (not single-round) OR novel crux with no ancestors in prior clusters. |
| **API budget brittleness** — single hard limit at 6× is fragile | Split into soft budget (6×, force synthesis) and hard ceiling (10×, terminate). Added auto-calibration: rolling average of actual calls/round adjusts soft multiplier. |
| **Smaller issues** — hardcoded `expected_cruxes`, lax health floor, nudge clause encourages stalling, thesis-antithesis rotation is suggestion not mandate | `expected_cruxes = max(1, active_povs - 1)`. Added single-round health floor at 0.10 for catastrophic collapse. Removed "if you have remaining exploration moves" from nudge. Made thesis-antithesis unheard-POV selection mandatory. |
| **Missing adversarial debater test** — no defense against signal manipulation by debaters | Added Adversarial Debater Robustness section: per-debater signal attribution, anomaly detection (2σ flagging), model version sensitivity (shadow mode for first 5 debates after model change). |
