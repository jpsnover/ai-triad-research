# Adaptive Debate Staging: A Signal-Driven Phase Transition Model

**Status:** Proposal (rev 2 — incorporates architectural review feedback)  
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

Our three-phase model (thesis-antithesis / exploration / synthesis) maps to confrontation+opening / argumentation / concluding. The proposal below preserves this structure but makes transitions signal-driven rather than position-based, with a back-edge from synthesis to exploration.

### The Saturation Principle

A debate phase has served its purpose when its *characteristic signals saturate* — when additional rounds in that phase produce diminishing returns on the behaviors the phase is designed to elicit. Each phase has a different saturation signature:

| Phase | Purpose | Characteristic Signal | Saturation = |
|-------|---------|----------------------|-------------|
| thesis-antithesis | Establish positions, identify disagreement points | New claims per turn, position staking | Claim rate drops; all POVs have staked core positions |
| exploration | Probe deeper, find cruxes, test edge cases | Crux identification, concession rate, engagement depth | Recycling rate rises; crux rate plateaus; no new concessions |
| synthesis | Converge, narrow disagreements, propose integrations | Cross-POV QBAF support edges, position stability | Agreement density plateaus; remaining disagreements are irreducible |

### Measurement Independence (Goodhart Mitigation)

A core design constraint: **the signals that drive phase transitions must be structurally independent of the behaviors prompted by phase-specific instructions.** If we tell debaters to use INTEGRATE moves during synthesis and then measure collaborative move ratio to decide when synthesis is complete, we create a Goodhart feedback loop where the prompt causes the signal that ends the debate.

The principle: *transition predicates measure post-hoc structural properties of the argument network, not self-reported move labels from the debaters.* Specifically:

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
    OR crux_identified(network)                             # at least one IDENTIFY-CRUX in the network
    OR round >= max_thesis_rounds                           # hard cap: 4
  )
```

**`claim_rate_declining`**: Compare argument network node count added this round vs. prior round. If the delta drops below 30% of the peak delta seen in any round, positions are established.

**`crux_identified`**: Any debater has used an IDENTIFY-CRUX move, signaling they've located the core disagreement — exploration should begin.

#### 2. Exploration Exit

The exploration exit uses a composite saturation score as the default, with override predicates for edge cases.

**Saturation score** [0, 1]:

```
saturation_score =
    0.35 * recycling_pressure
  + 0.25 * crux_maturity
  + 0.20 * concession_plateau
  + 0.20 * engagement_fatigue
```

Where:

- **`recycling_pressure`** = rolling 3-round average of `recycling_rate.avg_self_overlap`. Already computed by `convergenceSignals.ts`. When debaters start echoing prior arguments, exploration is exhausted.

- **`crux_maturity`** = `min(1, cumulative_crux_count / expected_cruxes) * follow_through_ratio`. A debate that has identified 2+ cruxes and followed through on them (engaged the crux rather than pivoting away) has mature exploration. `expected_cruxes` = 2 (fixed, based on typical 3-POV debate structure).

- **`concession_plateau`** = 1 if last 2 rounds had `concession_opportunity.outcome == 'missed'` despite `strong_attacks_faced > 0`. Debaters are ignoring strong attacks rather than engaging — a signal that positions have hardened.

- **`engagement_fatigue`** = 1 − (current `engagement_depth.ratio` / peak `engagement_depth.ratio`). When targeted engagement drops relative to the debate's own peak, the conversation is becoming less interactive.

**Predicate hierarchy:**

```
exploration_exit :=
    # Default: composite score above threshold
    saturation_score >= exploration_exit_threshold

    # Veto: fresh crux resets the clock (don't exit mid-discovery)
    AND NOT crux_discovered_this_round
    AND NOT concession_this_round                          # new concession = momentum, keep going

# Force exit regardless of score:
force_exploration_exit :=
    round_in_phase >= max_exploration_rounds                # hard cap: 8
    OR (recycling_pressure > 0.8 AND engagement_fatigue > 0.8)
       # debate is dead: high repetition + low engagement
```

**The saturation signal weights (0.35 / 0.25 / 0.20 / 0.20) should be validated empirically** against the existing debate corpus (~50 completed debates in the data repo). Backtest different weight vectors to see which best predicts where a human reader would place the exploration→synthesis transition.

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

**Regression trigger** (synthesis → exploration, max 1 per debate):

```
synthesis_regression :=
    NOT regression_already_used
    AND convergence_score dropped > 0.15 in one round
    AND crux_discovered_this_round                          # new crux surfaced during synthesis
```

On regression: `exploration_exit_threshold += 0.10` (ratchet to demand stronger saturation before re-entering synthesis).

#### 4. Global Early Termination

Independent of phase, the debate terminates early if:

```
early_termination :=
    health_score.value < 0.20 AND health_score.consecutive_decline >= 3
    # Debate has collapsed — health below floor for 3 straight rounds
```

This catches degenerate debates where the AI is producing low-quality output regardless of phase.

#### 5. API Call Budget (Shadow Limit)

The user-facing budget is denominated in rounds (semantically meaningful). Internally, the engine tracks a shadow `apiCallBudget`:

```
apiCallBudget = maxTotalRounds * 6
  # 4 pipeline stages + moderator + buffer per round
```

If `apiCallsUsed >= apiCallBudget`, force synthesis regardless of current phase. This handles variable-cost rounds (moderator interventions, retries, gap injection) without requiring users to think in API calls.

The shadow budget is reported in diagnostics but not exposed as a user parameter.

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

> *"The debate is approaching the transition to synthesis. If you have remaining exploration moves, this is the time. Otherwise, begin orienting toward integration."*

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

**Important:** Move weights are inputs to the *debater's plan stage* only. They are deliberately excluded from transition predicate computation to maintain measurement independence (see Goodhart Mitigation above). The debater is guided to behave appropriately for the phase, but the system's judgment of whether the phase is complete relies on structural argument-network properties, not on whether the debater followed the guidance.

### 3. Transition Awareness in the Moderator

The moderator's intervention selection already respects `PHASE_ALLOWED_FAMILIES`. We add transition-specific interventions:

- **On exploration → synthesis transition:** Moderator issues a `TRANSITION_SUMMARY` intervention listing identified cruxes, concessions made, and open questions — framing the synthesis.
- **On approaching synthesis exit:** Moderator issues a `FINAL_COMMIT` intervention asking each debater to state their final position on each crux.
- **On synthesis → exploration regression:** Moderator issues a `REGRESSION_NOTICE` explaining the new crux that triggered regression and directing debaters to address it.

## User-Configurable Parameters

### Parameters Exposed to Users

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
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
| Health floor for early termination | 0.20 | Below this the debate is producing garbage. |
| Expected cruxes for maturity calc | 2 | Structural: 3 POVs typically produce 2-3 binary cruxes. |
| Max regressions | 1 | Prevents infinite loops; one regression handles the common case. |
| Regression threshold ratchet | +0.10 | Demands stronger saturation after regression to prevent oscillation. |
| API call budget multiplier | 6× rounds | 4 pipeline stages + moderator + buffer. |

### Per-Phase Debater Rotation

The moderator selects one responder per round (not all POVs). The thesis-antithesis exit predicate requires that every active POV has responded at least once before it can fire — this is a precondition, not a per-round mandate.

Silence from a POV is tracked via `rounds_since_last_response[pov]` and available to the moderator as a selection signal. If a POV hasn't spoken in 3+ rounds, the moderator should prioritize selecting them.

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

15. Backtest saturation and convergence weight vectors against existing debate corpus (~50 debates)
16. Compare adaptive staging vs. fixed-round debates on convergence quality metrics
17. Tune override predicate thresholds based on observed signal distributions

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
