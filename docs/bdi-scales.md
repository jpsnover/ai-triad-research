# BDI Scales: Priority, Operationality, Confidence

**Last updated:** 2026-08-11 · **Owner:** Computational Linguist
**Audience:** taxonomy-editor users first (this doc is bookmarked from the node **Attributes** tab, next to the Priority control); pipeline internals are in the later sections.

Every node in a POV taxonomy carries a **BDI category** (Belief, Desire, or Intention). Each category also carries **one numeric scale** that measures a dimension appropriate to that kind of claim. The scale is what the Attributes tab shows next to the category.

| BDI category | Scale | Range | Question it answers |
|---|---|---|---|
| **Belief** | `confidence` | 0.0–1.0 (continuous) | How well-supported is this claim by evidence? |
| **Desire** | `priority` | 1–5 (integer) | How foundational is this value to the camp? |
| **Intention** | `operationality` | 1–5 (integer) | How realized is this action, from rhetoric to deployment? |

All three are top-level fields on the node, defined in `lib/debate/taxonomyTypes.ts:157-172` and the JSON schema `taxonomy/schemas/pov-taxonomy.schema.json`. They are optional. Nodes created before the weighting pass ("pre-weighted nodes") simply lack them.

> **Not to be confused with debate-claim sub-scores.** A separate system scores the individual *claims* generated inside a debate (the `base_strength` of an Argument-Network node, from nine BDI sub-scores). That is documented in [`bdi-sub-score-calibration.md`](bdi-sub-score-calibration.md) and is a *per-debate* score. The three scales here are *persistent taxonomy-node attributes*. They connect at exactly one point. A debate outcome can update a node's `confidence` (Stage 3 below). Node `confidence` is not the same field as a claim's `base_strength`, and neither is derived from the other.

---

## 1 · Theory of success (why scale the BDI model)

Without scales, the taxonomy is **flat**: every node is treated as equally true and equally important (`docs/weighted-bdi-proposal.md`, "The Problem"). A speculative fringe Belief has the same standing as a replicated empirical finding; an existential Desire weighs the same as a procedural one. That flatness hurts the system in three concrete ways the proposal calls out. Debaters cannot tell foundational context from peripheral context. Every CONTRADICTS edge looks equally serious. And post-debate reflection has no way to say "we are less sure of this now" short of deleting the node.

**Why one scale per category, not one universal scale.** Each BDI category makes a different kind of claim, so "how strong is it" means something different in each:

- A **Belief** is an assertion about how the world *is*. The meaningful axis is **evidential support** (`confidence`). A belief can be strongly held yet poorly evidenced.
- A **Desire** is an assertion about how the world *should be*. Evidence does not rank a value; what ranks it is **how foundational** it is to the camp (`priority`). A camp's core values are non-negotiable regardless of evidence.
- An **Intention** is an assertion about what *will be done*. The meaningful axis is **how far along the path from rhetoric to enacted policy** the intention sits (`operationality`).

Collapsing these onto one number would conflate epistemic support with value ranking with implementation maturity. Keeping them separate lets each scale mean exactly one thing.

**What each scale is NOT** (from the proposal's guardrails, worth repeating because these are the common misreads):

- `confidence` is *not* strength of conviction and *not* a popularity count. A one-camp belief with strong evidence should outscore a three-camp belief with weak evidence. It measures evidential support.
- `priority` is *not* urgency. A priority-5 Desire may need no immediate action; it simply cannot be compromised. Priority also legitimately *differs across camps* ("AI safety" is 5 for safetyists, 2–3 for accelerationists). That divergence is the signal, not noise.
- `operationality` is *not* importance. A vague but important aspiration scores low; a fully-enacted minor policy scores high.

**What the scales unlock** (each expanded with code in §4): weighted taxonomy-context injection so debaters lead with well-supported / high-priority / concrete nodes; edge-weight modulation so a contradiction between two well-supported beliefs outweighs one where a side is speculative; a debate→taxonomy feedback loop where confidence rises and falls with argument outcomes; and editor sort/filter by priority and confidence.

**Calibration rationale (why the confidence formula is multi-signal).** A single-signal score from `epistemic_type` + `falsifiability` alone is too coarse. It lands 100% of the ~335 Belief nodes in just two buckets with only 4–5 distinct values. The multi-signal formula (§2) spreads the same nodes across all five tiers with 42 distinct values, validated against the full Belief set (`docs/weighted-bdi-proposal.md`, "Resulting distribution"). The Contested tier (0.0–0.3) stays deliberately **empty at initial assignment**: no belief should *start* contested; that status is earned only through debate outcomes (§3).

---

## 2 · How each scale is calculated

Initial values are assigned by a **deterministic PowerShell cmdlet**, `scripts/AITriad/Public/Invoke-BDIWeightAssignment.ps1`, not by an LLM pass. It reads `source_evidence_index.json` (evidence counts) and `edges.json` (support/attack balance) and writes each value back to the POV JSON with a seed history entry. Because it is arithmetic over existing metadata, it is reproducible and auditable. New nodes (from ingestion or reflection) start from the base term only; the boosts accrue as the node gathers evidence, debate references, and edges.

### Confidence (Belief, 0.10–0.95)

Rendered as a continuous slider with a color ramp. The reader-facing tiers (`docs/weighted-bdi-proposal.md`):

| Confidence | Tier | Meaning |
|---|---|---|
| 0.9–1.0 | Established | broad empirical support, replicated, expert consensus |
| 0.7–0.9 | Well-supported | strong evidence, some contested aspects |
| 0.5–0.7 | Plausible | theoretical support and some evidence, not conclusive |
| 0.3–0.5 | Speculative | logically coherent, limited empirical basis |
| 0.0–0.3 | Contested | significant counter-evidence or methodological dispute |

The multi-signal formula (`Invoke-BDIWeightAssignment.ps1:11-16`):

```
confidence = clamp(base + evidence_boost + debate_boost + edge_boost, 0.10, 0.95)

  base(epistemic_type, falsifiability):
    empirical_claim + high/medium/low falsifiability → 0.80 / 0.70 / 0.60
    predictive → 0.40 · interpretive_lens/definitional/other → 0.50
  evidence_boost = min(0.15, source_doc_count × 0.05)     # +0.05 per source doc
  debate_boost   = min(0.10, debate_ref_count × 0.03)      # +0.03 per debate ref
  edge_boost     = min(0.05, supports×0.02) − min(0.05, attacks×0.02)
```

**Doctrinal floor.** A Belief that is cosine-similar to its POV's doctrinal boundaries is flagged `doctrinally_anchored` and gets a confidence **floor** (so a load-bearing commitment is not scored as weak just because its evidential grounding is thin). When the floor is applied, the pre-floor score is preserved in `evidential_confidence` so the two readings stay distinguishable (`taxonomyTypes.ts:161-164`). The Attributes tab surfaces both.

### Priority (Desire, 1–5)

Dropdown levels (`GraphAttributesPanel.tsx:238-244`):

| Level | Label |
|---|---|
| 5 | Core (non-negotiable) |
| 4 | High |
| 3 | Important |
| 2 | Preferred |
| 1 | Nice-to-have |

Initial assignment is seeded from the taxonomy hierarchy plus the doctrinal boundaries (`Invoke-BDIWeightAssignment.ps1:17-21`): **5** = a doctrinal boundary named in `POVER_INFO`; **4** = root-level Desire (no parent); **3** = mid-tree (has parent and children); **2** = leaf (has parent, no children). Priority 5 also renders a "Doctrinally Pinned" badge in the editor.

### Operationality (Intention, 1–5)

Dropdown levels (`GraphAttributesPanel.tsx:246-252`):

| Level | Label |
|---|---|
| 5 | Fully operational (deployed/enacted) |
| 4 | High (concrete plan, resources allocated) |
| 3 | Moderate (specific but unresourced) |
| 2 | Low (vague aspiration) |
| 1 | Notional (pure rhetoric) |

Initial value: `clamp(tree_base + falsifiability_mod + situation_bonus, 1, 5)`. `tree_base` is leaf 4 / mid-tree 3 / root 2; `falsifiability_mod` is +1 (high) or −1 (low); `situation_bonus` is +1 when the node carries `situation_refs` (`Invoke-BDIWeightAssignment.ps1`, operationality section). The scoring logic is mirrored in TypeScript at `lib/debate/intentionOperationality.ts`; design rationale is in `research/comp-linguist/docs/intention-operationality-design.md`.

---

## 3 · How values are updated

The "**N update(s) — latest: <reason>**" line under a scale on the Attributes tab is the node's history log. It renders `node.{confidence,priority,operationality}_history`, showing the count and the `reason` of the most recent entry (`GraphAttributesPanel.tsx:229-233`). Each entry is a `WeightHistoryEntry` (`taxonomyTypes.ts:101-114`):

```
date · value (the new value) · delta · reason
supersedes?  (debate id whose update this replaced)
attack_claim?  (the AN claim text that drove a confidence change)
robustness?  (cross-model confirmation count, ≥2 = multi-model agreement)
model_confirmations?  (which models confirmed)
```

**What triggers a re-evaluation.** A completed debate. The debate engine's post-debate reflection step (`lib/debate/debateEngine.ts:696-789`) runs the evolution passes: `computeConfidenceUpdates`, `computePriorityUpdates`, `computeOperationalityUpdates`, and cross-debate crux feedback (`computeWeightAdjustments`). There is **no "re-evaluate" button** on the Attributes tab; the scales evolve from debate outcomes, not a manual UI action.

**Updates are human-gated.** The passes produce `ReflectionProposal[]` on the session, not direct writes. A researcher reviews and approves them in the editor's Reflections panel (`ReflectionsPanel.tsx`, `useDebateStore/slices/debateReflectionSlice.ts`) before anything is committed to the taxonomy. Large moves are flagged `requires_human_review`.

**Each scale updates under a different rule** (this is deliberate):

- **Confidence** changes only when an attack targets a Belief's *substance*, gated by three conditions all holding (`lib/debate/confidenceEvolution.ts:11-15,97-133`): the AN claim attributes to the Belief with `attribution_confidence > 0.60`, the attack is an `undermine` (not rebut/undercut), and the attacking claim has QBAF `computed_strength > 0.5`. Surviving a strong attack raises it; an opposing camp citing the belief raises it further (cross-POV validation, +0.10); a document directly contradicting it lowers it (−0.15).
- **Operationality** updates under an analogous gate (attribution > 0.60, a SPECIFY / EMPIRICAL-CHALLENGE move, a decisive outcome) at `lib/debate/operationalityEvolution.ts:87-135`.
- **Priority** never changes from a debate *outcome* alone. It moves only when the camp's own reflection concedes a value is less central, or a Desire recurs as a debate crux (contested values are core values). External pressure reveals priorities; it does not set them.

**Conflict resolution ("latest" is not just most-recent").** Two mechanisms keep updates honest:

1. **Drift caps** bound cumulative change from the initial value: confidence `MAX_DRIFT = 0.3` (then clamped to [0.10, 0.95], `confidenceEvolution.ts:32`), operationality `MAX_DRIFT = 2` (clamped [1, 5], `operationalityEvolution.ts:34`), priority clamped to 5. A single debate cannot flip a node from 0.8 to 0.3.
2. **Cross-model deduplication** (`lib/debate/confidenceDedup.ts:97-267`) stops re-running the same topic across models from compounding the same evidence. Topic dedup (topic cosine > 0.80) takes the max magnitude rather than summing; attack-vector dedup (attack cosine > 0.85) replaces-if-stronger or discards-if-weaker; a repeat from a *different* model increments `robustness` instead of adding a second delta. Each decision is `apply | supersede | discard | robustness`, and a superseded entry records `supersedes`. So the effective "latest" value is the **strongest surviving, model-deduplicated** update.

History is pruned to the last 30 entries or 12 months, whichever is smaller, with a summary of what was pruned (`confidenceEvolution.ts:429-485`).

---

## 4 · How the system uses the scales

**Weighted taxonomy-context injection (debate grounding).** When taxonomy context is assembled for a debater, nodes are ranked by a weighted score, not relevance alone (`lib/debate/taxonomyContext.ts:166-178`):

```
Beliefs:    relevance × confidence
Desires:    relevance × (priority / 5)
Intentions: relevance × (operationality / 5)
```

Each node is labelled inline so the debater sees the weight: `(confidence: 0.72, doctrinally anchored)`, `(priority: 4/5)`, `(operationality: 3/5)`; a Belief below 0.50 is tagged `[Speculative, …]` (`taxonomyContext.ts:180-195`). The grounding instructions tell the debater to lead with well-supported beliefs, non-negotiable values, and concrete strategies, and to hedge low-confidence claims explicitly.

**Editor sort and filter.** In "Priority" sort mode the node tree sorts Desires by `priority` (desc) and Beliefs by `confidence` (desc) (`NodeTree.tsx:45-57`; the "Sort: Priority" control is in `PovTab.tsx`).

**Confidence-impact diagnostics.** The debate diagnostics window's Argument Network tab renders a Confidence Impact trace. It scans every node's three `*_history` logs for entries whose `reason` names the current debate, and shows the node, the new value, a colored delta, the driving `attack_claim`, and an "N× confirmed" robustness chip (`ArgumentNetworkTab.tsx:383-439`). This closes the loop visibly, from taxonomy node (injected as context) to claim (attacked or defended) to updated scale shown back to the researcher.

**Edge-weight modulation.** Confidence and priority also modulate the QBAF edge weights between nodes (`lib/debate/modulateEdgeWeights.ts`), so a contradiction between two high-confidence Beliefs carries more weight than one where a side is speculative, and an Intention grounded in a high-priority Desire is harder to dislodge. The full modulation matrix and the edge-reprocessing plan are in `docs/weighted-bdi-proposal.md` ("Edge Weight Modulation").

---

## Where each number comes from (provenance)

| Value / rule | Provenance class | Source |
|---|---|---|
| Confidence tiers, multi-signal formula, boost caps | stipulated (validated distribution) | `docs/weighted-bdi-proposal.md`, `Invoke-BDIWeightAssignment.ps1` |
| Priority / Operationality level labels | stipulated | `GraphAttributesPanel.tsx:238-252` |
| Priority / Operationality initial-assignment tables | stipulated (hierarchy-derived) | `Invoke-BDIWeightAssignment.ps1` |
| Confidence 3-condition gate, drift caps, dedup thresholds | stipulated | `confidenceEvolution.ts`, `confidenceDedup.ts`, `operationalityEvolution.ts` |
| Doctrinal-anchor floor | stipulated | `taxonomyTypes.ts:161-164`, `docs/weighted-bdi-proposal.md` |

Any change to a threshold, level label, boost, cap, or formula above must update its provenance row in `research/comp-linguist/docs/metric-provenance-register.md` in the same PR (CL provenance-declaration rule).

---

## Related documents

- [`bdi-sub-score-calibration.md`](bdi-sub-score-calibration.md): the *per-debate* claim `base_strength` sub-scores (distinct from these node scales)
- [`weighted-bdi-proposal.md`](weighted-bdi-proposal.md): the full design (theory, formulas, evolution, edge modulation, phases)
- `research/comp-linguist/docs/intention-operationality-design.md`: operationality scoring rationale
- `scripts/AITriad/Public/Invoke-BDIWeightAssignment.ps1`: initial assignment (§2)
- `lib/debate/confidenceEvolution.ts`, `operationalityEvolution.ts`, `confidenceDedup.ts`: debate-driven updates (§3)
- `lib/debate/taxonomyContext.ts`: weighted context injection (§4)

*Created: 2026-08-11 · Computational Linguist · AI Triad Research*
