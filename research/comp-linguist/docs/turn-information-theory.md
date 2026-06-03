# Theory of Information Use Across Debate Turn Stages

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-29
**Ticket:** t/276
**Status:** Reference document

---

## Overview

A single debate turn passes through 7+ stages. Each stage receives specific data and produces specific outputs. This document traces what information enters each stage, what it produces, why that information belongs at that stage, and — critically — where information is lost that shouldn't be.

```
Moderator   Brief    Plan    Evidence   Citation   Draft    Lookahead   Cite    Claims
Pre-check →  →  →  →  Bank Build  →  →  →  →  →  Extraction
                       (deterministic)  (deterministic)                              (post-turn)
```

---

## Stage-by-Stage Information Map

### Stage 0: Moderator Pre-Check

**Purpose:** Decide if a moderator intervention should precede this turn.

| Data In | Source | Why Here |
|---------|--------|----------|
| Argument network state | Prior turns | Detect unaddressed claims, stale cruxes |
| Phase transition signals | `phaseTransitions.ts` | Determine if phase change needed |
| Participation balance | Turn history | Detect speaker domination |

| Data Out | Consumed By |
|----------|-------------|
| `pendingIntervention` | Brief, Plan, Draft (all see the directive) |
| Intervention type (PIN, REDIRECT, etc.) | Plan (steers move selection) |

**Rationale:** Moderator decides *before* the debater thinks, so the debater can incorporate the directive from the start. If intervention came after the Brief, the situation assessment would miss it.

---

### Stage 1: Brief (temp=0.15)

**Purpose:** Pure analysis of debate state. "What just happened? What matters?"

| Data In | Source | Why Here |
|---------|--------|----------|
| Taxonomy context (25 nodes, weighted) | `getRelevantTaxonomyContext()` | Grounds analysis in POV's knowledge base |
| Recent transcript (8 turns) | `formatRecentTranscript()` | What happened recently |
| Context summaries (compressed history) | `tieredCompression.ts` | What happened before the window |
| Edge context (AN tensions) | `formatDebaterEdgeContext()` | Cross-POV structural relationships |
| Commitment store | Prior turns | What's been asserted/conceded/challenged |
| Established points (AN summary) | Argument network | High-strength surviving claims |
| Concession candidates (QBAF) | AN analysis | Opponent claims worth conceding |
| Pending intervention | Stage 0 | Moderator directive to address |
| Phase context | Adaptive staging | Phase progress, transition proximity |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| `situation_assessment` | Plan (as briefJson) | No |
| `key_claims_to_address` with grounding refs | Plan (as briefJson) | **Grounding confidence/priority visible in Brief but not scored** |
| `relevant_commitments` | Plan (as briefJson) | No |
| `edge_tensions` | Plan (as briefJson) | No |
| `phase_considerations` | Plan (as briefJson) | No |

**Rationale:** The Brief is the debater's "intelligence report." It operates at low temperature (0.15) for analytical precision. It sees the full context but produces only a *summary* — this is deliberate compression to prevent the Plan from being overwhelmed by raw data.

**What's NOT here and why:** The Brief doesn't see source evidence facts or the citation bank. This is principled — the Brief should analyze *debate dynamics*, not source material. Evidence belongs in the Draft, where specific claims are being constructed.

---

### Stage 2: Plan (temp=0.4)

**Purpose:** Strategy selection. "What moves will I make?"

| Data In | Source | Why Here |
|---------|--------|----------|
| `briefJson` (full Brief output) | Stage 1 | Situation awareness drives strategy |
| All Brief-stage inputs (taxonomy, transcript, etc.) | Same sources | Plan needs the same context |
| Prior moves history | Turn history | Avoid repetitive move patterns |
| Prior flagged hints | Validation feedback | Learn from past mistakes |
| Doctrinal boundaries | POV config | Cannot plan moves that violate identity |
| Strategic hints (opponent intelligence) | `strategicHints.ts` | Commitment traps, capability gaps, strategy shifts |
| Strong foundations / avoid claims | Lookahead gate | Claims that help/hurt utility |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| `strategic_goal` | Draft (as planJson) | No |
| `planned_moves[]` | Draft, Cite, final metadata | No |
| `target_claims[]` | Draft (as planJson) | No |
| `argument_sketch` | Draft (as planJson) | **Yes — not checked downstream** |
| `anticipated_responses[]` | Draft (as planJson) | **Yes — not tracked or verified** |
| `target_nodes[]` | Evidence stage, Cite stage | No |
| `directive_response` | Draft (as planJson) | No |

**Rationale:** The Plan operates at moderate temperature (0.4) — higher than Brief (needs creative strategy) but lower than Draft (must be coherent). It produces the *roadmap* that the Draft executes.

**Key loss — `anticipated_responses`:** The Plan predicts what opponents will say, but this prediction is never checked against what they *actually* say in the next turn. This is a missed opportunity — if the Plan anticipated a COUNTEREXAMPLE and the opponent indeed used one, the system could detect that the debater prepared well. If the prediction was wrong, the Brief could note the surprise. Currently: predicted, forgotten.

**Key loss — `argument_sketch`:** The Plan outlines a skeletal argument structure, but the Draft prompt just receives the Plan as a JSON blob. The sketch is LLM working memory — it helps the Plan think but doesn't constrain the Draft.

---

### Stage 2.5: Evidence Retrieval (deterministic)

**Purpose:** Find source facts to ground the Draft's claims.

| Data In | Source | Why Here |
|---------|--------|----------|
| `target_nodes[]` | Plan | Which taxonomy nodes to find evidence for |
| Source evidence index | Pre-built from summaries | Fact corpus grouped by node |
| Debater POV | Config | Filter key points to matching perspective |
| Doc titles/metadata | Source metadata | For citation formatting |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| `evidenceBlock` (formatted text) | Draft prompt | No |
| `evidenceDocIds` (Set) | Citation bank scoping | No |
| Diversity diagnostics | Stage diagnostics | No (logged) |

**Rationale:** Evidence retrieval is deterministic (no LLM call) and sits between Plan and Draft. The Plan identifies *what to argue*; Evidence retrieves *what supports it*; Draft *writes the argument*. This ordering ensures the Draft has specific, citable facts rather than generating claims from parametric memory.

**What's NOT here and why:** The Brief doesn't see evidence because the Brief doesn't know which nodes to retrieve evidence for — that comes from the Plan's `target_nodes`. The Cite stage doesn't see evidence because Cite operates on the finished statement, not the evidence used to write it.

---

### Stage 2.6: Citation Bank Build (deterministic)

**Purpose:** Constrain the Draft to cite only verified sources.

| Data In | Source | Why Here |
|---------|--------|----------|
| Full evidence index | Pre-built | All available sources |
| `evidenceDocIds` | Evidence stage | Turn-relevant source docs |
| `priorRefs` → doc lookup | Prior turns | Sources cited before (carry-forward) |
| `target_nodes[]` | Plan | Buffer docs from target nodes |
| Policy registry | Taxonomy | Legislation sources |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| `citationBankBlock` (scoped, ~15 entries) | Draft prompt | No |
| `citationBank` (full, ~200 entries) | Post-draft scrub, validation | No |

**Rationale:** The scoped bank goes into the prompt; the full bank is kept for post-draft fabrication detection. The Draft sees only ~15 relevant sources (saves ~8-9K tokens vs. injecting the full corpus, per t/274).

---

### Stage 3: Draft (temp=0.7)

**Purpose:** Generate the actual debater statement.

| Data In | Source | Why Here |
|---------|--------|----------|
| `briefJson` | Stage 1 | Situation awareness |
| `planJson` | Stage 2 | Strategic roadmap |
| `evidenceBlock` | Stage 2.5 | Source facts to cite |
| `citationBankBlock` | Stage 2.6 | Verified sources list |
| Taxonomy context | Same as Brief | BDI grounding (with weights) |
| Recent transcript | Same as Brief | What to respond to |
| Repair hints (if retry) | Validation | Fix prior draft's weaknesses |
| Field freeze (if retry) | Prior draft | Preserve validated fields |
| Audience directives | Config | Tone, reading level, detail level |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| `statement` | Final output, Cite, Lookahead | No |
| `claim_sketches[]` | Cite (as draftJson), Claims extraction, final metadata | No |
| `key_assumptions[]` | Final metadata | No |
| `disagreement_type` | Final metadata | No |
| `position_update` | Final metadata | No |
| `turn_symbols[]` | Display only | **Yes — not used by any downstream stage** |

**Post-Draft Processing (deterministic):**
1. Citation scrub — remove fabricated citations
2. Linkification — add markdown links to cited sources
3. Evidence utilization check — did the debater actually cite the evidence?
4. Ungrounded claims detection — find claims from parametric memory

**Rationale:** The Draft operates at the highest temperature (0.7) — it needs creative, natural-sounding prose. It receives everything the debater needs: situation analysis (Brief), strategy (Plan), evidence (Evidence stage), and source constraints (Citation bank). This is the convergence point where all prior analysis materializes as text.

**What's NOT here and why:** The Draft doesn't see the full argument network directly — it sees it mediated through the Brief's `key_claims_to_address` and the taxonomy context's established points. This is principled: the AN is a structural representation that would confuse the Draft's prose generation. The Brief translates AN structure into narrative guidance.

---

### Stage 3.5: Draft Quality Pre-Check (optional, temp=0.1)

**Purpose:** Catch low-quality drafts before the expensive Cite stage.

| Data In | Source | Why Here |
|---------|--------|----------|
| `draft.statement` | Stage 3 | The text to evaluate |
| Last opponent statement | Prior turn | Does this draft engage? |
| Planned moves | Stage 2 | Exclude false positives |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| Pass/fail (3 questions) | Gate decision | No |
| Weaknesses list | Draft retry (if fail) | **Yes — not persisted if pass** |

**Rationale:** A lightweight gate (3 yes/no questions, fast model) that catches statements that are vague, unfalsifiable, or non-responsive *before* spending tokens on taxonomy grounding. If the statement fails, it's cheaper to regenerate the Draft than to Cite a bad statement.

---

### Stage 4: Cite (temp=0.15)

**Purpose:** Ground the finished statement in the taxonomy. Map claims to nodes.

| Data In | Source | Why Here |
|---------|--------|----------|
| `planJson` | Stage 2 | What was intended |
| `draftJson` | Stage 3 | What was actually written |
| Taxonomy context | Same as Brief | Available nodes to cite |
| Prior refs (all turns) | Turn history | Novelty filter — cite uncited nodes |
| Cross-POV node IDs | Config | Can cite opponent's taxonomy when engaging |
| Policy IDs | Config | Available policy actions |

| Data Out | Consumed By | Lost? |
|----------|-------------|-------|
| `taxonomy_refs[]` with relevance explanations | Final transcript entry, next turn's priorRefs | **Relevance explanations stored but not used in next turn's Brief** |
| `policy_refs[]` | Final metadata | No |
| `grounding_confidence` | Final metadata | **Not used by any downstream system** |
| `move_annotations[]` | (prompt says don't include) | N/A |

**Rationale:** Cite operates at low temperature (0.15) for analytical precision — it's classifying relationships, not generating prose. It runs *after* the Draft because it needs to ground the *actual statement*, not the planned one. The Draft may deviate from the Plan; the Cite stage sees what was really written.

---

## The Cite Stage Paradox

This is the core question: the Cite stage produces the richest structured data about how a turn connects to the taxonomy, but almost none of it flows forward.

### What Cite Produces

For each taxonomy ref:
```json
{
  "node_id": "acc-beliefs-042",
  "relevance": "The claim that telemetry can detect 94% of reward hacking
                incidents directly supports this Belief's empirical foundation.
                The 2024 DeepMind study cited in the evidence provides the
                specific data point that this Belief's confidence score (0.82)
                is built on."
}
```

This relevance explanation is a **high-quality, LLM-generated annotation** linking a specific argument to a specific taxonomy node with reasoning. It costs tokens to produce. It's validated for filler. It's strengthened when weak.

### What Happens to It

The `relevance` string is stored on the transcript entry's `taxonomy_refs[]` and displayed in the diagnostics. That's it.

### What Should Happen to It

**1. Feed into next turn's Brief**

The Brief for turn N+1 identifies "key claims to address" — but it doesn't know *why* those claims were grounded in specific taxonomy nodes. If the Brief saw:

```
Prior turn grounding:
- acc-beliefs-042: "The telemetry detection rate directly supports the
  empirical foundation of this Belief" (relevance: 0.85)
```

It could make better strategic assessments: "The opponent built their argument on a specific empirical claim — I should challenge the data, not the principle."

**Current barrier:** The `recentTranscript` includes `taxonomy_refs` but only as `node_id` lists. The relevance explanations are on the transcript entry but not formatted into the Brief's input. This is an **accidental barrier** — the data exists, it just isn't wired through `formatRecentTranscript()`.

**2. Feed into confidence evolution**

The Cite stage's relevance explanation describes *how* a claim connects to a Belief node. The `confidenceEvolution.ts` module evaluates whether debate outcomes should change Belief confidence — but it works from AN claim strength and attack types, not from the Cite stage's rich attribution. A Cite relevance like "this claim provides the specific data point that this Belief's confidence is built on" is exactly the kind of signal the confidence evolution gate should consider.

**Current barrier:** `confidenceEvolution.ts` uses `claim_taxonomy_attribution` (computed during AN extraction), not Cite-stage `taxonomy_refs`. These are different: AN extraction classifies the structural relationship; Cite explains the argumentative connection. Both are useful; only the structural one is used.

**3. Feed into the Crux Tracker**

The Cite stage knows which taxonomy nodes a turn engaged with and how strongly. If two debaters from opposing POVs both cite the same node with high relevance and opposing stances, that's a crux signal — the node is contested. Currently, crux detection runs from AN structure (cross-POV attack edges), not from Cite data.

**Current barrier:** Crux detection in `cruxResolution.ts` operates on argument network edges. The Cite stage's per-node relevance data doesn't feed into it.

### Summary: Why Cite Data Doesn't Flow Forward

| Cite Output | Where It Goes | Where It Should Go | Barrier Type |
|-------------|---------------|-------------------|-------------|
| `taxonomy_refs[].node_id` | Next turn's `priorRefs` (novelty filter) | Also Brief context | Accidental — data exists, not formatted |
| `taxonomy_refs[].relevance` | Stored on transcript entry, displayed in diagnostics | Brief, confidence evolution, crux tracker | Accidental — never wired |
| `grounding_confidence` | Stored on transcript entry | Quality metrics, calibration | Accidental — computed but unused |
| `policy_refs` | Final metadata | Policy impact tracking across debate | Accidental — stored but not aggregated |

**None of these barriers are principled.** The Cite stage was designed as an annotation step — "tag the finished statement with taxonomy references." It wasn't designed as a data-producing stage whose outputs feed into downstream analysis. But that's what it should be.

---

## Cross-Turn Information Flow

### What Persists from Turn N to Turn N+1

| Data | How It Persists | Available To |
|------|----------------|-------------|
| Statement text | Transcript entry → `recentTranscript` | Brief, Plan, Draft, Cite |
| Taxonomy ref node IDs | Transcript entry → `priorRefs` | Cite (novelty filter) |
| Claim sketches | AN extraction → argument network nodes | Brief (via established points), Relevance scoring |
| Planned moves | Transcript metadata | Next turn's move history |
| Commitments | Commitment store update | Brief, Plan (commitment context) |
| Disagreement type | Transcript metadata | (Not consumed by next turn) |
| Position update | Transcript metadata | (Not consumed by next turn) |
| Key assumptions | Transcript metadata | (Not consumed by next turn) |

### What's Lost Between Turns

| Data | Where It Dies | Should It Persist? |
|------|---------------|-------------------|
| Taxonomy ref relevance explanations | Transcript entry (stored, not formatted for next turn) | **Yes — feed into Brief** |
| Grounding confidence | Transcript entry | **Yes — quality metric** |
| Plan's anticipated_responses | PlanWorkProduct (not on transcript entry) | **Yes — verify against what actually happened** |
| Plan's argument_sketch | PlanWorkProduct | No — working memory |
| Evidence block text | Pipeline result (not on transcript entry) | Possibly — could help next turn avoid re-citing same facts |
| Draft quality pre-check result | Stage diagnostics only | No — single-turn gate |
| Filler strengthening rewrites | Stage diagnostics only | No — debugging artifact |

---

## Information Barriers: Principled vs. Accidental

### Principled Barriers (Keep)

| Barrier | Rationale |
|---------|-----------|
| Brief doesn't see source evidence | Brief analyzes debate dynamics, not source material. Evidence belongs in Draft where claims are constructed. |
| Draft doesn't see raw AN structure | AN is a graph — the Draft needs narrative guidance (via Brief), not data structures. |
| Cite operates on finished statement, not plan | The Draft may deviate from the Plan. Cite must ground what was *actually written*. |
| Quality pre-check uses a lightweight model | The gate is a cost optimization — cheap model for yes/no, expensive model for prose. |
| Temperature gradient (0.15 → 0.4 → 0.7 → 0.15) | Analytical stages need precision; generative stages need creativity. |

### Accidental Barriers (Fix)

| Barrier | What's Lost | Recommended Fix |
|---------|------------|-----------------|
| Cite relevance not in `recentTranscript` | Rich per-node argumentative connection | Format top-2 relevance explanations per turn into `formatRecentTranscript()` |
| `grounding_confidence` not used | Per-turn quality signal | Feed into calibration metrics and moderator intervention triggers |
| `anticipated_responses` not tracked | Prediction-vs-reality comparison | Store on transcript metadata, compare in next turn's Brief |
| `position_update` not consumed | How the debater's view evolved | Feed into convergence tracker as a self-reported signal |
| `key_assumptions` not consumed | What the debater thinks could break their argument | Feed into opponent's Brief as "vulnerable assumptions to probe" |
| Evidence utilization not in next turn | Whether the debater actually used the evidence | Feed into next evidence retrieval — deprioritize unused source docs |

---

## Recommendations

### Priority 1: Wire Cite Relevance into Next Turn's Brief

The single highest-value information flow improvement. The data exists, is validated, and is stored — it just needs to be formatted into the Brief's input.

**Implementation:** In `formatRecentTranscript()`, for the most recent 2-3 transcript entries, append 1-2 highest-relevance `taxonomy_refs` with their relevance explanations. ~100 tokens per turn of additional context, enormous analytical value.

### Priority 2: Track Anticipated Responses

Store `plan.anticipated_responses` on the transcript entry metadata. In the next turn's Brief, compare against what the opponent actually did. Surface as: "Your prediction was X. The opponent did Y. Adjust accordingly."

### Priority 3: Surface Key Assumptions to Opponents

The current turn's `key_assumptions` are stored but never shown to the *other* debaters. In the next opponent's Brief, surface: "The prior speaker assumes X. If wrong, their argument changes in way Y. This is a potential attack vector."

### Priority 4: Feed Evidence Utilization Back

Track which evidence facts were cited vs. ignored. In the next turn's evidence retrieval, deprioritize doc_ids that were provided but not cited — the debater had the evidence and chose not to use it.

### Priority 5: Feed Grounding Confidence into Calibration

`grounding_confidence` from the Cite stage is a per-turn quality signal. Aggregate across turns: declining grounding confidence suggests the debate is drifting from the taxonomy. Feed into the moderator's intervention triggers.
