# How the Draft Prompt Evolves Between Turns

This document explains what changes in the raw prompt sent to the AI during the DRAFT stage of each debate turn, and why.

## Overview

The debate engine uses a four-stage pipeline for each turn: BRIEF → PLAN → DRAFT → CITE. The DRAFT stage produces the debater's actual statement. Its prompt is constructed as a four-layer envelope, where most of the content is dynamically generated from the current debate state. Every turn produces a semantically different draft prompt because the debate's transcript, argument network, commitments, and moderator selections all evolve.

## The Four-Layer Envelope

The draft prompt is built from four layers, each with a different change frequency:

| Layer | Name | What It Contains | Changes Per Turn? |
|-------|------|-----------------|-------------------|
| 1 | Static | Core debate rules, output constraints, steelman instruction | **Never** — hashed and cached |
| 2 | Persona | Speaker name, POV, personality, other debaters | **Rarely** — only when a different speaker is selected |
| 3 | Turn Context | Audience/reading level, taxonomy context | **Yes** — taxonomy context changes every turn |
| 4 | Variable | Brief, plan, focus point, intervention, evidence, repair hints | **Yes** — everything here is per-turn |

Layer 1 is identical across all turns in a debate. Layer 2 changes only when the moderator selects a different debater to respond. Layers 3 and 4 are where the real evolution happens.

## What Changes Every Turn

### 1. Taxonomy Context (Layer 3)

The taxonomy context is the largest changing block. It's composed of six sub-contexts concatenated together:

**Base taxonomy context** — The most relevant taxonomy nodes for this turn. Built by:
- Constructing a relevance query from the topic + the last 8 transcript entries
- Scoring every node using hybrid AN + topic similarity (embedding-based)
- Applying a ×0.55 diversification penalty on nodes cited in the debater's last 2 statements
- Selecting the top ~35 nodes (min 3 per BDI category, min 0.48 similarity threshold)
- Formatting with descriptions, connected edges, and policy links

This changes every turn because the relevance query incorporates fresh transcript and the argument network grows with each new claim.

**Commitment context** — Explicit concessions made by this debater in prior turns. Empty on turn 1, grows as the debater makes CONCEDE-AND-PIVOT moves. Each debater has their own commitment history.

**Established points** — Recent claims by OTHER debaters that this speaker should be aware of. Sorted by strength, limited to ~10 nodes from other POVs. Grows with every statement in the debate.

**Edge context** — Top 15 structural tensions between this debater's POV nodes and opponent POV nodes (CONTRADICTS, TENSION_WITH, WEAKENS edges). The edges themselves are static (from the taxonomy), but which ones appear depends on which nodes are relevant this turn.

**Concession hint** — QBAF-grounded candidates for strategic concession. Shows the 2 strongest opponent claims (strength ≥ 0.65) that this debater hasn't attacked or already conceded. Recomputed each turn as the argument network grows.

### 2. Brief and Plan Outputs (Layer 4)

The DRAFT prompt receives the full JSON output from the BRIEF and PLAN stages that ran earlier in the same turn's pipeline. These are different every turn because they analyze the current debate state:

**Brief output** includes:
- Situation assessment (what's happening in the debate right now)
- Key claims to address (from recent opponent turns)
- Relevant commitments (prior concessions by all speakers)
- Edge tensions (structural disagreements surfaced so far)
- Phase considerations (what the current phase demands)

**Plan output** includes:
- Strategic goal (what this turn should accomplish)
- Planned moves (1-5 dialectical moves with AN targets)
- Target claims (which argument network nodes to engage)
- Argument sketch (2-4 sentence structure)
- Anticipated responses (expected opponent reactions)
- Directive response plan (if a moderator intervention is pending)

### 3. Focus Point and Addressing (Layer 4)

Each turn, the moderator selects:
- **Focus point** — The specific topic or claim the debater should address. Derived from argument network claims, agreement/tension signals, phase state, and debate health scoring. Varies significantly turn-to-turn.
- **Addressing** — Who the response is directed at (a specific debater by name, or "the panel" for general statements).

### 4. Source Evidence (Layer 4)

When a source evidence index is available, the pipeline runs a deterministic evidence retrieval step (Stage 2.5) between PLAN and DRAFT:
- Retrieves evidence for the nodes the debater planned to cite (from `plan.target_nodes`)
- Selects up to 3 facts and 2 key points per target node
- Filters by POV relevance (accelerationist nodes get accelerationist sources)
- Injects as a `=== SOURCE EVIDENCE ===` block with a citation mandate

This changes every turn because the plan's target nodes differ.

### 5. Prior Moves and Citation History (Layer 4)

**Prior moves** — The debater's last 6 dialectical moves (roughly their last 3 turns). Used to enforce move diversity:
- "You have conceded frequently. DO NOT open with a concession this turn."
- "You last conceded N turns ago — consider whether a genuine concession is warranted."
- "Your last N responses used: DISTINGUISH → EXTEND → DISTINGUISH. Vary your approach."

**Prior refs** — Node IDs from the debater's last 2 statements. Used to:
- Down-weight recently cited nodes in taxonomy context scoring (×0.55 penalty)
- Guide the CITE stage: "Recently cited: {nodes}. 1-2 of this turn's refs must be NEW."
- In rounds ≥ 4, inject cross-POV node IDs sampled from other POVs (forces engagement with opposing positions)

### 6. Phase Directive (Layer 4)

A short instruction block based on the current debate phase:
- **Confrontation:** "Engage directly with what was said. If you disagree, say why with evidence."
- **Argumentation:** "Probe deeper. Find cruxes, test edge cases, challenge assumptions."
- **Concluding:** "Focus on convergence. Name what you agree on, where you still disagree, and what evidence would change your mind."

This changes only on phase transitions (every few rounds), not every turn.

## What Changes Only Sometimes

### Moderator Intervention Block

Injected only when the moderator issues a targeted directive to this debater. Different moderator moves produce different response schemas:

| Move | Response Field | What It Asks |
|------|---------------|--------------|
| PIN | `pin_response` | State your position (agree/disagree/conditional) with reasons |
| PROBE | `probe_response` | Provide specific evidence type, evidence, and critical question |
| CHALLENGE | `challenge_response` | Has your position evolved? Explain. |
| CLARIFY | `clarify_response` | Define the term and give an example |
| COMPRESS | `compressed_thesis` | State your thesis in 1-2 unhedged sentences |
| COMMIT | `commitment_made` | State commitment, scope, conditions, and falsifiability |

When a targeted intervention is active, the prompt includes a `=== MODERATOR DIRECTIVE ===` block with move-specific instructions and the JSON response field is added to the output schema.

### Repair Block (Retry Only)

Injected only when the draft stage is being retried after a validation failure. The `buildRepairBlock()` function translates generic validation hints into specific, actionable corrections:

| Validation Issue | Repair Instruction |
|-----------------|-------------------|
| Single paragraph | "You MUST use \\n\\n to create 3-5 separate paragraphs" |
| Hedge density too high | "Replace 'may', 'might', 'could' with definitive claims" |
| Claim specificity lacking | "Include at least one: specific number ('≥20%'), named entity ('the EU AI Act'), or timeline ('by 2028')" |
| Move repetition | "Choose different moves from your previous turn" |
| Directive non-compliance | "Your first sentence must begin with your response to the moderator" |
| Commitment schema missing | Full JSON structure with field descriptions |

The repair block is inserted in the prompt's recency window (just before the JSON schema) to maximize the model's attention to the corrections.

### Prior Flagged Hints

If the debater's previous turn was accepted with a flag (`accept_with_flag` outcome), the quality hints from that validation are carried forward as `priorFlaggedHints`. These flow into the PLAN stage so the debater can proactively address weaknesses identified by the judge. Cleared after one turn.

## What Never Changes

- **Layer 1 (static behaviors)** — Core debate rules, steelman instruction, output format constraints. Hashed and cached for efficiency.
- **Speaker personality** — Each debater's personality trait is fixed for the debate.
- **Topic** — The debate topic/question is set at creation time.
- **Audience** — The target audience (academic, general public, policymaker) is set per debate and affects reading level and detail depth.

## Visualizing the Evolution

Here's what a typical prompt looks like across 3 consecutive turns for the same debater:

```
Turn 5 (S7):
  Layer 1: [static — same]
  Layer 2: [persona — same speaker]
  Layer 3: taxonomy context → 35 nodes scored against "S1-S6 transcript + topic"
           commitments → 1 concession from S4
           established points → 8 opponent claims from S1-S6
           edge context → 12 relevant tensions
           concession hint → 2 candidates (strength 0.72, 0.68)
  Layer 4: brief → analyzes S4-S6 (last 8 entries)
           plan → DISTINGUISH + EMPIRICAL CHALLENGE, targets AN-5, AN-8
           evidence → 2 facts from source corpus for AN-5
           focus → "algorithmic accountability frameworks" (moderator-selected)
           phase → argumentation
           prior moves → [EXTEND, REFRAME, DISTINGUISH, PROBE, ...]
           prior refs → [acc-B-012, acc-I-031, saf-D-008] (down-weighted)

Turn 8 (S13):
  Layer 1: [static — same]
  Layer 2: [persona — same speaker]
  Layer 3: taxonomy context → 35 nodes scored against "S1-S12 transcript + topic"
           commitments → 2 concessions from S4, S10
           established points → 14 opponent claims from S1-S12
           edge context → 15 relevant tensions (shifted by new relevance)
           concession hint → 1 candidate (strength 0.81) — prior candidate was attacked
  Layer 4: brief → analyzes S10-S12
           plan → CONCEDE-AND-PIVOT + INTEGRATE, targets AN-12, AN-15
           evidence → 3 facts for AN-12
           focus → "liability frameworks vs. pre-deployment audits" (new moderator selection)
           phase → argumentation (same)
           pending intervention → PROBE from moderator (targeted)
           prior moves → [DISTINGUISH, EMPIRICAL CHALLENGE, EXTEND, REFRAME, ...]
           prior refs → [acc-B-003, saf-I-047, skp-D-002] (different set, down-weighted)
           prior flagged hints → ["Hedge density 38% exceeds threshold"] (from S7's validation)

Turn 11 (S19):
  Layer 1: [static — same]
  Layer 2: [persona — same speaker]
  Layer 3: taxonomy context → 35 nodes scored against "S1-S18 transcript + topic"
           commitments → 3 concessions
           established points → 20 opponent claims
           edge context → 15 tensions (further shifted)
           concession hint → 0 candidates (all strong claims already attacked)
  Layer 4: brief → analyzes S16-S18
           plan → INTEGRATE + SUMMARIZE, targets AN-3, AN-18, AN-22
           evidence → 2 facts for AN-18
           focus → "convergence on transparency requirements"
           phase → concluding (transitioned!)
           phase directive → "Focus on convergence. Name what you agree on..."
           prior moves → [CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, ...]
           prior refs → [acc-I-031, cc-B-005, pol-028] (cross-POV in late rounds)
```

Each turn's prompt is shaped by the cumulative debate history, the moderator's evolving focus, the argument network's growing claim structure, and the debater's own citation and concession patterns. No two draft prompts are alike.
