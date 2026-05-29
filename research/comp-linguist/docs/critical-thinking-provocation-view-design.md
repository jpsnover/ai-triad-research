# Per-Claim Critical Thinking Provocation — Design Document

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-27 (revised 2026-05-27: claim-level granularity)
**Ticket:** t/242
**Status:** Design proposal — revised (granularity changed from turn to claim)

---

## Problem

The debate diagnostics tabs (Brief, Plan, Evidence, Draft, Claims) are engineering-facing — they show *how* the turn was constructed. A reader watching a debate has no structured prompt to think critically about the *substance*. They either passively absorb the arguments or bring their own unstructured reactions.

## Revised Insight: Claim-Level, Not Turn-Level

The original design proposed a per-turn "Challenge" tab. But a turn contains 3-8 claims, and a reader may agree with some and disagree with others. Per-turn provocation forces a binary stance on a multi-claim statement, which is both reductive and unnatural.

**The correct granularity is the claim.** Each AN claim extracted from a turn is an independent assertion that can be individually agreed with, challenged, or questioned. The existing **Claims view** in the diagnostics already displays claims with their BDI category, grounding classification, strength, and edges. Provocation questions should be **inline per claim** within this existing view, not a separate tab.

## Proposal: Inline Provocation in the Claims View

Each claim in the existing Claims tab gets an expandable provocation section. The reader clicks a claim to see 2-3 targeted questions based on that specific claim's properties.

### Per-Claim Stance Toggle

Instead of a per-turn agree/disagree toggle, each claim gets a lightweight inline indicator:

```
AN-8  Safetyist Asserted Belief  Very Weak 0.10  [unaddressed]
  "Data siloing is a necessary technical constraint to prevent systemic failure..."
  [ AGREE ] [ DISAGREE ] [ UNSURE ]     ← per-claim stance

  ─── Challenge Questions (Stress-Test) ───
  1. This claim is classified as "Asserted" (no evidence cited). What specific
     data or case study would ground it?
  2. The opposing claim AN-12 (strength 0.72) directly contradicts this.
     If AN-12 is right, what does that mean for your position?
```

The reader selects a stance per claim — this is more natural than a per-turn binary. Claims with no stance selected show no questions (reducing visual noise). The stance selection is ephemeral (not saved to debate JSON).

---

## Per-Claim Question Taxonomy

Questions are generated from each claim's specific properties, not from the turn as a whole. The claim's BDI category, grounding classification, QBAF strength, edges, and taxonomy attribution all drive which questions appear.

### When You AGREE with a Claim (Stress-Test Mode)

Goal: *Prevent comfortable confirmation bias. Force the reader to find weaknesses in this specific claim.*

| Category | Question Template | Claim Data Source |
|----------|------------------|-------------------|
| **Grounding Probe** | "This claim is classified as {Asserted/Reasoned/Grounded}. {If Asserted: What specific evidence would you need? If Reasoned: What empirical test would confirm it?}" | `base_strength` grounding classification on this AN node |
| **Attack Exposure** | "Claim {opponent_claim_id} (strength {strength}) directly attacks this. If that attack is valid, what survives of your agreement?" | Incoming `attacks` edges on this AN node — show the strongest attacker |
| **Confidence Check** | "The taxonomy Belief this instantiates has confidence {confidence}. Is your agreement based on the evidence, or on the debater's rhetoric?" | `claim_taxonomy_attribution.primary_ref` → Belief node confidence |
| **Scope Limit** | "Under what specific conditions does THIS claim break down? Name one scenario." | Derived from `bdi_category`: Belief claims have empirical failure modes, Intention claims have feasibility limits |
| **Concession Cost** | "If the opponent's claim {AN-id} is right, does THIS claim still hold?" | Opponent claims connected to the same crux node |

### When You DISAGREE with a Claim (Steelman Mode)

Goal: *Prevent reflexive dismissal. Force the reader to find the strongest version of this specific claim.*

| Category | Question Template | Claim Data Source |
|----------|------------------|-------------------|
| **Steelman** | "Restate THIS claim in the strongest possible form. What would make it more convincing?" | The AN claim text itself — reader must improve it |
| **Support Network** | "This claim has {N} supporting edges and strength {strength}. What's holding it up that you might be underestimating?" | Incoming `supports` edges on this AN node |
| **Value Behind It** | "What legitimate concern or value does THIS claim serve?" | `claim_taxonomy_attribution` → if attributed to a Desire, show the priority; if a Belief, show what Desires it supports via taxonomy edges |
| **Evidence That Would Convert** | "What specific evidence would make you accept THIS claim?" | Derived from `bdi_category`: Belief → what data; Desire → what principle; Intention → what outcome |
| **Asymmetric Risk** | "If this claim is right and you dismiss it, what's the cost?" | Derived from the claim's QBAF strength and edge network — high-strength claims with many dependents have high dismissal cost |

### Universal (Both Modes, Every Claim)

| Category | Question Template | Claim Data Source |
|----------|------------------|-------------------|
| **Crux Connection** | "Is this claim connected to a debate crux? If resolved, would it shift the whole debate?" | Cross-reference AN node against `crux_tracker` — show if this claim attacks or supports a crux |
| **Operationality** | "Could you act on this claim? What's the first concrete step?" | Only for Intention-category claims — show `operationality` score from taxonomy attribution |
| **Doctrinally Anchored** | "This claim is doctrinally anchored — the debater CANNOT concede it. Why? And does that change how you evaluate it?" | Only when `claim_taxonomy_attribution.primary_ref` maps to a doctrinally anchored Belief — surfaces the identity-vs-evidence tension |

---

## Generation Approach

### Option A: Template-Driven (Recommended for V1)

Fill question templates from structured data already available per claim:

```typescript
interface ClaimChallengeData {
  // From the AN claim itself
  claim_text: string;
  bdi_category: 'belief' | 'desire' | 'intention';
  base_strength: number;
  computed_strength: number;
  grounding: 'grounded' | 'reasoned' | 'asserted';

  // From the argument network edges
  incoming_attacks: { claim_id: string; text: string; strength: number; speaker: string }[];
  incoming_supports: { claim_id: string; text: string; strength: number }[];

  // From per-claim taxonomy attribution
  attribution: {
    primary_ref: string;
    attribution_confidence: number;
    node_label: string;
    node_confidence?: number;  // Belief confidence
    node_priority?: number;    // Desire priority
    node_operationality?: number; // Intention operationality
    doctrinally_anchored?: boolean;
  } | null;

  // From crux tracker
  connected_crux?: { description: string; status: string };
}
```

**Advantages:** Fast, deterministic, no API cost, works offline. Each claim's data is already available in the argument network and attribution pipeline.
**Disadvantage:** Questions can feel formulaic if templates aren't varied.

### Option B: LLM-Generated (Future V2)

Pass the specific claim + its edges + reader stance to an LLM:

```
You are a Socratic tutor reviewing a specific debate claim.
Claim: "{claim_text}"
Strength: {strength}, Grounding: {grounding}
Attacked by: {attacker_claims}
The reader {agrees/disagrees} with this claim.
Generate 2 questions that challenge the reader's position on THIS claim.
Every question must reference the claim's specific content.
```

**Advantages:** Natural, context-sensitive, references claim-specific details.
**Disadvantage:** API cost per claim expansion, latency.

### Recommendation

**V1: Template-driven** with 2-3 questions per claim per mode. Question selection is driven by claim properties:
- Asserted claims always get the Grounding Probe
- Claims with incoming attacks always get Attack Exposure (agree) or Support Network (disagree)
- Claims attributed to doctrinally anchored Beliefs always get the Doctrinally Anchored question
- Claims connected to cruxes always get the Crux Connection question

**V2: Hybrid** — template questions plus one LLM-generated question that connects the claim to the broader debate arc.

---

## UI Layout: Inline in the Claims View

### No New Tab

The provocation integrates **into the existing Claims tab**, not as a separate tab. This keeps the claim and its challenge co-located — the reader doesn't context-switch between seeing a claim and thinking about it.

### Claims Tab Enhancement

The existing Claims view shows each AN claim as a row:

```
AN-8  Safetyist Asserted Belief  Very Weak 0.10  [unaddressed]
  "Data siloing is a necessary technical constraint..."
```

With provocation enabled, each claim row becomes expandable:

```
┌─────────────────────────────────────────────────────────┐
│ AN-8  Safetyist Asserted Belief  Very Weak 0.10         │
│   "Data siloing is a necessary technical constraint      │
│    to prevent systemic failure in an era of increasingly │
│    autonomous systems."                                  │
│                                                          │
│   → saf-beliefs-012 (0.72) "Insufficient alignment..."  │ ← attribution
│   [L] Regulation & Institutional Economics               │ ← lineage badge
│                                                          │
│   Your stance: [ AGREE ] [ DISAGREE ] [ UNSURE ]        │
│                                                          │
│   ─── Stress-Test (you agree) ───────────────────────── │
│                                                          │
│   GROUNDING: This claim is "Asserted" — no evidence     │
│   cited. What specific data or case study would you      │
│   need to see to consider this grounded?                 │
│                                                          │
│   ATTACK EXPOSURE: AN-12 (Accelerationist, strength     │
│   0.72) directly contradicts this: "Siloed data          │
│   architectures sacrifice the interoperability that      │
│   makes AI systems valuable." If that attack is valid,   │
│   what survives of your agreement?                       │
│                                                          │
│   CRUX: This claim connects to crux "Can data sharing    │
│   be made safe enough for AI training?" — is that the    │
│   question you'd need answered?                          │
│                                                          │
│   [ Your thoughts... ]          ← optional, ephemeral   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ AN-9  Safetyist Reasoned Intention  Moderate 0.52       │
│   "Mandatory, risk-stratified oversight is the only      │
│    mechanism that ensures accountability..."             │
│   [ AGREE ] [ DISAGREE ] [ UNSURE ]  ← collapsed       │
└─────────────────────────────────────────────────────────┘
```

### Interaction Details

- **Stance buttons appear on every claim row** — small, unobtrusive, next to the existing strength badge.
- **Questions appear only after stance selection** — clicking AGREE/DISAGREE/UNSURE expands the provocation section below that claim. UNSURE shows the Universal questions only.
- **Only one claim expanded at a time** (accordion-style) — prevents visual overload. Clicking another claim's stance collapses the previous one.
- **Question count:** 2-3 questions per claim. Fewer than the original per-turn design because there are more claims to engage with.
- **Optional response area** per claim — ephemeral, not saved to debate JSON.
- **Dismiss button** — collapse the provocation section without clearing the stance. The stance indicator remains visible as a small colored dot (green=agree, orange=disagree, gray=unsure).

### Color Scheme

- **Agree stance:** Green dot + green-tinted provocation header: "You agree. Let's stress-test that."
- **Disagree stance:** Orange dot + orange-tinted header: "You disagree. Let's steelman it."
- **Unsure stance:** Gray dot + neutral header: "You're unsure. Let's clarify what would decide it."
- **Questions:** Same font as surrounding diagnostics. Question category label (GROUNDING, ATTACK EXPOSURE, etc.) in bold muted text.

---

## Data Flow (Per Claim)

```
AN claim node
  ├── claim properties
  │     ├── text                     → all question templates reference this
  │     ├── base_strength / grounding → Grounding Probe
  │     ├── computed_strength         → strength context in all questions
  │     └── bdi_category             → determines which question templates apply
  │
  ├── argument network edges (on this node)
  │     ├── incoming attacks          → Attack Exposure (agree) / Support Network (disagree)
  │     └── incoming supports         → Support Network (disagree)
  │
  ├── claim_taxonomy_attribution
  │     ├── primary_ref → Belief confidence   → Confidence Check (agree)
  │     ├── primary_ref → Desire priority     → Value Behind It (disagree)
  │     ├── primary_ref → Intention operationality → Operationality (universal)
  │     └── doctrinally_anchored              → Doctrinally Anchored (universal)
  │
  └── crux_tracker cross-reference
        └── claim attacks/supports crux node  → Crux Connection (universal)
```

### Question Selection Rules

Not every claim needs every question. Selection is driven by claim properties:

| Claim Property | Always Show | Agree Mode | Disagree Mode |
|---|---|---|---|
| `grounding = asserted` | | Grounding Probe | Steelman |
| Has incoming attacks | | Attack Exposure | |
| Has incoming supports | | | Support Network |
| Attributed to Belief with confidence | | Confidence Check | Evidence That Would Convert |
| Attributed to Desire with priority | | | Value Behind It |
| Attributed to Intention with operationality | Operationality | | |
| Doctrinally anchored | Doctrinally Anchored | | |
| Connected to crux | Crux Connection | | |

**Minimum viable output:** Every claim gets at least 1 question (Agree: Grounding Probe based on grounding classification; Disagree: Steelman from claim text alone). Maximum 3 questions per claim per mode to prevent fatigue.

---

## Implementation Scope

### Phase 1 (V1 — template-driven, inline in Claims view)

| Component | Owner | Files |
|-----------|-------|-------|
| Per-claim question generation logic | Shared Lib | New `lib/debate/claimChallenge.ts` |
| Claims view enhancement (stance buttons, expandable provocation) | Taxonomy Editor | `DiagnosticsWindow.tsx` — modify Claims section |
| Per-claim stance state | Taxonomy Editor | Local component state (not persisted) |
| Accordion behavior (one claim expanded at a time) | Taxonomy Editor | Local component state |

### Phase 2 (V2 — hybrid)

| Component | Owner | Files |
|-----------|-------|-------|
| LLM per-claim question prompt | CL (prompt design) + Shared Lib (implementation) | `prompts.ts` or `claimChallenge.ts` |
| Stance aggregation (turn-level summary from per-claim stances) | Taxonomy Editor | Optional summary row at bottom of Claims view |
| Stance persistence (optional) | Taxonomy Editor | `reader_notes` field on debate session (future) |

---

## Open Questions

1. **Should per-claim stances persist across sessions?** Current proposal: ephemeral (lost on tab switch / window close). Could optionally save to a `reader_stances` map on the debate session (`{ [claimId]: 'agree' | 'disagree' | 'unsure' }`), enabling cross-session tracking of how the reader's views evolve. Defer to V2.

2. **Should the provocation section show the reader's prior stance?** If stances are persisted, returning to a claim could show "You previously agreed — has anything changed?" This creates a longitudinal critical thinking trail. Requires persistence (V2).

3. **Should there be a turn-level summary?** After the reader marks stances on 3+ claims from a turn, show a summary: "You agree with 2/5 claims, disagree with 2, unsure on 1. The claims you disagree with are the strongest (avg strength 0.68) — are you sure?" This turn-level synthesis is derived from per-claim stances, not a separate mechanism. Defer to V2.

4. **Token budget for V2 LLM questions:** Each claim expansion would need ~200 tokens of prompt + ~100 tokens of response. With 5 claims per turn and a reader expanding 2-3, that's 600-900 tokens per turn viewed. Acceptable for API-tier access but should be cached per claim to avoid re-generation on accordion open/close.
