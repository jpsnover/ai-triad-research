# Moderator Quality Diagnostics: Theory, Instrumentation, and Visualization

## Status: Proposal — April 2026

Companion to [moderator-enhancement.md](./moderator-enhancement.md), which defines
14 moderator moves across six families (Procedural, Elicitation, Repair,
Reconciliation, Reflection, Synthesis) and a trajectory-aware triggering system based on
a composite Debate Health Score. This document addresses: *how do we know the
moderator is doing its job well?*

---

## Part 1: Theory — What Makes a Good Moderator?

A moderator can fail in two symmetric ways: **too passive** (lets debaters wander,
dodge, repeat themselves) or **too aggressive** (interrupts productive exchanges,
forces premature convergence, derails natural argument development). Good moderation
sits in tension between these failure modes. We need diagnostics that detect both.

### The Five Quality Dimensions

#### D1: Intervention Accuracy — "Did It Fire When It Should?"

An intervention is **accurate** when the trigger condition genuinely identified a
problem that needed moderator action. We measure this in two parts:

- **Precision:** Of interventions that fired, how many addressed a real problem?
  A false positive is a PIN that interrupted a debater who was about to answer
  the question anyway, or an REDIRECT that raised a topic the debaters were
  deliberately setting aside for good reason.

- **Recall:** Of situations that warranted intervention, how many were caught?
  A false negative is a debater who evaded a direct question for three rounds
  with no PIN, or two debaters using "alignment" in incompatible ways for five
  rounds with no CLARIFY.

We cannot measure precision/recall automatically (that would require ground-truth
labels), but we can surface the evidence that lets a human reviewer judge. For each
intervention: what triggered it, what data supported the trigger, and what happened
in the turns immediately after.

#### D2: Intervention Effectiveness — "Did It Change the Debate?"

An intervention is **effective** when the debate's trajectory measurably shifts in
the desired direction after the intervention. Each intervention type has a specific
effectiveness signal:

| Move | Effective if... | Ineffective if... |
|---|---|---|
| **PIN** | Next turn contains `pin_response` with substantive `brief_reason`; subsequent turns reference the pinned claim | Debater gives empty agreement and pivots away; claim never reappears |
| **PROBE** | `probe_response` names specific evidence or honestly concedes a gap; subsequent turns build on the evidence | Vague hand-wave; evidence_type is never `empirical` or `precedent` |
| **CHALLENGE** | Debater acknowledges position evolution or explicitly concedes; position drift stabilizes | Debater claims consistency without addressing the contradiction; drift continues |
| **CLARIFY** | Next turn contains `clarification` with operational `definition`; subsequent debaters adopt the definition | Definition is tautological; other debaters ignore it |
| **CHECK** | Misunderstanding is identified and corrected; subsequent attacks target the actual claim | Debater confirms understanding without revision; strawman attacks continue |
| **SUMMARIZE** | Subsequent turns advance beyond the summarized state; no regression to settled points | Debaters re-argue points the summary marked as resolved |
| **ACKNOWLEDGE** | Concession persists in subsequent turns (no walk-back); other debaters adjust positions | Concession is forgotten within 2 rounds; other debaters don't reference it |
| **REVOICE** | Debater confirms accuracy; other debaters engage with the revoiced version | Debater corrects the revoice; or propositional gate rejects it (taxonomy anchor mismatch or entity loss) |
| **META-REFLECT** | Debater names a specific crux condition or examines a shared assumption; crux appears in subsequent focus_point selection | Debater gives a vague non-answer ("I'd need more evidence") without naming what evidence; no crux node created |
| **REDIRECT** | The raised topic appears in `taxonomy_refs` or claims for ≥2 subsequent turns | Topic is mentioned once and dropped |
| **COMPRESS** | `compressed_thesis` is distinct from generic position statement; sharpens the disagreement | Thesis is a bland restatement of prior arguments |
| **COMMIT** | All sub-fields present with specific, non-generic content; creates high-confidence AN edges | Sub-fields are vague or empty; concessions list is suspiciously short |

#### D3: Pacing — "Did It Intervene at the Right Moments?"

Good moderation has rhythm. We track:

- **Intervention density:** Interventions per round, rolling 3-round average.
  Healthy range: 0.2–0.5 (roughly one intervention every 2-3 rounds).
  Below 0.1 over 5+ rounds suggests the moderator is too passive.
  Above 0.7 suggests it's dominating the debate.

- **Clustering:** Are interventions bunched together? Two or more consecutive
  rounds with interventions suggests the moderator is overreacting to a
  temporary pattern rather than letting the debate self-correct.

- **Phase alignment:** Intervention types should match the debate phase.
  CLARIFY in thesis-antithesis is fine (definitions matter early). PIN in
  thesis-antithesis is premature (positions aren't established yet). REDIRECT
  in synthesis is disruptive (don't open new fronts at the end).

- **Debater targeting balance:** Is the moderator disproportionately
  intervening on one debater? A ratio beyond 2:1 across the debate suggests
  bias. Track interventions-per-debater and flag imbalance.

#### D4: Trigger Quality — "Was the Signal Real?"

Each intervention fires because a convergence signal or AN pattern crossed a
threshold. But signals can be noisy. We need to see the raw signal values at the
moment of triggering to judge whether the threshold was appropriate:

- A PIN triggered by `concession_opportunity === 'missed'` — was the
  opposing claim's QBAF strength actually ≥ 0.7, or did noise in the
  scoring produce a false trigger?

- A CHALLENGE triggered by position drift — was the overlap drop from 0.45
  to 0.25 a genuine shift, or did the debater simply use different vocabulary
  to express the same position?

- An REDIRECT triggered by uncited high-relevance nodes — is the embedding
  similarity ≥ 0.7 genuine topical relevance, or a false match?

The diagnostic must show the triggering signal's value, the threshold, and
enough context (the actual claims, the actual words) for a human to judge.

#### D5: Missed Opportunities — "What Should It Have Done?"

The hardest dimension to instrument, but the most valuable. We want to flag
rounds where intervention was *warranted but didn't happen*. This requires
computing trigger conditions even when they don't fire and logging them as
"near-miss" events:

- A trigger signal crossed 80% of its threshold but not 100%.
- Two or more trigger types nearly fired simultaneously (compound signal).
- A debater's recycling rate has been climbing for 3+ turns without
  triggering CHALLENGE (it fires on single-turn threshold, missing gradual
  accumulation).

Near-misses surface tuning opportunities: if the threshold is consistently
too high, the moderator is under-intervening.

---

## Part 2: Instrumentation — What to Capture

> **Type authority:** Core moderator types (`ModeratorState`, `SelectionResult`,
> `EngineValidationResult`, `ModeratorIntervention`, `DebateTurnResponse`,
> `ANMutation`, `DebateHealthScore`, `TranscriptEntry` extensions) are defined in
> [moderator-enhancement.md](./moderator-enhancement.md). This document defines
> diagnostics-only types that reference those definitions. When a field appears
> in both documents, moderator-enhancement.md is authoritative.

### 2.1 New Type: `ModeratorDiagnostics`

Added to the per-round moderator trace (extends the existing
`moderator_trace` in system entry metadata):

```typescript
interface InterventionRecord {
  family: InterventionFamily;
  move: InterventionMove;
  target_debater: PoverId;
  text: string;
  trigger: {
    signal_name: string;          // e.g. 'concession_opportunity', 'position_drift'
    signal_value: number | string; // the actual value at trigger time
    threshold: number | string;    // the threshold it crossed
    source_node_id?: string;       // AN node that triggered it, if applicable
    source_round?: number;         // prior round referenced
    source_claim?: string;         // specific claim text
  };
  phase: DebatePhase;
  round: number;
}

interface InterventionOutcome {
  intervention_id: string;        // links back to InterventionRecord
  move: InterventionMove;
  family: InterventionFamily;
  response_present: boolean;      // did debater include required field?
  response_substantive: boolean;  // was the response non-trivial? (heuristic)
  formally_compliant_evasion: boolean; // passed form check but flagged by Stage B specificity heuristic
  follow_through_rounds: number;  // how many subsequent rounds reference this topic
  topic_persistence: number;      // % of next 3 rounds that cite related AN nodes
  judge_retries: number;          // how many retries needed for compliance
}

interface NearMiss {
  move: InterventionMove;
  family: InterventionFamily;
  target_debater: PoverId;
  signal_name: string;
  signal_value: number | string;
  threshold: number | string;
  effective_threshold: number | string; // after persona + trajectory modifiers
  gap_pct: number;                // how close: (value / effective_threshold) * 100
  round: number;
}

interface ModeratorRoundDiagnostics {
  round: number;
  phase: DebatePhase;

  // What happened
  intervention?: InterventionRecord;
  intervention_outcome?: InterventionOutcome;  // filled in post-hoc

  // What almost happened
  near_misses: NearMiss[];

  // All trigger evaluations (even those that didn't fire)
  trigger_evaluations: {
    move: InterventionMove;
    family: InterventionFamily;
    target: PoverId;
    signal_name: string;
    signal_value: number | string;
    base_threshold: number | string;
    persona_modifier: number;       // from persona-aware thresholds
    trajectory_modifier: number;    // from health score trend
    effective_threshold: number | string; // base × persona × trajectory
    fired: boolean;
    suppressed_reason?: string;    // 'rate_limit' | 'phase_mismatch' |
                                   // 'same_debater_consecutive' | 'budget_exhausted'
                                   // | 'register_balance' | 'prerequisite_unmet'
                                   // | 'burden_cap' | 'cooldown_blocked'
    prerequisite_override?: {      // if prerequisite graph changed this move's priority
      original_rank: number;
      override_rank: number;
      prerequisite_rule: string;   // e.g. 'semantic_divergence → repair_before_elicitation'
    };
    force: InteractionalForce;     // descriptive annotation
    burden_weight: number;         // family burden weight
  }[];

  // Debate health score (trajectory-aware triggering)
  health: {
    score: number;                  // 0.0 (critical) to 1.0 (healthy)
    trend: number;                  // change from previous turn
    consecutive_decline: number;    // turns of continuous decline
    trajectory_modifier: number;    // threshold multiplier in effect
    sli_breach: string | null;      // which component breached its floor (2+ consecutive turns), if any
    sli_routed_family: string | null; // which intervention family received sensitivity boost from breach
    components: {
      engagement: number;           // from engagement_depth.ratio, 3-turn avg
      novelty: number;              // inverse of recycling_rate, 3-turn avg
      responsiveness: number;       // concessions_taken / opportunities, 3-turn
      coverage: number;             // unique cited nodes in last 3 turns / relevant nodes for current focus
      balance: number;              // evenness of turn distribution
    };
    floors: {                       // critical floor thresholds (2-turn breach → targeted alert)
      engagement: 0.25;
      novelty: 0.25;
      responsiveness: 0.15;
      coverage: 0.20;
      balance: 0.30;
    };
  };

  // Pacing state
  pacing: {
    interventions_so_far: number;
    budget_total: number;
    budget_remaining: number;
    rounds_since_last_intervention: number;
    interventions_per_debater: Record<PoverId, number>;
    interventions_per_family: Record<InterventionFamily, number>;
    burden_per_debater: Record<PoverId, number>;  // cumulative burden weight
    rolling_density_3round: number;  // interventions / rounds, trailing 3
    last_intervention_family?: InterventionFamily; // for register shifting
    prerequisite_overrides_this_debate: number;    // times prerequisite graph changed priority
  };

  // Selection context (existing, enhanced)
  selection: {
    responder: PoverId;
    candidates: { debater: PoverId; score: number; rank: number }[];
    focus_point: string;
    selection_reason: string;
  };
}

// Session-level aggregation
interface ModeratorSessionDiagnostics {
  total_interventions: number;
  interventions_by_move: Record<InterventionMove, number>;
  interventions_by_family: Record<InterventionFamily, number>;
  interventions_by_debater: Record<PoverId, number>;
  interventions_by_phase: Record<DebatePhase, number>;
  total_near_misses: number;
  near_misses_by_move: Record<InterventionMove, number>;
  suppressed_by_reason: Record<string, number>;
  avg_follow_through_rounds: number;
  compliance_rate: number;           // % of interventions where response_present
  substantive_rate: number;          // % where response_substantive
  debater_targeting_ratio: number;   // max/min interventions across debaters
  debater_burden_ratio: number;      // max/min cumulative burden across debaters
  avg_density: number;               // interventions / total rounds
  phase_appropriateness: number;     // % of interventions whose family matches phase
  burden_balance: number;            // 1 - (max_debater_burden / total_burden)
  register_alternation_rate: number; // % of consecutive interventions that shift register
  prerequisite_overrides_total: number; // times prerequisite graph changed priority

  // Health score trajectory
  health_score_min: number;          // lowest health score during debate
  health_score_final: number;        // health score at last round
  health_score_trend: 'improving' | 'stable' | 'declining';
  longest_decline_streak: number;    // max consecutive rounds of declining health
  trajectory_interventions: number;  // interventions where trajectory_modifier < 1.0
                                     // (proactive, fired by trend not just threshold)

  // SLI floor alert tracking (2+ consecutive turns below floor)
  sli_breaches_total: number;        // total 2-turn breach events (not single-turn dips)
  sli_breaches_by_component: Record<string, number>;  // count per component
  sli_routed_interventions: number;  // interventions where SLI breach boosted a specific family

  // Cooldown conflict tracking
  cooldown_blocked_count: number;    // interventions that would have fired but for cooldown
  cooldown_blocked_during_decline: number; // subset where health was also declining

  // Engine validation tracking
  engine_overrides: number;          // Stage 1 recommended intervention, engine rejected it
  engine_overrides_by_reason: Record<string, number>;  // breakdown by suppression reason
  stage2_failures: number;           // Stage 2 failed (parse error, timeout) after engine validated

  // Compliance evasion tracking
  formally_compliant_evasions: number;  // responses that passed form check but flagged by Stage B
  evasion_rate: number;                 // formally_compliant_evasions / total hard-compliance responses

  // Trajectory freeze tracking
  trajectory_freezes: number;        // times consecutive_decline was frozen post-intervention
  trajectory_freeze_health_still_declining: number; // subset where health dropped during freeze

  // REVOICE quality (architectural gate metrics)
  revoice_attempts: number;          // total REVOICE moves attempted
  revoice_gate_rejections: number;   // rejected by propositional gate (taxonomy anchor mismatch or entity loss)
  revoice_dynamic_an_fallbacks: number; // times dynamic AN anchors used (0 taxonomy overlap)
  revoice_dynamic_an_accuracy: number;  // accuracy rate for AN-anchored revoices (separate from taxonomy-anchored)
  revoice_debater_corrections: number; // revoice_response.accurate === false
  revoice_accuracy_rate: number;     // 1 - (corrections / successful revoices)
}
```

### 2.2 Where to Compute

| Data | When computed | Where stored |
|---|---|---|
| `trigger_evaluations` | Engine pre-computes `TriggerEvaluationContext`, then records all evaluations after Stage 1 returns | `entry.metadata.moderator_diagnostics` on the system entry |
| Engine validation | After Stage 1, deterministic check of budget/cooldown/phase/prerequisites/burden | Same location (includes `suppressed_reason` if recommendation rejected) |
| `intervention` | After engine validates + Stage 2 generates (if both succeed) | Same location + visible transcript entry |
| `near_misses` | During trigger evaluation (when signal ≥ 80% threshold) | Same location |
| `health` (inc. SLI floors) | After each turn's convergence signals are computed | Same location |
| `pacing` | During moderator selection (after intervention decision) | Same location |
| `intervention_outcome` | After the *responding* debater's turn completes | Backfilled into the moderator's system entry |
| `follow_through_rounds` | After each subsequent turn (rolling update for 3 rounds) | Updated on the moderator's system entry |
| REVOICE propositional gate | During REVOICE intervention (taxonomy anchor check + entity preservation) | On the intervention's system entry |
| Session aggregates | End of debate (post-synthesis) | `session.moderator_session_diagnostics` |

### 2.3 Outcome Assessment Logic

After a debater responds to an intervention, the engine computes
`InterventionOutcome`:

**`response_present`**: Check whether the required structured field exists
in the debater's parsed JSON output. Only checked for moves with hard
compliance requirements (PIN, PROBE, CHALLENGE, CLARIFY, CHECK, COMPRESS,
COMMIT, REVOICE, META-REFLECT). Moves with no compliance check (ACKNOWLEDGE, BALANCE,
REDIRECT, SEQUENCE, SUMMARIZE) always report `response_present: true`.

**`response_substantive`**: Heuristic per move:
- PIN: `brief_reason` is > 15 words and doesn't repeat the moderator's
  question verbatim (Jaccard similarity < 0.5 with moderator text).
- PROBE: `evidence` names a specific source (contains proper noun, number,
  or date), OR `evidence_type === 'conceded_gap'` (honest acknowledgment
  counts as substantive).
- CHALLENGE: `explanation` references the specific prior claim cited by the
  moderator (substring match or embedding similarity > 0.6).
- CLARIFY: `definition` contains at least one number, date, or proper noun
  (indicating operational specificity rather than tautology).
- CHECK: `understood_correctly` is false and `actual_target` is non-empty, OR
  `understood_correctly` is true (confirmed understanding is always substantive).
- COMPRESS: `compressed_thesis` is ≤ 50 words and has Jaccard similarity
  < 0.4 with the debater's most recent full statement (distillation, not
  copy-paste).
- COMMIT: all three sub-fields (`concessions`, `conditions_for_change`,
  `sharpest_disagreements`) are non-empty arrays/objects.
- REVOICE: `revoice_response` is present. If `accurate === false`, the
  `correction` field must be non-empty.
- META-REFLECT: `reflection` contains a non-empty `conclusion`. For
  `type === 'crux'`, the `crux_condition` must name a specific falsifiable
  condition (contains ≥1 proper noun, number, or measurable threshold —
  not just "more evidence"). For `type === 'assumption_check'`, the
  `assumption_examined` must be non-empty.

**`topic_persistence`**: For each of the 3 turns following the intervention,
check whether any `taxonomy_refs` or extracted AN claims reference the same
topic (measured by embedding similarity ≥ 0.6 between the intervention's
`source_claim` and the subsequent turn's claims).

---

## Part 3: Visualization — Diagnostics UI

### 3.1 New Tab: "Moderator" in DiagnosticsPanel

Added as a peer to the existing Overview and Convergence Signals tabs.
Three sub-views:

#### Sub-View A: Intervention Timeline

A horizontal timeline, one column per round. Each column shows:

Two tracks stacked vertically: the **intervention track** (discrete events) and
the **health score track** (continuous line chart).

```
Health:  0.8 ─────╲                 ╱─────────────
         0.6       ╲───────╲──────╱
         0.4                ╲────╱
              R1    R2    R3    R4    R5    R6    R7    R8

Moves:                    ┌──────────┐          ┌──────────┐
                          │ PIN      │          │ ACKNOWL. │
                          │ elicit.  │          │ reconcil.│
                          │ → Prom.  │          │ → Sent.  │
                          │ ✓ subst. │          │ (no chk) │
                          └──────────┘          └──────────┘
                          ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
Near-misses:              CLARIFY(82%)  REDIRECT(92%)
                          → Sent.       → general
```

The health score line visually connects interventions to debate trajectory:
when the line dips, interventions cluster; when it rises, the moderator
backs off. A "proactive" intervention (one where the trajectory modifier
contributed to the trigger) is marked with a small ▼ on the health line
at its round.

**Color coding (intervention boxes):**
- Border color = outcome: green (effective), yellow (compliant but no
  follow-through), red (ignored or empty compliance)
- Fill color = family: amber (elicitation), blue (repair), green
  (reconciliation), gray (procedural), gold (synthesis)
- Gray dashed: near-miss (with percentage of effective threshold reached)

**Phase bands:** Background color shifts across phases (blue = thesis-antithesis,
white = exploration, amber = synthesis) so phase-appropriateness is visually
obvious.

**Clicking an intervention** opens the detail panel (Sub-View C).

#### Sub-View B: Session Summary Cards

Five cards across the top of the Moderator tab:

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ INTERVENTIONS   │  │ EFFECTIVENESS   │  │ HEALTH SCORE    │  │ PACING          │  │ BALANCE         │
│                 │  │                 │  │                 │  │                 │  │                 │
│ 5 of 6 budget   │  │ 80% substantive │  │ Current: 0.72   │  │ Density: 0.33   │  │ Prom: 2         │
│                 │  │ 60% follow-thru │  │ Trend: ↑        │  │ No clustering   │  │ Sent: 1         │
│ Elicitation: 2  │  │ 100% compliant  │  │ Min: 0.41 (R5)  │  │ Phase-aligned:  │  │ Cass: 2         │
│ Repair: 1       │  │                 │  │ Proactive: 1    │  │ 4 of 5 (80%)   │  │ Ratio: 2.0      │
│ Reconcil.: 1    │  │                 │  │                 │  │                 │  │                 │
│ Synthesis: 1    │  │                 │  │                 │  │ Families:       │  │                 │
│                 │  │                 │  │                 │  │ balanced ✓      │  │                 │
│ Near-misses: 3  │  │                 │  │                 │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Card behavior:**
- INTERVENTIONS: Grouped by family, not individual move type. Click to filter
  timeline to only show intervention rounds.
- EFFECTIVENESS: Colored red/yellow/green based on substantive rate thresholds
  (< 40% red, 40-70% yellow, > 70% green).
- HEALTH SCORE: Shows current value, overall trend (↑/→/↓), worst point (with
  round), and count of "proactive" interventions (those where trajectory_modifier
  < 1.0 contributed to the trigger firing). Color: green ≥ 0.6, yellow 0.4-0.6,
  red < 0.4.
- PACING: Flags clustering (⚠) or dead zones (⚠ no interventions for 5+ rounds).
  Also shows family balance status.
- BALANCE: Debater targeting ratio colored by severity (≤ 1.5 green, 1.5-2.5
  yellow, > 2.5 red).

#### Sub-View C: Intervention Detail Panel

When an intervention (or near-miss) is selected, the right panel shows:

```
┌─────────────────────────────────────────────────────────────┐
│ INTERVENTION: PIN — Round 4 → Prometheus                    │
│ Phase: exploration                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ MODERATOR TEXT:                                             │
│ "Prometheus, Sentinel asked whether deployment timelines    │
│  should include mandatory safety audits. You moved to a     │
│  different topic. Do you agree or disagree?"                │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ TRIGGER:                                                    │
│ Signal: concession_opportunity                              │
│ Value:  missed (opposing claim strength: 0.82)              │
│ Base threshold: missed + strength ≥ 0.7                     │
│ Persona modifier: 0.85 (Prometheus: lower PIN threshold)    │
│ Trajectory modifier: 0.85 (health declining 2 turns)        │
│ Effective threshold: 0.7 × 0.85 × 0.85 = 0.51 — triggered │
│ Note: would NOT have fired at base threshold (0.82 < 0.7    │
│       for the concession check, but trajectory brought the  │
│       system's sensitivity up — proactive intervention)     │
│                                                             │
│ Source: AN-14 "Safety audits should be mandatory before      │
│         any deployment exceeding 10^25 FLOPs"               │
│ Source round: 3 (Sentinel)                                  │
│                                                             │
│ HEALTH SCORE AT THIS ROUND:                                 │
│ Score: 0.52 (↓ from 0.61, declining 2 turns)                │
│ SLI alerts: all clear (no 2-turn breach)                    │
│ Components: engagement 0.45 | novelty 0.38 | responsive-    │
│ ness 0.60 | coverage 0.72 | balance 0.85                   │
│ Floors:     eng ≥0.25 ✓  | nov ≥0.25 ✓  | resp ≥0.15 ✓    │
│             cov ≥0.20 ✓  | bal ≥0.30 ✓                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ RESPONSE (Round 4, Prometheus):                             │
│ pin_response:                                               │
│   position: conditional                                     │
│   condition: "only for frontier models above 10^26 FLOPs"   │
│   brief_reason: "Blanket mandates slow iteration on         │
│                  smaller models with negligible risk"        │
│                                                             │
│ Substantive: ✓ (22 words, low overlap with question)        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ FOLLOW-THROUGH:                                             │
│ Round 5: Sentinel references AN-14 in rebuttal       ✓     │
│ Round 6: Cassandra cites "FLOPs threshold" framing   ✓     │
│ Round 7: No further references                       ─     │
│                                                             │
│ Topic persistence: 67% (2 of 3 subsequent rounds)           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ OTHER TRIGGERS EVALUATED THIS ROUND:                        │
│ ✗ CLARIFY [repair] → Sentinel: "adequate oversight"         │
│   (signal: 1 use, eff. threshold: ≥ 2) — not triggered     │
│ ✗ CHALLENGE [elicitation] → Cassandra: drift 0.38           │
│   (base: 0.30, eff: 0.26) — not triggered (near-miss: 68%) │
│ ✗ REDIRECT [procedural] → topic "compute governance"        │
│   relevance 0.65 (eff. threshold: 0.60) — near-miss: 92%   │
│ ✓ ACKNOWLEDGE [reconciliation] → Sentinel: concession taken │
│   — suppressed: lower priority than PIN this round          │
│                                                             │
│ SUPPRESSED: 1 (ACKNOWLEDGE, priority below PIN)             │
│ REGISTER: last intervention was Elicitation (R2) —          │
│           Reconciliation preferred next ✓                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Per-Turn Entry View Enhancement

The existing EntryView (shown when clicking a transcript row) gains a new
section: **"Moderator Context"** — visible on both system entries (moderator
turns) and debater entries (if preceded by an intervention).

**On a moderator system entry:**
```
MODERATOR CONTEXT
  Intervention: PIN [elicitation] → Prometheus
  Budget: 3 of 6 used (3 remaining)
  Health score: 0.52 ↓ (declining 2 turns)
  Trajectory modifier: 0.85 (thresholds lowered 15%)
  Rounds since last intervention: 2
  Last family: elicitation → next prefers reconciliation/repair
  Trigger evaluations: 5 (1 fired, 2 near-miss, 1 suppressed, 1 clear)
  [Expand to see full trigger evaluation table]
```

**On a debater entry that followed an intervention:**
```
MODERATOR CONTEXT
  Responding to: PIN (Round 4)
  Compliance: ✓ pin_response present
  Substantive: ✓ (22 words, specific condition stated)
  Judge retries for compliance: 0
```

### 3.3 Convergence Signals Panel Enhancement

The existing ConvergenceSignalsPanel turn-by-turn table gains a new column:
**"Mod"** — a compact indicator of moderator activity for that round.

| Round | Speaker | ... existing columns ... | Health | Mod |
|---|---|---|---|---|
| 3 | Sentinel | ... | 0.71 → | — |
| 4 | Prometheus | ... | 0.52 ↓ | PIN ✓ |
| 5 | Sentinel | ... | 0.58 ↑ | — |
| 6 | Cassandra | ... | 0.63 ↑ | ACK |
| 7 | Prometheus | ... | 0.68 ↑ | — |
| 8 | Sentinel | ... | 0.49 ↓ | RDR ✗ |

The **Health** column shows the debate health score and trend arrow for that
round. Color-coded: green ≥ 0.6, yellow 0.4-0.6, red < 0.4. This makes it
immediately visible when the debate was struggling and whether interventions
correlated with recovery.

The **Mod** column uses abbreviations (PIN, PRB, CHL, CLR, CHK, SUM, ACK,
RVC, MRF, CMP, CMT, RDR, BAL, SEQ) and a ✓/✗ for substantive response (omitted
for families with no compliance check, like Reconciliation). Clicking the
cell navigates to the Moderator tab's detail panel for that intervention.

This colocation is important: convergence signals are the *inputs* to
intervention triggers, and this column shows whether those inputs resulted
in action. A reviewer can see, for example, that recycling_rate was high
(red) for three consecutive rows with no Mod activity — a potential
missed-opportunity pattern.

### 3.4 Overview Tab Enhancement

The existing "Moderator Deliberations" section in the Overview tab gets a
new sub-section: **"Intervention Summary"** — a compact version of Sub-View B's
cards, embedded inline so that the Overview gives a complete debate-health
picture without switching tabs.

```
INTERVENTION SUMMARY
  5 interventions (of 6 budget) | 3 near-misses
  Families: elicitation ×2, repair ×1, reconciliation ×1, reflection ×1, synthesis ×1
  Effectiveness: 80% substantive, 60% follow-through
  Health: 0.72 (↑ from min 0.41 at R5) | 1 proactive intervention
  Phase alignment: 4/5 appropriate | Family balance: ✓
  Targeting: Prometheus ×2, Sentinel ×1, Cassandra ×2 (ratio 2.0)
```

---

## Part 4: Diagnostic Scenarios

These scenarios show how the diagnostics surface specific moderator quality
problems.

### Scenario 1: Over-Aggressive Moderator

**Symptoms in diagnostics:**
- Pacing card shows density > 0.6 and clustering flag
- Timeline shows back-to-back interventions in rounds 3-4-5
- Family breakdown is heavily skewed toward elicitation (>60%)
- Effectiveness card shows low follow-through (debaters can't develop
  arguments because they're constantly responding to moderator challenges)
- Health score track shows no recovery after interventions (the debate
  isn't improving despite heavy moderation)
- Convergence signals show collaborative ratio dropping (debaters become
  defensive under pressure)
- Register column shows no alternation — all interventions are adversarial

**Tuning response:** Increase minimum gap between interventions from 1 to 2
unmoderated rounds. Reduce budget. More importantly, check the family
balance: if elicitation dominates, the register-shifting logic isn't working.
Add reconciliation moves to break the pressure cycle.

### Scenario 2: Passive Moderator

**Symptoms in diagnostics:**
- Pacing card shows density < 0.1 over 8+ rounds
- Health score declining steadily but no interventions fire
- Near-misses accumulate (3+ per round) but nothing fires
- Trajectory modifier stays at 1.0 despite declining health (check whether
  health score computation is connected to threshold adjustment)
- Convergence signals show high recycling rates (red) with no CHALLENGE
- Concession opportunities show repeated "missed" with no PIN
- The debate stagnates: move disposition flatlines, engagement depth drops

**Tuning response:** Lower base trigger thresholds. Verify that the
trajectory modifier is actually being applied. Reduce the near-miss
threshold from 80% to 70% to surface more opportunities. Consider
compound triggers (two near-misses in the same round → force an
intervention).

### Scenario 3: Biased Moderator

**Symptoms in diagnostics:**
- Balance card shows ratio > 3.0 (e.g., Prometheus gets 4 interventions,
  Sentinel gets 1, Cassandra gets 0)
- Detail panels show that triggers are firing legitimately — Prometheus
  really is evading more — but the imbalance still creates an appearance
  of bias
- Family breakdown shows the biased debater gets only elicitation (pressure)
  and never reconciliation (support) — compounding the perception
- Audience perception: the moderator appears to be "picking on" one debater

**Tuning response:** Enforce the consecutive-debater rule more strictly.
The persona-aware thresholds (Risk 3 in moderator-enhancement.md) should
already be adjusting, but check whether the modifiers are too aggressive.
Also check whether the moderator is ACKNOWLEDGEing when the targeted debater
does comply — pressure without recognition is perceived as bias even when
substantively warranted.

### Scenario 4: All Pressure, No Support

**Symptoms in diagnostics:**
- Family breakdown: elicitation 60%, repair 25%, reconciliation 0%
- Health score recovers after interventions (they're effective!) but
  collaborative ratio stays low (debaters aren't building on each other)
- No ACKNOWLEDGE moves despite concession_opportunity.outcome === 'taken'
  appearing multiple times in convergence signals
- Position drift shows concessions being walked back in subsequent turns
  (no public record of the concession)

**Tuning response:** This is the scenario the six-family redesign was built
to prevent. Lower ACKNOWLEDGE thresholds so concessions are publicly marked.
The register-shifting logic should be recommending reconciliation after
elicitation, but if it's not firing, check whether ACKNOWLEDGE triggers are
being suppressed by the priority ordering (it sits below CHALLENGE and PIN).

### Scenario 5: Effective Moderation

**Symptoms in diagnostics:**
- Pacing: density 0.25–0.4, no clustering, good phase alignment
- Effectiveness: > 70% substantive, > 50% follow-through
- Family balance: no single family > 40%, register alternation > 60%
- Balance: debater targeting ratio ≤ 2.0
- Health score: starts moderate, dips mid-debate, recovers in synthesis
- Timeline: green borders dominate, interventions correlate with health
  score recovery, near-misses are sparse
- Convergence signals show collaborative ratio increasing over time
- Position drift stabilizes after CHALLENGE interventions
- Concessions persist after ACKNOWLEDGE interventions (no walk-back)
- META-REFLECT produces crux nodes that subsequent rounds actually engage with
- New AN nodes from PIN/CLARIFY/COMMIT responses have high QBAF scores

This is the target state. The diagnostics confirm that interventions are
well-timed, well-targeted, balanced across families, and produce lasting
effects on the debate.

---

## Part 5: Implementation Sequence

### Phase 1: Capture (engine-side, no UI changes)

These steps correspond to the round loop pseudocode in
[moderator-enhancement.md](./moderator-enhancement.md) §"Changes to
debateEngine.ts". Step numbers below map to the round loop steps in
parentheses.

1. Add `ModeratorRoundDiagnostics` and `DebateHealthScore` types to
   `lib/debate/types.ts`. Core types (`ModeratorState`, `SelectionResult`,
   `EngineValidationResult`, etc.) are defined in moderator-enhancement.md
   (the type authority); diagnostics-only types are defined here.
2. Implement `computeDebateHealthScore()` in a new module
   `lib/debate/debateHealth.ts` — computes the composite score from
   existing convergence signals after each turn. (Round loop step 1.)
3. Modify the moderator selection logic in `debateEngine.ts` to:
   a. Compute the health score and trajectory modifier. (Step 1.)
   b. Evaluate all trigger conditions every round (with persona and
      trajectory modifiers applied to thresholds). (Steps 2-3.)
   c. Record `trigger_evaluations`, `near_misses`, and `health` in
      `ModeratorRoundDiagnostics`. (Step 4.)
4. Store `ModeratorRoundDiagnostics` in the system entry's metadata
   alongside the existing `moderator_trace`. (Step 4.)
5. After each debater turn that follows an intervention, compute and
   backfill `InterventionOutcome`. (Step 12.)
6. Update `ModeratorState` via `updateModeratorState()`. (Step 14.)
7. At end of debate, compute `ModeratorSessionDiagnostics` aggregates.

### Phase 2: Display (renderer-side)

7. Add "Moderator" tab to DiagnosticsPanel with Sub-Views A, B, C.
8. Add "Health" and "Mod" columns to ConvergenceSignalsPanel table.
9. Add "Moderator Context" section to EntryView.
10. Add "Intervention Summary" to Overview tab.

### Phase 3: Iterate

11. After running several debates with diagnostics, review near-miss
    patterns and health score trajectories to tune trigger thresholds
    and health score component weights.
12. Add threshold configuration and health score weights to debate config
    (so they can be adjusted without code changes).
13. Consider adding a "moderator quality score" to the session-level
    metrics — a single number (0-1) computed from the five quality
    dimensions, weighted by debate length and intervention count.
14. Review family balance and register alternation rates across multiple
    debates to calibrate the soft preferences for register shifting.
15. **Sensitivity analysis slider:** Add a retroactive threshold adjustment
    tool to the Diagnostics Panel (popout). A reviewer drags a slider to
    adjust base thresholds for any move type across the entire debate log.
    The UI recomputes which `near_misses` *would* have fired and which
    actual interventions *wouldn't* have, displaying the counterfactual
    alongside the actual timeline. This requires no re-running of the
    debate — all raw signal values are already captured in
    `trigger_evaluations`. The slider operates client-side by reapplying
    the `effective_threshold` formula with the adjusted base value.
16. **Entailment-based substantive checks:** Add post-debate batch analysis
    using an NLI model to assess whether PIN/PROBE responses actually
    entail the expected semantic content (see Open Question #2).

---

## Part 6: Troubleshooting Runbook

Common failure modes and how to diagnose them using the diagnostics
instrumentation.

### "The moderator fired but shouldn't have"

1. Open the intervention detail panel (Sub-View C) for the round in question.
2. Check `trigger_evaluations` → find the entry where `fired: true`.
3. Compare `signal_value` against `effective_threshold`. If the signal
   legitimately crossed the threshold, the trigger was correct — the
   question is whether the threshold is too low.
4. Check which modifiers contributed: `persona_modifier`, `trajectory_modifier`,
   `sli_component_modifier`. If the effective threshold is far below the
   base threshold, one or more modifiers are pulling it down aggressively.
5. Check `health.consecutive_decline` — a long declining streak amplifies
   sensitivity via the trajectory modifier.
6. **Fix:** Raise the base threshold for this move, or reduce the trajectory
   modifier aggressiveness (see Configuration Reference in
   moderator-enhancement.md, Appendix A).

### "The moderator didn't fire but should have"

1. Check `near_misses` for the round. If the signal appears at ≥80%, it was
   close — lower the base threshold or the near-miss percentage.
2. If no near-miss: check `trigger_evaluations` for the expected move. Look
   at the `signal_value` — was it genuinely below threshold, or was the
   effective threshold raised by a persona or trajectory modifier?
3. Check `suppressed_reason`. Common causes:
   - `cooldown_active`: The moderator wanted to fire but the gap rule
     prevented it. Check `cooldown_blocked_count` in session diagnostics.
   - `budget_exhausted`: All reactive slots are used. Check if COMMIT
     is correctly excluded from budget counting.
   - `same_debater_consecutive`: Valid suppression — check if the
     targeting was genuinely needed despite the same-debater rule.
   - `burden_cap`: The target debater's cumulative burden exceeded 1.5×
     average. Check `burden_per_debater` in pacing diagnostics.
4. **Fix:** If `cooldown_blocked_count` or `cooldown_blocked_during_decline`
   is high (>2 per debate), reduce the cooldown escalation cap.

### "REVOICE gate rejected a valid translation"

1. Check diagnostics for the REVOICE attempt: `revoice_gate_rejections`
   in session summary.
2. Check which gate layer failed:
   - **Taxonomy anchor mismatch:** The revoiced text's top-3 taxonomy
     nodes didn't overlap ≥2/3 with the original claim's taxonomy refs.
     If the overlap was 0/3, the dynamic AN fallback should have
     activated. Check `revoice_dynamic_an_fallbacks` — if this is 0
     despite rejections, the fallback logic may not be triggering.
   - **Dynamic AN fallback also failed:** The claim's vocabulary is so
     novel that even the top-3 cited AN nodes from the last 2 rounds
     don't match. This is a genuine coverage gap. Check
     `revoice_dynamic_an_accuracy` — if the AN-anchored path has
     lower accuracy than taxonomy-anchored, the fallback anchors may
     be too permissive.
   - **Entity/relation loss:** The revoiced text dropped a named entity,
     numeric threshold, or causal relation. Check the Stage 2 prompt — it
     may need stronger instructions to preserve specifics.
3. The system automatically downgrades to CHECK on gate failure, so the
   debate is not disrupted. The diagnostic concern is systematic rejection
   rates (>30%).
4. **Fix:** If taxonomy anchor mismatches dominate, consider adding
   register-neutral alternative descriptions to taxonomy nodes. If dynamic
   AN fallbacks fire frequently (`revoice_dynamic_an_fallbacks` > 30% of
   attempts), the taxonomy is lagging behind the debate's vocabulary —
   consider a post-debate taxonomy update pipeline. If entity loss
   dominates, tighten the Stage 2 prompt for REVOICE.

### "A debater is ignoring interventions"

1. Check `compliance_rate` and `substantive_rate` in session diagnostics.
2. For the specific intervention: check `judge_retries` in the
   `InterventionOutcome`. High retries (≥2) mean the judge had to force
   compliance.
3. Check `formally_compliant_evasion` — the debater may be providing
   structurally valid but empty responses (vague conditions, generic hedges).
4. Check `evasion_rate` — if >20%, the specificity heuristics in Stage B
   may need tightening, or the debater's persona prompt may need adjustment.
5. **Fix:** For hard non-compliance, check that the BRIEF injection template
   includes the correct `response_field` and `response_schema` for the move
   type. For formal evasion, review the Stage B heuristic thresholds
   (PIN specificity: proper nouns/numbers, PROBE citation specificity).

### "The health score doesn't match what I see in the debate"

1. Check the individual `components` in the health diagnostics. The
   composite can mask a single failing component.
2. Check `sli_breach` — if a component is below its floor for 2+ turns,
   it should be flagged. If it's not, check the `sli_consecutive_breaches`
   counter.
3. Check `coverage` specifically — it uses a 3-turn rolling window
   relative to the current focus area, not cumulative. A debate that
   covered many topics in earlier rounds but is now stuck will show
   declining coverage. This is correct behavior.
4. **Fix:** If the weights feel wrong for a specific debate type, adjust
   the health score component weights (see Configuration Reference).

---

## Open Questions

1. **Should near-misses be visible to the user during the debate, or only
   in post-hoc review?** Showing them live might create distraction; hiding
   them loses real-time tuning feedback. Recommendation: show them only
   in the popout DiagnosticsWindow, not in the inline panel.

2. **How should `response_substantive` be computed for edge cases?** The
   heuristics above (word count, Jaccard similarity, presence of numbers)
   are coarse. An LLM can generate synonym-rich "fluff" that bypasses
   Jaccard without actually answering a PIN or PROBE. Planned Phase 3
   upgrade path: **entailment analysis** — for PIN responses, check that
   the response entails the prompt's boolean logic (agree/disagree/
   conditional) rather than just measuring surface overlap. For PROBE, check
   that the evidence entails the claim it purports to support. This requires
   an NLI model or additional LLM call per intervention response, so it
   belongs in post-debate batch analysis (not the critical path). A two-tier
   approach (fast heuristic live, entailment check in post-debate analysis)
   is the likely landing point.

3. **Should intervention outcomes feed back into subsequent trigger
   decisions?** If a PIN was ineffective (debater gave empty compliance),
   should the moderator escalate — e.g., re-PIN with sharper language, or
   shift to a CHALLENGE? This creates a feedback loop that could amplify
   moderator aggression. The safest design logs the ineffectiveness but
   doesn't auto-escalate; a future iteration could add explicit escalation
   rules with their own diagnostics.

4. **How much of this should appear in the DiagnosticsWindow (popout)
   vs. inline DiagnosticsPanel?** The popout has more space and is used
   for deep investigation. Recommendation: the Moderator tab lives in
   both, but near-miss details and full trigger evaluation tables are
   popout-only.
