# Crux Lifecycle Design: In-Debate Interventions, Cross-Debate Registry, Taxonomy Feedback

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-28
**Ticket:** t/260
**Status:** Design proposal — pending approval

---

## The Problem

Cruxes are the most valuable artifacts the debate system produces. They're the precise points where perspectives genuinely diverge — not just different conclusions, but different *types* of disagreement (empirical, values, definitional). The system identifies them, classifies them, tracks their resolution state... and then lets them die.

Today's lifecycle:

```
Detect → Classify → Track resolution → Drive phase transitions → End of debate → Gone
```

What it should be:

```
Detect → Classify → Intervene (in-debate) → Persist (cross-debate) → Feed back (taxonomy)
            ↑                                       ↓
            └───────── Seed future debates ─────────┘
```

---

## Area 1: In-Debate — CRUX FOCUS Moderator Intervention

### The Gap

A crux in `engaged` state for 2+ rounds means the debate is spinning. The debaters are arguing past each other — but no one tells them *why.* An empirical crux needs evidence. A values crux needs tradeoff acknowledgment. A definitional crux needs term clarification. The moderator has no crux-type-aware intervention.

### Design

**New moderator move: `CRUX_FOCUS`**

**Trigger conditions** (all must be true):
1. A tracked crux is in `engaged` state
2. At least 2 rounds have elapsed since `identified_turn` with no state transition
3. The moderator has not already issued a CRUX_FOCUS for this specific crux
4. No higher-priority intervention is pending (PIN, REDIRECT take precedence for safety)

**Intervention templates by disagreement type:**

#### Empirical Crux
```
MODERATOR: This debate hinges on a factual question that neither side has
resolved: "{crux.description}"

{next_speaker}, you have two options:
1. Cite specific evidence — a study, dataset, or documented case — that
   would settle this question.
2. State precisely what evidence would change your mind. Be falsifiable:
   "If [X metric] exceeded [Y threshold], I would accept [Z conclusion]."

If neither side can produce evidence, acknowledge this as an empirical gap
and state what research would be needed to resolve it.
```
**Steered moves:** EMPIRICAL CHALLENGE, SPECIFY

#### Values Crux
```
MODERATOR: This disagreement is about competing priorities, not competing
facts: "{crux.description}"

More evidence will not resolve this. {next_speaker}, acknowledge the
tradeoff directly:
1. Name the value you're prioritizing and the value you're sacrificing.
2. Propose a conditional agreement: "I would accept [opponent's position]
   if [specific safeguard] were guaranteed."

If no conditional agreement is possible, state why — what makes this value
non-negotiable for your perspective?
```
**Steered moves:** CONCEDE-AND-PIVOT, INTEGRATE, SPECIFY

#### Definitional Crux
```
MODERATOR: The debaters may be using "{contested_term}" to mean different
things: "{crux.description}"

{next_speaker}, before continuing this thread:
1. Define your key term precisely — what is included and excluded.
2. Ask the opponent whether they accept your definition or use a different one.

You may discover you agree more than you think once terms are aligned.
```
**Steered moves:** DISTINGUISH, SPECIFY

**Contested term extraction:** When `disagreement_type === 'definitional'`, scan the crux description and attacking claims for the noun phrase that appears in both sides' claims but with divergent usage. Use simple heuristic: most-frequent content word (>5 chars) appearing in both the crux node text and the strongest attacker's text.

### Priority & Mutual Exclusion

```
Intervention priority (highest first):
1. PIN (safety/derailment — blocks all others)
2. REDIRECT (off-topic — blocks all others)
3. CRUX_FOCUS (type-aware crux intervention)
4. BALANCE / SEQUENCE (participation equity)
5. META-REFLECT (periodic reflection)
6. IMPLEMENTATION_CHALLENGE (policymaker-specific, t/249)
```

CRUX_FOCUS fires at most once per crux per debate. If the crux transitions (to `one_side_conceded`, `resolved`, or `irreducible`) after the intervention, it was effective. If it remains `engaged` for 2+ more rounds post-intervention, the system logs `crux_focus_ineffective` for calibration.

---

## Area 2: Cross-Debate — Persistent Crux Registry

### The Gap

Cruxes are debate-scoped. When a debate ends, its cruxes are frozen in the debate JSON. A new debate on a similar topic starts from scratch — no awareness that "we've been here before."

### Data Model

```typescript
// crux-registry.json (lives alongside calibration-log.json in the data root)
interface CruxRegistryEntry {
  /** Stable ID — hash of normalized crux description for dedup */
  id: string;
  /** Canonical description (from first occurrence, may be refined) */
  description: string;
  /** Embedding of description (all-MiniLM-L6-v2, 384-dim) */
  embedding: number[];
  /** Disagreement type — majority vote across debates */
  disagreement_type: 'empirical' | 'values' | 'definitional';
  /** First debate where this crux was identified */
  first_seen_debate: string;
  first_seen_date: string;
  /** All debates where this crux appeared */
  occurrences: CruxOccurrence[];
  /** Related taxonomy nodes (union of taxonomy_refs from crux claims) */
  related_taxonomy_nodes: string[];
  /** Whether this crux has been promoted to a situation node */
  promoted_to_situation: string | null;  // sit-NNN ID or null
}

interface CruxOccurrence {
  debate_id: string;
  debate_topic: string;  // first 100 chars
  date: string;
  /** AN node ID of the crux in this debate */
  an_id: string;
  final_state: CruxResolutionState;
  turns_engaged: number;
  /** Whether a CRUX_FOCUS intervention was issued */
  intervention_issued: boolean;
  /** Whether the crux was resolved after intervention */
  resolved_post_intervention: boolean;
  /** The model used in this debate */
  model: string;
}
```

### Cross-Debate Dedup

Same pattern as `confidenceDedup.ts`:

1. After each debate, extract all cruxes with final state `irreducible` or `engaged` (not `resolved`)
2. Embed each crux description
3. Compare against existing registry entries (cosine similarity)
4. If similarity > 0.80 → same crux, add occurrence
5. If similarity < 0.80 → new crux, create entry

The `disagreement_type` on the registry entry uses majority vote across occurrences — a crux classified as `empirical` in 2 debates and `values` in 1 stays `empirical`.

### Seeding Future Debates

When a new debate starts:

1. Embed the debate topic
2. Search the crux registry for entries with embedding similarity > 0.50 to the topic
3. For matching entries, inject into the **Brief stage** as prior context:

```
=== PRIOR UNRESOLVED CRUXES ===
Previous debates on related topics identified these unresolved disagreements:

1. [empirical] "Can real-time telemetry detect catastrophic risk before
   irreversible harm?" — unresolved in 3 prior debates. No side produced
   decisive evidence. Consider whether your argument addresses this gap.

2. [values] "Does innovation speed justify accepting safety uncertainty?"
   — irreducible values disagreement in 2 prior debates. Both sides
   acknowledged the tradeoff but could not agree on where to draw the line.
```

This doesn't constrain the debaters — it saves them from re-deriving cruxes that are already known, and points them toward the unresolved questions that matter most.

### Registry Maintenance

- **Max registry size:** 200 entries (LRU eviction by `first_seen_date` when exceeded)
- **Staleness:** Entries not referenced by any debate in 12 months are archived
- **Human curation:** Registry is editable — entries can be merged, split, or deleted via a CLI tool

---

## Area 3: Taxonomy Feedback

### 3A. Crux-to-Situation Promotion

**When:** A crux has 3+ occurrences across debates, all with final state `irreducible` or `engaged` (never resolved).

**What:** Flag the registry entry as a **situation candidate**. The system generates a draft situation node:

```typescript
{
  id: "sit-NEW",  // assigned on approval
  label: "Derived from crux: {crux.description}",
  description: "A contested concept identified across {N} debates: {crux.description}. " +
    "This crux was classified as a {disagreement_type} disagreement. " +
    "POV interpretations should be authored based on how each perspective " +
    "engaged with this crux in prior debates.",
  interpretations: {
    // Extracted from crux claim texts across debates
    accelerationist: "...",
    safetyist: "...",
    skeptic: "...",
  },
  interpretation_divergence: null,  // computed after interpretations authored
  disagreement_type: crux.disagreement_type,
}
```

**Human review required.** The system proposes; a human approves, edits interpretations, and assigns the final sit- ID. This prevents the situation taxonomy from growing without quality control.

### 3B. Confidence Impact

When an irreducible **empirical** crux is linked to a specific Belief node (via `related_taxonomy_nodes`):

- If the crux recurs 2+ times without resolution → reduce the Belief's confidence by **-0.05** (the evidence is genuinely contested)
- Use the existing `confidenceEvolution.ts` history entry format with reason: `"Cross-debate empirical crux '{description}' irreducible in {N} debates"`
- Apply drift cap (±0.30) as usual
- This only applies to **empirical** cruxes — values and definitional cruxes don't imply evidential weakness

### 3C. Priority Impact

When an irreducible **values** crux is centered on a specific Desire node:

- If the crux recurs 2+ times → increase the Desire's priority by **+1** (it's load-bearing for the POV)
- Capped at priority 5 (doctrinal)
- Reason: `"Cross-debate values crux '{description}' — this value is repeatedly at the center of irreducible disagreements"`

---

## Implementation Priority

| Phase | Area | Effort | Impact |
|-------|------|--------|--------|
| 1 | CRUX_FOCUS moderator move (Area 1) | Medium | High — immediate debate quality improvement |
| 2 | Crux registry data model + post-debate extraction (Area 2, storage) | Medium | Foundation for everything else |
| 3 | Future debate seeding from registry (Area 2, retrieval) | Medium | High — connects debates across time |
| 4 | Crux-to-situation promotion (Area 3A) | Low | Medium — grows taxonomy organically |
| 5 | Confidence/priority feedback (Area 3B/3C) | Low | Low-Medium — refinement of existing weights |

Phase 1 is standalone. Phases 2-5 are sequential (registry must exist before retrieval, promotion, or weight feedback).

---

## Diagnostics

| Component | What to Surface | Where |
|-----------|----------------|-------|
| CRUX_FOCUS firing | Type, crux description, targeted speaker, steered moves | Moderator panel in DiagnosticsWindow |
| CRUX_FOCUS effectiveness | Did the crux transition after intervention? | Calibration log: `crux_focus_fired`, `crux_focus_resolved` |
| Registry matches | Prior cruxes seeded into this debate | Brief stage diagnostics — "N prior cruxes injected" |
| Promotion candidates | Registry entries with 3+ irreducible occurrences | CLI report / taxonomy health check |
| Weight impacts | Confidence/priority changes from crux feedback | Existing confidence/priority evolution panels |

---

## Design Principles

1. **Cruxes are research artifacts, not debate artifacts.** An unresolved empirical question doesn't disappear because a debating session ended. It's a standing question for the research program.

2. **The registry is a memory, not a constraint.** Seeding a future debate with prior cruxes informs but doesn't bind. The debaters can engage the prior crux, reframe it, or discover it's been superseded by new evidence.

3. **Promotion is human-gated.** Automatically generating situation nodes from cruxes would pollute the taxonomy with low-quality entries. The system proposes; a human decides.

4. **Type classification drives action, not just labeling.** Empirical cruxes need evidence. Values cruxes need tradeoff acknowledgment. Definitional cruxes need term precision. Every downstream system that touches cruxes should ask "what type?" and adapt accordingly.
