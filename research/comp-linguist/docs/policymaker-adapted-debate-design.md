# Policymaker-Adapted Debate Pipeline — Design Document

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-27
**Ticket:** t/246
**Status:** Design proposal — pending approval

---

## The Cognitive Model

Policymakers think about outcomes, power, and incentives — rarely about pure theory or abstract mechanics. Their information processing operates through three layers:

### Layer 1: Operational Archetypes

| Archetype | How They Read a Debate | What They Extract |
|-----------|----------------------|-------------------|
| **Validation Seeker** | Scans for data that confirms a pre-existing narrative | Quotable statistics, named precedents, authority citations |
| **Firefighter** | Filters for immediate crisis relevance | Failure scenarios, liability triggers, "what could go wrong tomorrow" |
| **Orchestrator** | Looks for coalition math and implementation pathways | Stakeholder alignment, enforcement mechanisms, political feasibility |

### Layer 2: Motivated Reasoning Filters

| Filter | Effect on Debate Consumption |
|--------|------------------------------|
| **Political Congeniality** | Evidence supporting their platform gets amplified; inconvenient evidence gets "noted" but deprioritized |
| **Electoral Impact** | Arguments with clear constituent implications get more weight than technically superior ones |
| **Formative Experience** | Historical analogies from their career era dominate their mental models (e.g., "this is like the dot-com bubble", "this is like nuclear proliferation") |

### Layer 3: Substance vs. Signal

Policymakers ask: *"What is the problem we are trying to solve, who wins, and who pays?"*

If a technically correct argument cannot be translated into a clear choice with a predictable political outcome, **it is invisible to them.**

---

## Current System: What Already Changes for Policymakers

| Component | Current Adaptation | Assessment |
|-----------|-------------------|------------|
| `readingLevel` | "Write for a policy reporter or congressional staffer" | Good — sets tone |
| `detailInstruction` | "Frame arguments in terms of implementability, enforcement mechanisms, and political feasibility" | Good — directs content |
| `moderatorBias` | "Steer toward actionable policy disagreements" | Good but shallow — doesn't reshape the debate structure |
| `styleReinforcement` | "Every sentence must be quotable by a reporter" | Good stylistic guard |
| News report persona | Revised in t/245 — now "senior policy journalist" | Good — addresses the output |

**What's missing:** All current adaptations are **prompt-text adjustments** — they change how the debaters *talk* but not how the debate *thinks*. The topic framing, claim extraction, situation injection, QBAF evaluation, phase transitions, and synthesis are all audience-agnostic. For policymakers, this is a significant gap.

---

## Proposed Adaptations by Pipeline Stage

### 1. Topic Framing & Wisdom Scoring

**Current:** Topic wisdom scoring evaluates crux density, evidence coverage, BDI heterogeneity, abstraction level, and situation activation — all audience-agnostic.

**Policymaker adaptation:**

Add a **political operationality** dimension to the wisdom score when `audience === 'policymakers'`:

| Criterion | Weight | What It Measures |
|-----------|:------:|------------------|
| **Actor specificity** | 0.20 | Does the topic name specific actors (agencies, companies, legislatures) or only abstract categories ("stakeholders")? |
| **Decision proximity** | 0.20 | Is there a pending legislative/regulatory action this debate could inform, or is it purely theoretical? |
| **Constituency impact** | 0.15 | Can the outcome be traced to identifiable voter/donor groups? |

The topic refinement prompt should add: *"For a policymaker audience, ensure the topic names specific institutional actors, references a concrete regulatory or legislative context, and identifies which constituencies are affected."*

**Cognitive model mapping:** Addresses **Substance vs. Signal** — if the topic can't answer "who wins, who pays?" it needs reframing.

### 2. Debater Persona Behavior

**Current:** Debater personalities are fixed (Prometheus = confident/forward-looking, Sentinel = methodical/evidence-driven, Cassandra = wry/pragmatic). The `readingLevel` and `detailInstruction` adjust their language but not their argumentation strategy.

**Policymaker adaptation:**

Inject a **policymaker framing instruction** into each debater's system prompt when `audience === 'policymakers'`:

```
POLICYMAKER AUDIENCE FRAMING:
Your audience consists of senior policymakers. They think in terms of
outcomes, power, and incentives — not theory or mechanics. For every
argument you make:
- Name WHO benefits and WHO bears the cost
- Identify the ENFORCEMENT MECHANISM (who enforces, with what authority)
- State the POLITICAL FEASIBILITY (what coalition supports this, what
  coalition opposes it)
- Provide a HISTORICAL PRECEDENT the audience will recognize (existing
  legislation, past regulatory action, analogous industry)
- If your argument requires technical understanding, translate the
  technical fact into a POLITICAL CONSEQUENCE in the same sentence

Do not assume your audience will follow a chain of reasoning from
technical premise to policy conclusion. State the conclusion first,
then justify it.
```

**Where to inject:** In the `debateResponsePrompt` and `draftOpeningStagePrompt`, after the existing `readingLevel` and `detailInstruction` blocks. Conditional on `audience === 'policymakers'`.

**Cognitive model mapping:** Addresses all three layers — gives Validation Seekers quotable precedents, Firefighters enforcement mechanisms, and Orchestrators coalition math.

### 3. Claim Extraction

**Current:** Claims are extracted with `bdi_category`, `base_strength`, `disagreement_type`, and `argumentation_scheme` — all audience-agnostic.

**Policymaker adaptation:**

Add a **political salience** field to the extraction schema when `audience === 'policymakers'`:

```typescript
// Addition to extraction prompt for policymaker debates
"political_salience": "high" | "medium" | "low"
// high = directly affects a pending decision, named constituency, or budget line
// medium = relevant to governance but not immediately actionable
// low = technically important but politically invisible
```

This field feeds into two downstream uses:
1. **QBAF strength modifier:** Claims with `political_salience: "high"` get a +0.10 boost to `base_strength` in policymaker debates. This doesn't mean they're more *true* — it means they're more *relevant to this audience's decision context*.
2. **Synthesis weighting:** The synthesis prompt should prioritize high-salience claims when building the policy lever assessment.

**Cognitive model mapping:** Addresses **Substance vs. Signal** — technically excellent claims that are "politically invisible" get deprioritized for this audience, reflecting how policymakers actually filter information.

### 4. Situation Injection

**Current:** Situations are selected by embedding similarity to the debate topic and AN claims. No audience awareness.

**Policymaker adaptation:**

When `audience === 'policymakers'`, boost situation nodes that have:
- **Institutional/regulatory framing** — situations involving governance structures, enforcement bodies, legislative proposals
- **Multi-stakeholder friction** — situations where multiple actors (developers, integrators, regulators, public) have conflicting interests
- **Historical regulatory precedent** — situations that parallel existing governance frameworks (nuclear, pharma, financial regulation)

Implementation: Add a `policymaker_relevance_boost` to `selectRelevantSituationNodes` that applies a +0.10 bonus to situations whose descriptions contain institutional/regulatory keywords. This is simpler than a full embedding approach and directly targets the "who governs, who enforces" framing policymakers need.

**Cognitive model mapping:** Addresses **Orchestrator** archetype — these policymakers need institutional context to evaluate whether a proposal can survive implementation.

### 5. Phase Transitions & Moderator Behavior

**Current:** The moderator's `moderatorBias` is already set to "Steer toward actionable policy disagreements." But the phase transition signals (saturation, convergence) are audience-agnostic.

**Policymaker adaptation:**

**Moderator interventions** should include a policymaker-specific move: **IMPLEMENTATION CHALLENGE**

When the debate has been in argumentation for 3+ rounds and the moderator detects high `pragmatic_convergence` but low `operationality` in cited Intention nodes, inject:

```
MODERATOR: The debaters have been discussing principles and frameworks.
A policymaker needs to know: Who writes the regulation? Which agency
enforces it? What's the budget? What happens when the first company
challenges it in court? Direct the next speaker to address implementation.
```

This is a new moderator move type, not a replacement for existing ones. It fires when the debate is drifting into abstract consensus without touching the enforcement/implementation layer that policymakers actually decide on.

**Cognitive model mapping:** Addresses **Firefighter** and **Orchestrator** — forces the debate toward the "boots-on-the-ground" layer.

### 6. Synthesis & Preference Resolution

**Current:** The synthesis prompt evaluates claim conflicts using criteria: empirical_evidence, logical_validity, source_authority, specificity, scope. Audience-agnostic.

**Policymaker adaptation:**

Add two synthesis criteria for policymaker debates:

| Criterion | What It Evaluates |
|-----------|------------------|
| **political_feasibility** | Can this position survive a legislative process? Does it have a coalition? |
| **implementation_specificity** | Does this position name the enforcement mechanism, timeline, and responsible agency? |

When `audience === 'policymakers'`, the synthesis prompt should include:

```
Additional criteria for policymaker audience:
e. "political_feasibility" — which position is more likely to survive
   a legislative process and achieve enforcement?
f. "implementation_specificity" — which position names concrete
   enforcement mechanisms, timelines, and responsible institutions?

Weight these criteria equally with the existing five when the target
audience is policymakers. A technically superior position that cannot
be implemented is less valuable to this audience than a feasible one.
```

**Cognitive model mapping:** Directly addresses **Substance vs. Signal** — without feasibility and implementation criteria, the synthesis produces recommendations a policymaker literally cannot act on.

### 7. News Report (Already Partially Addressed)

**Current:** Revised in t/245 — persona, framing, collision, outcome all improved. Policymaker delta exists.

**Additional policymaker adaptation:**

Add to the policymaker audience delta:

```
- THE FRAMING: Include a "DECISION CONTEXT" paragraph that names the
  specific pending legislative, regulatory, or executive action this
  debate informs. If none exists, name the most analogous recent action.
- THE COLLISION: For each position, state explicitly: who benefits,
  who bears the cost, and which existing institution would enforce it.
- THE OUTCOME: Every recommended "policy lever" must name: the specific
  actor who would pull it, the legal authority they would invoke, and
  the constituency that would support or oppose it.
```

### 8. Challenge View (t/242)

**Policymaker-specific provocations:**

| Category | Agree Mode | Disagree Mode |
|----------|------------|---------------|
| **Constituency** | "Which voter bloc benefits from this position? Who loses?" | "Which constituency supports this position, and why might their interests be legitimate even if you disagree?" |
| **Enforcement** | "Who enforces this? What happens when the first company resists?" | "Is there an enforcement mechanism that could make this work despite your objections?" |
| **Precedent** | "What's the closest historical precedent? Did it work?" | "Has a similar approach worked in another domain (pharma, nuclear, financial)?" |
| **Coalition** | "What's the minimum coalition needed to pass this? Is it achievable?" | "What coalition could form around this position that you wouldn't expect?" |

---

## Implementation Priority

| Phase | Change | Effort | Impact |
|-------|--------|--------|--------|
| 1 | Debater persona framing instruction (§2) | Low — prompt text addition | High — changes every turn |
| 2 | Synthesis criteria: feasibility + implementation (§6) | Low — prompt text addition | High — changes conclusions |
| 3 | News report additions (§7) | Low — already have the delta structure | Medium — improves output |
| 4 | Moderator IMPLEMENTATION CHALLENGE move (§5) | Medium — new move type | High — forces actionable debate |
| 5 | Political salience in extraction (§3) | Medium — schema change + QBAF modifier | Medium — better claim prioritization |
| 6 | Topic wisdom: political operationality (§1) | Medium — new scoring dimension | Medium — better topic selection |
| 7 | Situation injection boost (§4) | Low — keyword matching | Low-Medium — marginal improvement |
| 8 | Challenge view provocations (§8) | Low — template additions | Medium — reader engagement |

---

## Design Principles

1. **Policymaker adaptations change the debate's *focus*, not its *rigor*.** The three-agent structure, QBAF evaluation, and evidence-based scoring remain unchanged. What changes is which dimensions get emphasized — feasibility, enforcement, and constituency impact move from background to foreground.

2. **The archetypes are reading modes, not user profiles.** We don't ask the user "are you a Validation Seeker or an Orchestrator?" — we design the output so that all three archetypes find what they need. Validation Seekers find quotable precedents. Firefighters find failure scenarios. Orchestrators find coalition math.

3. **Motivated reasoning is the reader's problem, not ours.** We don't try to counteract political congeniality or electoral filtering — that's patronizing. We ensure that the debate produces material that is *useful even when filtered* through political lenses. If a senator only reads the parts that support their position, those parts should still be substantively correct and implementationally specific.

4. **"Who wins, who pays?" is not cynicism — it's the operating language.** Translating technical claims into power/incentive terms is not dumbing them down. It's making them legible to people who allocate resources and write laws. A debate that can't answer "who enforces this?" has not finished its work.
