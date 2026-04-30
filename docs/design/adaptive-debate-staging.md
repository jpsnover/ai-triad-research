# Adaptive Debate Staging: A Signal-Driven Phase Transition Model

**Status:** Proposal (rev 10 — AI-implementer review: v1 scope boundary, worked example, SignalContext interface, state transition table, contradiction fixes, failure mode taxonomy; nine rounds of review)  
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

### Terminology: "Round"

Throughout this document, **round** means one speaker turn — one debater produces one statement, which is then extracted into the argument network. In a 3-POV debate where the moderator selects one speaker per round, it takes ~3 rounds for all POVs to speak once. All windowed computations ("last 2 rounds", "rolling 3-round average") count speaker turns, not full POV cycles. This means a "last 2 rounds" window in a 3-POV debate covers ~2/3 of a full cycle. This is intentional — signals should react to individual contributions, not wait for a full cycle to complete.

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
             │  (1/crux)       when:  │
             └─────────┘       │  • convergence predicate satisfied
                               │  • OR synthesis_stall detected
                               │  • OR max rounds hit
                               ▼
                           DEBATE ENDS
```

**Regression from synthesis → exploration** is permitted at most once per *crux* — a debate with N distinct cruxes can regress at most N times (in practice ≤ 2 for 3-POV debates; see Regression Trigger for structural similarity rules). A **global regression budget of 2** applies as a hard safety cap regardless of crux count — even if 5 cruxes are identified, the debate can regress at most twice. This prevents oscillation death spirals from stochastic extraction + low-confidence rounds. When regression fires, the exploration exit threshold ratchets up by +0.10. Regression rounds count against `maxTotalRounds`. "Regression pressure" (cumulative count / 2) is exposed in diagnostics and the UI phase panel.

### Signal Confidence Floor

All transition predicates treat signals as point estimates, but LLM extraction is stochastic. A single round with anomalous extraction (hallucinated edge, misclassified category) can trigger spurious regression or veto. To mitigate:

**Per-component confidence** — each signal reports a confidence value [0, 1]:

```
extraction_confidence =
    0.5 * extraction_status_score          # 1.0 if ok, 0.5 if truncated, 0.0 if parse_error
  + 0.3 * min(1, claims_accepted / 2)      # at least 2 claims accepted = full confidence
  + 0.2 * category_validity_ratio           # fraction of categories that mapped to known values
                                            # (not fallback/unknown)
```

For signals that don't depend on extraction (e.g., `pragmatic_convergence`, `scheme_stagnation`), `extraction_confidence = 1.0` — they're computed from raw text or already-stored categorical data and are not subject to extraction noise.

**Stability confidence** — each composite signal (saturation_score, convergence_score) reports stability based on inter-round variance:

```
stability_confidence =
    1.0 if rounds_in_phase < 3             # not enough history to judge, trust the signal
    else 1.0 - min(1, |signal - moving_avg_3| / 0.3)
                                            # penalize signals that deviate >0.3 from their
                                            # own 3-round moving average
```

**Global floor:**

```
signal_confidence = min(extraction_confidence, stability_confidence)
```

If `signal_confidence < 0.4`, all predicate evaluations defer to the next round — no transitions, regressions, or vetoes fire. The debate continues in its current phase.

Confidence values are reported in diagnostics for tuning visibility.

### Transition Predicates

Transitions use a **predicate hierarchy**: override predicates (veto/force) take precedence over composite scores. This prevents a single important event (a late crux, a sudden concession) from being averaged away by a composite formula. All predicates are gated by the signal confidence floor (see above).

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

**`claim_rate_declining`**: Compare argument network node count added this round vs. prior round. If the delta drops below 30% of the peak delta seen in any round, positions are established. Floor: `max(2, 0.3 * peak_delta)` — if the peak is ≤6 nodes, the threshold is 2, preventing the predicate from firing trivially on debates with low claim extraction rates.

**`crux_identified`**: A *structural* detector, not a move-label check. A crux is identified when a node in the argument network has ≥2 attack edges from different POVs AND `computed_strength > 0.5` — i.e., it's a shared target of substantial attacks. This avoids Goodhart coupling with the IDENTIFY-CRUX move label: the debater may or may not label their move as IDENTIFY-CRUX, but the network topology reveals the crux regardless.

#### Signal Interface and Context

Every signal is a modular `Signal` object registered in the signal array. To prevent signals from coupling to engine internals, all signals consume a declared `SignalContext` interface — no direct access to engine state.

```typescript
interface Signal {
  id: string;
  weight: number;                                // loaded from provisional-weights.json
  compute: (ctx: SignalContext) => number;        // returns [0, 1]
  enabled: boolean;
  maturity: 'v1-ship' | 'post-validation' | 'research';
}

interface SignalContext {
  // Argument network (read-only snapshot)
  network: {
    nodes: ReadonlyArray<{ id: string; speaker: string; computed_strength: number;
      base_strength_category: string; argumentation_scheme: string;
      taxonomy_refs: ReadonlyArray<{ node_id: string; relevance: string }> }>;
    edges: ReadonlyArray<{ source: string; target: string; relationship: string;
      attack_type?: string; weight: number; speaker: string }>;
    nodeCount: number;
  };

  // Transcript window
  transcript: {
    currentRound: number;
    roundsInPhase: number;
    activePovsCount: number;
    lastNRounds(n: number): ReadonlyArray<{
      round: number; speaker: string; text: string;
      extraction_status: string; claims_accepted: number; claims_rejected: number;
      category_validity_ratio: number;
    }>;
  };

  // Prior signal values (for stability computation)
  priorSignals: {
    get(signalId: string, roundsBack: number): number | null;
    movingAverage(signalId: string, window: number): number | null;
  };

  // Existing convergence signals (already computed by convergenceSignals.ts)
  convergenceSignals: {
    recycling_rate: { avg_self_overlap: number };
    engagement_depth: { ratio: number };
    position_delta: { drift: number };
    concession_opportunity: { outcome: string; strong_attacks_faced: number };
  };

  // Phase metadata
  phase: {
    current: 'thesis-antithesis' | 'exploration' | 'synthesis';
    allPovsResponded: boolean;
    cruxNodes: ReadonlyArray<{ id: string; crossPovAttackCount: number;
      computedStrength: number; embedding?: Float32Array }>;
    priorCruxClusters: ReadonlyArray<ReadonlyArray<string>>;
    regressionCount: number;
    explorationExitThreshold: number;
    synthesisExitThreshold: number;
  };

  // Extraction confidence (for confidence floor computation)
  extraction: {
    lastRoundStatus: string;         // 'ok' | 'truncated' | 'parse_error'
    lastRoundClaimsAccepted: number;
    lastRoundCategoryValidityRatio: number;
  };
}
```

Signals may read any field on `SignalContext`. Each signal definition below notes which fields it consumes. New signals added to the registry must consume only declared `SignalContext` fields — if a new signal needs data not on the interface, the interface is extended (and existing signals are verified against the change).

#### Cold-Start Behavior

Windowed signals reference "peak rate," "debate mean," or "last N rounds" — values undefined for the first 2-3 rounds. **Uniform cold-start rule:** during the cold-start period (rounds 1 through `min_phase_rounds` for the current phase), all windowed signals return a **neutral sentinel** of 0.5 (midpoint of [0, 1]). The sentinel value is tagged as low-confidence: `extraction_confidence` is set to 0.5 for sentinel values, ensuring the confidence floor formula treats them as uncertain but not deferred. Once `rounds_in_phase >= min_phase_rounds`, signals switch to their normal computation using all available history.

This prevents:
- `claim_rate_declining` from firing trivially on round 1 (no prior round to compare)
- `pragmatic_convergence` from computing "debate mean" with 1 data point
- `engagement_fatigue` from comparing against a peak that is also the only data point
- `scheme_stagnation` from flagging low diversity when only 1-2 rounds of schemes exist

#### Confidence Floor × Regression Interaction

When `signal_confidence < 0.40`, all predicate evaluations are deferred — including regression evaluations. A regression that *would have* fired on a low-confidence round is reconsidered on every subsequent round until either (a) confidence recovers and the regression condition is re-evaluated with fresh signals, or (b) the phase exits via another predicate. Deferred regressions do **not** ratchet the threshold until they actually fire — the +0.10 ratchet is applied only when the engine commits to the regression and transitions back to exploration. A debate cannot get stuck in synthesis because of a single low-confidence round that masked a regression trigger.

#### 2. Exploration Exit

The exploration exit uses a composite saturation score as the default, with override predicates for edge cases.

**Saturation score** [0, 1] — weights are **provisional defaults** pending Phase 5 validation (see Validation Methodology below). Adaptive mode is opt-in behind a `useAdaptiveStaging` flag until validation is complete:

```
saturation_score =
    0.30 * recycling_pressure
  + 0.25 * crux_maturity
  + 0.15 * concession_plateau
  + 0.15 * engagement_fatigue
  + 0.05 * pragmatic_convergence          # reduced: partially coupled to phase context (see note)
  + 0.10 * scheme_stagnation
```

Where:

- **`recycling_pressure`** = rolling 3-round average of `recycling_rate.avg_self_overlap`. Already computed by `convergenceSignals.ts`. When debaters start echoing prior arguments, exploration is exhausted.

- **`crux_maturity`** = `min(1, cumulative_crux_count / expected_cruxes) * follow_through_ratio * scheme_coverage_factor`. A debate that has identified its expected cruxes, followed through on them, and deployed diverse argumentation schemes has mature exploration.
  - `expected_cruxes = max(1, active_povs - 1)` — scales with the number of active POVs (2 for 3-POV, 1 for 2-POV).
  - `follow_through_ratio` = (cruxes that received ≥1 cross-POV edge within 2 rounds of identification) / (total identified cruxes). A crux is "identified" per the canonical `crux_identified` detector (§Thesis-Antithesis Exit): ≥2 cross-POV attack edges AND `computed_strength > 0.5`. "Follow-through" means at least one other POV produced a node with an edge targeting the crux node within 2 subsequent rounds. If no cruxes have been identified yet, `follow_through_ratio = 0`.
  - `scheme_coverage_factor = min(1, unique_schemes_used / min(6, available_schemes))` — penalizes debates that achieve high crux count through repetitive reasoning patterns.

- **`concession_plateau`** = 1 if last 2 rounds had `concession_opportunity.outcome == 'missed'` despite `strong_attacks_faced > 0`. Debaters are ignoring strong attacks rather than engaging — a signal that positions have hardened.

- **`engagement_fatigue`** = 1 − (current `engagement_depth.ratio` / peak `engagement_depth.ratio`). When targeted engagement drops relative to the debate's own peak, the conversation is becoming less interactive.

- **`pragmatic_convergence`** [0, 1] = surface-form discourse signal computed from debater text (no LLM evaluation required). **Coupling note:** This signal is partially coupled to phase context — the debater produces text with knowledge of the phase rationale and transition nudge, creating a direct prompt-to-signal feedback channel. Unlike structural signals (which measure argument network topology computed by the *evaluator*), pragmatic signals scan raw *debater* output. This coupling is acknowledged; the signal's weight (0.05) reflects its tiebreaker role rather than a primary transition driver. The Phase 5 coupling audit (item 20) must specifically measure this signal's r-value against phase-context prompts. Three sub-signals, averaged:
  - **Hedge density drop**: ratio of epistemic hedges to assertive markers in the last 2 rounds vs. the debate mean. When hedging drops, positions have crystallized.
    - Hedge lexicon (case-insensitive): "perhaps", "seems", "I suspect", "might", "could be", "it's possible", "arguably", "one might think", "it appears", "tentatively", "I would suggest", "to some extent", "not necessarily", "in some cases", "it remains unclear"
    - Assertive lexicon: "clearly", "necessarily", "entails", "obviously", "certainly", "undeniably", "without question", "it follows that", "the evidence shows", "demonstrably", "incontrovertibly", "unambiguously"
  - **Concessive marker plateau**: 1 − (concessive marker rate in last 2 rounds / peak concessive marker rate in debate). Concessive markers rise during active engagement and plateau when positions harden. The *drop from peak* signals saturation — when the rate was high and has fallen, the debate has moved past active concession-making. If the rate is still rising, this sub-signal stays near 0 (low saturation).
    - Concessive lexicon: "however", "granted that", "although", "nonetheless", "I concede", "that said", "admittedly", "while I agree", "fair point", "you're right that", "I'll grant", "notwithstanding", "even so", "despite this", "acknowledging that"
  - **Meta-discourse crux markers**: presence of crux-awareness phrases — surface indicators that debaters have identified the core disagreement. Computed via case-insensitive substring matching against the lexicon below. These signals saturate earlier than graph topology, are computed without LLM evaluation, and are hard for debaters to fake without fundamentally changing their argument content.
    - Meta-discourse lexicon: "the central disagreement", "the crux is", "what this really comes down to", "the fundamental question", "the core tension", "the real issue is", "at the heart of", "the key disagreement", "where we fundamentally differ", "the root of our disagreement", "the decisive question", "the essential trade-off", "this hinges on", "the critical assumption", "what ultimately matters here", "the deepest point of contention", "the irreducible disagreement"
  
  All three lexicons are defined as `const` arrays in the implementation module. Matching is case-insensitive substring search; no stemming, no embedding cosine (simpler and deterministic). The ~50 total phrases across three categories provide adequate coverage for English-language academic debate.
  
  **Learned classifier (Phase 1b, required for shipping):** A lightweight sentence-transformer classifier (~1.5B params, e.g., distilled from all-MiniLM-L6-v2) detects hedge/concessive/meta-discourse markers with higher recall than lexicon matching, particularly for non-academic registers, paraphrases, and implicit concessions. The learned classifier runs in parallel with the lexicon and the final `pragmatic_convergence` value is the max of the two paths. The lexicon path is always authoritative — the learned path can only raise the signal, never lower it. This ensures determinism for the core case while capturing edge cases the lexicon misses. Deployment of the classifier is gated on an F1 ≥ 0.80 benchmark against a hand-labeled subset of 200 debate turns.
  
  **Why required, not optional:** Hardcoded lexicons are brittle across model generations and system prompt variations. An adversarial model prompted to avoid specific marker phrases will trivially bypass lexicon-based detection while preserving the underlying discourse moves. The learned classifier generalizes across paraphrases and is resistant to simple lexical evasion. The lexicon remains as a **degraded fallback** when the classifier is unavailable (cold start, benchmark failure, resource-constrained environments), but adaptive staging cannot ship as default without the classifier passing its F1 gate. This is a Phase 5 blocking requirement.

- **`scheme_stagnation`** [0, 1] = 1 − (unique `argumentation_scheme` values in last 2 rounds / unique schemes in entire debate). When the active scheme set contracts, the debate is recycling the same reasoning patterns. This catches enthymematic bankruptcy — debates with perfect structural saturation but where every argument uses the same unstated warrant. Already-extracted `argumentation_scheme` categories feed this directly; no additional LLM calls needed.

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

**The saturation signal weights (0.30 / 0.25 / 0.15 / 0.15 / 0.05 / 0.10) are provisional defaults** — see Validation Methodology below for the empirical protocol to replace them. All provisional weights must be loaded from `provisional-weights.json` at runtime, not hardcoded as constants (see §Provisional Weights Config).

**Force-exit / ratchet interaction (intended):** After two regressions, the ratcheted `exploration_exit_threshold` is 0.85 (0.65 + 0.20). The `force_exploration_exit` predicate (`recycling_pressure > 0.8 AND engagement_fatigue > 0.8`) can satisfy before the ratcheted threshold. This is correct: a twice-regressed debate that hits the "debate is dead" force exit has genuinely exhausted exploration — the ratchet prevents premature *scored* exits, but the force exit catches debates that are dead regardless of score. A debate that reaches the force exit after regressions is being mercifully terminated, not prematurely advanced.

#### 3. Synthesis Exit

**Convergence score** [0, 1]:

```
convergence_score =
    0.35 * qbaf_agreement_density
  + 0.25 * position_stability
  + 0.25 * irreducible_disagreement_ratio
  + 0.15 * synthesis_pragmatic_signal
```

Where:

- **`qbaf_agreement_density`** = count of cross-POV *support* edges in the argument network added in the last 2 rounds, weighted by grounding confidence. Grounding confidence is derived from the cite stage's `taxonomy_refs[].relevance` field: `"high"` → 1.0, `"medium"` → 0.6, `"low"` → 0.3, absent → 0.1. For edges connecting two nodes that both have ≥1 high-relevance taxonomy ref, the edge counts as fully grounded. This measures semantic convergence through the argument network — two claims from different POVs with a support edge grounded in taxonomy nodes represent genuine agreement that is structurally harder to fake than a move label.

- **`position_stability`** = 1 − mean(`position_delta.drift`) over last 2 rounds. When drift approaches 0, positions have stabilized (either in agreement or irreducible disagreement).

- **`irreducible_disagreement_ratio`** = (attack edges with both endpoints at `computed_strength > 0.6` in last 2 rounds) / (total cross-POV edges in last 2 rounds). When this is high, the remaining disagreements are between strongly-supported positions — they won't resolve with more rounds.

- **`synthesis_pragmatic_signal`** [0, 1] = surface-form convergence markers in debater text. Three sub-signals, averaged:
  - **Integration language density**: frequency of synthesis-characteristic phrases ("building on X's point", "combining these perspectives", "a possible resolution") via curated lexicon matching.
  - **Conditional agreement markers**: frequency of conditional structures ("if we accept X, then Y follows", "provided that", "under the condition") — signals of narrowing disagreement space.
  - **Diminishing qualification rate**: drop in new qualifications, caveats, and exceptions relative to the debate's exploration phase. When debaters stop adding new qualifications, synthesis is stabilizing.

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
    round_in_phase >= 2                                      # cannot regress in synthesis round 1
                                                             # (no 2-round window to compare against;
                                                             # the last exploration round is NOT included)
    AND NOT regression_used_for_similar_crux(current_crux)
    AND (
      # Convergence drop: sustained decline over rounds 1→2 of synthesis
      convergence_score_drop_over_2_rounds > 0.10
      OR
      # Novel crux: a new argument node with no ancestors in prior crux clusters
      novel_crux_discovered(network, prior_crux_clusters)
    )
```

**`novel_crux_discovered`**: A node qualifies as a novel crux if it has ≥2 cross-POV attack edges, `computed_strength > 0.5`, AND passes both of:

1. **Structural novelty:** None of its supporting/grounding nodes overlap with previously identified crux clusters.
2. **Semantic novelty:** The node's text has embedding cosine similarity < 0.70 to *every* prior crux node's text (using the same all-MiniLM-L6-v2 embeddings already computed for `position_delta`). This catches the crux-farming attack: a gaming debater can produce arguments that are structurally distinct (different graph ancestors) but substantively redundant ("AI governance needs international coordination" vs. "Global AI regulation requires cross-border cooperation"). Without the semantic check, each phrasing counts as a novel crux and burns a separate regression budget slot.

A candidate that passes the structural check but fails the semantic check is logged as a "semantically redundant crux" in diagnostics and does not trigger regression.

**`regression_used_for_similar_crux`**: Two cruxes are "similar" if >50% of the argument nodes in their grounding subgraphs are shared OR their text embedding cosine similarity is > 0.70.

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

**Design constraint:** No new LLM calls in the per-round hot path beyond the existing extraction/cite stages and moderator selection/intervention. All transition predicates, convergence signals, pragmatic signals, and phase progress computations are deterministic (computed from argument network topology, lexicon matching, and already-extracted categorical data). Phase rationale generation uses template + string interpolation, not a full LLM generation. This constraint preserves the existing calls-per-round baseline and ensures adaptive staging does not inflate API costs.

The user-facing budget is denominated in rounds (semantically meaningful). Internally, the engine tracks a shadow API call budget with two thresholds:

```
soft_budget  = maxTotalRounds * 6    # soft limit: force transition to synthesis
hard_ceiling = maxTotalRounds * 10   # hard limit: terminate immediately
```

- At `apiCallsUsed >= soft_budget`: if not already in synthesis, force transition to synthesis. If already in synthesis, lower `synthesisExitThreshold` by 0.10 to encourage faster convergence.
- At `apiCallsUsed >= hard_ceiling`: terminate the debate immediately regardless of phase.
- The engine tracks `actual_calls_per_round` across debates to calibrate the multiplier over time. If the rolling average exceeds 6 calls/round, the soft multiplier auto-adjusts upward (capped at 8×).

**Cross-debate calibration persistence:** The rolling average of `actual_calls_per_round` is stored in a lightweight JSON file at `{outputDir}/.debate-calibration.json`:

```json
{
  "schema_version": 1,
  "updated_at": "2026-04-30T12:00:00Z",
  "calls_per_round": {
    "samples": [5.2, 6.1, 4.8, 5.5],
    "rolling_avg": 5.4,
    "max_samples": 20
  }
}
```

On debate start, if this file exists and `schema_version` matches, the engine seeds `soft_budget_multiplier = max(6, min(8, ceil(rolling_avg)))`. On debate end, the engine appends the debate's actual calls/round to `samples` (FIFO, capped at 20), recomputes `rolling_avg`, and writes back. If the file is missing, corrupt, or has an unknown `schema_version`, the engine silently uses the default multiplier (6×) and overwrites the file on completion.

Both thresholds are reported in diagnostics but not exposed as user parameters.

#### 6. Runtime Safety Guardrails

**Kill switches** — three levels of granularity for disabling adaptive staging without code changes:

| Switch | Scope | Mechanism | Effect |
|---|---|---|---|
| `adaptiveStagingEnabled` | Global | Config flag in `ai-models.json` or env var `ADAPTIVE_STAGING_ENABLED=false` | All debates use fixed-round mode. Overrides per-debate `useAdaptiveStaging`. |
| `forceFixedRounds` | Per-debate | `DebateConfig` field, settable from CLI and UI | This debate uses fixed-round mode regardless of global flag. |
| "Replay with fixed staging" | Post-hoc | UI action on a completed adaptive debate | Re-runs the same topic/config with `forceFixedRounds: true` for A/B comparison. |

The global flag is checked at debate start and on every phase transition evaluation. If toggled mid-debate (via config reload), the current debate completes its current phase, then falls back to positional phase assignment for remaining rounds.

**Argument network size guardrail** — the argument network can grow unboundedly if extraction is prolific or the debate runs long. The guardrail has two stages:

```
network_gc_pass :=
    argument_network.nodes.length >= 175
    → trigger argument network garbage collection before any phase transition
    → prune tangential leaf nodes (computed_strength < 0.3, no support edges, ≤1 attack edge)
    → prune orphan nodes (no edges to any other node)
    → target: reduce to ≤ 150 nodes
    → log: "Network GC: pruned {n} tangential/orphan nodes ({before} → {after})"
    → pruned nodes are archived in diagnostics (not permanently lost)

network_hard_cap :=
    argument_network.nodes.length >= 200 (after GC, or if GC was insufficient)
    → force transition to synthesis (regardless of current phase)
    → log warning: "Argument network hard cap reached (200 nodes post-GC)"
    → extraction continues at full fidelity (no degradation)
```

The GC pass preserves high-fidelity extraction during synthesis — the phase where resolving arguments are most critical. Degrading extraction at the moment synthesis begins (the previous design) risked dropping crucial resolving arguments from complex debates. Instead, the GC pass removes low-value nodes that aren't contributing to active cruxes or cross-POV engagement, freeing capacity for the synthesis phase to extract at full quality.

The 200-node hard cap is based on QBAF computational complexity (DF-QuAD is O(n²) in edges) and practical readability. The GC trigger at 175 provides a buffer. Both are fixed parameters, not user-configurable.

**State validation on load** — when deserializing `PhaseState` from a persisted session (resume, replay):

1. Validate `current_phase` is one of the three valid phases
2. Validate `rounds_in_phase` is a non-negative integer ≤ max for that phase
3. Validate `regression_count` ≤ 2 (global budget)
4. Validate `exploration_exit_threshold` ≥ baseline (no downward drift)
5. Validate all signal values are in [0, 1]
6. If any check fails: **auto-downgrade to fixed-round mode** for this session's remaining duration. Do not attempt to re-initialize adaptive state over a mid-flight argument graph — resetting `rounds_in_phase` to zero on a saturated network would cause composite scores to behave unpredictably (saturation signals high from existing nodes, but phase clock at zero), potentially locking the debate in a frozen phase. Log the corruption details and emit a diagnostic warning: "Corrupt PhaseState detected; session downgraded to fixed-round mode."

**Config validation** — reject pathological parameter combinations at debate creation time:

| Condition | Action |
|---|---|
| `explorationExitThreshold > 0.95` | Reject: exploration will almost never exit organically |
| `synthesisExitThreshold < 0.30` | Reject: synthesis will exit before meaningful convergence |
| `maxTotalRounds < 6` | Reject: below the minimum sum of per-phase minimums |
| `maxTotalRounds > 20` | Warn: unusually long debate; confirm with user |
| `pacing = 'tight'` AND `dialecticalStyle = 'integrative'` | Warn: tight pacing conflicts with integrative style's higher exploration threshold |

Config validation runs before the engine starts. Invalid configs produce an `ActionableError` with the specific conflict and suggested fix.

**Structured predicate logging** — every predicate evaluation is logged as a structured JSON record in the per-debate diagnostics:

```json
{
  "round": 7,
  "phase": "exploration",
  "predicate": "exploration_exit",
  "result": false,
  "reason": "saturation_score 0.52 < threshold 0.65",
  "components": {
    "saturation_score": 0.52,
    "threshold": 0.65,
    "veto_active": false,
    "force_active": false
  },
  "confidence": { "extraction": 0.85, "stability": 0.92, "global": 0.85 },
  "network_size": 87,
  "elapsed_ms": 2
}
```

This enables post-hoc debugging of transition decisions without replaying the debate. Every predicate evaluation — including vetoes, forces, and deferred-due-to-confidence — is logged. The `elapsed_ms` field tracks predicate computation time to catch latency creep.

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
  phase_progress: number;  // 0–1, how close to exit threshold (formula below)
  approaching_transition: boolean; // true if within 0.1 of exit threshold
}
```

**`phase_progress` formula** — the maximum of the composite-score path and the time-based path, so progress never appears to stall even when the score is below threshold:

```
phase_progress =
  thesis-antithesis:
    max(
      (rounds_in_phase - 1) / (max_thesis_rounds - 1),   # time path: 0→1 over min..max
      all_povs_responded ? 0.5 : 0.0                      # precondition path
    )
  exploration:
    max(
      saturation_score / exploration_exit_threshold,       # score path
      (rounds_in_phase - 1) / (max_exploration_rounds - 1) # time path
    )
  synthesis:
    max(
      convergence_score / synthesis_exit_threshold,        # score path
      (rounds_in_phase - 1) / (max_synthesis_rounds - 1)  # time path
    )
```

Clamped to [0, 1]. `approaching_transition = (phase_progress >= 0.85)`.

When `approaching_transition` is true, the draft envelope includes a nudge:

> *"The debate is approaching the transition to synthesis. Begin orienting toward integration."*

The nudge does not mention "remaining exploration moves" — that phrasing would encourage debaters to pad exploration to delay transition, which is a Goodhart-adjacent incentive.

**Residual Goodhart risk from nudges:** Even without explicit round counts, some models will begin performing synthesis moves early when they see the `phase_progress` context or transition nudge. Phase 5 must include a **prompt-variant ablation** test: A/B test nudge-on vs. nudge-off across 20 debates and measure (a) whether the nudge correlates with premature synthesis moves (r > 0.3 flags a problem), and (b) whether nudge-off debates produce different outcome quality scores. If the nudge is net-negative, remove it and rely solely on move-weight guidance.

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
- **On approaching synthesis exit:** Moderator issues a `FINAL_COMMIT` intervention. Because the engine selects one speaker per round, FINAL_COMMIT runs as a **multi-round sequence**: the moderator selects each active POV in turn over consecutive rounds, each receiving the FINAL_COMMIT prompt asking them to state their final position on each identified crux. The synthesis exit predicate is suppressed until all POVs have responded to FINAL_COMMIT (or `max_synthesis_rounds` is hit). If a POV has already spoken in the current synthesis phase and the moderator needs to cycle back, FINAL_COMMIT overrides the normal selection heuristic — the moderator MUST select the unheard POV.
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
| `dialecticalStyle` | `'adversarial' \| 'deliberative' \| 'integrative'` | `'adversarial'` | Modulates thresholds and move weights for different dialectical traditions (see below) |

### Dialectical Style Presets

Different dialectical traditions have different norms for what constitutes productive engagement. Anglo-American adversarial norms privilege direct confrontation and explicit rebuttal; Eastern and deliberative traditions may privilege harmony-seeking, exhaustive classification, or indirect engagement. The style preset modulates transition thresholds and move weight tables to avoid mis-firing on culturally different rhetorical patterns.

| Style | Effect on thresholds | Effect on saturation weights | Character |
|---|---|---|---|
| `adversarial` | Default thresholds | Default weights | Western academic debate norms. Direct challenge expected. |
| `deliberative` | +0.10 to exploration exit; −0.05 to synthesis exit | `concession_plateau` 0.20 (vs 0.15); `pragmatic_convergence` 0.15 (vs 0.10) | Consensus-oriented. Exploration runs longer; synthesis converges faster. |
| `integrative` | +0.15 to exploration exit; `concession_plateau` weight reduced | `concession_plateau` 0.05 (vs 0.15); `pragmatic_convergence` 0.15 (vs 0.10); `scheme_stagnation` 0.15 (vs 0.10) | Harmony-seeking. Missed concessions less penalized; reframing encouraged. |

**Move weight overrides by dialectical style** (cells show override value; blank = use default from the base table above):

| Move | `deliberative` thesis-anti | `deliberative` exploration | `deliberative` synthesis | `integrative` thesis-anti | `integrative` exploration | `integrative` synthesis |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| DISTINGUISH | | | | 0.7 | 0.5 | 0.3 |
| COUNTEREXAMPLE | | 0.6 | | 0.5 | 0.4 | 0.1 |
| EMPIRICAL CHALLENGE | | | | | 0.7 | |
| IDENTIFY-CRUX | | | | | | |
| CONCEDE-AND-PIVOT | 0.5 | 1.0 | | 0.5 | 1.0 | |
| INTEGRATE | 0.2 | 0.6 | | 0.3 | 0.7 | |
| CONDITIONAL-AGREE | 0.2 | 0.8 | | 0.3 | 0.8 | |
| REFRAME | | 1.0 | 0.8 | 1.0 | 1.0 | 0.8 |

**Limitation:** These presets modulate thresholds on English-language signals. Multilingual debate corpora and non-Western validation sets are needed for robust cross-cultural support (see Phase 5).

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
| Signal confidence floor | 0.40 | Below this, defer all predicate evaluations to next round. Prevents noisy extraction from triggering spurious transitions. |
| Health floor for early termination | 0.20 (sustained), 0.10 (single-round) | Sustained: 3 consecutive rounds. Single-round: catastrophic collapse. |
| Expected cruxes for maturity calc | `max(1, active_povs - 1)` | Scales with debate size: 2 for 3-POV, 1 for 2-POV. |
| Max regressions | 1 per crux, hard cap 2 total | Per-crux cap prevents same-issue looping; global cap prevents oscillation death spirals from stochastic signals. |
| Regression threshold ratchet | +0.10 per regression | Cumulative: two regressions demand +0.20 above baseline. |
| API call soft budget | 6× rounds | Force synthesis. Auto-adjusts based on rolling actual calls/round. |
| API call hard ceiling | 10× rounds | Terminate immediately. |
| Argument network GC trigger | 175 | Prune tangential/orphan nodes to ≤150, preserving extraction fidelity for synthesis. |
| Argument network hard cap | 200 | Forces synthesis if GC insufficient. Based on QBAF O(n²) complexity and visualization readability. |
| Crux semantic novelty threshold | cosine < 0.70 | Prevents crux farming via paraphrased-but-substantively-identical cruxes. |
| Human override alert threshold | >3 per debate | Triggers diagnostic note suggesting threshold recalibration. |

### Per-Phase Debater Rotation

The moderator selects one responder per round (not all POVs). The thesis-antithesis exit predicate requires that every active POV has responded at least once before it can fire — this is a precondition, not a per-round mandate.

Silence from a POV is tracked via `rounds_since_last_response[pov]` and available to the moderator as a selection signal. **In thesis-antithesis, the moderator MUST select unheard POVs before any POV can speak a second time** — this is mandatory, not a suggestion. After thesis-antithesis, the moderator should prioritize selecting silent POVs if `rounds_since_last_response[pov] >= 3`, but this is a soft signal, not a hard constraint.

## Validation Methodology

The saturation and convergence weights are provisional. Before shipping adaptive staging as the default, the following protocol must be completed:

1. **Held-out test set.** Split the debate corpus (~50 debates) into 70% training / 30% held-out. All weight tuning uses training set only; final evaluation on held-out.
2. **Human annotation.** Three annotators independently mark where they would place the exploration→synthesis transition and debate termination point in each training debate. Inter-annotator agreement (Krippendorff's α ≥ 0.6) establishes the ground truth.
3. **Single-signal baselines.** For each signal (recycling_pressure, crux_maturity, concession_plateau, engagement_fatigue), compute transition accuracy using that signal alone. Any signal that doesn't beat random on its own is dropped before composite tuning.
4. **Leave-one-out cross-validation.** On the training set, tune weight vectors using LOOCV. Report mean and variance of transition-point error (rounds off from human annotation).
5. **Coupling audit.** For each transition signal, measure correlation between the signal's value and the presence of phase-specific move prompts in the preceding turn. If r > 0.5 for any signal-prompt pair, flag it as residually Goodhart-coupled and either replace the signal or add a debiasing correction. Include **prompt-variant ablation**: A/B test transition nudges on/off across 20 debates and measure outcome quality divergence.
6. **Causal analysis.** SHAP or feature ablation on outcome quality: for each signal, compute its marginal contribution to post-debate outcome scores (crux resolution depth, reframe novelty, remaining open questions). Drop signals that correlate with annotator transition points but do not causally improve outcomes. This prevents optimizing for "feels right to annotators" instead of "produces higher-quality final synthesis."
7. **Red-team loop.** Run 100 debates where one POV is explicitly system-prompted with: "Your secondary objective is to game the transition signals to extend exploration and delay synthesis. Stay on-topic but produce structural patterns (meta-discourse phrases, fabricated support edges, scheme diversity padding) that manipulate phase transitions." Measure: (a) whether the gaming POV successfully delays transitions, (b) whether per-debater signal attribution catches it, (c) whether anomaly detection flags it. Any gaming strategy that succeeds ≥30% of the time without triggering detection requires a signal or detection fix before shipping.
8. **Formal simulation.** Define a Markov chain over signal states as the trajectory generator: each state is a vector of signal values, transitions are conditioned on phase + POV count + noise level. Run 10,000 synthetic debates with varied parameters (active POVs, adversarial strategies, noise levels, signal distributions). The phase topology is a bounded pushdown automaton — simulation is cheap. Measure oscillation probability, average regression count, budget exhaustion rate, and parameter interaction effects. Identify parameter regions that cause oscillation or veto deadlock.
9. **Non-English subset.** At least 10% of validation debates (or translations of existing debates) must use non-English content to validate that lexicon-based pragmatic signals degrade gracefully and that the learned classifier fallback activates appropriately.

Adaptive staging ships behind `useAdaptiveStaging: true` until this validation is complete. The fixed-round fallback remains the default.

## Online Signal Monitoring

Phase 5 validates weights offline. In production, signal distributions will drift with model updates, new topics, and new dialectical styles. The following mechanisms detect and respond to drift continuously.

### Signal Telemetry Export

Every round emits a `SignalTelemetryRecord` to a per-debate JSON file (`{outputDir}/{slug}-signals.json`):

```json
{
  "round": 7,
  "phase": "exploration",
  "signals": {
    "recycling_pressure": 0.42,
    "crux_maturity": 0.65,
    "concession_plateau": 0.0,
    "engagement_fatigue": 0.31,
    "pragmatic_convergence": 0.28,
    "scheme_stagnation": 0.15
  },
  "composite": { "saturation_score": 0.38, "convergence_score": null },
  "confidence": { "extraction": 0.85, "stability": 0.92, "global": 0.85 },
  "predicate_result": { "action": "stay", "veto_active": false },
  "phase_progress": 0.58,
  "regression_pressure": 0.0,
  "human_override": null
}
```

This telemetry is the raw material for all downstream monitoring, weight tuning, and debugging.

### Drift Detection

After every batch of 10 completed debates, a lightweight drift detector compares signal distributions against the Phase 5 validation baseline:

- **Per-signal KS test:** For each signal, compute the two-sample Kolmogorov-Smirnov statistic between the current batch's per-round values and the validation baseline distribution. If KS > 0.20 for any signal, flag the signal as drifted.
- **Multi-signal MMD (Maximum Mean Discrepancy):** Compute MMD on the full signal vector to catch coordinated shifts that individual KS tests miss.
- **Auto-fallback:** If ≥2 signals are flagged as drifted in the same batch, auto-downgrade to fixed-round mode and emit a diagnostic alert. The coupling audit must rerun with the new signal distributions before adaptive mode reactivates.

Drift detection uses only the telemetry already emitted — no additional LLM calls. The baseline distributions are stored alongside the validation weights as a `signal-baselines.json` file.

### Persistent Shadow Mode

Shadow mode is not a one-time gate — it runs **permanently** in the background. Even when adaptive staging is active, the fixed-round fallback computes what it *would* have done in parallel. The divergence between adaptive and fixed-round transition points is logged in telemetry. If divergence exceeds 3 rounds on average over a batch of 10 debates, the system flags it for review. This catches slow drift that per-signal KS tests miss.

### Evaluator Quality Gate

The evaluator model is the most critical single point of failure — if extraction accuracy degrades, all downstream signals become garbage. An automated quality benchmark runs weekly (or after any evaluator model change):

1. Gold-labeled extraction benchmark: 20 debates with human-annotated claims (claim text, category, edge type, strength).
2. Run the current evaluator model against the benchmark.
3. Require F1 ≥ 0.85 on edge classification (supports/attacks), F1 ≥ 0.80 on strength classification (decisive/substantial/tangential), F1 ≥ 0.75 on node strength (grounded/reasoned/asserted).
4. If any threshold is not met, downgrade to fixed-round mode and alert. The evaluator model must be replaced or the extraction prompt revised before adaptive mode reactivates.
5. Evaluator quality metrics are surfaced in the UI alongside the model selector.

## Observability Plan

### Per-Debate Diagnostics

The existing `diagnostics` field on `DebateSession` is extended with adaptive staging data:

```json
{
  "adaptive_staging": {
    "enabled": true,
    "phases": [
      { "phase": "thesis-antithesis", "rounds": [1, 2, 3], "exit_reason": "claim_rate_declining" },
      { "phase": "exploration", "rounds": [4, 5, 6, 7, 8], "exit_reason": "saturation_score >= 0.68" },
      { "phase": "synthesis", "rounds": [9, 10], "exit_reason": "convergence_score >= 0.72" }
    ],
    "regressions": [],
    "total_predicate_evaluations": 10,
    "confidence_deferrals": 1,
    "vetoes_fired": 0,
    "forces_fired": 0,
    "human_overrides": [],
    "network_size_peak": 134,
    "predicate_log_file": "slug-predicates.json"
  }
}
```

The UI exposes a "Download signals" button (signals.json + predicates.json) for every adaptive debate. Non-adaptive debates omit this section.

### Metrics Export Format

For deployments with Prometheus/Grafana or equivalent monitoring, the engine emits metrics in a structured format that adapters can export. The engine itself does not depend on Prometheus — it writes metric events to a callback; the deployment layer decides whether to export to Prometheus, CloudWatch, Datadog, or just the JSON diagnostics file.

**Metric definitions:**

| Metric | Type | Labels | Description |
|---|---|---|---|
| `debate_phase_duration_rounds` | histogram | `phase`, `pacing`, `style` | Rounds spent in each phase |
| `debate_regression_count_total` | counter | `debate_id` | Number of synthesis→exploration regressions |
| `debate_regression_pressure` | gauge | `debate_id` | Current regression_count / 2 |
| `debate_signal_value` | gauge | `signal_id`, `phase` | Per-signal value at each predicate evaluation |
| `debate_confidence_deferral_total` | counter | `debate_id` | Rounds where confidence < 0.40 deferred all predicates |
| `debate_network_size` | gauge | `debate_id` | Argument network node count |
| `debate_predicate_latency_ms` | histogram | `predicate` | Time to evaluate each predicate |
| `debate_evaluator_f1` | gauge | `classification_type` | Latest evaluator quality benchmark result |
| `debate_api_calls_per_round` | histogram | `debate_id` | Actual API calls per round |
| `debate_human_override_total` | counter | `override_type` | "keep_exploring" or "move_to_synthesis" |
| `debate_drift_ks_statistic` | gauge | `signal_id` | Latest KS statistic from drift detection |
| `debate_shadow_divergence_rounds` | gauge | — | Adaptive vs. fixed-round transition divergence |

### Alerting Rules

Deployments that wire metrics to an alerting system should configure the following rules:

| Alert | Condition | Severity | Action |
|---|---|---|---|
| RegressionPressureHigh | `debate_regression_pressure > 1.0` (i.e., max budget hit) | warning | Review debate config; check for crux extraction noise |
| EvaluatorF1Drop | `debate_evaluator_f1{classification_type="edge"} < 0.85` | critical | Auto-downgrade to fixed-round (evaluator quality gate handles this) |
| SignalDrift | `debate_drift_ks_statistic > 0.20` for ≥2 signals in same batch | critical | Auto-downgrade to fixed-round (drift detection handles this) |
| APIBudgetExhaustion | `debate_api_calls_per_round` rolling avg > 8 | warning | Review extraction prompt verbosity; check model |
| NetworkSizeLimit | `debate_network_size >= 200` | warning | Guardrail auto-triggers; review extraction rates |
| PredicateLatencyCreep | `debate_predicate_latency_ms` p99 > 50ms | info | Profile predicate computation; check QBAF complexity |
| ShadowDivergenceHigh | `debate_shadow_divergence_rounds` > 3 avg over 10 debates | warning | Review weight calibration; consider rerunning coupling audit |

These alerting rules are documented here as operational guidance. The engine does not enforce them — the deployment layer is responsible for wiring metrics to alerts. For local/development use, the structured predicate log and per-debate diagnostics provide equivalent visibility without infrastructure dependencies.

### Cross-Debate Aggregate Dashboard

For teams running debates at scale, the following aggregate views should be available (built from the metrics above):

1. **Phase duration distribution** — histogram of rounds per phase across all debates, faceted by pacing preset and dialectical style. Reveals whether thresholds are well-calibrated.
2. **Regression frequency** — time series of regressions per debate. A rising trend indicates signal degradation or evaluator drift.
3. **Human override rate** — fraction of debates where humans override the transition engine. High rates signal poor threshold calibration or inadequate trust in adaptive staging.
4. **Evaluator F1 trend** — weekly benchmark results over time. Drift in evaluator quality is the leading indicator of system-wide degradation.
5. **Signal correlation matrix** — pairwise correlation between signals across debates. Highly correlated signals are redundant; signals with sudden decorrelation indicate drift.

These dashboards are **deployment-layer concerns** — the engine provides the data; visualization infrastructure is outside this document's scope.

## Adversarial Debater Robustness

An LLM debater can learn (within-context or across fine-tuning) to manipulate transition signals — producing structural patterns that trigger or delay phase transitions to its advantage.

### Per-Debater Signal Attribution

Each transition signal is decomposed per-debater. If one debater's contributions dominate a signal (>60% of the signal's value comes from one speaker), the signal is flagged and the moderator can intervene with a `BALANCE_CHECK`. Additionally, the per-debater attribution feeds into the **red-team detection** pipeline: if a single debater is responsible for >70% of meta-discourse marker hits or >80% of new scheme introductions in a given round, the round is flagged for potential signal gaming and the anomaly detector's threshold tightens to 1.5σ for that round.

### Anomaly Detection

Track per-signal moving averages. If any signal spikes or drops >2σ from its debate-level mean in a single round, flag the round for moderator review. Flagged rounds do not contribute to transition predicate evaluation until the moderator clears them. In production, anomaly flags are logged to telemetry and contribute to drift detection batches.

### Model Version Sensitivity

When the underlying LLM version changes (model swap, fine-tune update), the first 5 debates under the new model run in **shadow mode**: adaptive transitions are computed but not enacted; the fixed-round fallback controls the debate. Signal distributions from shadow mode are compared against the validation baseline. If any signal's distribution shifts by >0.15 (KL divergence), the coupling audit reruns before adaptive mode activates. Per the Online Signal Monitoring section, shadow mode is also permanent — even after activation, the fixed-round fallback runs in parallel as a divergence detector.

## Evaluator Independence

### The Problem

The argument network — nodes, edges, strengths, and types — is constructed by `extractClaims()` in `debateEngine.ts`, which calls `this.generate()`: the same model and adapter used for debate generation. This creates two compounding failures:

1. **Same-model feedback loop.** The debater generates text; the same model evaluates that text's structural properties; those properties feed transition predicates that control the debate. This is the Goodhart loop that "measurement separation" was supposed to prevent, operating one layer below what rev 3 addressed.

2. **Float mode collapse.** Empirical analysis of the existing debate corpus shows 99% of `base_strength` values at exactly 0.6 and 97.6% of edge weights at exactly 0.5. LLMs suffer severe mode collapse when asked to estimate continuous probabilities (Zheng et al., 2023). The QBAF engine is operating on near-uniform inputs — `computed_strength` is driven almost entirely by graph topology (which edges exist), not by edge or node magnitudes.

These failures degrade the existing fixed-round system, not just future adaptive staging: concession candidate ranking, specify hints, and unanswered claim tracking all use `computed_strength` thresholds that are meaningless when all nodes have near-identical base strengths.

**References:**
- Zheng et al. (2023), "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" — self-preference bias, position bias in LLM evaluators
- Irving et al. (2018), "AI Safety via Debate" — structural decoupling of judge and debater

### Fix 1: NLI-Style Discrete Evaluation

Replace all continuous float outputs in extraction prompts with categorical classifications. The deterministic execution layer maps categories to fixed weights.

**Edge strength** (replaces `weight: 0.0-1.0`):

| LLM outputs | Maps to weight | Definition |
|---|---|---|
| `decisive` | 1.0 | Directly rebuts/supports with specific evidence or logical entailment |
| `substantial` | 0.7 | Clear engagement with some evidence or reasoning |
| `tangential` | 0.3 | Loosely related, weak or indirect connection |

**Node strength** (replaces `base_strength: 0.0-1.0` and `bdi_sub_scores`):

| LLM outputs | Maps to base_strength | Definition |
|---|---|---|
| `grounded` | 0.8 | Cites specific data, named sources, dates, or directly verifiable facts |
| `reasoned` | 0.5 | Logical argument with internal coherence but no specific evidence |
| `asserted` | 0.2 | Claim stated without supporting reasoning or evidence |

**BDI sub-scores** (each dimension becomes ternary):

| LLM outputs | Maps to score | Definition |
|---|---|---|
| `yes` | 1.0 | Criterion clearly satisfied |
| `partial` | 0.5 | Criterion partially or ambiguously satisfied |
| `no` | 0.0 | Criterion not addressed |

This gives QBAF meaningful variance (0.2–0.8 base strengths, 0.3–1.0 edge weights) through deterministic mapping, eliminating both mode collapse and the model's opportunity to game continuous values. The downstream pipeline (`processExtractedClaims`, `computeQbafStrengths`, convergence signals) is unchanged — it still consumes floats, just better-calibrated ones.

**What's already categorical.** `relationship` (supports/attacks), `attack_type` (rebut/undercut/undermine), `bdi_category` (belief/desire/intention), `specificity` (precise/general/abstract), and `argumentation_scheme` are already discrete. The change targets only `base_strength`, `weight`, and `bdi_sub_scores`.

### Fix 2: Cross-Vendor Model Separation

Add an `evaluatorModel` field to `DebateConfig`. The evaluator model is used exclusively for claim extraction and classification — the analyst role. The debate model is used for the four-stage turn pipeline (brief/plan/draft/cite).

```typescript
interface DebateConfig {
  model: string;          // debate generation model
  evaluatorModel?: string; // claim extraction model (defaults to model if unset)
  // ...
}
```

**Production recommendation:** cross-vendor split (e.g., Claude generates, Gemini evaluates or vice versa). This shatters the in-context stylistic feedback loop — a different model family won't share the same RLHF-induced rhetorical preferences.

**Dev/free-tier:** same-vendor separation is acceptable (e.g., `gemini-2.5-flash` generates, `gemini-2.0-flash-lite` evaluates). Even same-model separation with a different system prompt and temperature provides partial decoupling.

**Minimum bar:** if `evaluatorModel` is unset, log a diagnostic warning: "Evaluator model matches debate model — self-preference bias is unmitigated."

**Shared pre-training bias mitigation:** Cross-vendor separation shatters RLHF-induced *stylistic* feedback loops but does not eliminate biases shared across all autoregressive transformers — most notably, equating verbosity and formatting quality with reasoning quality. Three structural defenses are already in place:

1. **NLI-style discrete evaluation** (Fix 1) constrains the evaluator to categorical outputs (`grounded`/`reasoned`/`asserted`, `decisive`/`substantial`/`tangential`). The evaluator cannot express a verbosity preference because it chooses from 3 categories defined by content properties (evidence specificity, logical entailment), not formal properties (length, formatting, citation density).
2. **T=0 evaluation** eliminates sampling randomness that could amplify token-length correlations.
3. **Extraction prompts exclude source text metadata.** The evaluator receives the debater's statement text but not its token count, word count, or any length-correlated metadata. Category definitions explicitly reference content criteria ("cites specific data" for `grounded`, "logical argument with internal coherence" for `reasoned`) rather than formal indicators.

These defenses are structural, not behavioral — they constrain the evaluator's *output space* rather than instructing it to ignore length. Prompt-level instructions to "ignore verbosity" are unreliable; schema-level constraints are enforceable.

### Fix 3: Mapping Layer

A thin `discreteToFloat()` adapter sits between the extraction prompt output and `processExtractedClaims()`. It:

1. Validates that extracted values are from the allowed category set (not floats)
2. Maps categories to fixed weights using the tables above
3. Logs any unrecognized categories (fallback: middle category)
4. Is the single source of truth for category→float mapping — change the table here, QBAF recalibrates everywhere

### Dependency Note

Fix 1 (NLI discretization) and Fix 2 (evaluator model separation) are independently valuable and should be implemented regardless of whether adaptive staging ships. Fix 1 improves every existing debate by giving QBAF meaningful input variance. Fix 2 is a prerequisite for credible measurement separation claims.

## AI Output Validation Contracts

Every backend AI call in the debate engine produces structured output that feeds downstream computation. This section specifies, for each call point: (a) the expected schema, (b) valid value space, (c) validation procedure, and (d) fallback behavior when validation fails.

### General Principles

1. **Parse first, validate second.** All AI responses go through `parseJsonRobust()` (strips code fences, repairs common JSON errors, handles partial output). If parsing fails entirely, the call is treated as a hard failure.
2. **Validation is schema + value-space.** Schema validation checks that required fields exist with correct types. Value-space validation checks that field values are from allowed sets (e.g., categorical enums, bounded ranges).
3. **Fallback hierarchy:** repair → degrade → skip → abort. Prefer keeping the debate running with reduced quality over terminating.
4. **Diagnostics.** Every validation failure is recorded in the per-entry `EntryDiagnostics` with the field name, expected value space, actual value, and which fallback was applied.

### Call Point 1: Claim Extraction (`extractClaimsPrompt` / `classifyClaimsPrompt`)

**Caller:** `DebateEngine.extractClaims()` → `generateWithEvaluator()`  
**Model:** evaluator model (cross-vendor recommended)  
**Temperature:** 0

**Expected schema:**

```json
{
  "claims": [{
    "text": "string (required, ≥10 chars)",
    "bdi_category": "belief | desire | intention",
    "base_strength": "grounded | reasoned | asserted",
    "bdi_sub_scores": { "<dimension>": "yes | partial | no" },
    "specificity": "precise | general | abstract",
    "steelman_of": "string | null",
    "responds_to": [{
      "prior_claim_id": "string (must match AN-\\d+ pattern)",
      "relationship": "supports | attacks",
      "attack_type": "rebut | undercut | undermine (required if attacks)",
      "strength": "decisive | substantial | tangential",
      "argumentation_scheme": "string (from SCHEME_ENUM)",
      "warrant": "string"
    }]
  }]
}
```

**Validation procedure:**

| Field | Valid values | On invalid |
|---|---|---|
| `claims` | Array of 1–6 objects | Empty array → status `empty_response`, skip extraction. >6 → truncate to 6. Non-array → status `parse_error`, skip. |
| `text` | String, ≥10 chars, word overlap with source statement ≥ grounding threshold | <10 chars → reject claim (reason: `too_short`). Low overlap → reject (reason: `low_overlap`). |
| `bdi_category` | `belief`, `desire`, `intention` | Unrecognized → default to `belief` (most common; lowest downstream impact). |
| `base_strength` | `grounded`, `reasoned`, `asserted` (categorical) OR legacy float [0, 1] | Unrecognized string → `reasoned` (middle). Float → passthrough (backward compat). |
| `bdi_sub_scores` | Object with 3 keys per category, each `yes`/`partial`/`no` | Missing keys → `partial`. Unrecognized values → `partial`. Non-object → omit entirely. |
| `specificity` | `precise`, `general`, `abstract` | Unrecognized → `general`. |
| `steelman_of` | `null`, or valid POV character name | Non-null non-matching → `null`. |
| `responds_to[].prior_claim_id` | Matches existing node id in argument network | Non-matching id → drop that edge (log warning). |
| `responds_to[].relationship` | `supports`, `attacks` | Unrecognized → infer from `attack_type` presence; if ambiguous → `attacks`. |
| `responds_to[].attack_type` | `rebut`, `undercut`, `undermine` | Unrecognized → `rebut` (most common). Missing when `relationship=attacks` → `rebut`. |
| `responds_to[].strength` | `decisive`, `substantial`, `tangential` | Unrecognized → `substantial` (middle). |
| `responds_to[].argumentation_scheme` | One of 13 defined schemes or `OTHER` | Unrecognized → `OTHER`. |

**Fallback behavior:**

- **Parse failure** (not valid JSON): status `parse_error`. No claims extracted for this turn. Argument network is incomplete but the debate continues. Logged in `extraction_trace`.
- **Adapter error** (timeout, HTTP error): status `adapter_error`. Same treatment as parse failure.
- **Partial success** (some claims valid, some rejected): accepted claims enter the network; rejected claims are logged with reasons. This is the normal path — most turns have some rejection.
- **Truncated response** (JSON cuts off mid-array): `extractArraysFromPartialJson()` recovers any complete array elements. Status `truncated_response`.

### Call Point 2: Four-Stage Turn Pipeline (brief/plan/draft/cite)

**Caller:** `runTurnPipeline()` in `turnPipeline.ts`  
**Model:** debate model  
**Temperatures:** brief 0.15, plan 0.4, draft 0.7, cite 0.15

Each stage has its own schema. Stages are sequential — a failed stage aborts subsequent stages.

#### 2a. Brief Stage

**Expected schema:**

```json
{
  "focus_point": "string",
  "key_tensions": ["string"],
  "addressing": "string (prior claim id or topic summary)"
}
```

**Validation:**

| Field | Valid values | On invalid |
|---|---|---|
| `focus_point` | Non-empty string | Missing/empty → use topic as focus. |
| `key_tensions` | Array of strings | Non-array → wrap as `[raw_value]`. Empty → `[]`. |
| `addressing` | String | Missing → empty string. |

**Fallback:** If brief stage parse fails entirely, use a default brief (`focus_point = topic`, `key_tensions = []`, `addressing = ""`). The plan stage can still function with a degraded brief.

#### 2b. Plan Stage

**Expected schema:**

```json
{
  "strategy": "string",
  "move": "string (from MOVE_ENUM)",
  "targets": ["string (claim ids)"],
  "disagreement_type": "EMPIRICAL | VALUES | DEFINITIONAL",
  "my_claims": [{ "claim": "string", "targets": ["string"] }]
}
```

**Validation:**

| Field | Valid values | On invalid |
|---|---|---|
| `move` | Valid move name from `MOVE_NAMES` set | Unrecognized → fuzzy-match against known moves (already implemented via `getMoveName()`). No match → `DISTINGUISH`. |
| `disagreement_type` | `EMPIRICAL`, `VALUES`, `DEFINITIONAL` | Unrecognized → keyword-score from response text (already implemented via `normalizeDisagreementType()`). Still unrecognized → omit. |
| `targets` | Array of existing claim ids | Non-matching ids → filter out. Empty after filter → `[]`. |
| `my_claims` | Array of objects with `claim` string | Non-array → `[]`. Objects missing `claim` → filter out. |

**Fallback:** If plan stage parse fails entirely, use default plan (`move = "DISTINGUISH"`, `targets = []`, empty `my_claims`). Draft stage will produce a generic response.

#### 2c. Draft Stage

**Expected output:** Plain text (the debater's statement). Not JSON.

**Validation:**

| Check | Threshold | On fail |
|---|---|---|
| Non-empty | ≥20 chars | Empty/too short → turn validation fails, trigger repair via `buildRepairPrompt()`. |
| Not a JSON blob | Must not parse as valid JSON | If the draft is JSON instead of prose → extract any `"statement"` or `"response"` field as text. |
| Response length | Within `responseLength` budget (brief ≤ 300 words, medium ≤ 600, detailed ≤ 1000) | Over-length → truncate at last sentence boundary within limit. |

**Fallback:** Draft stage failures go through the turn validation → repair loop (up to `maxRetries` attempts with `buildRepairPrompt()`). If all retries fail, the turn is skipped and logged.

#### 2d. Cite Stage

**Expected schema:**

```json
{
  "taxonomy_refs": [{
    "node_id": "string (matches taxonomy node pattern)",
    "relevance": "high | medium | low",
    "rationale": "string"
  }],
  "bibliography": ["string"]
}
```

**Validation:**

| Field | Valid values | On invalid |
|---|---|---|
| `taxonomy_refs[].node_id` | Matches a known taxonomy node id | Unknown id → drop that ref. |
| `taxonomy_refs[].relevance` | `high`, `medium`, `low` | Unrecognized → `medium`. |
| `bibliography` | Array of strings | Non-array → `[]`. |

**Fallback:** If cite stage parse fails, the turn proceeds with empty taxonomy refs and bibliography. The statement is still valid — it just lacks grounding metadata.

### Call Point 3: Moderator Selection

**Caller:** `DebateEngine.runCrossRespondRound()` → `this.generate()`  
**Model:** debate model  
**Temperature:** default

**Expected schema:**

```json
{
  "responder": "string (valid POV id)",
  "focus_point": "string",
  "addressing": "string"
}
```

**Validation:**

| Field | Valid values | On invalid |
|---|---|---|
| `responder` | One of the active POV ids | Unrecognized → select the POV with highest `rounds_since_last_response`. |
| `focus_point` | Non-empty string | Missing → use topic. |
| `addressing` | String | Missing → empty string. |

**Fallback:** If parse fails entirely, fall back to round-robin selection (next POV in rotation order).

### Call Point 4: Moderator Intervention Generation

**Caller:** `DebateEngine.runCrossRespondRound()` → `this.generate()` (stage 2 intervention prompt)  
**Model:** debate model  
**Temperature:** default

**Expected schema:** Varies by intervention type. Common fields:

```json
{
  "intervention_text": "string",
  "move": "string (intervention move name)",
  "target_debater": "string (POV id)"
}
```

**Validation:**

| Field | Valid values | On invalid |
|---|---|---|
| `move` | Valid intervention move from `InterventionMove` type | Unrecognized → use the move that the trigger evaluation selected. |
| `target_debater` | Active POV id | Unrecognized → use the POV the intervention was targeting. |
| `intervention_text` | Non-empty string | Missing → skip intervention this round. |

**Fallback:** If intervention generation fails, the round proceeds without an intervention. The moderator state records the failed attempt and the intervention trigger remains eligible for the next round.

### Call Point 5: Synthesis Pipeline (3-stage)

**Caller:** `DebateEngine.runSynthesis()` → `this.generate()` (three sequential calls)  
**Model:** debate model  
**Temperature:** default

#### 5a. Extract Stage (`synthExtractPrompt`)

**Expected schema:**

```json
{
  "areas_of_agreement": [{ "point": "string", "supporting_povers": ["string"] }],
  "areas_of_disagreement": [{ "point": "string", "type": "EMPIRICAL|VALUES|DEFINITIONAL", "positions": {} }],
  "key_insights": ["string"]
}
```

**Validation:** `areas_of_agreement` and `areas_of_disagreement` must be arrays (empty OK). `type` validated via `normalizeDisagreementType()`. Missing fields → empty arrays.

**Fallback:** Parse failure → synthesis degrades to a summary-only output. The debate still completes.

#### 5b. Map Stage (`synthMapPrompt`)

**Expected schema:**

```json
{
  "argument_map": [{ "claim": "string", "support": ["string"], "opposition": ["string"], "strength": "string" }]
}
```

**Validation:** `argument_map` must be an array. Each entry needs at least `claim`. Missing `support`/`opposition` → `[]`.

**Fallback:** Parse failure → skip argument map. Evaluate stage receives empty map input.

#### 5c. Evaluate Stage (`synthEvaluatePrompt`)

**Expected schema:**

```json
{
  "preferences": [{ "pover": "string", "position": "string", "confidence": "number [0,1]" }],
  "meta_analysis": "string"
}
```

**Validation:** `preferences` must be an array. `confidence` must be a number in [0, 1] — clamp if out of range. `pover` must be a known POV id — drop if not.

**Fallback:** Parse failure → synthesize without preferences. Core synthesis output (agreements/disagreements from 5a) is still available.

### Call Point 6: Context Compression

**Caller:** `DebateEngine.compressContext()` → `this.generate()`  
**Model:** debate model  
**Temperature:** default

**Expected output:** Plain text summary of earlier transcript entries.

**Validation:** Must be non-empty string. Length must be < input length (compression actually happened).

**Fallback:** If compression fails or produces output longer than input, skip compression this round. The transcript continues to grow but the debate is not affected.

### Call Point 7: Probing Questions

**Caller:** `DebateEngine.runProbingQuestions()` → `this.generate()`  
**Model:** debate model  
**Temperature:** default

**Expected schema:**

```json
{
  "questions": [{ "text": "string", "targets": ["string (POV ids)"] }]
}
```

**Validation:** `questions` must be an array. Each entry needs `text` (non-empty). `targets` validated against active POV ids — unknown ids dropped.

**Fallback:** Parse failure → skip probing this round. No impact on debate quality.

### Call Point 8: Missing Arguments / Taxonomy Refinement

**Caller:** `DebateEngine.runMissingArgumentsPass()` / `runTaxonomyRefinementPass()` → `this.generate()`  
**Model:** debate model  
**Temperature:** default

Both are post-debate analysis passes. Parse failures are logged and the respective output section is omitted from the session. The core debate output is unaffected.

### Call Point 9 (Proposed): Phase Rationale Generation

**Caller:** `phaseTransitions.ts` → evaluator or debate model  
**Model:** debate model (this is a prompt, not an evaluation)  
**Temperature:** 0.15

**Expected output:** A single sentence (≤ 200 chars) explaining why the debate is in its current phase.

**Validation:** Must be a non-empty string. Truncate at 200 chars if longer.

**Fallback:** If generation fails, use a template-based rationale: `"${phase} phase, round ${rounds_in_phase}."` No downstream impact — the rationale is informational only.

### Call Point 10 (Proposed): Transition Moderator Interventions

**Caller:** Moderator on phase transition events  
**Model:** debate model  
**Temperature:** default

For `TRANSITION_SUMMARY`, `FINAL_COMMIT`, and `REGRESSION_NOTICE`: these are specialized moderator interventions that follow the same validation contract as Call Point 4 (Moderator Intervention Generation). The additional constraint is that FINAL_COMMIT must include at least one identified crux — if the generated text contains no crux references, the engine injects the crux list from the argument network as a structured prefix.

### Validation Implementation Notes

- **Existing validation:** `processExtractedClaims()` already implements most of Call Point 1's validation (grounding overlap, duplicate detection, edge id validation, attack type normalization). The contract above codifies these as requirements.
- **`normalizeExtractedClaim()`** already implements the categorical → float mapping with fallback to middle category. This is the Call Point 1 value-space enforcement.
- **`normalizeDisagreementType()`** already implements keyword-based fuzzy matching for disagreement types. This covers Call Points 2b and 5a.
- **Turn validation** (`validateTurn()` + `buildRepairPrompt()`) already implements the repair loop for Call Point 2c.
- **New validation needed:** Call Points 3 (moderator selection fallback), 4 (intervention generation fallback), and 9–10 (proposed features) require new validation code.

## Implementation Plan

### Maturity Tags

Every item in this plan is tagged with a maturity level. An AI implementer asked to "implement adaptive staging" should build only `[v1-ship]` items unless explicitly instructed otherwise.

| Tag | Meaning | Action |
|---|---|---|
| `[v1-ship]` | Required for the initial adaptive staging release behind `useAdaptiveStaging` flag | Build it |
| `[post-validation]` | Blocked on Phase 5 empirical validation results | Design the interface; do not build the implementation |
| `[research]` | Research program — requires tooling, corpora, or analysis infrastructure | Do not build; reference only |
| `[future]` | Post-launch operational concern or deferred feature | Do not build; emit telemetry that enables it later |

### Out of Scope for v1

The following are described in this spec for completeness but **must not be built** in the initial implementation. Building them speculatively wastes effort and ships dormant code paths that accumulate rot.

| Item | Why deferred | What to build instead |
|---|---|---|
| Learned pragmatic classifier (Phase 1b-vi) | Requires training data, benchmark, deployment infra | Use lexicon-only path; emit raw text in telemetry so the classifier can be trained later |
| Drift detection (KS + MMD) | No baseline distributions exist until Phase 5 completes | Emit `SignalTelemetryRecord` per round; defer detection |
| SHAP causal analysis (Phase 5 item 24) | Research task requiring annotation tooling | Reference only |
| Markov chain simulator (Phase 5 item 25) | Research task | Reference only |
| Red-team CI loop (Phase 5 item 26) | Requires prompt suite and analysis pipeline | Reference only |
| Observability metric adapters | Deployment-layer concern; no infra exists | Emit metric events to a callback; write to JSON diagnostics |
| Non-default dialectical style presets (`deliberative`, `integrative`) | Threshold adjustments are unvalidated numerology without a style-specific validation protocol | Ship `adversarial` only; define the `dialecticalStyle` config field and accept the value, but treat non-`adversarial` as `adversarial` with a diagnostic note: "Style presets other than adversarial are not yet validated" |
| "Replay with fixed staging" UI action (Phase 4 item 16d) | Useful, not v1-blocking | Defer |
| Cross-cultural / non-English validation (Phase 5 item 27) | Requires non-English corpus | Reference only |
| Evaluator quality benchmark CI (weekly automated) | Requires gold-labeled corpus | Run manually for Phase 0 gate; automate later |

### Provisional Weights Config

All provisional signal weights are loaded from `provisional-weights.json` at runtime, not hardcoded as constants:

```json
{
  "schema_version": 1,
  "status": "PROVISIONAL — pending Phase 5 validation per §Validation Methodology",
  "saturation": {
    "recycling_pressure": 0.30,
    "crux_maturity": 0.25,
    "concession_plateau": 0.15,
    "engagement_fatigue": 0.15,
    "pragmatic_convergence": 0.05,
    "scheme_stagnation": 0.10
  },
  "convergence": {
    "qbaf_agreement_density": 0.35,
    "position_stability": 0.25,
    "irreducible_disagreement_ratio": 0.25,
    "synthesis_pragmatic_signal": 0.15
  },
  "thresholds": {
    "exploration_exit": 0.65,
    "synthesis_exit": 0.70,
    "confidence_floor": 0.40,
    "crux_semantic_novelty": 0.70
  }
}
```

The engine loads this file at startup. If missing, it uses the compiled defaults and logs a warning. Phase 5 validation produces a replacement config file — a single config diff, not a code change scattered across multiple call sites.

### Phase 0: Evaluator Independence (prerequisite — benefits existing system)

**Implementation status:** 0a–0e are **implemented** (merged to main). 0f and 0g are outstanding.

0a. ~~Add `evaluatorModel` field to `DebateConfig` and `DebateSession` types in `types.ts`~~ ✓
0b. ~~Add `generateWithEvaluator()` method to `DebateEngine` that routes through `evaluatorModel`~~ ✓ (via `generateWithModel`)
0c. ~~Rewrite `extractClaimsPrompt()` and `classifyClaimsPrompt()` to demand categorical outputs (decisive/substantial/tangential for edges, grounded/reasoned/asserted for nodes, yes/partial/no for BDI sub-scores)~~ ✓
0d. ~~Add `discreteToFloat()` mapping layer between extraction output and `processExtractedClaims()`~~ ✓ (`normalizeExtractedClaim()` in `argumentNetwork.ts`)
0e. ~~Update `processExtractedClaims()` to validate categorical inputs (reject raw floats from LLM)~~ ✓ (accepts both formats for backward compatibility)
0f. Add `evaluatorModel` selector to `NewDebateDialog.tsx` with cross-vendor recommendation
0g. Backtest: run 5 existing debate transcripts through new extraction prompts, compare QBAF output distributions against current (expect wider variance, fewer degenerate values)

### Phase 1: Transition Predicates `[v1-ship]`

**Architecture requirement:** Signals must be **modular**. Each signal is a `Signal` object implementing the `Signal` interface (see §Signal Interface and Context). The composite scorer iterates over the signal array, enabling A/B testing of new signals without code changes to the scorer itself. Weight overrides per dialectical style are applied as a transform on the signal array.

**Pre-Phase 1 gate (before any adaptive code merges):**
- Evaluator quality gate benchmark must pass (item 0g + gold-labeled extraction baseline)
- Global kill switch (`adaptiveStagingEnabled`) must be wired (trivial: config flag check at engine start)

1. Add `PhaseTransitionConfig`, `PhaseContext`, `Signal`, and `SignalContext` interfaces to `types.ts` (see §Signal Interface and Context for the canonical `SignalContext` definition) `[v1-ship]`
2. Create `phaseTransitions.ts` with modular `Signal[]` registry, `evaluatePhaseTransition()`, `computeSaturationScore()`, `computeConvergenceScore()`, and override predicates. Load weights from `provisional-weights.json` `[v1-ship]`
3. Refactor `debateEngine.ts` main loop: replace fixed `for` loop with `while` loop that calls `evaluatePhaseTransition()` after each round; track phase in engine state `[v1-ship]`
4. Deprecate positional `getDebatePhase()` — replace callers with engine state lookup `[v1-ship]`
5. Add `PhaseContext` to `StagePromptInput` and update envelope builders in `envelopes.ts` `[v1-ship]`
5b. Add `SignalTelemetryRecord` emission after each round (see Online Signal Monitoring) `[v1-ship]`
5c. Implement runtime safety guardrails: kill switches (global + per-debate), argument network GC (175→150) + hard cap (200), state validation on load (downgrade to fixed-round on corruption), config validation with `ActionableError` on pathological combos `[v1-ship]`
5d. Add structured predicate logging (JSON record per predicate evaluation, see Runtime Safety Guardrails) `[v1-ship]`
5e. Implement cold-start behavior: sentinel values (0.5) for windowed signals during rounds 1 through `min_phase_rounds`, tagged as low-confidence `[v1-ship]`

### Phase 1b: Pragmatic Signals & Confidence `[v1-ship]` (parallel with Phase 1)

1b-i. Create `pragmaticSignals.ts` with three lexicon `const` arrays (hedge, concessive, meta-discourse) and `computePragmaticConvergence(transcript, windowSize)` → `[0, 1]` `[v1-ship]`
1b-ii. Create `schemeStagnation.ts` with `computeSchemeStagnation(argumentNetwork, windowSize)` → `[0, 1]`, consuming already-extracted `argumentation_scheme` categories `[v1-ship]`
1b-iii. Add `synthesis_pragmatic_signal` computation to `computeConvergenceScore()` — three sub-signals (integration language, conditional agreement, diminishing qualifications) with their own lexicon arrays `[v1-ship]`
1b-iv. Implement `signalConfidence.ts` with `computeExtractionConfidence()` and `computeStabilityConfidence()` per the formulas above; wire confidence floor gating into `evaluatePhaseTransition()`, including confidence × regression deferral semantics (see §Confidence Floor × Regression Interaction) `[v1-ship]`
1b-v. Add `dialecticalStyle` config field — accept the value but treat non-`adversarial` as `adversarial` with diagnostic note `[v1-ship]` (style-specific threshold modulation is `[post-validation]`)
1b-vi. Add learned pragmatic classifier — sentence-transformer as a parallel path for `pragmatic_convergence`, gated on F1 ≥ 0.80 benchmark. **Required for shipping as default** — lexicon path is the degraded fallback. For v1 behind opt-in flag, lexicon-only is acceptable. `[post-validation]`
1b-vii. Add argument network GC pass: prune tangential leaf nodes and orphans when network size reaches 175, targeting ≤150. Archive pruned nodes in diagnostics. `[v1-ship]`

### Phase 2: Debater Awareness `[v1-ship]`

6. Add phase rationale string generation to `phaseTransitions.ts` (template + string interpolation, not LLM) `[v1-ship]`
7. Add move weight table to `prompts.ts`, inject into plan stage only `[v1-ship]`
8. Add transition nudge to draft envelope when `approaching_transition` is true. **Gated on Phase 5 ablation** (item 20): nudge ships disabled by default; enabled only if A/B test shows no premature synthesis correlation (r ≤ 0.3) and no outcome quality degradation `[post-validation]`

### Phase 3: Moderator Transition Actions `[v1-ship]`

9. Add `TRANSITION_SUMMARY` intervention type — fired once on exploration→synthesis transition `[v1-ship]`
10. Add `FINAL_COMMIT` intervention type — fired when approaching synthesis exit; runs as multi-round sequence across all active POVs (see Transition Awareness section) `[v1-ship]`
11. Add `REGRESSION_NOTICE` intervention type — fired on synthesis→exploration regression `[v1-ship]`

### Phase 4: UI Integration `[v1-ship]`

12. Surface phase progress indicator in `DebateWorkspace.tsx` (progress bar per phase) `[v1-ship]`
13. Add pacing selector to `NewDebateDialog.tsx` `[v1-ship]`; dialectical style selector `[post-validation]` (accept field but only `adversarial` is active)
14. Display phase transition events (including regression) in the debate transcript `[v1-ship]`
15. Expose PhaseContext (phase rationale, progress, confidence) to the debate panel so human participants can see why they're in a given phase `[v1-ship]`
16. Add **pre-emptive** human transition override buttons: "Keep exploring" (vetoes exploration exit for 1 round) and "Move to synthesis" (forces exploration exit). Override events are logged in diagnostics with the signal scores at the time of override. `[v1-ship]`
16b. Add "Download signals" button for adaptive debates — exports `signals.json` (per-round signal telemetry) and `predicates.json` (structured predicate log) `[v1-ship]`
16c. Surface full per-debate adaptive staging diagnostics (phase timeline, regressions, confidence deferrals, override log, network size) in the diagnostics panel `[v1-ship]`
16d. Add "Replay with fixed staging" action on completed adaptive debates `[future]`

### Phase 5: Empirical Validation `[research]`

**Blocking requirements before adaptive staging ships as default (not as opt-in):**

17. Annotate debate corpus (3 annotators, inter-annotator agreement ≥ 0.6 α) `[research]`
17b. **Pre-tuning correlation analysis:** Compute pairwise signal correlation on the training corpus. Merge or drop signals with r > 0.7 before LOOCV weight tuning. `recycling_pressure` / `engagement_fatigue` and `scheme_stagnation` / `scheme_coverage_factor` are expected to be correlated — verify and merge if so. `[research]`
18. Compute single-signal baselines; drop signals that don't beat random `[research]`
19. LOOCV weight tuning on training set; evaluate on held-out set `[research]`
20. Coupling audit: measure signal-prompt correlations, flag r > 0.5 pairs. **Specifically audit `pragmatic_convergence`** — it reads raw debater text influenced by phase context (see §Exploration Exit coupling note). Include **prompt-variant ablation**: A/B test transition nudges on/off across 20 debates. `[research]`
21. Compare adaptive staging vs. fixed-round debates on convergence quality metrics `[research]`
22. Run adversarial debater shadow mode on first 5 debates per model version `[research]`
23. Post-debate outcome quality annotation `[research]`
24. **Causal analysis (SHAP/feature ablation)** `[research]`
25. **Formal simulation** `[research]`
26. **Red-team loop** `[research]`
27. **Non-English validation subset** `[research]`
28. **Evaluator quality benchmark:** Gold-label 20 debates for extraction accuracy. Verify F1 thresholds. `[research]` (manual run for Phase 0 gate is `[v1-ship]`)
29. **Signal baseline export** `[research]`

### Phase 6: Ongoing Operations `[future]`

**Testing pyramid** — required test coverage before adaptive staging ships as default:

| Layer | What | When | Blocking? |
|---|---|---|---|
| Unit | Each `Signal.compute()`, predicate evaluators, config validation, state validation, `discreteToFloat()`, lexicon matching | Every PR | Yes — CI gate |
| Integration | Full debate with adaptive staging on: verify phase transitions fire, regressions work, kill switches stop the debate, network size cap triggers | Every PR touching `lib/debate/` | Yes — CI gate |
| Simulation | 10,000 Markov-chain synthetic debates (Phase 5 item 25) | Before weight finalization; re-run on signal weight changes | Yes — blocks weight changes |
| Shadow regression | 5 real debates in shadow mode after every evaluator model change | After model swap | Yes — blocks adaptive activation for new model |
| Evaluator benchmark CI | Gold-label F1 check (Phase 5 item 28) | Weekly; after evaluator model change | Yes — auto-downgrades on failure |
| Red-team CI | Subset of red-team loop (10 debates, not 100) as a fast gate | Monthly; after signal weight changes | No — advisory, full loop runs quarterly |

**Backward compatibility contract:**

- `DebateSession` schema is versioned via `schema_version`. New fields are additive; no field removals. Sessions created under old versions must load and display correctly.
- Signal telemetry format (`SignalTelemetryRecord`) is versioned independently. Unknown fields in older records are ignored; missing fields in newer code default to `null`.
- The `useAdaptiveStaging: false` path must remain functional and tested indefinitely. It is not a temporary flag — some users and automated pipelines will always prefer deterministic fixed-round behavior.
- `signal-baselines.json` and `.debate-calibration.json` use `schema_version` fields. Unknown versions trigger silent fallback to defaults, not errors.

**Code ownership checklist** — every PR that modifies signal definitions, weights, or transition predicates must include:

1. Simulation results showing no increase in oscillation probability or budget exhaustion rate
2. A drift detection run against the current `signal-baselines.json` confirming the change doesn't invalidate the baseline
3. A coupling audit for any new or modified signal (correlation with prompted move labels must be r < 0.5)
4. Unit tests covering the new/changed signal's edge cases (zero input, max input, missing data)
5. Integration test verifying the signal participates correctly in at least one phase transition scenario

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

### Rev 4 Changes (evaluator independence review)

| Issue Raised | Resolution |
|---|---|
| **Same-model evaluation is a Goodhart loop** — `extractClaims()` uses the debate model to judge its own output; "measurement separation" is contradicted by the execution layer | Added Evaluator Independence section. Cross-vendor model separation (`evaluatorModel` config field) decouples the analyst from the debater. |
| **Float mode collapse** — empirical analysis shows 99% of `base_strength` at 0.6, 97.6% of edge weights at 0.5; LLMs cannot produce meaningful continuous probability estimates | NLI-style discrete evaluation: extraction prompts demand categorical outputs (decisive/substantial/tangential for edges, grounded/reasoned/asserted for nodes), deterministic mapping layer converts to fixed floats. Eliminates mode collapse and model gaming of continuous values. |
| **Self-preference bias** — same model family over-indexes arguments matching its own RLHF-induced rhetorical style (Zheng et al., 2023) | Cross-vendor split recommended for production. Same-model fallback logs diagnostic warning. |
| **Evaluator fixes are independently valuable** — concession hints, specify hints, and unanswered claim tracking are degraded by degenerate base_strength values in the existing fixed-round system | Added Phase 0 (Evaluator Independence) to implementation plan as a prerequisite that ships before adaptive staging and benefits all existing debates. |

### Rev 5 Changes (computational linguistics and simulation review)

| Issue Raised | Resolution |
|---|---|
| **Discourse-pragmatic signals under-weighted** — signal suite is entirely structural; surface-form signals (hedging, discourse markers, meta-discourse) are cheaper and harder to fake | Added `pragmatic_convergence` (0.10 weight) to saturation score and `synthesis_pragmatic_signal` (0.15 weight) to convergence score. Both computed via regex + curated lexicon — no LLM evaluation, resistant to same-model feedback loop. |
| **Argumentation schemes unused in transition predicates** — `argumentation_scheme` is extracted but never feeds transition signals; enthymematic bankruptcy is undetectable | Added `scheme_stagnation` (0.10 weight) to saturation score. Added `scheme_coverage_factor` multiplier to `crux_maturity`. Both use already-extracted categorical scheme data. |
| **Cross-cultural register bias** — pragma-dialectics and Anglo-American adversarial norms baked into thresholds and move weights | Added `dialecticalStyle` config parameter with three presets (adversarial, deliberative, integrative) that modulate thresholds and move weight tables. Acknowledged multilingual validation as a longer-term need. |
| **No uncertainty quantification** — signals treated as point estimates; noisy extraction can trigger spurious transitions | Added Signal Confidence Floor section: per-component confidence based on extraction quality and inter-round stability; global floor at 0.40 defers all predicate evaluations when unreliable. |
| **No outcome quality metrics** — system optimizes when to stop but not whether the stop was dialectically valuable | Added post-debate outcome quality annotation to Phase 5: crux resolution depth, novelty of reframes, remaining open questions as downstream tuning targets. |
| **No human-in-the-loop override** — architecture is 100% LLM-vs-LLM; real deployment will be hybrid | Added human override buttons to Phase 4 UI integration: "Keep exploring" and "Move to synthesis" feed the veto/force predicate system. PhaseContext exposed to UI. |
| **No formal simulation** — 50 real debates insufficient to expose parameter interactions | Added 10,000 synthetic debate simulation to Phase 5: vary POV count, adversarial strategies, noise levels. Measure oscillation, regression, and budget exhaustion rates. |

### Rev 6 Changes (implementor review + AI validation contracts)

| Issue Raised | Resolution |
|---|---|
| **Pragmatic lexicons unspecified** — "~50 phrases" placeholder with no actual word lists | Specified all three lexicons inline: 15 hedge markers, 12 assertive markers, 15 concessive markers, 17 meta-discourse markers. Matching is case-insensitive substring; no embedding cosine needed. |
| **FINAL_COMMIT incompatible with single-speaker-per-round** — intervention asks "each debater" but only one speaks per round | FINAL_COMMIT runs as a multi-round sequence, selecting each active POV in consecutive rounds. Synthesis exit suppressed until all POVs have responded. |
| **No implementation plan for rev 5 features** — pragmatic signals, scheme stagnation, confidence floor, dialecticalStyle had no Phase 1 items | Added Phase 1b with 5 implementation items covering all rev 5 features. |
| **Dialectical style move weights described qualitatively** — "higher weight on CONDITIONAL-AGREE" without numbers | Added explicit move weight override table for `deliberative` and `integrative` presets across all three phases. |
| **Cross-debate API budget calibration not persisted** — "rolling average across debates" with no storage mechanism | Specified `.debate-calibration.json` file format, FIFO sample buffer, seeding logic, and silent-overwrite fallback for corrupt files. |
| **`phase_progress` formula unspecified** — PhaseContext had `phase_progress: number // 0–1` with no computation | Specified formula per phase: max of composite-score path and time-based path, with `approaching_transition` threshold at 0.85. |
| **Phase 0 implementation status unclear** — no indication which items were already done | Marked 0a–0e as implemented with strikethrough; noted 0f and 0g as outstanding. |
| **No AI output validation contracts** — every backend AI call lacked schema, value-space, and fallback specifications | Added "AI Output Validation Contracts" section with 10 call points, per-field validation tables, and a four-level fallback hierarchy (repair → degrade → skip → abort). Documented which validation is already implemented vs. new. |

### Rev 7 Changes (ML tech lead review — online monitoring, causal grounding, red-teaming)

| Issue Raised | Resolution |
|---|---|
| **Signal suite too heuristic-heavy** — lexicon-based pragmatic signals English-centric, register-sensitive; no learned fallback | Added optional learned classifier fallback (1.5B sentence-transformer) that runs in parallel with lexicon; max of two paths used. Gated on F1 ≥ 0.80 benchmark. Added to Phase 1b implementation plan. |
| **Validation is offline-only** — no online monitoring or continual re-calibration after deployment | Added full "Online Signal Monitoring" section: per-round signal telemetry export, KS+MMD drift detection per batch of 10 debates, auto-fallback to fixed-round on drift. Signal baselines exported from Phase 5 for ongoing comparison. |
| **No causal analysis** — tuning on correlation with annotator transition points is necessary but insufficient; risk of optimizing for "feels right" not "produces better outcomes" | Added SHAP/feature ablation step to Phase 5 (item 24): compute marginal contribution of each signal to outcome quality scores. Drop signals that correlate with transition points but don't causally improve synthesis. |
| **Phase progress / nudge could create subtle Goodhart** — models may perform early synthesis moves when seeing `approaching_transition` | Added prompt-variant ablation requirement: A/B test nudges on/off across 20 debates; measure outcome quality divergence and synthesis-move correlation. Remove nudge if net-negative. |
| **Simulation underspecified** — "10,000 synthetic debates" without a trajectory model won't find real failure modes | Specified Markov chain over signal states as trajectory generator. Run before weight finalization to identify pathological parameter regions. |
| **No red-team loop** — adversarial robustness section lacks active testing against signal gaming | Added red-team loop to Phase 5 (item 26): 100 debates with one POV explicitly prompted to game signals. Any strategy succeeding ≥30% without detection blocks shipping. Expanded per-debater attribution with tighter thresholds for suspected gaming. |
| **Shadow mode too short (5 debates)** — insufficient to catch slow distribution shift | Made shadow mode permanent: fixed-round fallback always runs in parallel, logs divergence. Auto-flag if divergence exceeds 3 rounds on average over a batch. |
| **Evaluator model quality is a single point of failure** — weak evaluator degrades all downstream signals | Added Evaluator Quality Gate: automated weekly F1 benchmark (F1 ≥ 0.85 edges, ≥ 0.80 strength, ≥ 0.75 nodes). Auto-downgrade to fixed-round on failure. Surfaced in UI. |
| **Oscillation / regression death spiral from stochastic extraction** — per-crux cap is necessary but not sufficient | Added global regression budget: hard cap of 2 regressions total per debate regardless of crux count. "Regression pressure" exposed in diagnostics and UI. |
| **Latency / cost creep from new LLM calls** — phase rationale and transition interventions could inflate per-round cost | Codified design constraint: "no new LLM calls in hot path." Phase rationale uses template + string interpolation. All transition signals are deterministic. |
| **Human overrides are post-hoc — friction of fighting the system** — buttons only appear when `approaching_transition` is true | Changed to pre-emptive model: override buttons available at any time during debate. Override events logged with signal scores as ground-truth labels for future weight tuning. |
| **Multi-lingual / cross-cultural generalization unvalidated** — English-only lexicons, no non-English test set | Added non-English validation subset requirement (≥10% of Phase 5 debates). Learned classifier fallback provides the multilingual path. |
| **Signal architecture not modular** — adding or A/B testing new signals requires code changes to the scorer | Mandated modular `Signal[]` registry architecture for Phase 1: each signal is a `{ id, weight, compute, enabled }` object. Composite scorer iterates the array. Style overrides are transforms on the array. |

### Rev 8 Changes (Code Maintainer + SRE review — runtime safety, observability, testing pyramid)

| Issue Raised | Resolution |
|---|---|
| **No kill switches** — adaptive staging cannot be disabled without code changes; no way to revert a single bad debate | Added three-tier kill switch system: global `adaptiveStagingEnabled` flag (config/env var), per-debate `forceFixedRounds`, and post-hoc "Replay with fixed staging" UI action. Global flag checked at engine start and on every predicate evaluation; mid-debate toggle gracefully degrades. |
| **Argument network unbounded growth** — QBAF is O(n²) in edges; prolific extraction can degrade performance and produce unreadable visualizations | Added 200-node guardrail: force transition to synthesis, switch to "top claims only" extraction (≤2 claims/turn, skip tangential edges). Cap is fixed, not user-configurable. |
| **State corruption on resume** — no validation of deserialized `PhaseState`; corrupt state could trigger impossible transitions | Added state validation on load: 5-point check (valid phase, round bounds, regression budget, threshold floor, signal ranges). Corruption resets to phase start with defaults + diagnostic warning. |
| **Pathological config combinations** — user can set thresholds that prevent transitions or force premature exits | Added config validation with `ActionableError`: reject `explorationExitThreshold > 0.95`, `synthesisExitThreshold < 0.30`, `maxTotalRounds < 6`; warn on `maxTotalRounds > 20` and conflicting pacing+style combos. |
| **No structured predicate logging** — transition decisions are opaque; debugging requires replaying the entire debate | Added structured JSON logging for every predicate evaluation: round, phase, predicate name, result, reason, component scores, confidence, network size, elapsed_ms. Written to per-debate `predicates.json`. |
| **No observability plan** — no metrics format, no alerting rules, no aggregate dashboards for production deployment | Added Observability Plan section: 12 metric definitions (histogram/counter/gauge), 7 alerting rules with severity and auto-remediation, 5 aggregate dashboard specs. Metrics are emitted via callback — deployment layer decides export target (Prometheus, CloudWatch, JSON file). Engine has no infrastructure dependency. |
| **No testing pyramid** — validation is offline-only in Phase 5; no CI gates for signal changes | Added Phase 6 with 6-layer testing pyramid: unit (CI gate), integration (CI gate for `lib/debate/`), simulation (blocks weight changes), shadow regression (blocks model activation), evaluator benchmark CI (weekly + model change), red-team CI (monthly advisory). |
| **No backward compatibility contract** — schema evolution undefined; old sessions may break on upgrade | Added backward compat contract: `DebateSession` and `SignalTelemetryRecord` are versioned, additive-only. `useAdaptiveStaging: false` path tested indefinitely. Config files use `schema_version` with silent fallback. |
| **No code ownership discipline** — signal changes can ship without verifying they don't break the system | Added code ownership checklist: every PR touching signals must include simulation results, drift run, coupling audit, unit tests, and integration test. |
| **Per-debate diagnostics not downloadable** — signals.json specified but no UI to access it | Added Phase 4 items: "Download signals" button (16b), full adaptive diagnostics panel (16c), "Replay with fixed staging" action (16d). |
| **Human override abuse unaddressed** — no rate limit or detection of excessive human overrides | Human overrides feed the existing veto/force predicate system and are logged with signal scores. The `debate_human_override_total` metric enables alerting on high override rates. Override rate is surfaced in the cross-debate aggregate dashboard. Excessive overrides (>3 per debate) trigger a diagnostic note suggesting threshold recalibration. |
| **Evaluator quality gate not gating Phase 1** — evaluator benchmark is Phase 5 but evaluator quality is a prerequisite for any adaptive signal | Added pre-Phase 1 gate: evaluator quality benchmark must pass before any adaptive code merges. This is a subset of the full Phase 5 benchmark (item 0g + gold-labeled baseline). |
| **Latency creep in predicate evaluation unmonitored** — QBAF recomputation + signal evaluation could slow down as networks grow | Added `debate_predicate_latency_ms` histogram metric and `PredicateLatencyCreep` alerting rule (p99 > 50ms). Predicate log includes `elapsed_ms` per evaluation. Network size guardrail (200 nodes) bounds the worst case. |

### Rev 9 Changes (systems review — lexical fragility, network GC, evaluator bias, state recovery, crux farming)

| Issue Raised | Resolution |
|---|---|
| **Lexical fragility trap** — hardcoded string arrays for `pragmatic_convergence` are brittle across model generations; LLM vocabularies shift; adversarial models can trivially bypass lexicon markers | Upgraded learned classifier from optional (Phase 1b) to **required for shipping**. Lexicon matching demoted to degraded fallback for cold start / resource-constrained environments. Classifier F1 ≥ 0.80 is now a Phase 5 blocking requirement. Lexicon still runs in parallel as a deterministic floor. |
| **200-node cliff** — degrading extraction quality at the exact moment synthesis begins risks dropping crucial resolving arguments from complex debates | Replaced extraction degradation with a two-stage approach: (1) GC pass at 175 nodes prunes tangential leaf nodes and orphans to ≤150, preserving full extraction fidelity; (2) hard cap at 200 still forces synthesis but extraction continues at full quality. Pruned nodes archived in diagnostics. |
| **Cross-vendor illusion** — vendor separation eliminates RLHF stylistic bias but not shared pre-training biases (verbosity = quality heuristic common to all autoregressive transformers) | Made explicit the three structural defenses already in place: (1) NLI discrete categories constrain output space to content-defined properties, not formal properties; (2) T=0 eliminates sampling randomness; (3) extraction prompts exclude length metadata. These are schema-level constraints, not prompt-level instructions — enforceable rather than advisory. |
| **State corruption recovery danger** — resetting `rounds_in_phase` to zero on a saturated network causes unpredictable composite scores, potentially locking the debate in a frozen phase | Changed recovery from "reset to phase start" to **auto-downgrade to fixed-round mode** for the session's remaining duration. Do not re-initialize adaptive state over a mid-flight argument graph. |
| **Crux farming** — debaters can hallucinate structurally distinct but substantively redundant cruxes to exhaust the regression budget and stall the debate | Added **semantic novelty check** to `novel_crux_discovered`: candidate crux must have embedding cosine similarity < 0.70 to all prior crux nodes (using existing all-MiniLM-L6-v2 embeddings). Also added semantic similarity to `regression_used_for_similar_crux`. Candidates that pass structural novelty but fail semantic novelty are logged as "semantically redundant crux" — they don't trigger regression. |
| **Educational references** — reviewer cited Zheng et al. (2023) and van Eemeren & Grootendorst | Both were already referenced in the document (Evaluator Independence and Theoretical Foundation sections respectively). No change needed. |

### Rev 10 Changes (AI-implementer review — v1 scope, worked example, interface declarations, contradiction fixes)

| Issue Raised | Resolution |
|---|---|
| **Internal contradictions** — regression budget, `crux_identified`, and transition nudge defined differently in different sections | Fixed: `crux_identified` in `crux_maturity` now references canonical §Thesis-Antithesis Exit definition (includes strength gate). Transition nudge implementation item now explicitly gated on Phase 5 ablation. Regression budget restated in full wherever referenced (per-crux cap AND global cap of 2). |
| **`pragmatic_convergence` is partially coupled** — reads raw debater text influenced by phase context, not structurally separated like network signals | Acknowledged coupling explicitly in the signal definition. Reduced weight from 0.10 to 0.05 (tiebreaker role). Phase 5 coupling audit must specifically measure this signal's r-value against phase-context prompts. |
| **Signal redundancy** — `engagement_fatigue` / `recycling_pressure` and `scheme_stagnation` / `scheme_coverage_factor` likely correlated | Added pre-tuning correlation analysis step (item 17b) to Phase 5: compute pairwise r on training corpus, merge or drop signals with r > 0.7 before LOOCV. |
| **Force-exit / ratchet interaction undocumented** — a twice-regressed debate likely exits via "debate is dead" force rather than ratcheted score | Documented as intended behavior: force exit catches genuinely exhausted debates regardless of score; ratchet prevents premature *scored* exits. |
| **No worked example** — AI implementers reason about specs by simulating execution traces | Added Appendix A: 10-round worked example with per-round signal values, predicate evaluations, one regression, one confidence deferral. |
| **No failure-mode taxonomy** — defenses listed without enumerating what they defend against | Added Appendix B: 10 failure modes with detection mechanism, defense, and accepted-risk flag. |
| **No `SignalContext` interface** — `compute(context)` hand-waved; signals will couple to engine internals | Added concrete `SignalContext` TypeScript interface with all fields a signal may read. Placed before signal definitions. Phase 1 item updated to implement it. |
| **No state-transition table** — actual state space is larger than the 3-phase flowchart | Added Appendix C: `(state × event) → (new_state, action)` transition table covering all cross-cutting concerns. |
| **No referenced-code appendix** — AI implementer will infer behavior from names or re-implement | Added Appendix D: every referenced symbol with file path and one-line behavioral summary. |
| **Cold-start behavior undefined** — windowed signals reference "peak" and "mean" undefined for rounds 1-2 | Added §Cold-Start Behavior: uniform sentinel rule (0.5) during cold-start period, tagged as low-confidence. |
| **Confidence × regression interaction unspecified** — can a regression be deferred? Does it ratchet when deferred? | Added §Confidence Floor × Regression Interaction: deferred regressions reconsidered each round; ratchet applies only when fired. |
| **No v1 scope boundary** — AI implementer will attempt the whole spec | Added "Out of Scope for v1" section and maturity tags (`[v1-ship]`, `[post-validation]`, `[research]`, `[future]`) on every implementation item. |
| **Provisional weights will become magic numbers** — AI will hardcode `0.30` as a constant | All weights loaded from `provisional-weights.json` at runtime. Validation produces a config diff, not scattered code changes. |
| **Dialectical style presets unvalidated** — threshold adjustments are numerology without a style-specific protocol | Non-default presets (`deliberative`, `integrative`) deferred from v1. Config field accepts the value but treats non-`adversarial` as `adversarial` with diagnostic note. |
| **Learned classifier cost unspecified** — 1.5B model running every round is not free | Classifier is `[post-validation]` — not built for v1 behind opt-in flag. For default-mode shipping, deployment requirements specified in Appendix B (failure mode F7). |
| **Do not split spec into multiple files** — AI may not load adjacent files | Accepted: spec remains a single document. All contracts, logs, and observability specs stay inline. |
| **Do not cut the Design Decisions Log** — it functions as anti-regression armor | Accepted: log retained in full. |

---

## Appendix A: Worked Example — 10-Round Debate Trace

A hypothetical 3-POV debate (`prometheus`, `sentinel`, `cassandra`) on "Should frontier AI labs be required to share safety research?" with `pacing: moderate`, `maxTotalRounds: 12`.

### Round-by-Round Trace

| Round | Phase | Speaker | Network Δ | Key Signal Values | Predicate | Action |
|---|---|---|---|---|---|---|
| 1 | thesis-anti | prometheus | +3 nodes | *cold-start: all signals = 0.5 sentinel* | thesis_exit: NO (not all POVs responded) | stay |
| 2 | thesis-anti | sentinel | +4 nodes | *cold-start: all signals = 0.5 sentinel* | thesis_exit: NO (cassandra unheard) | stay |
| 3 | thesis-anti | cassandra | +3 nodes, 2 cross-POV attacks | claim_rate_delta: 0.75 of peak; crux_identified: NO (only 1 cross-POV attack cluster) | thesis_exit: NO (claim_rate not declining, no crux) | stay |
| 4 | thesis-anti | prometheus | +2 nodes, 1 node gains 2nd cross-POV attack (strength 0.6) | claim_rate: 0.50 of peak (declining); crux_identified: YES | thesis_exit: YES (all responded + crux identified) | → **exploration** |
| 5 | exploration | sentinel | +2 nodes | recycling: 0.18, crux_mat: 0.40, concession: 0, engage_fat: 0.10, pragmatic: 0.12, scheme_stag: 0.20; **sat_score: 0.21** | exploration_exit: NO (0.21 < 0.65) | stay |
| 6 | exploration | cassandra | +1 node, 1 concession | recycling: 0.25, crux_mat: 0.55, concession: 0, engage_fat: 0.15, pragmatic: 0.18, scheme_stag: 0.25; **sat_score: 0.28** | exploration_exit: NO (0.28 < 0.65); veto: NO | stay |
| 7 | exploration | prometheus | +1 node | recycling: 0.45, crux_mat: 0.70, concession: 0.5 (missed), engage_fat: 0.30, pragmatic: 0.35, scheme_stag: 0.40; **sat_score: 0.48** | exploration_exit: NO (0.48 < 0.65) | stay |
| 8 | exploration | sentinel | +0 nodes, extraction_confidence: 0.35 | *confidence < 0.40 — all predicates deferred* | **DEFERRED** | stay (confidence deferral) |
| 9 | exploration | cassandra | +1 node | recycling: 0.60, crux_mat: 0.80, concession: 1.0, engage_fat: 0.55, pragmatic: 0.40, scheme_stag: 0.50; **sat_score: 0.65** | exploration_exit: YES (0.65 ≥ 0.65, no vetoes active) | → **synthesis** (moderator issues TRANSITION_SUMMARY) |
| 10 | synthesis | prometheus | +1 support edge | qbaf_agree: 0.30, pos_stab: 0.60, irreduc: 0.20, synth_prag: 0.25; **conv_score: 0.34**; novel crux detected (cosine 0.45 to prior) | synthesis_exit: NO; regression: YES (novel crux, regression_count=0) | → **exploration** (regression #1, threshold ratchets to 0.75) |
| 11 | exploration | sentinel | +2 nodes addressing new crux | recycling: 0.70, crux_mat: 0.90, concession: 1.0, engage_fat: 0.65, pragmatic: 0.50, scheme_stag: 0.55; **sat_score: 0.74** | exploration_exit: NO (0.74 < 0.75, ratcheted) | stay |
| 12 | exploration | cassandra | +0 nodes | recycling: 0.85, crux_mat: 0.95, concession: 1.0, engage_fat: 0.82, pragmatic: 0.55, scheme_stag: 0.60; **force_exit: YES** (recycling 0.85 > 0.8 AND fatigue 0.82 > 0.8) | force_exploration_exit fires | → **synthesis** |

Debate terminates at `maxTotalRounds = 12`. Moderator issues FINAL_COMMIT to each POV in a compressed sequence within the final round budget.

**Key observations from this trace:**
- Round 8 demonstrates confidence deferral — noisy extraction prevented a potentially spurious transition
- Round 10 demonstrates regression — a novel crux in synthesis triggered return to exploration with ratcheted threshold
- Round 12 demonstrates force-exit after regression — the "debate is dead" force exit catches the exhausted exploration with ratcheted threshold 0.75

## Appendix B: Failure Mode Taxonomy

| ID | Failure Mode | Detection | Defense | Risk Level |
|---|---|---|---|---|
| F1 | **Evaluator collapse** — extraction model degrades, producing garbage signals | Evaluator F1 benchmark (weekly); extraction_confidence < 0.4 sustained | Auto-downgrade to fixed-round; evaluator quality gate | Mitigated |
| F2 | **Signal drift** — model updates shift signal distributions | KS + MMD drift detection per batch; shadow mode divergence | Auto-fallback to fixed-round; coupling audit rerun `[post-validation]` | Mitigated (post-v1) |
| F3 | **Oscillation** — repeated regression/synthesis cycling | Global regression budget (hard cap 2); threshold ratchet (+0.10 per regression) | Budget cap terminates oscillation after 2 cycles; force exit catches dead debates | Mitigated |
| F4 | **Premature synthesis** — transitions before exploration is genuinely saturated | Min round floors (2 per phase); confidence gating (0.40 floor); veto predicates | Vetoes delay 1 round; min rounds provide floor; shadow mode catches systematic early transitions `[post-validation]` | Mitigated |
| F5 | **Runaway exploration** — debate never exits exploration | Max exploration rounds (8); force exit (recycling > 0.8 AND fatigue > 0.8); API budget soft cap | Multiple independent force exits | Mitigated |
| F6 | **Frozen-phase deadlock** — state corruption or edge-case interaction prevents any predicate from firing | State validation on load (downgrade on corruption); max round caps per phase; `maxTotalRounds` absolute ceiling | Hard caps guarantee termination | Mitigated |
| F7 | **Classifier latency** — learned pragmatic classifier (1.5B params) adds per-round latency | `debate_predicate_latency_ms` metric; p99 > 50ms alert | Classifier runs async with 200ms timeout; on timeout, falls back to lexicon path with diagnostic warning. Classifier is `[post-validation]`; v1 uses lexicon only. | Accepted (v1); Mitigated (post-v1) |
| F8 | **Signal gaming** — debater manipulates structural patterns to delay/force transitions | Per-debater signal attribution (>60% dominance flag); anomaly detection (>2σ spike/drop); red-team loop `[research]` | Flagged rounds excluded from predicate evaluation; moderator BALANCE_CHECK intervention | Partially mitigated |
| F9 | **Silent quality degradation** — adaptive staging is worse than fixed-round but not detectably broken | Shadow mode divergence (>3 rounds avg over 10 debates flags review); outcome quality annotation `[research]` | Shadow divergence metric is the primary detector. **Accepted risk:** shadow mode tells you *when* they disagree, not *which* is right. Human review required. | Accepted risk |
| F10 | **Config explosion** — pathological parameter combinations produce unexpected behavior | Config validation at debate creation (reject extreme thresholds, warn conflicting combos) | `ActionableError` with specific conflict and fix | Mitigated |

## Appendix C: State Transition Table

The phase flowchart has 3 nodes, but the actual state space includes cross-cutting concerns. This table covers all combinations. States are evaluated in priority order (top to bottom); the first matching row fires.

**State variables:** `phase` (thesis-anti / exploration / synthesis), `kill_switch` (active / inactive), `confidence` (ok / deferred), `veto` (active / inactive), `override` (keep_exploring / move_to_synthesis / none), `regression_budget` (0 / 1 / 2 used), `network_gc` (needed / not_needed), `budget` (ok / soft_hit / hard_hit)

| State | Event | New State | Action |
|---|---|---|---|
| any | `kill_switch = active` | current phase | Complete current phase via positional assignment; disable all adaptive predicates |
| any | `budget = hard_hit` | TERMINATED | Terminate immediately; log budget exhaustion |
| any | `health_score < 0.10` | TERMINATED | Terminate immediately; log catastrophic collapse |
| any | `health_score < 0.20` for 3 rounds | TERMINATED | Terminate; log gradual collapse |
| any | `network.nodeCount >= 175` AND `gc_not_run_this_phase` | same phase | Run GC pass; prune to ≤150; log; set `gc_ran = true` |
| any | `network.nodeCount >= 200` (post-GC) | synthesis | Force to synthesis; log hard cap; extraction continues at full fidelity |
| any | `confidence < 0.40` | same phase | Defer all predicate evaluations; log deferral; continue |
| **thesis-anti** | `all_povs_responded AND (claim_rate_declining OR crux_identified) AND round >= min` | exploration | Transition; moderator notes phase change |
| **thesis-anti** | `round >= max_thesis_rounds` | exploration | Force transition |
| **exploration** | `override = move_to_synthesis` | synthesis | Force transition; log human override with signal scores |
| **exploration** | `budget = soft_hit` | synthesis | Force transition; log budget pressure |
| **exploration** | `force_exploration_exit` (recycling > 0.8 AND fatigue > 0.8) | synthesis | Force transition; log "debate is dead" |
| **exploration** | `round >= max_exploration_rounds` | synthesis | Force transition |
| **exploration** | `sat_score >= threshold AND NOT veto_active` | synthesis | Normal transition; moderator issues TRANSITION_SUMMARY |
| **exploration** | `sat_score >= threshold AND veto_active` | exploration | Veto delays 1 round; if same veto fired last round, override veto → synthesis |
| **synthesis** | `override = keep_exploring AND regression_budget < 2` | exploration | Regression; ratchet +0.10; log human override |
| **synthesis** | `regression fires AND regression_budget < 2` | exploration | Regression; ratchet +0.10; moderator issues REGRESSION_NOTICE |
| **synthesis** | `regression fires AND regression_budget >= 2` | synthesis | Budget exhausted; log blocked regression; continue synthesis |
| **synthesis** | `conv_score >= threshold` | TERMINATED | Normal exit; moderator issues FINAL_COMMIT sequence |
| **synthesis** | `synthesis_stall` (2 rounds, delta < 0.05, recycling > 0.5) | TERMINATED | Force exit; log stall |
| **synthesis** | `round >= max_synthesis_rounds` | TERMINATED | Force exit |
| **synthesis** | `budget = soft_hit` | synthesis | Lower synthesis threshold by 0.10 |
| **any** | `state deserialization fails` | fixed-round mode | Downgrade session; log corruption |

## Appendix D: Referenced Existing Code

Every existing symbol referenced in this spec, with file path and behavioral summary. An AI implementer should read these files before implementing; do not re-implement or infer behavior from names.

| Symbol | File | Behavior |
|---|---|---|
| `processExtractedClaims()` | `lib/debate/argumentNetwork.ts` | Validates extracted claims against the argument network: grounding overlap check, duplicate detection, edge ID validation, attack type normalization. Returns accepted/rejected claim arrays. |
| `normalizeExtractedClaim()` | `lib/debate/argumentNetwork.ts` | Maps categorical extraction outputs to float values (`grounded`→0.8, `reasoned`→0.5, `asserted`→0.2 etc.). Handles legacy float passthrough. Single source of truth for category→float mapping. |
| `convergenceSignals` (module) | `lib/debate/convergenceSignals.ts` | Computes per-round convergence metrics: `recycling_rate` (self-overlap), `engagement_depth` (targeted response ratio), `position_delta` (embedding drift), `concession_opportunity` (missed concession detection). |
| `getMoveName()` | `lib/debate/prompts.ts` | Fuzzy-matches a raw move string against the known `MOVE_NAMES` set. Returns the canonical move name or a best-effort match. |
| `normalizeDisagreementType()` | `lib/debate/prompts.ts` | Keyword-scores raw text to classify disagreement as `EMPIRICAL`, `VALUES`, or `DEFINITIONAL`. Used in plan stage and synthesis extraction. |
| `validateTurn()` | `lib/debate/turnPipeline.ts` | Validates a completed draft against length, format, and content constraints. Returns pass/fail with violation details. |
| `buildRepairPrompt()` | `lib/debate/turnPipeline.ts` | Generates a repair prompt for a failed turn validation, citing the specific violation. Used in the retry loop (up to `maxRetries`). |
| `parseJsonRobust()` | `lib/debate/aiAdapter.ts` | Strips code fences, repairs common JSON errors (trailing commas, unquoted keys), handles partial output. Returns parsed object or throws. |
| `extractArraysFromPartialJson()` | `lib/debate/aiAdapter.ts` | Recovers complete array elements from truncated JSON responses. Used when extraction is cut off mid-array. |
| `getDebatePhase()` | `lib/debate/debateEngine.ts` | **DEPRECATED by this spec.** Current positional phase assignment: rounds 1-2 → thesis-antithesis, last 2 rounds → synthesis, middle → exploration. Replaced by `evaluatePhaseTransition()`. |
| `DebateEngine.generate()` | `lib/debate/debateEngine.ts` | Sends a prompt to the debate model via the AI adapter. Used for turn pipeline, moderator selection, synthesis. |
| `DebateEngine.generateWithEvaluator()` | `lib/debate/debateEngine.ts` | Routes generation through `evaluatorModel` (cross-vendor). Used for claim extraction and classification. Implemented via `generateWithModel()`. |
| `runTurnPipeline()` | `lib/debate/turnPipeline.ts` | Four-stage sequential pipeline: brief → plan → draft → cite. Each stage has its own temperature and schema. Stage failures abort subsequent stages. |
| `StagePromptInput` | `lib/debate/turnPipeline.ts` | Input type for each pipeline stage. Contains transcript context, phase info, prior claims, taxonomy refs. Extended by this spec to include `PhaseContext`. |
| `DEBATE_PROTOCOLS` | `lib/debate/types.ts` | Registry of debate protocol definitions (structured, socratic, deliberation). Each protocol can set per-protocol defaults for adaptive parameters. |
| `computeQbafStrengths()` | `lib/debate/argumentNetwork.ts` | Runs DF-QuAD gradual semantics on the argument network. Computes `computed_strength` for all nodes. O(n²) in edges — bounded by the 200-node cap. |
| `formatSituationDebateContext()` | `lib/debate/prompts.ts` | Builds rich context string for situation-based debates from taxonomy nodes, linked nodes, and conflict summaries. |
| `buildDiagnosticsOutput()` | `lib/debate/formatters.ts` | Assembles the diagnostics JSON section of a completed debate session. Extended by this spec to include adaptive staging diagnostics. |
| `POVER_INFO` | `lib/debate/types.ts` | Registry of POV character definitions (prometheus, sentinel, cassandra). Maps POV IDs to names, descriptions, and BDI profiles. |
| `EntryDiagnostics` | `lib/debate/types.ts` | Per-transcript-entry diagnostics type. Records extraction status, claim counts, validation failures. Extended by this spec to include predicate evaluation results. |
