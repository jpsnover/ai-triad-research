# Post-Debate Reflection Write-Back: Scope Audit

**Ticket:** t/1532
**Date:** 2026-07-12
**Author:** Computational Linguist
**Owner question (2026-07-11):** should post-debate reflection revise situation POV
interpretations, and what else could reflection improve?

## TL;DR

The system has **one** wired post-debate write-back path (crux → *new* situation
promotion, proposal-based, human-reviewed) and **three dead modules** that compute
taxonomy-weight evolution but are never called. The right move is **not** to flip the
dead modules on as-is — their auto-apply design predates and conflicts with the project's
"machine proposes, human disposes" stance — but to **converge all reflection write-back
onto the single proposal-to-review-queue pattern that already works.** Situation
interpretation revision becomes one more proposal type in that queue. Desire-priority
evolution logic already exists (the ticket's premise that it doesn't is incorrect); it is
dead alongside the rest of `confidenceEvolution.ts`.

## AC #1 — Wiring status (verified at the call-site level)

Grep for every evolution/feedback entry-point across `lib/`, `scripts/`, and
`taxonomy-editor/`, excluding `*.test.ts`.

| Module / function | Purpose | Call sites (non-test) | Status |
|---|---|---|---|
| `cruxTaxonomyFeedback.findAndEnrichPromotionCandidates` | Draft **new** situation nodes from cruxes that recurred as `irreducible` ≥3× | `debateEngine.ts:880` → `session.promotion_candidates` | **WIRED** (proposal-based) |
| `cruxTaxonomyFeedback.computeWeightAdjustments` | Crux-driven confidence/priority deltas on existing nodes | none | **DEAD** |
| `confidenceEvolution.ts` (`computeConfidenceUpdates`, `computePriorityUpdates`, `computeCrossPovUpdates`) | Belief confidence **and Desire priority** + cross-POV evolution; three-condition gate; `requires_human_review` >0.2 | none (only its own test) | **DEAD** |
| `operationalityEvolution.ts` (`computeOperationalityUpdates`, …) | Intention operationality ±1 on SPECIFY / EMPIRICAL CHALLENGE | none (only its own test) | **DEAD** |

**Finding:** confirmed dead code — same "built, tested, never wired" pattern as t/1278 /
t/1438. Three separate reflection mechanisms exist in code and are unreachable.

**Correction to the ticket's Part 2 premise #2.** The ticket states "Desire priority has
no post-debate evolution (`desirePriority.ts` has no evolve/post-debate logic)." The logic
*does* exist — `confidenceEvolution.ts:384 computePriorityUpdates` evolves Desire priority
(±1 on `reflection_concession` / `crux_of_disagreement`). It is dead, not absent. So all
three weights (Belief confidence, Desire priority, Intention operationality) are
symmetric: each has written evolution logic, and each is unwired. This is a cleaner
starting point than "two exist, one is missing."

### Why are they dormant? (the load-bearing question)

Not a simple oversight to reverse. `confidenceEvolution.ts` **auto-applies** small deltas
directly and only flags drifts >`HUMAN_REVIEW_THRESHOLD` (0.2) for review. That hybrid
auto-apply design predates the project's now-settled boundary — every taxonomy write is
human-gated (framing paper, Wisdom Harvesting; corroboration-design.md §Wisdom Harvesting;
the promotion path is proposal-only for exactly this reason). Wiring these modules **as
written** would reintroduce silent auto-drift into the taxonomy, violating that boundary.
That tension is the most plausible reason they were shelved rather than finished, and it
dictates the recommendation: keep the gate logic, drop the auto-apply, route everything
through proposals.

## Recommendation: one unified reflection-proposal queue

The wired promotion path already models the correct pattern: compute a **draft**, attach it
to the session (`promotion_candidates`), let a human approve/reject. Generalize it.

1. **Do not wire `confidenceEvolution` / `operationalityEvolution` as-is.** Their gate logic
   is sound and worth keeping (three-condition confidence gate; operationality ±1 on
   SPECIFY/EMPIRICAL CHALLENGE; priority ±1 on concession/crux). Their *auto-apply* path is
   not — remove it.
2. **Emit proposals, not writes.** Refactor the three dead computations to feed a single
   `session.reflection_proposals` structure alongside `promotion_candidates`: each proposal
   carries `{ node_id, kind: 'belief_confidence'|'desire_priority'|'intention_operationality'|'situation_interpretation', delta_or_text, reason, gate_result, materiality }`.
   Human approves/rejects in the review queue; approval is the only path to a taxonomy write.
   This is the t/1278/t/1438 "built-never-wired" fix done *correctly* — reconciled with the
   human-gated design, not merely switched on.

## AC #2 — Situation interpretation revision

**Gap is real.** `situationRefs.ts` only extracts references post-debate (t/193); the wired
promotion path only **creates new** situations from cruxes. Nothing **revises an existing**
situation's three POV interpretations when a debate stress-tests them. Situations are the
one BDI-bearing structure with no revision path.

Recommendation — add `situation_interpretation` as a proposal `kind` in the unified queue:

- **Mechanism: proposal-to-review-queue only.** Never direct rewrite (silent drift;
  contradicts Wisdom Harvesting). Matches the promotion path exactly.
- **Trigger: materiality gate, not update-on-mention.** Propose a revision only when a debate
  *materially engaged* the specific POV interpretation — the interpretation's claims were
  attacked (rebut/undercut/undermine) or extended, with attack `computed_strength` ≥ a
  severe threshold (reuse `SEVERE_ATTACK_THRESHOLD` 0.5, already defined for
  Debate-Tested), AND the referencing claim's attribution to the situation clears
  `ATTRIBUTION_THRESHOLD` (0.60, reuse from confidenceEvolution). Mere reference
  (`situation_crux_alignment` "decorated, not engaged") does not trigger.
- **Per-camp granularity.** A debate typically stresses one camp's reading; propose a
  revision to *that* interpretation, not all three.
- **Composition with t/1299.** An **approved** interpretation revision must regenerate that
  interpretation's debate-register POV-statements (t/1299) and its embeddings, so the
  revised text is what future debates inject and match against. This is a post-approval
  hook, not part of the proposal itself.

## AC #3 — Desire priority evolution

The logic exists (`computePriorityUpdates`) and is dead with the rest of
`confidenceEvolution.ts`. Recommendation: it rides the same wiring fix — surface priority
updates as `desire_priority` proposals in the unified queue. **Gate (already written,
keep):** concession on a Desire → −1; Desire is a crux of disagreement → +1; clamp [1,5];
no double-update. One addition worth considering per the framing paper's Three Weights /
doctrinal-anchoring interaction: a Desire at a doctrinal floor should not be auto-lowered
below that floor even by a concession — flag instead. Stipulated; note in the register.

## AC #4 — Other reflection candidates (go / no-go)

| Candidate | Currently debate-driven? | Recommendation | Reasoning |
|---|---|---|---|
| **Belief confidence** | No (dead code) | **GO** — unified queue | Gate logic exists and is sound; just needs proposal wiring. |
| **Desire priority** | No (dead code) | **GO** — unified queue | Same; corrects the ticket premise. |
| **Intention operationality** | No (dead code) | **GO** — unified queue | Same. |
| **Situation interpretations** | No (no logic) | **GO** — new proposal kind | The one true gap; highest owner interest. |
| **Edge weights** (`Invoke-EdgeWeightEvaluation`) | No — static compute from node confidence/doctrinal + edge type (CONTRADICTS/WEAKENS) | **NO-GO** (defer) | Already recomputed per-debate inside QBAF (`computed_strength`); propagating those to *taxonomy* edge weights is low-value and risks double-counting the same attack signal the node-weight proposals already use. Revisit only if edges need a testing-history of their own. |
| **`steelman_vulnerability`** node metadata | No — never checked against debate outcomes | **GO-LITE** (separate, low priority) | A debate that *exploits* a stated vulnerability validates it; one that repeatedly *fails* to exploit it flags it stale/wrong. Genuine validation signal, but distinct machinery (text-match of attack against the vulnerability description) — file separately, do not block the weight-evolution work. |
| **`possible_fallacies`** node metadata | No | **DEFER** | Same shape as steelman but weaker signal; revisit after steelman-validation proves the pattern. |
| **Source authority / recency** (t/1122) | No — ingestion metadata | **NO-GO** | Must stay debate-independent by construction: venue tier and publication date are properties of the source, not of how a debate went. Letting debate outcomes move them would corrupt the credibility signal. |

## AC #5 — Provenance of proposed thresholds

All **stipulated** (no evidence pointer), to be added to `metric-provenance-register.md`
§8 (design-stage) when the implementation ticket lands. Most are *reused* existing
constants, not new numbers:

| Threshold | Value | Source |
|---|---|---|
| `ATTRIBUTION_THRESHOLD` | 0.60 | reused, `confidenceEvolution.ts` |
| `SEVERE_ATTACK_THRESHOLD` (situation materiality) | 0.5 | reused, Debate-Tested design |
| `HUMAN_REVIEW_THRESHOLD` | 0.2 | reused; under the proposal model this becomes moot for auto-apply (everything is reviewed) but still useful to *rank* proposals by drift magnitude |
| confidence deltas / `MAX_DRIFT` (0.3) | as written | reused, `confidenceEvolution.ts` |
| operationality step / `MAX_DRIFT` (2) | as written | reused, `operationalityEvolution.ts` |
| priority ±1, clamp [1,5] | as written | reused, `confidenceEvolution.ts` |
| doctrinal-floor guard on priority | boolean gate | new, stipulated |

No new *magnitudes* are introduced by the situations recommendation — it reuses the
attribution and severity gates. The only genuinely new judgment is the doctrinal-floor
guard, a boolean.

## AC #6 — Follow-up tickets

Filed before this ticket closes (handoff discipline). Both are **DebateTool** scope
(`lib/debate/`), and the unified-queue design is cross-cutting (new session structure,
touches the human-review surface) → **Main (Technical Lead) design review required** before
implementation.

- **t/1542 (DebateTool):** Unified reflection-proposal queue — wire the three dead evolution
  modules (`confidenceEvolution`, `operationalityEvolution`, and the dormant
  `cruxTaxonomyFeedback.computeWeightAdjustments`) as **proposals** into a
  `session.reflection_proposals` structure parallel to `promotion_candidates`; remove the
  auto-apply path. This is the "built-never-wired" fix.
- **t/1543 (DebateTool):** Situation interpretation revision as a proposal kind — materiality
  gate (attack ≥ severe AND attribution ≥ 0.60, per-camp), review-queue integration, and the
  post-approval hook to regenerate t/1299 debate-register statements + embeddings. Blocked by
  t/1542.

Downstream (not filed yet — blocked on the queue structure existing): a Taxonomy Editor
review-UI for `reflection_proposals` (the human-disposes surface). Noted as a dependency;
file when t/1540 lands the structure.

The `steelman_vulnerability` validation idea (GO-LITE) is intentionally **not** filed — it
is separate machinery and would dilute the focused weight-evolution work; revisit after
t/1540/t/1541.
