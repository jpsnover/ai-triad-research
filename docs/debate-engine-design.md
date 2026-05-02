# Debate Engine — High-Level Design

**Status:** Living document  
**Last updated:** 2026-05-01  
**Author:** Jeffrey Snover  
**Audience:** Engineers, researchers, and contributors who need to understand the debate engine's architecture, behavior, and design rationale.

---

## 1. Problem Statement

AI policy debates involve deeply entangled arguments across multiple perspectives. A human researcher reading 50 papers encounters hundreds of claims that support, contradict, and assume each other — but these relationships are implicit. Existing tools (literature reviews, annotated bibliographies) capture *what* authors say but not *how* their arguments interact structurally.

The debate engine simulates structured multi-perspective arguments grounded in a taxonomy of ~320 classified claims, making implicit argument relationships explicit through a formal argumentation framework. The output is not "who wins" but a **graph of how arguments relate** — which claims attack which, where concessions happen, and what remains genuinely unresolved.

## 2. Goals and Non-Goals

### Goals

- **G1:** Produce structured argument networks (QBAF graphs) from any AI policy topic, grounded in the project taxonomy
- **G2:** Detect genuine convergence vs. recycled positions — know when to stop
- **G3:** Maintain debate quality through autonomous moderation without human babysitting
- **G4:** Support both topic-only and document-grounded debates (URL or file as source)
- **G5:** Run identically via CLI and Electron UI, with full diagnostic instrumentation
- **G6:** Work across multiple AI backends (Gemini, Claude, Groq) without backend-specific logic in the debate layer

### Non-Goals

- **NG1:** Declaring winners or producing normative judgments — the engine maps argument structure, it does not evaluate who is "right"
- **NG2:** Real-time multi-user debates — this is single-operator, AI-vs-AI with human oversight
- **NG3:** Open-ended conversation — debates follow structured phases with defined entry/exit conditions
- **NG4:** Training or fine-tuning models — the engine uses inference-only LLM calls
- **NG5:** Replacing human analysis — output is a scaffold for researcher interpretation, not a finished product

## 3. System Context

```
                    ┌─────────────┐
                    │  Researcher  │
                    └──────┬──────┘
                           │ configures topic, reviews output
                           ▼
┌───────────────────────────────────────────────────────┐
│                    Debate Engine                       │
│  ┌──────────┐  ┌───────────┐  ┌────────────────────┐ │
│  │ Debate    │  │ Moderator │  │ Argument Network   │ │
│  │ Engine    │◄─┤ Agent     │  │ (QBAF Builder)     │ │
│  │ (Orch.)   │  └───────────┘  └────────────────────┘ │
│  └─────┬─────┘                                        │
│        │ prompts & parses                              │
│        ▼                                               │
│  ┌──────────┐    reads     ┌──────────────────────┐   │
│  │ AI       │◄─────────────┤ Taxonomy + Embeddings │   │
│  │ Adapter  │              │ (read-only at runtime)│   │
│  └────┬─────┘              └──────────────────────┘   │
└───────┼───────────────────────────────────────────────┘
        │ HTTP
        ▼
   ┌──────────┐
   │ Gemini / │
   │ Claude / │
   │ Groq     │
   └──────────┘
```

**External dependencies:**
- **AI backends** — inference-only, stateless API calls (no fine-tuning, no persistent state)
- **Taxonomy data** — read at session start, never mutated during a debate
- **File system** — debate transcripts written to `debates/` directory on completion

**Two runtime hosts:**
- **CLI** (`debateEngine.ts` → `cli.ts`) — runs a complete debate as a batch process
- **Electron** (`useDebateStore.ts`) — wraps the engine in a Zustand store for reactive UI

Both hosts use the same core logic. The Electron host reimplements the orchestration loop to support pause/resume and incremental UI updates, which means fixes to debate logic must be ported to both.

## 4. Architecture Overview

### 4.1 Component Map

| Component | File(s) | Responsibility |
|---|---|---|
| **Orchestrator** | `debateEngine.ts` | Phase sequencing, turn generation, hook dispatch |
| **Turn Pipeline** | `turnPipeline.ts` | 4-stage per-turn generation (brief → plan → draft → cite) |
| **Moderator** | `moderator.ts` | Intervention triggering, budget/cooldown, health scoring |
| **Argument Network** | `argumentNetwork.ts`, `qbaf.ts` | Claim extraction, QBAF graph construction, strength computation |
| **Phase Controller** | `phaseTransitions.ts` | Adaptive phase transitions via signal predicates |
| **Signal System** | `convergenceSignals.ts`, `pragmaticSignals.ts` | Per-turn debate health measurement (includes semantic recycling detection) |
| **Crux Resolution** | `cruxResolution.ts` | Deterministic crux state machine (identified → engaged → resolved/irreducible) |
| **Context Compression** | `tieredCompression.ts` | Three-tier compression: recent (full), medium (structural), distant (summary) |
| **Prompt Library** | `prompts.ts` | 27+ prompt templates for all phases and actors |
| **AI Adapter** | `aiAdapter.ts` | Multi-backend abstraction with retry |
| **Document Analyzer** | `documentAnalysis.ts` | Source document claim extraction |
| **Network GC** | `networkGc.ts` | Argument network pruning when node count exceeds threshold |
| **Types** | `types.ts` | All shared type definitions |

### 4.2 Layering

```
┌────────────────────────────────────────────┐
│ Hosts (CLI / Electron Zustand store)       │  ← runtime integration
├────────────────────────────────────────────┤
│ Orchestrator (debateEngine.ts)             │  ← phase sequencing, hooks
├──────────┬──────────┬──────────────────────┤
│ Turn     │ Moderator│ Phase Controller     │  ← per-turn logic
│ Pipeline │          │                      │
├──────────┴──────────┴──────────────────────┤
│ Argument Network / QBAF / Signals          │  ← debate state tracking
├────────────────────────────────────────────┤
│ Prompt Library                             │  ← LLM interface
├────────────────────────────────────────────┤
│ AI Adapter                                 │  ← backend abstraction
└────────────────────────────────────────────┘
```

Each layer depends only on layers below it. The prompt library is the boundary between debate logic and LLM interaction — all natural language lives there.

## 5. Characters

Three AI characters represent distinct intellectual traditions. Each has a fixed POV alignment, personality, and rhetorical strategy:

| Character | POV | Voice | Strategy |
|---|---|---|---|
| **Prometheus** | Accelerationist | Bold, impatient, visionary | Appeals to progress, capability scaling, historical inevitability |
| **Sentinel** | Safetyist | Cautious, analytical, urgent | Appeals to existential risk, alignment failure modes, precaution |
| **Cassandra** | Skeptic | Pragmatic, grounded, sardonic | Appeals to concrete harms, labor displacement, current AI failures |

Characters are not interchangeable — their prompts encode distinct epistemic commitments and argumentative tendencies. This is by design: the goal is to surface how real intellectual communities would engage, not to produce "balanced" generic responses.

## 6. Debate Lifecycle

### 6.1 Phase Sequence

```
setup ──► clarification ──► edit-claims ──► opening ──► debate ──► closed
  │            │                  │                         │
  │       (optional)         (optional,               (adaptive or
  │                        doc debates               fixed rounds)
  │                           only)
  └──────────────────────────────────────────────────────────┘
                    (skip paths available)
```

| Phase | Entry Condition | Exit Condition | What Happens |
|---|---|---|---|
| **setup** | Session created | User chooses clarify or skip | Configure topic, participants, source document |
| **clarification** | User requests topic refinement | Answers submitted or skipped | Characters ask clarifying questions, topic refined |
| **edit-claims** | Document analysis found claims | User clicks "Proceed" | User reviews, edits, or deletes extracted claims |
| **opening** | Clarification complete or skipped | All characters have spoken | Each character states their position grounded in taxonomy |
| **debate** | Openings complete | Convergence detected or round limit | Moderated cross-examination with claim extraction |
| **closed** | Debate phase exits | — | Synthesis statements, QBAF output, diagnostics |

### 6.2 Per-Round Runtime Flow (Debate Phase)

This is the core behavioral loop — what happens each round:

```
 ┌─── Round N ─────────────────────────────────────────────────────┐
 │                                                                  │
 │  1. Select responder                                            │
 │     └─ round-robin, unless moderator PIN overrides              │
 │                                                                  │
 │  2. Build context for responder                                 │
 │     └─ taxonomy nodes, commitments, edge tensions,              │
 │        unanswered claims, intervention brief (if targeted)      │
 │                                                                  │
 │  3. Generate turn (4-stage pipeline)                            │
 │     └─ brief → plan → draft → cite                             │
 │     └─ validate: schema check, coherence, advancement           │
 │     └─ retry up to 2× on validation failure                    │
 │                                                                  │
 │  4. Extract claims from response                                │
 │     └─ 3-6 claims per statement                                │
 │     └─ reject if >70% overlap with existing claims             │
 │     └─ classify: BDI category, base strength, specificity       │
 │     └─ add to argument network with edges                       │
 │                                                                  │
 │  5. Compute convergence signals                                 │
 │     └─ recycling rate, engagement depth, concession tracking,   │
 │        position drift, crux maturity, pragmatic lexicon         │
 │                                                                  │
 │  6. Evaluate moderator intervention                             │
 │     └─ compute health score                                     │
 │     └─ Stage 1 LLM: should we intervene? which move?           │
 │     └─ deterministic validation: budget, cooldown, phase,       │
 │        same-debater, burden cap                                 │
 │     └─ if validated → Stage 2 LLM: generate intervention text  │
 │     └─ update budget, cooldown, burden tracking                 │
 │                                                                  │
 │  7. Evaluate phase transition (adaptive mode only)              │
 │     └─ compute saturation/convergence scores                    │
 │     └─ predicate: stay / transition / force / regress / terminate│
 │                                                                  │
 │  8. Housekeeping                                                │
 │     └─ network GC if nodes > 175                               │
 │     └─ context compression if transcript > 12 entries          │
 │     └─ gap injection (midpoint + responsive every 3-4 rounds)  │
 │     └─ neutral evaluation at checkpoints                        │
 │     └─ crux resolution state machine update                     │
 │                                                                  │
 └──────────────────────────────────────────────────────────────────┘
```

## 7. Key Subsystem: Moderator

The moderator is the most complex subsystem. It operates autonomously — no human input required during a debate — and must balance competing goals: keeping the debate productive without dominating it.

### 7.1 Intervention Taxonomy

Six families of moves, each with a distinct purpose:

| Family | Moves | When Used | Force Level |
|---|---|---|---|
| **Procedural** | REDIRECT, BALANCE, SEQUENCE | Debate wandering off-topic or structurally lopsided | Directive |
| **Elicitation** | PIN, PROBE, CHALLENGE | Arguments too vague, claims unsubstantiated | Interrogative |
| **Repair** | CLARIFY, CHECK, SUMMARIZE | Misunderstanding detected, semantic divergence | Mixed |
| **Reconciliation** | ACKNOWLEDGE, REVOICE | Concession made but not recognized, bridge-building | Declarative |
| **Reflection** | META-REFLECT | Exploration phase only — step back and assess | Reflective |
| **Synthesis** | COMPRESS, COMMIT | Convergence detected, time to consolidate | Declarative |

### 7.2 Budget and Cooldown

The moderator has a finite intervention budget per debate, preventing over-moderation:

**Budget initialization:** `ceil(exploration_rounds / 2.5)`

**Per-move costs** (high-value moves are cheap because they're worth spending budget on):

| Tier | Moves | Cost |
|---|---|---|
| High-value | PIN, PROBE, CHALLENGE, REDIRECT, CLARIFY, CHECK, META-REFLECT | 0.34 |
| Medium | BALANCE, SEQUENCE | 0.67 |
| Routine | SUMMARIZE, ACKNOWLEDGE, REVOICE, COMPRESS | 1.0 |
| Free | COMMIT (synthesis only) | 0.0 |

**Refill mechanism:** When budget exhausts, it doesn't stay empty — it refills with a smaller amount and longer cooldown:

```
Epoch 0:  full budget,        required gap = 1 round
Epoch 1:  budget / 2,         required gap = 2 rounds
Epoch 2:  budget / 3,         required gap = 3 rounds
  ...progressively less frequent but never silent
```

**Design rationale:** Hard budget caps caused the moderator to go permanently silent mid-debate. Empirical testing showed debates degrade when moderation stops entirely — recycling and drift increase. The refill system ensures the moderator can always intervene but at decreasing frequency.

### 7.3 Two-Stage Selection

```
┌──────────────────────────────────┐
│  Stage 1: Selection (LLM)       │
│  Input: transcript, network,    │
│         health score, signals   │
│  Output: intervene? which move? │
│          target debater?        │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Deterministic Validation       │
│  • Budget sufficient?           │
│  • Cooldown elapsed?            │
│  • Move appropriate for phase?  │
│  • Same debater targeted twice? │
│  • Burden cap exceeded?         │
│  • Prerequisite rules (P1-P3)   │
└──────────┬───────────────────────┘
           │ if valid
           ▼
┌──────────────────────────────────┐
│  Stage 2: Generation (LLM)      │
│  Input: selected move + context │
│  Output: intervention text      │
└──────────────────────────────────┘
```

The split is deliberate: Stage 1 lets the LLM assess debate health holistically (it sees the full context), while deterministic validation enforces hard constraints the LLM might ignore (budget, cooldown, fairness). Stage 2 only runs if validation passes.

### 7.4 Prerequisite Graph

Three blocking rules override the LLM's move suggestion:

| Rule | Condition | Override |
|---|---|---|
| **P1** | Concession detected but not acknowledged | Force ACKNOWLEDGE (reconciliation) |
| **P2** | Semantic divergence detected | Force CLARIFY before any elicitation move |
| **P3** | Misunderstanding detected | Force CHECK before CHALLENGE |

These exist because empirical testing showed the LLM moderator would sometimes CHALLENGE a position built on a misunderstanding, escalating rather than repairing.

### 7.5 Debate Health Score

Computed per round from recent convergence signals:

```
engagement    = avg(engagement_depth.ratio) from last 3 turns     × 0.25
novelty       = 1 - avg(recycling_rate.avg_self_overlap)          × 0.25
responsiveness = concessions_made / attack_opportunities           × 0.20
coverage      = cited_taxonomy_nodes / relevant_taxonomy_nodes     × 0.15
balance       = 1 - (max_turns - min_turns) / total_turns         × 0.15
                                                              ─────────
                                                         health (0–1)
```

Consecutive health decline triggers more aggressive moderation; consecutive rise causes the moderator to back off. After any intervention, health trajectory tracking freezes for 1 round to avoid penalizing the moderator for its own disruption.

### 7.6 Semantic Drift Detection

When debating a source document, the moderator monitors for three drift patterns:

1. **Metaphor literalization** — A figure of speech (e.g., "arms race") gets treated as a factual claim about literal weapons
2. **Implementation spiral** — Abstract policy discussion descends into technical implementation details (API design, database schemas)
3. **Scope creep** — Debate drifts from the source document to tangentially related topics

Detection is prompt-based: the source document summary is injected into the moderator's selection prompt with explicit instructions to check for these patterns. When detected, the moderator's `drift_detected` flag triggers a corrective REDIRECT.

## 8. Key Subsystem: Argument Network (QBAF)

The argument network is the debate engine's primary output artifact — a directed graph of claims with support/attack relationships and computed strengths.

### 8.1 Claim Extraction

After each character speaks, an LLM extracts 3–6 claims:

```
Character statement
    │
    ▼
LLM extraction ──► candidate claims (near-verbatim from text)
    │                 each with: BDI type, base strength,
    │                 specificity, relationships to prior claims
    │
    ▼
Overlap check ──► reject if >70% word overlap with existing nodes
    │              reject if >50% overlap with same speaker's prior claims
    │
    ▼
Accepted nodes added to argument_network.nodes[]
Edges added to argument_network.edges[]
```

### 8.2 Node and Edge Structure

Each argument node carries:
- **Identity:** unique ID, text, speaker, round number
- **Classification:** BDI category (belief/desire/intention), specificity (precise/general/abstract)
- **Strength:** base_strength (intrinsic quality), computed_strength (after QBAF propagation)
- **Provenance:** source transcript entry, extraction confidence, taxonomy references

Each edge carries:
- **Relationship:** supports or attacks
- **Attack subtype:** rebut (direct contradiction), undercut (weakens premise), undermine (questions reliability)
- **Argumentation scheme:** Walton-derived labels (ARGUMENT_FROM_EVIDENCE, COUNTEREXAMPLE, etc.)
- **Warrant:** one-sentence justification for the relationship

### 8.3 Strength Computation

QBAF uses gradual semantics — an iterative algorithm where node strength depends on its attackers and supporters:

```
computed_strength(n) = base_strength(n)
                     × (1 − Σ(attack_weight × attacker_strength) / (1 + Σ(attack_weight × attacker_strength)))
                     × (1 + Σ(support_weight × supporter_strength))
```

Strengths are recomputed after each round and stored in `qbaf_timeline[]` for visualization.

### 8.4 Network Garbage Collection

The network grows by 3–6 nodes per round. Unchecked, this bloats prompts and degrades extraction quality. GC runs when nodes exceed 175:

- Rank nodes by: `(computed_strength + taxonomy_relevance) × centrality`
- Prune lowest-ranked until 150 nodes remain
- Hard cap: 200 nodes (never exceeded)
- Cross-POV edges and high-strength nodes are preserved

## 9. Key Subsystem: Phase Transitions

### 9.1 Two Modes

**Fixed-round mode** (legacy, default): Run exactly N rounds. Phase assigned deterministically:
- Rounds 1–2: thesis-antithesis
- Rounds 3 to N−2: exploration
- Final 2: synthesis

**Adaptive mode** (experimental): Phase transitions driven by signal predicates. The engine monitors 6 saturation signals and 4 convergence signals, computing composite scores each round:

```
Saturation score (exploration exit):
  = Σ(signal_weight × signal_value)
  signals: recycling_pressure, crux_maturity, concession_plateau,
           engagement_fatigue, pragmatic_convergence, scheme_stagnation

Convergence score (synthesis exit):
  = Σ(term × factor)
  terms: qbaf_agreement_density, position_stability,
         irreducible_disagreement_ratio, synthesis_pragmatic_signal
```

### 9.2 Adaptive Predicate Logic

Each round, the phase controller evaluates:

```
IF score ≥ threshold AND confidence ≥ floor:
    → transition to next phase
IF score ≥ threshold BUT confidence < floor:
    → veto (stay, lower threshold by 0.10 for next attempt)
IF 3rd consecutive veto OR max_rounds reached:
    → force transition (override veto)
IF synthesis entered but crux unresolved:
    → regress to exploration (max 2 regressions)
IF health score collapsed:
    → terminate debate
```

### 9.3 Pacing Presets

| Preset | Max Rounds | Exploration Exit | Synthesis Exit |
|---|---|---|---|
| Tight | 8 | 0.55 | 0.60 |
| Moderate | 12 | 0.65 | 0.70 |
| Thorough | 15 | 0.80 | 0.80 |

## 10. Key Subsystem: Convergence Signals

Seven per-turn signals tracked after each character speaks:

| Signal | Measures | Why It Matters |
|---|---|---|
| **Recycling rate** | Word overlap + embedding cosine similarity (≥ 0.85) with own prior turns | Detects position saturation — lexical and semantic recycling |
| **Engagement depth** | Ratio of connected vs. isolated claims | Low engagement = talking past each other |
| **Concession tracking** | Did speaker concede after strong attacks? | Missed concessions signal entrenchment |
| **Position drift** | Overlap with own opening statement | High drift may indicate sycophancy; zero drift indicates rigidity |
| **Crux rate** | Crux identification moves used and followed up | Core disagreements found and explored? |
| **Move disposition** | Ratio of confrontational vs. collaborative moves | Debate maturity indicator |
| **Pragmatic lexicon** | Hedge/assertive/concessive language rates | Pure lexicon analysis (no LLM) — detects rhetorical shift |

An eighth signal, **crux resolution**, is tracked via a deterministic state machine (`cruxResolution.ts`): each crux transitions through identified → engaged → one_side_conceded → resolved | irreducible based on QBAF edge polarity and concession events. Crux maturity feeds into the saturation score for phase transitions.

These signals serve dual purposes: the **moderator** uses them to decide when and how to intervene, and the **phase controller** uses them to decide when to transition.

## 11. Document-Grounded Debates

When the debate source is a URL or document:

### 11.1 Pre-Analysis

Before opening statements, the engine analyzes the source document to extract:
- **I-nodes** (information nodes) — individual claims typed as empirical, normative, definitional, assumption, or evidence
- **Tension points** — where the document's own arguments create cross-POV disagreement
- **Claims summary** — 2–3 sentence overview for moderator context

### 11.2 Claims Editing

After extraction, the user can review and edit claims before the debate starts. This is the `edit-claims` phase — displayed only when document analysis produces I-nodes. Users can:
- Edit claim text (propagates to argument network)
- Delete irrelevant claims (cleaned from tension points and network)
- Review tension points

### 11.3 Source Anchoring

The claims summary is injected into moderator prompts throughout the debate, giving the moderator context to detect when characters drift from the source material. Without this anchoring, debates on documents tend to wander into generic AI policy territory by round 4–5.

## 12. Cross-Cutting Concerns

### 12.1 Error Handling

All unrecoverable errors use `ActionableError` with four fields: Goal, Problem, Location, Next Steps. LLM parse failures trigger retry (up to 2 attempts) before falling back to a structured error entry in the transcript. A failed turn never silently drops — it's recorded with its failure mode.

### 12.2 Diagnostics and Observability

Every LLM call is recorded in `session.diagnostics`:
- Full prompt sent
- Raw response received
- Model used, latency
- Extraction trace (what claims were accepted/rejected and why)
- Turn validation trail (pass/retry/flag)

Adaptive staging records signal telemetry per round: all signal values, composite scores, predicate results, and veto/force decisions.

The `Show-DebateDiagnostics` cmdlet and the Diagnostics panel in the Taxonomy Editor let you step through a debate turn-by-turn, inspecting exactly what the engine "saw" at each decision point.

### 12.3 Context Management

LLM context windows are finite. The engine manages this through:
- **Three-tier context compression** (`tieredCompression.ts`): recent (full text, last 8 entries), medium (structural claims + commitments from the argument network — deterministic, no LLM call), distant (LLM summary enriched with structural overlay). Triggered after 12+ transcript entries.
- **Network GC:** Prune argument network when nodes exceed 175 (runs in both fixed-round and adaptive modes)
- **Taxonomy sampling:** Only inject relevant taxonomy nodes (via embedding similarity), not the full ~320-node taxonomy

### 12.4 Temperature Strategy

| Operation | Temperature | Rationale |
|---|---|---|
| Character statements | 0.7 | Variation in rhetoric and argumentation |
| Claim extraction | 0.0 | Deterministic — must reliably parse structure |
| Turn validation (judge) | 0.0 | Deterministic — consistent quality gate |
| Moderator selection | 0.3 | Slight variation in intervention timing |

## 13. Design Decisions and Trade-offs

### D1: Signal-Based Phase Transitions vs. Fixed Rounds

**Chosen:** Both available; fixed is default, adaptive is opt-in.

**Why:** Adaptive staging (6 saturation + 4 convergence signals, confidence deferral, veto/force/regression) adds significant complexity. But fixed rounds have a fundamental flaw: a 12-round debate on a narrow topic wastes 6 rounds recycling, while the same 12 rounds on a rich topic may cut off before key arguments surface. Adaptive mode solves this but needs more empirical calibration (Phase 5 validation ongoing).

**Trade-off accepted:** Maintaining two code paths increases testing burden. We accept this because premature deprecation of fixed mode would break existing workflows.

### D2: Budget Refill vs. Hard Cap

**Chosen:** Refill with escalating cooldown.

**Why:** Hard budget caps caused the moderator to go permanently silent by round 7–8. Empirical observation: debates without moderation in the second half exhibit 2–3× higher recycling rates and lose argument network density. The refill mechanism (epoch-scaled smaller budgets with longer gaps) keeps the moderator available without letting it dominate.

**Alternative considered:** Proportional budget (spend X% per round). Rejected because intervention need is bursty, not uniform — a debate might need 3 interventions in rounds 5–7 and none in rounds 8–12.

### D3: Two-Stage Moderator (LLM Selection + Deterministic Validation)

**Chosen:** Split selection from validation.

**Why:** LLMs are good at holistic debate assessment ("this feels like it's going in circles") but unreliable at constraint enforcement ("I have 0.34 budget remaining and cooldown is 2 rounds"). Deterministic validation catches budget overruns, cooldown violations, and fairness issues that the LLM selection stage ignores ~15% of the time.

**Alternative considered:** Single-stage LLM with constraints in the prompt. Tested and rejected — budget violations occurred in ~12% of interventions despite explicit prompt instructions.

### D4: Claim Overlap Rejection at 70%

**Chosen:** 70% word overlap threshold for rejection.

**Why:** Lower (50%) was too aggressive — legitimate elaborations were rejected. Higher (85%) let too much recycling through. 70% balances redundancy suppression against allowing substantive development of prior claims. Same-speaker overlap uses a stricter 50% threshold because self-repetition is less justifiable than cross-speaker elaboration.

### D5: Per-Layer BDI Confidence Calibration

**Chosen:** Different extraction reliability per BDI layer.

**Why:** Empirical Q-0 calibration showed extraction confidence varies by claim type: Beliefs 0.30 (low — factual claims often misclassified), Desires 0.65 (moderate), Intentions 0.71 (high — action proposals are most distinctive). Using a single confidence threshold would either over-trust Belief extraction or under-trust Intention extraction.

### D6: Prerequisite Graph (P1 > P2 > P3) as Hard Rules

**Chosen:** Deterministic blocking rules, not probabilistic weights.

**Why:** When the moderator CHALLENGEs a position built on a misunderstanding, it escalates conflict rather than repairing it. Empirical testing showed this happened in ~8% of CHALLENGE interventions. P3 (CHECK before CHALLENGE when misunderstanding detected) eliminated this. Hard rules were chosen over soft weights because the failure mode (escalating a misunderstanding) is more costly than the false-positive rate (unnecessary CHECK before valid CHALLENGE).

### D7: COMMIT Automation in Synthesis

**Chosen:** Deterministic first-appearance ordering, not LLM-selected.

**Why:** COMMIT is the highest-stakes move (characters produce final positions). LLM selection introduced ordering bias — later speakers had more context and produced stronger syntheses. Deterministic ordering (first character to speak gets first COMMIT) ensures equal access to synthesis context.

### D8: Dual Runtime Hosts (CLI + Electron)

**Chosen:** Separate orchestration implementations sharing core logic.

**Why:** The CLI engine runs debates as batch processes; the Electron host needs pause/resume, incremental UI updates, and reactive state (Zustand). Sharing a single orchestration loop would require the batch engine to support async interruption, complicating the simpler use case.

**Trade-off accepted:** Logic fixes must be ported to both hosts. This has caused bugs (e.g., moderator PIN not forcing responder in Electron but fixed in CLI). We accept this because the alternative (single async-capable engine) would add complexity to both hosts.

## 14. Risks and Open Questions

| Risk | Impact | Mitigation |
|---|---|---|
| **Adaptive staging undertested** | Premature transitions or missed convergence | Phase 5 validation in progress; fixed mode remains default |
| **LLM extraction quality varies by backend** | Claim extraction degrades on smaller models | Extraction confidence tracking; model-specific thresholds planned |
| **Dual-host sync** | Fixes applied to one host but not the other | Manual porting discipline; considered but not yet built: shared turn executor |
| **QBAF strength computation is simplistic** | Gradual semantics may not capture argument quality | Adequate for structural mapping (non-goal to determine winners); combinator module exists for future refinement |
| **Context compression lossy** | Compressed transcript summaries lose nuance | Three-tier compression (recent/medium/distant) with deterministic structural tier; original entries retained in diagnostics |

## 15. Glossary

| Term | Definition |
|---|---|
| **BDI** | Belief-Desire-Intention — agent architecture from philosophy of mind, used to classify claims |
| **QBAF** | Quantitative Bipolar Argumentation Framework — directed graph with support/attack edges and computed strengths |
| **I-node** | Information node — an individual claim extracted from a source document |
| **Saturation** | When a debate phase has extracted most available arguments (high recycling, low novelty) |
| **Convergence** | When characters' positions are stabilizing and synthesis is productive |
| **Epoch** | Budget refill generation — epoch 0 is initial budget, epoch 1 is first refill, etc. |
| **Crux** | A core disagreement that, if resolved, would change a character's position |
| **Crux resolution** | Deterministic state machine tracking per-crux lifecycle: identified → engaged → one_side_conceded → resolved or irreducible |
| **PIN** | Moderator move: direct a specific character to respond to a specific claim |
| **COMMIT** | Moderator move: request a character's final synthesis statement |
| **Pacing** | Adaptive staging intensity — tight (fast debates), moderate, or thorough |
| **Health score** | Composite metric (0–1) measuring debate quality across engagement, novelty, responsiveness, coverage, and balance |
| **SLI** | Service Level Indicator — minimum health component thresholds that trigger moderator intervention |
