# Dialectical Protocol Stack: Review and Application to AI Triad Debate Engine

**Author:** Computational Linguist
**Date:** 2026-05-21
**Status:** Working document

## 1. The Proposed Stack

The proposal describes a 4-layer protocol stack for translating human rhetorical structures into machine-executable argumentation logic:

```
+-----------------------------------------------------------+
| 4. Strategy & Pragmatics Layer (Game Theory / Incentives) |
+-----------------------------------------------------------+
| 3. Illocutionary / Protocol Layer (AIF+ / Agent Comm.)    |
+-----------------------------------------------------------+
| 2. Logical / Dialectical Layer (Abstract Argumentation)   |
+-----------------------------------------------------------+
| 1. Semantic / Extraction Layer (NLP / LLM Parsing)        |
+-----------------------------------------------------------+
```

This document reviews the stack against our existing debate engine, identifies where we already implement each layer, and maps potential usage scenarios.

## 2. What We Already Have

The AI Triad debate engine already implements substantial machinery at all four layers, though the nomenclature differs.

### Layer 1: Semantic / Extraction

**Proposed:** LLM-based parsing of natural language into structured argumentative primitives using AIF schemas.

**What we have:**
- **Claim extraction** (`turnPipeline.ts`, `turnValidator.ts`) -- Every debate turn is parsed into discrete claims with `claim_id`, speaker attribution, BDI category, and taxonomy node references.
- **AIF-adjacent vocabulary** -- 8 canonical edge types (SUPPORTS, CONTRADICTS, ASSUMES, WEAKENS, RESPONDS_TO, TENSION_WITH, INTERPRETS, CONVERGES_WITH) with typed attack subtypes (rebut/undercut/undermine).
- **Move annotation** -- 10-move dialectical catalog (DISTINGUISH, COUNTEREXAMPLE, CONCEDE-AND-PIVOT, REFRAME, EMPIRICAL CHALLENGE, EXTEND, UNDERCUT, SPECIFY, INTEGRATE, BURDEN-SHIFT).
- **Domain vocabulary injection** (`evidenceQbaf.ts`) -- Classification prompts receive standardized term definitions, reducing linguistic ambiguity.

**Gap:** No JSON-LD or formal AIF-RDF. JSON with AIF-inspired vocabulary is intentional -- "vocabulary over formalism" per AGENTS.md.

### Layer 2: Logical / Dialectical

**Proposed:** Dung’s Abstract Argumentation Frameworks (AAF) or Preferred/Grounded Extension algorithms.

**What we have:**
- **QBAF engine** (`qbaf.ts`) -- Full DF-QuAD implementation. Goes beyond Dung’s binary AAF: arguments carry base strengths in [0,1], edges carry weights, iterative convergence with configurable aggregation.
- **Evidence QBAF** (`evidenceQbaf.ts`) -- Classifies evidence as support/contradict/irrelevant and builds evidence sub-graphs feeding into claim strength computation.
- **Argument network** (`argumentNetwork.ts`) -- Full directed graph of claims and relations. QBAF strengths recomputed as new claims enter.
- **Dialectic traces** (`dialecticTrace.ts`) -- Human-readable argument chains (assertion, attack, defense, defeat) explaining why a position prevailed. Cites Loui (1995).

**Gap:** No Dung extensions (preferred, grounded, stable). QBAF gradual semantics is more expressive for our use case -- continuous strength scores, not binary acceptability sets.

### Layer 3: Illocutionary / Protocol

**Proposed:** Dialogue game protocols governing valid moves, turn order, and structural fairness (FIPA-ACL, Mackenzie DC, Walton-Krabbe).

**What we have:**
- **Debate protocols** (`protocols.ts`) -- Three declarative protocol definitions (Structured, Socratic, Deliberation) with per-phase actions, progression rules, and default round counts.
- **Phase transitions** (`phaseTransitions.ts`) -- Signal-based state machine with weighted predicates. Transitions triggered by convergence signals, saturation metrics, and budget constraints.
- **Moderator orchestration** (`moderator.ts`, `orchestration.ts`) -- Selects speakers, detects drift, issues interventions (REDIRECT, CLARIFY, REFRAME), enforces topic adherence.
- **Turn validation** (`turnValidator.ts`) -- Hybrid PRM with 9 deterministic structural rules plus optional neural quality assessment. Invalid turns rejected with repair hints.
- **Concession tracking** (`concessionTracker.ts`) -- Monitors concession honoring, preventing silent retraction.

**Gap:** No FIPA-ACL message envelopes. Protocol rules enforced through prompt construction. LLM agents do not need formal ACL headers.

### Layer 4: Strategy & Pragmatics

**Proposed:** BDI + game-theoretic reward functions driving optimal move selection.

**What we have:**
- **BDI architecture** -- Each debater has Beliefs (empirical grounding), Desires (normative commitments), Intentions (argumentative strategies). Turn validation checks BDI grounding.
- **Process Reward Model** (`processReward.ts`) -- Continuous [0,1] per-turn score: engagement (0.25), novelty (0.25), consistency (0.20), grounding (0.15), move quality (0.15).
- **Convergence signals** (`convergenceSignals.ts`) -- Move disposition, engagement depth, semantic recycling, ARCO drift, clause engagement.
- **Calibration optimization** (`calibrationOptimizer.ts`) -- Self-adjusting parameters with safety rails (minimum 5 debates between adjustments).

**Gap:** No Nash Equilibria or formal game-theoretic solution concepts. Process reward evaluates post-hoc rather than guiding move selection prospectively.

## 3. The Cooperative vs. Adversarial Question

The proposal correctly identifies the fundamental design tension:

> Are you engineering this protocol assuming cooperative agents searching for objective truth, or adversarial agents managing zero-sum resource allocation?

**Our answer: structured cooperation with adversarial stress-testing.**

The debate engine is designed for cooperative truth-seeking -- three perspectives examining AI policy to surface genuine disagreements and find convergence. We engineer adversarial robustness for two reasons:

1. **Character fidelity.** Prometheus, Sentinel, and Cassandra hold genuinely opposing positions. The engine must prevent degenerate cooperation (everyone agrees too easily) and degenerate adversarialism (everyone talks past each other).

2. **Calibration integrity.** If agents exploit protocol loopholes (silent retraction, semantic recycling, off-topic drift), calibration metrics become unreliable. The turn validator, concession tracker, and moderator maintain measurement integrity.

**We need Layer 3 fortification against laziness and drift, not strategic exploitation.** The process reward penalizes these behaviors through quality scores, not access control or economic penalties.

## 4. Potential Usages

### 4.1 Policy Literature Analysis (Current Primary Use)

Three AI agents debate a source document from opposing perspectives, producing argument networks, convergence points, disagreement taxonomies, and dialectic traces. A single researcher gets structured multi-perspective analysis with computed claim strengths, identified cruxes, and traceable reasoning chains.

### 4.2 Socratic Deep-Dive (Newly Enabled)

A single debater interrogated by the user, with the moderator probing for contradictions. The QBAF engine reveals intra-perspective contradictions -- when a single agent’s claims attack each other -- which is harder to surface in multi-agent debates.

### 4.3 Deliberative Consensus Building

All participants seek agreement. Layer 4 reward functions reweighted toward collaborative moves and convergence. Produces output emphasizing shared ground rather than divergence.

### 4.4 Document Triage and Quality Assessment

Run lightweight debates (1-2 rounds) on document batches. Documents producing flat, low-engagement debates are not contentious enough for deep analysis. Prioritization at scale: find the 30 papers with genuine tension out of 200.

### 4.5 Argument Quality Auditing

Submit a draft policy brief for three-perspective stress-testing. Dialectic traces identify which claims survive cross-examination. Pre-publication vulnerability analysis with a roadmap for strengthening.

### 4.6 Calibration-Driven Prompt Engineering

A/B test prompt variants by running the same document through the engine and comparing calibration metrics (crux_addressed_rate, repetition_rate, convergence_score). Empirical prompt optimization with quantitative metrics.

### 4.7 Taxonomy Gap Discovery

Run debates at taxonomy edges. Low grounding scores reveal coverage gaps. The QBAF layer shows whether ungrounded claims are structurally important (high strength, many edges). Systematic taxonomy expansion driven by debate data.

### 4.8 Teaching and Demonstration

Interactive teaching tool where AI perspectives have formal argumentation structure, traceable claims, and computed argument strengths. The dialectic trace explains *why* a position prevailed, not just *that* it did.

## 5. Extensions the Stack Suggests

### 5.1 Prospective Move Selection (Layer 4 Enhancement)

Generate N candidate responses per turn, score with PRM, select the best. The turn pipeline already supports retry with repair hints -- extending to N-candidate ranking is architecturally similar. **Effort:** Medium.

### 5.2 Formal Extension Computation (Layer 2 Enhancement)

Add Dung extension computation (preferred, grounded, stable) on the existing argument network. Enables queries like "What is the maximally consistent position?" and "What are all defensible positions?" **Effort:** Low-medium.

### 5.3 Inter-Debate Learning (Layer 4 Enhancement)

Agent-specific strategy profiles that evolve across debates. Approaches opponent modeling from game theory. Risk of overfitting to opponent patterns rather than truth-seeking. **Effort:** High.

## 6. What We Should Not Build

- **FIPA-ACL message envelopes.** Formalism without function -- prompt construction already enforces protocol rules.
- **OWL/RDF export.** Vocabulary over formalism. No external argumentation system integration is planned.
- **Nash Equilibrium computation.** Misleading in cooperative truth-seeking. Agents should seek strongest collective understanding.
- **Adversarial robustness beyond drift detection.** Our agents are LLMs following prompts, not autonomous economic actors.

## 7. Summary

| Stack Layer | Proposed Technology | AI Triad Implementation |
|---|---|---|
| 1. Semantic/Extraction | AIF + LLM parsing | Claim extraction, move annotation, domain vocabulary injection |
| 2. Logical/Dialectical | Dung AAF, extensions | QBAF (DF-QuAD), evidence QBAF, argument network, dialectic traces |
| 3. Illocutionary/Protocol | FIPA-ACL, dialogue games | Debate protocols, phase transitions, moderator orchestration, turn validation |
| 4. Strategy/Pragmatics | BDI + game theory | BDI taxonomy, process reward model, convergence signals, calibration optimization |

The primary design decision -- cooperative truth-seeking with robustness against drift -- is already embedded in the architecture. Extensions toward prospective move selection (5.1) and formal extension computation (5.2) are the highest-value additions the stack framework suggests.