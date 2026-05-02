# Debate Engine

## Overview

The debate engine is a three-agent BDI (Belief-Desire-Intention) debate system implemented in TypeScript across 22+ source files in `lib/debate/`. Three AI-driven characters — Prometheus (accelerationist), Sentinel (safetyist), and Cassandra (skeptic) — argue about AI policy topics grounded in the taxonomy, moderated by an autonomous intervention agent.

The engine runs in two modes:
- **CLI** — `npm run debate` via `cli.ts` and `debateEngine.ts`
- **Electron app** — Integrated into the Taxonomy Editor via `useDebateStore.ts`

## Characters

| Character | POV | Personality | Debate Style |
|---|---|---|---|
| **Prometheus** | Accelerationist | Bold, optimistic, impatient | Appeals to progress, capability, inevitability |
| **Sentinel** | Safetyist | Cautious, analytical, urgent | Appeals to risk, alignment, precautionary principle |
| **Cassandra** | Skeptic | Pragmatic, grounded, critical | Appeals to concrete harms, labor impact, current failures |

Each character has a distinct voice and rhetorical strategy, configured through extensive prompt templates in `prompts.ts` (168 KB, 27+ templates).

## Debate Phases

```
setup → clarification → edit-claims → opening → debate → closed
```

| Phase | Purpose |
|---|---|
| **setup** | Configure topic, protocol, participants, optional source document |
| **clarification** | (Optional) Characters ask clarifying questions |
| **edit-claims** | (Optional) User reviews/edits extracted document claims before opening |
| **opening** | Each character states their position, grounded in taxonomy nodes |
| **debate** | Moderated turn-taking with interventions and convergence tracking |
| **closed** | Synthesis, final statements, QBAF network output |

Phase transitions are adaptive — the engine monitors convergence signals and can trigger early synthesis when arguments begin recycling.

## Moderator System

The moderator is an autonomous agent that monitors debate quality and intervenes when needed. It operates on a budget/cooldown system with drift detection.

### Intervention Families

| Family | Purpose | Example Moves |
|---|---|---|
| **Procedural** | Manage debate flow | REDIRECT, SEQUENCE |
| **Elicitation** | Draw out deeper arguments | PROBE, CHALLENGE |
| **Repair** | Fix misunderstandings | CLARIFY, REVOICE |
| **Reconciliation** | Find common ground | BALANCE, ACKNOWLEDGE |
| **Reflection** | Step back and assess | META-REFLECT, CHECK |
| **Synthesis** | Consolidate progress | SUMMARIZE, COMPRESS, COMMIT |

### Budget & Cooldown

The moderator has a finite budget per debate. Each intervention costs a fractional amount:

| Cost Tier | Moves | Cost |
|---|---|---|
| High-value (cheap) | PIN, PROBE, CHALLENGE, REDIRECT, CLARIFY, CHECK, META-REFLECT | 0.34 |
| Medium | BALANCE, SEQUENCE | 0.67 |
| Routine (full cost) | SUMMARIZE, ACKNOWLEDGE, REVOICE, COMPRESS | 1.0 |
| Free | COMMIT | 0.0 |

When budget exhausts, it refills with a smaller amount and a longer required cooldown gap between interventions:

```
Epoch 0: full budget, gap = 1 turn
Epoch 1: budget / 2, gap = 2 turns
Epoch 2: budget / 3, gap = 3 turns
...
```

This ensures the moderator never goes permanently silent but becomes progressively less frequent.

### Semantic Drift Detection

The moderator monitors for three drift patterns:

1. **Metaphor Literalization** — A figure of speech gets treated as a factual claim (e.g., "arms race" → literal weapons discussion)
2. **Implementation Spiral** — Abstract policy discussion descends into technical implementation details
3. **Scope Creep** — Debate drifts from the source document's topic to tangentially related issues

When drift is detected, the moderator anchors back to the source document summary and recommends a corrective intervention.

### Two-Stage Selection

1. **Stage 1 — Selection**: Given debate history and trigger context, the moderator decides whether to intervene and selects a move
2. **Stage 2 — Generation**: If intervening, generate the actual intervention text with specific targeting

## Core Files

| File | Size | Purpose |
|---|---|---|
| `debateEngine.ts` | 139 KB | Main orchestration — turn pipeline, phase transitions, character prompting |
| `prompts.ts` | 168 KB | 27+ prompt templates for all phases, characters, and moderator |
| `moderator.ts` | 34 KB | Moderator logic — budget, cooldown, trigger evaluation, signal detection |
| `argumentNetwork.ts` | 36 KB | QBAF graph construction, node/edge management |
| `phaseTransitions.ts` | 35 KB | Adaptive phase staging, early termination logic |
| `aiAdapter.ts` | 28 KB | Multi-backend AI abstraction (Gemini, Claude, Groq) |
| `types.ts` | — | Type definitions for all debate structures |
| `convergenceSignals.ts` | — | Recycling rate, engagement depth, position drift, concession tracking |
| `pragmaticSignals.ts` | — | Synthesis quality, exploration depth, crux discovery |

## QBAF (Quantitative Bipolar Argumentation Framework)

The engine constructs a QBAF network during the debate — a directed graph where nodes are claims and edges represent support/attack relationships with numerical strengths:

- **Nodes** — Claims extracted from character statements, mapped to taxonomy node IDs
- **Support edges** — One claim strengthens another (positive weight)
- **Attack edges** — One claim weakens another (negative weight)
- **Strengths** — Computed via iterative propagation algorithm

QBAF networks are exported alongside debate transcripts and can be visualized in the Taxonomy Editor's argument graph view.

Related files: `qbaf.ts`, `qbafCombinator.ts`, `networkGc.ts` (prune weak edges).

## Convergence Detection

The engine tracks multiple convergence signals to determine when a debate should move toward synthesis:

- **Recycling rate** — Are characters repeating arguments they've already made?
- **Engagement depth** — Are responses engaging with specifics or staying surface-level?
- **Position drift** — Are characters' positions shifting over time?
- **Concession tracking** — Are characters acknowledging points from other POVs?
- **Crux discovery** — Have the core disagreements been identified?

When signals indicate diminishing returns, the engine transitions to synthesis phase.

## Document Analysis

When debating a source document or URL, the engine first analyzes it to extract:

- **Claims summary** — Overview of the document's main arguments
- **I-nodes** (`DocumentINode[]`) — Individual claims typed as empirical, normative, definitional, assumption, or evidence
- **Tension points** — Internal contradictions or areas of uncertainty

After extraction, users can optionally review and edit claims in the edit-claims phase before opening statements begin.

## Turn Pipeline

Each debate turn follows this pipeline:

1. Build context (debate history, taxonomy nodes, convergence signals)
2. Check for moderator intervention (budget, cooldown, trigger evaluation)
3. Select next speaker (round-robin with moderator overrides via PIN)
4. Generate character response (grounded in taxonomy and debate history)
5. Extract claims and update argument network
6. Update convergence signals
7. Check phase transition conditions

## Testing

- `moderator.test.ts` — Unit tests for moderator logic (budget, refill, cooldown, move costs)
- `moderator-integration.test.ts` — Integration tests for full moderator evaluation pipeline

Run via `npm test` from the repository root.

## Entry Points

| Entry Point | Context | File |
|---|---|---|
| `npm run debate` | CLI | `lib/debate/cli.ts` |
| `Show-TriadDialogue` | PowerShell | Calls into the TypeScript engine via tsx |
| `useDebateStore.ts` | Electron app | Zustand store wrapping the engine |
