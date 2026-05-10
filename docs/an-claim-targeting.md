# How the Debate Engine Selects AN Claims for Response

This document explains who decides which Argument Network (AN) claims a debater responds to, how that decision is made, and how moderator interventions alter the flow.

## Overview

Claim targeting is a **three-actor process**: the moderator selects the speaker and sets the agenda, the taxonomy relevance engine filters which nodes the debater can see, and the debater (via the 4-stage pipeline) chooses which specific AN claims to engage. The moderator can override normal targeting through interventions that force specific responses.

```
                    ┌─────────────────────┐
                    │  MODERATOR SELECTION │
                    │  (orchestration.ts)  │
                    └────────┬────────────┘
                             │
                    Outputs: responder, focusPoint,
                    addressing, intervention (optional)
                             │
              ┌──────────────┴──────────────┐
              │                             │
     No Intervention              Intervention Active
              │                             │
              ▼                             ▼
    ┌─────────────────┐          ┌──────────────────────┐
    │ TAXONOMY CONTEXT │          │ TAXONOMY CONTEXT      │
    │ (debateEngine.ts)│          │ + intervention brief  │
    │ AN-based hybrid  │          │ injection             │
    │ scoring          │          └──────────┬───────────┘
    └────────┬────────┘                      │
             │                               │
             ▼                               ▼
    ┌─────────────────────────────────────────────────┐
    │         TURN PIPELINE (turnPipeline.ts)          │
    │  BRIEF → PLAN → DRAFT → CITE                    │
    │  Debater selects target_claims from visible AN   │
    └─────────────────────────────────────────────────┘
```

## Actor 1: The Moderator

**File:** `lib/debate/orchestration.ts` — `runModeratorSelection()`

The moderator runs at the start of every round (after openings). It makes two decisions: **who speaks next** and **what they should focus on**.

### What the moderator sees

The moderator LLM receives:

| Context | Source | Purpose |
|---|---|---|
| Recent transcript (8 entries) | `formatRecentTranscript()` | What was just said |
| Full AN with attack relationships | `formatArgumentNetworkContext()` | All claims + who attacked whom |
| Top 5 unaddressed high-strength claims | `buildQbafContext()` | Claims that survived attacks but nobody responded to |
| Unanswered claims ledger | `formatUnansweredClaimsHint()` | High-confidence claims that were raised but ignored |
| Cross-POV edges | Edge context | CONTRADICTS/TENSION_WITH relationships between POVs |
| Debate health scores | `computeDebateHealthScore()` | Engagement, novelty, responsiveness, coverage, balance |
| Moderator state | Trigger block | Budget remaining, cooldown, burden per debater, health trajectory |

### What the moderator outputs

The moderator LLM returns:

- **`responder`** — which debater speaks next (e.g., Prometheus)
- **`focus_point`** — a natural-language directive about what to address (e.g., "Respond to Sentinel's claim that interpretability audits are technically feasible")
- **`addressing`** — who the responder should address (`"general"` or a specific debater name)
- **`intervene`** — boolean: should the moderator intervene this round?
- **`suggested_move`** — if intervening, which intervention type (PIN, CHALLENGE, PROBE, etc.)
- **`target_debater`** — if intervening, who the intervention targets

The `focus_point` is the moderator's primary mechanism for steering claim targeting. It appears verbatim in the debater's BRIEF and DRAFT prompts as: *"Address [addressing] on this point: [focus_point]"*.

### How the moderator decides what to focus on

The moderator's selection prompt asks it to consider:

1. **Unaddressed claims** — claims with high QBAF strength that no debater has responded to
2. **Epistemic type mismatches** — debaters arguing past each other (one empirical, one normative)
3. **Hidden assumptions** — claims whose `assumes` field reveals attackable foundations
4. **Debate balance** — which debater has spoken least recently
5. **Phase goals** — confrontation (establish positions), argumentation (probe cruxes), concluding (converge)

## Actor 2: The Taxonomy Relevance Engine

**File:** `lib/debate/debateEngine.ts` — `getRelevantTaxonomyContext()`

Before the turn pipeline runs, the engine determines which **taxonomy nodes** (not AN claims — those are always visible) are relevant to inject as context. This filtering determines which POV nodes and situation nodes the debater sees as grounding material.

### Hybrid AN-based scoring

The relevance engine uses a two-signal hybrid:

1. **AN-based score** — for each taxonomy node, compute max cosine similarity against all active AN claim embeddings. Measures: "Is this taxonomy node relevant to what's actually being debated?"

2. **Topic-based score** — cosine similarity between the taxonomy node and the debate topic + recent transcript. Measures: "Is this taxonomy node relevant to the broad topic?"

3. **Hybrid merge** — `max(AN_score, topic_score × 0.5)`. AN-based scoring dominates when claims are in play; topic scoring provides a floor.

4. **Citation diversity** — nodes the speaker cited recently are down-weighted by 0.55× to encourage fresh grounding.

### What gets injected

The engine selects:
- **POV nodes** — filtered by the speaker's perspective, with thresholds (embedding: 0.48, lexical: 0.22)
- **Situation nodes** — cross-cutting nodes relevant to the debate (3–15 max)
- A **primary/starred** subset of high-relevance nodes

These appear in the debater's context as `=== TAXONOMY CONTEXT ===` and influence which nodes the debater can cite — but they do NOT determine which AN claims to respond to. That's the debater's job.

## Actor 3: The Debater (via the Turn Pipeline)

**File:** `lib/debate/turnPipeline.ts` — `runTurnPipeline()`

The debater receives the moderator's directive and the filtered context, then decides which specific AN claims to target through a 4-stage pipeline.

### Stage 1: BRIEF

**What the debater sees:**
- Recent transcript (last 8 entries with full text)
- The moderator's focus directive: *"[Label] must address [addressing] on: [focusPoint]"*
- Taxonomy context (filtered POV + situation nodes)
- If intervention: the intervention directive is injected here

**What the debater produces:**
- `situation_assessment` — analysis of the current debate state
- `key_claims_to_address` — which AN claims they intend to engage (by AN-ID)
- `relevant_commitments` — their prior positions that are relevant
- `edge_tensions` — cross-POV tensions they've identified

The BRIEF stage is where the debater first identifies which AN claims matter. The moderator's `focus_point` steers this, but the debater has latitude to identify additional claims.

### Stage 2: PLAN

**What the debater sees:**
- The BRIEF output (situation assessment)
- Move history (what dialectical moves they've used recently)
- FIELD-AWARE STRATEGY block (epistemic type, rhetorical strategy, falsifiability, assumptions)
- The canonical move list (DISTINGUISH, COUNTEREXAMPLE, etc.)
- If intervention: the intervention directive again

**What the debater produces:**
- `strategic_goal` — what this turn should accomplish
- `planned_moves` — specific dialectical moves with AN-ID targets (e.g., `{"move": "DISTINGUISH", "target": "AN-3", "detail": "..."}`)
- **`target_claims`** — explicit list of AN-IDs to engage (e.g., `["AN-3", "AN-7"]`)
- `argument_sketch` — outline of the argument structure
- `anticipated_responses` — what opponents will likely say

The PLAN stage is where AN targeting becomes explicit. The debater commits to specific AN-IDs and specific moves against them.

### Stage 3: DRAFT

**What the debater sees:**
- The BRIEF and PLAN outputs
- The focus directive and addressing target
- Phase-specific instructions (confrontation/argumentation/concluding)
- If intervention (targeted): a mandatory response format for paragraph 1

**What the debater produces:**
- `statement` — the actual debate text (3–5 paragraphs)
- `claim_sketches` — 3–6 near-verbatim claims extracted from the statement, each with `targets` (AN-IDs they respond to)
- `key_assumptions` — assumptions the argument depends on
- `disagreement_type` — empirical, values, or definitional

The DRAFT stage executes the plan. The `claim_sketches` with their `targets` are what ultimately become new AN nodes with `responds_to` edges.

### Stage 4: CITE

**What the debater sees:**
- The draft text and taxonomy context
- Prior citation history (which nodes were recently cited)
- Cross-POV node options (nodes from other perspectives)
- Instructions to cite at least 1–2 nodes NOT in recent history

**What the debater produces:**
- `taxonomy_refs` — specific taxonomy node IDs that ground the argument
- `move_annotations` — finalized dialectical move classifications

CITE doesn't change AN targeting — it grounds the already-drafted argument in taxonomy nodes.

## How Moderator Interventions Override Targeting

When the moderator intervenes, the normal targeting flow is altered at three points:

### Intervention types and their targeting effect

| Move | Effect on AN Targeting |
|---|---|
| **PIN** | Forces the debater to agree or disagree with a specific claim. First paragraph must begin with "I agree that..." or "I disagree that..." |
| **CHALLENGE** | Demands the debater defend or revise a specific position. Must address the challenge before proceeding to other claims. |
| **PROBE** | Asks for evidence supporting a specific claim. Must provide concrete evidence or acknowledge its absence. |
| **CLARIFY** | Asks the debater to define or scope a specific term. Must provide a clear definition. |
| **REDIRECT** | Steers the debater away from a tangent toward an unaddressed claim. Changes focus_point to the redirected topic. |
| **REVOICE** | Asks the debater to restate their position more clearly. Must restate, not add new arguments. |
| **META-REFLECT** | Asks the debater to step back and assess their own reasoning. Must produce a self-assessment conclusion. |
| **COMPRESS** | Asks the debater to summarize their position in ≤50 words. Forces concision. |
| **COMMIT** | Forces the debater to state final concessions, conditions for mind-change, and sharpest disagreements. Used in concluding phase. |

### How intervention injection works

**File:** `lib/debate/moderator.ts` — `buildInterventionBriefInjection()`

When an intervention is active:

1. **In the BRIEF stage**, the intervention text is injected as `=== MODERATOR INTERVENTION ===` with a mandatory response format
2. **In the PLAN stage**, the debater must include a `directive_response_plan` field explaining how they'll respond
3. **In the DRAFT stage**, if targeted, the first paragraph is structurally constrained to directly respond
4. **Post-turn**, `checkInterventionCompliance()` validates that the response includes required fields (e.g., `pin_response` for PIN, `probe_response` for PROBE)

### Targeted vs non-targeted

- **Targeted** (intervention directed at the current speaker): mandatory first-paragraph response, structured response field required, compliance checked
- **Non-targeted** (intervention directed at another debater): brief acknowledgment requested in opening (1–2 sentences), then proceed with own argument

## What the Debater Sees vs What They Don't

### Visible to the debater

- All AN claims from the recent transcript window (last 8 entries, full text)
- Medium-tier structural summary of older claims (AN nodes by speaker, QBAF strengths, concessions)
- Distant-tier summary of earliest claims (top surviving claims, crux status, network stats)
- The moderator's focus directive
- Their own prior claims (commitment store)
- Other debaters' claims prioritized by relevance (established points)
- Cross-POV edges (attacks, tensions)
- Filtered taxonomy nodes (POV + situations)

### NOT visible to the debater

- The moderator's internal health scores
- Raw QBAF computation details
- Other debaters' planned moves (from their PLAN stage)
- The full unfiltered taxonomy (only relevant nodes are injected)
- Relevance scores on taxonomy nodes (these are used internally for filtering)
- The moderator's intervention budget or cooldown state

## Summary: Who Decides What

| Decision | Who decides | How |
|---|---|---|
| Who speaks next | Moderator (LLM) | Least-recently-spoken + debate balance + health signals |
| What topic to focus on | Moderator (LLM) | Unaddressed claims, epistemic mismatches, phase goals |
| Whether to intervene | Moderator (LLM) + Engine (validation) | LLM recommends, engine checks budget/cooldown/phase |
| Which taxonomy nodes to show | Engine (deterministic) | Hybrid AN + topic scoring, citation diversity |
| Which AN claims to engage | Debater (LLM, via BRIEF + PLAN) | Steered by moderator's focus_point, constrained by visible AN |
| Which dialectical moves to use | Debater (LLM, via PLAN) | FIELD-AWARE STRATEGY pairings + move history |
| How to respond to intervention | Debater (LLM, via DRAFT) | Mandatory response format, compliance-checked post-turn |
