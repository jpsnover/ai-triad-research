# Design: Topic-Alignment Enforcement Across the Debate Turn Pipeline

**Author:** Computational Linguist  
**Date:** 2026-06-02  
**Ticket:** t/335  
**Evidence debate:** `debate-ad8379a1` (user specified "low risk consumer product with no agentic or other AI features"; Safetyist cited Knight Capital $440M and Boeing 737 MAX 346 deaths)

---

## 0. Pipeline Audit Summary

Every stage was audited for topic-alignment enforcement. The result: **none exists.**

| Stage | Topic Input | Topic Validated? | Gap |
|---|---|---|---|
| **Topic Critique** | Raw topic string | Pre-debate wisdom score (0-20) | Scores topic quality, not debater adherence |
| **Brief** | `"${input.topic}"` in prompt | No | Brief plan not checked against topic constraints |
| **Plan** | Via brief (indirect) | No | Plan target nodes not filtered by topic domain |
| **Evidence** | Deterministic | N/A | Retrieves whatever plan requests |
| **Draft** | Via taxonomy context (indirect) | No | Draft quality gate checks grounding, falsifiability, engagement — not topic alignment |
| **Draft Pre-Check** | Via draft text | No | Checks engagement, quotability, relevance to focus point — not topic scope |
| **Cite** | Via citation bank | No | Verifies source existence, not topic fit |
| **Claim Extraction** | None | No | Claims extracted without any reference to debate topic |
| **Taxonomy Selection** | Topic as embedding query | Indirect only | Semantic similarity is the sole signal; no constraint filtering |
| **Moderator** | Topic anchoring block + drift detection | Partial | Detects metaphor literalization, implementation spiral, scope creep — but NOT risk-level mismatch or domain mismatch |
| **Phase Transitions** | topic_coherence signal (8% weight) | Weak | Measures embedding similarity to crux centroid; no constraint checking |

The topic is treated as a **query generator** (for embedding similarity scoring), never as a **constraint enforcer**. A debater can cite catastrophic examples in a low-risk debate, and no stage in the pipeline will catch it.

---

## 1. Topic Constraint Extraction and Representation

**Investigation area:** #1 (foundation — all other mechanisms depend on this)

### Problem

The topic is a raw string. Downstream stages cannot programmatically check whether a statement stays within the topic's scope — its relevant disciplines, acceptable evidence types, or off-scope adjacent topics. This applies to ALL debates, not just those with explicit user qualifiers. A debate about "physical limits halting AI scaling" can drift into alignment philosophy or labor displacement just as easily as the MVP debate drifted into Knight Capital.

### Proposed mechanism

Add a one-time extraction step after topic critique and before the first turn. An LLM call parses the topic string into a structured `TopicScope` object:

```typescript
interface TopicScope {
  // Core definition (populated for EVERY topic via LLM inference)
  core_proposition: string;           // The specific claim/question being debated
  relevant_disciplines: string[];     // Domains from which evidence should be drawn
  on_scope_evidence: string[];        // Types of facts/data/examples that are relevant
  key_tensions: string[];             // The 2-4 central disagreements to resolve
  off_scope_topics: string[];         // Adjacent subjects debaters will drift toward
  drift_signatures: string[];         // Specific argument patterns that signal drift
  example_ceiling: string;            // Max severity/type of on-scope examples

  // User-specified constraints (populated when user states them explicitly)
  risk_level: 'low' | 'medium' | 'high' | 'catastrophic' | 'unspecified';
  domain: string;
  product_type: string | null;
  time_horizon: string | null;
  excluded_scenarios: string[];
  explicit_qualifiers: string[];

  // Metadata
  constraint_confidence: 'explicit' | 'inferred';
}
```

The first 7 fields are populated for every topic — abstract policy topics, philosophical propositions, and applied product topics alike. The user-constraint fields provide additional enforcement for the ~6% of topics where users state explicit qualifiers. See `topic-constraints-schema-evaluation.md` (v2) for worked examples on all 20 precanned topics demonstrating 100% coverage.

### Token cost

~800-1200 tokens (single LLM call, one-time per debate). Negligible relative to debate token budgets (500K-1M+).

### Risk assessment

- **Over-constraining:** If the LLM infers overly narrow scope (e.g., marking labor displacement as off-scope for a topic where it's tangentially relevant), downstream stages will over-reject valid arguments. **Mitigation:** Enforcement uses "clear violation" threshold — brief analogies from adjacent topics are allowed; sustained off-scope framing is not. The `constraint_confidence: 'inferred'` flag enables softer enforcement (warn) versus `'explicit'` (block).
- **Extraction quality:** The schema is only as good as the extraction prompt. Generic output ("relevant: AI, technology, society") renders downstream mechanisms toothless. **Mitigation:** The extraction prompt must include 3-4 worked examples and a validation criterion: every topic produces ≥3 `off_scope_topics` and ≥2 `drift_signatures`. CL reviews extraction quality on all 20 precanned topics before merge.

### Store location

`DebateSession.topic.scope: TopicScope | null`. Null when topic critique is skipped or extraction fails (graceful degradation — pipeline runs as today).

---

## 2. Draft Quality Gate: Topic-Alignment Dimension

**Investigation area:** #3

### Problem

The draft quality pre-check (`draftQualityCheckPrompt()` in `prompts.ts`) evaluates three dimensions — grounding, falsifiability, opponent engagement — but not whether the statement stays within the debate's stated scope. The motivating example (Knight Capital in a low-risk consumer product debate) would pass all three existing checks.

### Proposed mechanism

Add a fourth dimension to the existing draft quality check:

```typescript
interface DraftQualityResult {
  grounded: boolean;
  falsifiable: boolean;
  engages: boolean;
  topic_aligned: boolean;     // NEW
  weaknesses: string[];
}
```

The quality check prompt receives `TopicScope.on_scope_evidence`, `off_scope_topics`, `example_ceiling`, and `explicit_qualifiers` as context. The alignment question:

> Does this statement stay within the debate's stated scope? Specifically: are the examples, analogies, and evidence drawn from the same risk level and domain as stated in the topic? A statement about a low-risk consumer product that cites catastrophic infrastructure failures or loss-of-life incidents is NOT aligned. A statement that uses a higher-risk analogy briefly to illuminate a principle, then returns to on-scope examples, IS aligned if the analogy is clearly marked as illustrative.

The threshold is **clear violation**, not **arguably tangential**. Creative cross-domain analogies are allowed if the debater signals them as analogies. Sustained off-domain framing (multiple paragraphs of catastrophic examples in a low-risk debate) fails.

### On failure

When `topic_aligned: false`, the draft stage retries with a repair hint:

```
REPAIR: Your statement uses examples from a different risk/domain category than the debate topic.
The topic specifies: [example_ceiling]. Rewrite using examples at that severity level.
Keep your argument structure — just change the evidence.
```

This is consistent with the existing repair-hint pattern for other quality gate failures.

### Token cost

~50 additional tokens in the quality check prompt (marginal, piggybacked on existing LLM call). ~0 additional calls if the check passes. ~1 additional draft retry if it fails (same cost as existing quality gate failures).

### Risk assessment

- **Over-constraining:** A strict alignment check could suppress legitimate "argument by analogy" where a debater references a higher-risk scenario to make a structural point. **Mitigation:** The prompt explicitly allows brief illustrative analogies. Only sustained off-domain framing fails. The repair hint asks the debater to keep the argument structure and change the evidence — preserving the logical point while fixing the severity mismatch.
- **False negatives:** A debater could frame catastrophic examples using neutral language that doesn't trigger the check. **Mitigation:** This is acceptable. The goal is to catch obvious mismatches (Knight Capital in a consumer product debate), not to police subtle framing.

### Interaction with existing gates

This check runs inside the existing `draftQualityCheckPrompt()` LLM call — no additional API call. It interacts with the grounding check: a statement can be well-grounded (cites real sources) but topic-misaligned (sources are from the wrong domain). These are orthogonal dimensions that should be checked independently.

---

## 3. Taxonomy Selection: Constraint-Aware Filtering

**Investigation area:** #5

### Problem

`selectRelevantNodes()` scores nodes purely on semantic similarity to the topic+transcript query. A node about "catastrophic AI failure modes" will score high in any AI debate, even one explicitly scoped to "low risk consumer products." The current system's only hard constraint is a similarity threshold (0.48 embedding / 0.22 lexical) and a minimum-per-category guarantee (3 nodes per BDI category). There is no domain or risk-level filter.

### Proposed mechanism: Post-selection constraint filter

After `selectRelevantNodes()` returns its scored candidates and before `formatTaxonomyContext()` renders them, apply a deterministic constraint filter:

```typescript
function filterByTopicScope(
  nodes: ScoredNode[],
  constraints: TopicScope | null,
  config?: { mode: 'demote' | 'exclude', penaltyFactor: number }
): ScoredNode[]
```

**Mode: `demote` (default, recommended)**

Rather than hard-excluding nodes, apply a penalty factor (default 0.7) to nodes whose descriptions contain risk/domain signals that contradict the stated constraints. This preserves the node as available (the debater *can* reference it) but deprioritizes it below more on-scope nodes.

**Signal detection (deterministic, no LLM call):**

1. **Discipline relevance (positive filter):** Compute embedding similarity between each node description and the `relevant_disciplines` entries. Nodes whose descriptions align with listed disciplines get a boost (1.2x). This is the primary filter — it promotes on-scope nodes rather than just punishing off-scope ones.

2. **Off-scope topic match (negative filter):** Check each node description against `off_scope_topics` entries. Fuzzy match (stemmed keywords + embedding similarity). Nodes strongly matching an off-scope topic get demoted (0.7x penalty).

3. **Risk-level mismatch:** If `risk_level` is `low` or `medium`, scan node descriptions for catastrophic-framing signals: `fatal`, `death`, `killed`, `catastrophic`, `existential`, `collapse`, `mass casualty`, `extinction`. Nodes with 2+ signals get demoted.

4. **Excluded scenario match:** If `excluded_scenarios` is non-empty, check each node description against the exclusion terms. Fuzzy match (stemmed keywords). Nodes matching any exclusion get demoted.

**Why demote, not exclude:** Hard exclusion risks removing structurally important nodes that happen to use off-scope language. A safety node that says "catastrophic failure modes" might be about software bugs, not loss of life. Demotion reduces their prominence in the formatted context without eliminating them — the debater sees them but is drawn to more on-scope nodes first.

### Token cost

Zero additional tokens. This is a deterministic filter on already-computed scores. The optional embedding similarity check uses the existing embedding infrastructure.

### Risk assessment

- **Over-constraining:** Keyword-based catastrophic detection is crude. A node about "the catastrophic UX failure of Windows Vista" would be flagged in a low-risk consumer debate, even though it's perfectly on-scope. **Mitigation:** Use `demote` mode, not `exclude`. The node stays available at reduced priority. The 2-signal threshold (must contain 2+ catastrophic keywords) reduces false positives.
- **Under-constraining:** The filter is purely lexical. A node could describe catastrophic outcomes using euphemistic language and pass the filter. **Mitigation:** This layer is defense-in-depth. The draft quality gate (Mechanism 2) catches what the filter misses.

### Interaction with existing selection

This filter runs AFTER `selectRelevantNodes()` and BEFORE `formatTaxonomyContext()`. It does not modify the scoring logic — it post-processes the results. The lineage boost, policymaker boost, and crux-based re-scoring all apply first. The constraint filter is the last filter in the chain, operating on final scores.

The min-per-category guarantee (3 nodes per BDI) is respected: if demotion drops a category below minimum, the top-scoring demoted nodes are restored to meet the floor. This prevents constraint filtering from starving a BDI category.

---

## 4. Moderator Drift Detection: Risk-Level and Domain Mismatch

**Investigation area:** #6

### Problem

The moderator's SEMANTIC DRIFT DETECTION block (`prompts.ts:3266-3285`) detects three patterns: metaphor literalization, implementation spiral, and scope creep. All three check **source-document coherence** — whether the debater is introducing concepts not in the source material. None check **user-constraint coherence** — whether the debater's examples match the stated risk level, domain, or exclusions.

In the motivating example, Knight Capital and Boeing 737 MAX are real-world examples that could plausibly appear in source material about AI risk. Source-coherence checks would not flag them. But the user explicitly said "low risk consumer product" — the mismatch is against the user's constraints, not the source documents.

### Proposed mechanism

Add two new drift patterns to the moderator's SEMANTIC DRIFT DETECTION block:

```
4. RISK-LEVEL MISMATCH: A debater cites examples, statistics, or case studies from a
   fundamentally different risk category than stated in the topic. The debate topic
   specifies: [example_ceiling]. If a debater repeatedly uses examples at a severity
   level that contradicts this — e.g., citing fatal accidents or billion-dollar losses
   in a debate about consumer product UX — that is a risk-level mismatch.
   Response: Use REDIRECT intervention. Instruct the debater to find evidence at the
   appropriate severity level. Do NOT ban the analogy entirely — if the debater clearly
   marks a high-risk example as illustrative ("To see the principle at a larger scale,
   consider...") and then returns to on-scope evidence, that is acceptable rhetorical
   technique, not drift.

5. DOMAIN MISMATCH: A debater shifts the debate's frame to a different domain than stated.
   [If excluded_scenarios exist:] The topic explicitly excludes: [excluded_scenarios].
   Arguments that assume, depend on, or are primarily supported by these excluded scenarios
   represent domain drift.
   Response: Use CHALLENGE intervention to ask the debater to re-ground their argument
   in the stated domain.
```

These patterns are injected when `TopicScope` is non-null. For topics with explicit user constraints (`constraint_confidence: 'explicit'`), enforcement is strict. For inferred scope (`constraint_confidence: 'inferred'`), the moderator uses softer intervention language. The `drift_signatures` field provides additional topic-specific patterns the moderator can watch for beyond these two general categories.

### Token cost

~100-150 additional tokens in the moderator system prompt. The moderator LLM call already exists; this adds context, not calls.

### Risk assessment

- **Over-constraining:** The moderator might REDIRECT too aggressively, suppressing valid analogies. **Mitigation:** The prompt explicitly allows brief illustrative analogies when clearly marked. The moderator uses REDIRECT (softer) for risk-level mismatch and CHALLENGE (softer still) for domain mismatch — neither is a hard block.
- **Under-constraining:** The moderator only evaluates at turn boundaries, not within a turn. A single turn can contain extensive off-domain framing before the moderator intervenes on the next turn. **Mitigation:** The draft quality gate (Mechanism 2) catches within-turn misalignment. The moderator handles cross-turn drift that accumulates.
- **Moderator overload:** Adding two more drift patterns increases moderator cognitive load. **Mitigation:** These patterns are condition-gated (only injected when constraints exist) and follow the same trigger-response structure as existing patterns. The moderator already handles 3 drift patterns; 5 is within the same complexity class.

### Interaction with existing drift detection

The new patterns complement, not overlap, the existing three:

| Pattern | Checks against | Trigger |
|---|---|---|
| Metaphor literalization | Source document | Figurative → literal shift |
| Implementation spiral | Source document | Policy → engineering shift |
| Scope creep | Source document | Extra-source concepts introduced |
| **Risk-level mismatch** (NEW) | **User constraints** | Examples at wrong severity |
| **Domain mismatch** (NEW) | **User constraints** | Arguments in excluded domain |

The existing patterns anchor to the source document. The new patterns anchor to the user's explicit constraints. These are independent checks — a statement can be source-coherent but constraint-violating (the motivating example), or source-incoherent but constraint-compliant.

---

## 5. Prompt Boundary Placement of User Constraints

**Investigation area:** #8

### Problem

User constraints embedded in the topic string lose salience when injected as part of a long topic block that precedes taxonomy context, transcript history, and character instructions. The topic string for the motivating debate ended with "The product in mind does a low risk consumer product with no agentic or other AI features" — a critical qualifier buried at the end of the input, deep in the mid-prompt zone where attention is lowest (Lost-in-the-Middle effect).

### Proposed mechanism

Extract `TopicScope.core_proposition`, `off_scope_topics`, `example_ceiling`, and `explicit_qualifiers` and place them at two high-attention positions:

**Position 1: Top of character block (primacy zone)**

After `=== YOUR CHARACTER ===` and before the voice spec, inject:

```
=== DEBATE SCOPE ===
This debate is about: [core_proposition]
Draw evidence from: [relevant_disciplines joined]
Stay away from: [off_scope_topics joined]
Example ceiling: [example_ceiling]
[If excluded_scenarios exist:] Explicitly excluded: [excluded_scenarios joined]
```

This is the first thing the model reads after its identity. It primes the constraint before the model encounters taxonomy nodes or transcript history.

**Position 2: End of recap section (recency zone)**

Append to `buildRecapSection()`:

```
Scope reminder: [core_proposition]. Off-scope: [off_scope_topics top 2]. Stay in scope.
```

This costs ~20-30 tokens and reinforces the topic scope at the prompt boundary where attention is highest.

### Token cost

~60-80 additional tokens per debater turn (two placements). For an 18-turn debate: ~1,200 tokens total. Negligible relative to typical debate token budgets (500K-1M+).

### Risk assessment

- **Over-constraining:** Repeated scope reminders could cause the model to over-filter, producing bland statements that avoid any reference to external examples. **Mitigation:** The constraint says "draw examples from this severity level," not "never mention anything outside this domain." It's a positive directive about where to source evidence, not a prohibition.
- **Prompt bloat:** Two additional blocks per turn add to the already-long debater prompt. **Mitigation:** The blocks are short (30-40 tokens each) and placed at structural boundaries where they serve as separators. They replace implicit information (buried in the topic string) with explicit information in high-attention zones — a net improvement in prompt efficiency.

### Interaction with other mechanisms

This is a passive enhancement. It makes `TopicScope` salient to the debater LLM, reducing the load on the draft quality gate (Mechanism 2) and the moderator (Mechanism 4). If the debater sees the constraint clearly, fewer violations reach the quality gate, and fewer reach the moderator. This is the cheapest mechanism and should be implemented first — it may reduce the failure rate enough that the more expensive mechanisms fire rarely.

---

## 6. Areas Not Covered (Deferred)

Three investigation areas are deferred from this design. They are lower priority given the mechanisms above, or require more data before designing.

### Area 2: Brief stage scope validation

The Brief stage generates a debate plan (key claims, examples, framing). Validating the brief against topic constraints would catch bad plans before they cascade to Draft. **Deferred because:** Mechanism 5 (prompt placement) makes constraints visible to the Brief stage LLM, and Mechanism 2 (draft gate) catches any bad plans that leak through. Adding a separate brief validation gate would be a third check on the same constraint — likely redundant until data shows the brief is the primary source of off-scope framing.

### Area 4: Claim extraction topic relevance

`extractClaimsPrompt()` and `classifyClaimsPrompt()` operate without any reference to the debate topic. Adding a topic-relevance signal to extracted claims would let the argument network distinguish on-topic claims from off-topic ones. **Deferred because:** The argument network is a downstream consumer. If Mechanisms 2 and 4 prevent off-topic claims from entering the transcript, the argument network won't encounter them. A topic-relevance signal becomes valuable only if off-topic claims routinely survive both gates — measure first, then decide.

### Area 7: Cross-turn coherence

The `topic_coherence` signal in `phaseTransitions.ts` already measures embedding similarity to the crux centroid. It could be augmented with a constraint-alignment dimension. **Deferred because:** The existing signal (8% weight in saturation) is already active. Augmenting it requires defining what "constraint drift over time" means quantitatively — a research question beyond this design scope. The moderator's expanded drift detection (Mechanism 4) handles the real-time version of this concern.

---

## 7. Token Budget Summary

| Mechanism | When | Per-occurrence | Per-debate (18 turns, 6 mod turns) |
|---|---|---|---|
| 1. Scope extraction | Once, pre-debate | 800-1200 tokens | 1,000 |
| 2. Draft quality gate | Per debater turn | ~50 tokens (marginal) | 900 |
| 3. Taxonomy constraint filter | Per debater turn | 0 tokens (deterministic) | 0 |
| 4. Moderator drift expansion | Per moderator turn | ~120 tokens | 720 |
| 5. Prompt boundary placement | Per debater turn | ~70 tokens | 1,260 |
| **Total** | | | **~3,880 tokens** |

**~3,900 tokens per debate** — approximately 0.4-0.8% of a typical debate's token budget (500K-1M). This is well within acceptable overhead for a cross-cutting quality improvement.

---

## 8. Implementation Order and Dependencies

```
Mechanism 1 (Constraint Extraction)
    ├── Mechanism 5 (Prompt Boundary Placement) ← cheapest, implement first after M1
    ├── Mechanism 2 (Draft Quality Gate)        ← piggybacks on existing LLM call
    ├── Mechanism 3 (Taxonomy Constraint Filter) ← deterministic, no LLM cost
    └── Mechanism 4 (Moderator Drift Expansion)  ← extends existing prompt
```

**Phase 1:** Mechanisms 1 + 5. Extract constraints, place at prompt boundaries. Cheapest intervention, likely catches 60-70% of the motivating problem by making constraints salient.

**Phase 2:** Mechanisms 2 + 3. Add draft quality gate dimension and taxonomy filter. These are defensive layers that catch what prompt placement misses.

**Phase 3:** Mechanism 4. Expand moderator drift detection. This is the corrective layer for cross-turn drift that survives Phases 1-2.

Each phase is independently deployable and testable. Phase 1 alone may be sufficient for most debates — measure before committing to Phases 2-3.

---

## 9. Validation Plan

### Regression test (motivating example)

Re-run debate-ad8379a1's topic ("The product in mind does a low risk consumer product with no agentic or other AI features") with each mechanism enabled incrementally. Measure:

1. Does the Safetyist still cite Knight Capital / Boeing 737 MAX?
2. Are the taxonomy nodes injected appropriate for a low-risk consumer product?
3. Does the moderator detect and redirect risk-level mismatch?
4. Do the debaters produce arguments at the appropriate severity level?

### False positive test

Run 3 debates on genuinely high-risk topics (frontier AI safety, autonomous weapons, financial trading systems) and verify that no mechanism over-constrains. Catastrophic examples should flow freely when the topic warrants them.

### Analogy test

Run 1 debate on a low-risk topic where a debater legitimately uses a high-risk analogy briefly ("To see this principle at scale, consider the Boeing case — but for our consumer product, the equivalent is..."). Verify that the analogy is allowed when clearly marked as illustrative.

---

## 10. Diagnostics UX Integration

Every mechanism in this design produces data that must be surfaced in the diagnostics UI. The principle: if the system is enforcing topic alignment, the user must be able to see what it extracted, what it enforced, and what it caught. Silent enforcement with no observability is a debugging black hole.

### 10.1 Existing Diagnostics Landscape

The debate diagnostics UI (`DiagnosticsPanel.tsx`, `DiagnosticsWindow.tsx`) already surfaces per-entry data in collapsible sections: model/timing, moderator intervention, pipeline stage work products (brief/plan/draft/cite), dialectical moves, extracted claims, QBAF strength, context usage, and full prompt/response. `CalibrationDashboard.tsx` shows longitudinal metrics across debates. `PromptInspector.tsx` shows prompt assembly with live preview.

**What's missing:** No dedicated topic-scope view. No per-turn topic alignment score. No visibility into which taxonomy nodes were demoted or why. Drift detection results are buried in moderator deliberation rather than called out as a first-class diagnostic.

### 10.2 New: Topic Scope Panel (Debate-Level)

**Where:** New collapsible section in `DiagnosticsPanel.tsx`, positioned FIRST — before Model & Timing. This is debate-level context that frames everything else.

**What it shows:**

```
┌─ Topic Scope ─────────────────────────────────────────────────┐
│ Core Proposition: Whether physical infrastructure limits      │
│   will halt AI scaling before algorithmic breakthroughs...    │
│                                                               │
│ Relevant Disciplines:                                         │
│   [physics] [semiconductor mfg] [thermodynamics]              │
│   [computational complexity] [technology forecasting]         │
│                                                               │
│ Key Tensions:                                                 │
│   1. Physical limits vs. paradigm shifts                      │
│   2. Current trajectory vs. efficiency gains                  │
│   3. Compute requirements vs. algorithmic breakthroughs       │
│                                                               │
│ Off-Scope Topics:                                             │
│   [AI alignment] [labor displacement] [geopolitics]           │
│   [consciousness]                                             │
│                                                               │
│ Drift Signatures:                                             │
│   • Discussing AI ethics without infrastructure connection    │
│   • Shifting from "can we" to "should we"                    │
│   • Labor market statistics without compute economics link    │
│                                                               │
│ Example Ceiling: Infrastructure engineering, energy systems,  │
│   manufacturing — not existential risk or labor displacement  │
│                                                               │
│ ┌─ User Constraints ──────────────────────────────────────┐  │
│ │ (none — all scope is inferred)                          │  │
│ │ Confidence: inferred                                    │  │
│ └─────────────────────────────────────────────────────────┘  │
│                                                               │
│ Extraction: 1,042 tokens │ Model: opus-4-6 │ 1.2s            │
└───────────────────────────────────────────────────────────────┘
```

**Data source:** `DebateSession.topic.scope: TopicScope`. Rendered once per debate, not per entry. If `scope` is null (extraction failed/skipped), show a warning badge: "⚠ Topic scope not extracted — alignment enforcement inactive."

**Interaction:** Clicking a discipline or off-scope topic tag highlights taxonomy nodes in the Context Usage section that match/violate it. Clicking a drift signature cross-references moderator interventions that were triggered by it.

### 10.3 Per-Entry: Topic Alignment Badge

**Where:** In the existing entry header row (next to the speaker name, round number, and model badge), add a topic-alignment indicator.

**What it shows:**

- **Green dot** — all checks passed: draft quality gate `topic_aligned: true`, no moderator drift intervention on this entry, no demoted taxonomy nodes referenced
- **Amber dot** — soft concern: inferred scope mismatch caught by draft quality gate but repaired on retry, OR moderator noted drift on a prior turn that this entry responds to
- **Red dot** — hard violation: draft quality gate `topic_aligned: false` after all retries, OR moderator issued REDIRECT/CHALLENGE for risk-level or domain mismatch on this entry

**Tooltip on hover:** One-line summary — e.g., "Draft repaired: originally cited catastrophic infrastructure failure for a low-risk consumer product debate" or "Moderator REDIRECT: risk-level mismatch detected."

**Data source:** Composed from `EntryDiagnostics.draftQuality.topic_aligned`, `EntryDiagnostics.moderatorIntervention.drift_detected`, and `EntryDiagnostics.taxonomyFilter.demotedNodesReferenced`.

### 10.4 Pipeline Stage: Draft Quality Gate Detail

**Where:** Inside the existing "Pipeline Stage Work Products" collapsible section in `DiagnosticsPanel.tsx`, within the Draft stage.

**What it shows:**

```
┌─ Draft Quality Gate ──────────────────────────────────────────┐
│ Grounded: ✓    Falsifiable: ✓    Engages: ✓                  │
│ Topic Aligned: ✗ → repaired on retry 1                       │
│                                                               │
│ Alignment failure reason:                                     │
│   Statement cited Knight Capital ($440M trading loss) and     │
│   Boeing 737 MAX (346 deaths) — catastrophic examples for a   │
│   debate scoped to low-risk consumer product UX failures.     │
│                                                               │
│ Repair hint sent:                                             │
│   "Your statement uses examples from a different risk/domain  │
│    category. The topic specifies: consumer product bugs and   │
│    UX failures. Rewrite using examples at that severity."     │
│                                                               │
│ Retry result: ✓ topic_aligned (cited Snapchat redesign        │
│   backlash, Juicero hardware pivot — on-scope consumer        │
│   product examples)                                           │
└───────────────────────────────────────────────────────────────┘
```

**Data source:** `EntryDiagnostics.stageOutputs.draftQuality` extended with `topic_aligned`, `alignment_failure_reason`, `repair_hint`, and retry outcomes. The failure reason and repair hint are already generated by the quality gate LLM call — they just need to be persisted and surfaced.

### 10.5 Taxonomy Constraint Filter Trace

**Where:** Inside the existing "Context Usage Analysis" section in `DiagnosticsPanel.tsx`. Currently shows injected vs. referenced taxonomy nodes with situation divergence scores. Add a "Scope Filter" sub-section.

**What it shows:**

```
┌─ Scope Filter ────────────────────────────────────────────────┐
│ Nodes boosted (discipline match):        12 of 28  (+1.2x)   │
│ Nodes demoted (off-scope topic match):    4 of 28  (×0.7)    │
│ Nodes demoted (risk-level mismatch):      2 of 28  (×0.7)    │
│ Nodes demoted (excluded scenario):        0 of 28            │
│ Min-per-category restorations:            1 (saf-beliefs)     │
│                                                               │
│ Demoted nodes:                                                │
│ ┌──────────────┬────────────────────────┬───────────────────┐ │
│ │ Node ID      │ Reason                 │ Original → Final  │ │
│ ├──────────────┼────────────────────────┼───────────────────┤ │
│ │ saf-b-125    │ off-scope: existential │ 0.72 → 0.50      │ │
│ │ cc-160       │ risk-level: catastrophic│ 0.68 → 0.48      │ │
│ │ saf-i-005    │ off-scope: military    │ 0.65 → 0.46      │ │
│ │ saf-d-003    │ risk-level: catastrophic│ 0.61 → 0.43      │ │
│ │ saf-b-042    │ off-scope: labor       │ 0.58 → 0.41      │ │
│ │ acc-b-017 *  │ off-scope: geopolitics │ 0.44 → 0.31 (R)  │ │
│ └──────────────┴────────────────────────┴───────────────────┘ │
│ * (R) = restored to meet min-per-category guarantee           │
│                                                               │
│ Debater referenced 1 demoted node: cc-160 (flagged amber)    │
└───────────────────────────────────────────────────────────────┘
```

**Data source:** `EntryDiagnostics.taxonomyFilter: { boosted: NodeFilterResult[], demoted: NodeFilterResult[], restorations: string[] }`. The filter function already computes these — they need to be returned as metadata alongside the filtered node list.

**Interaction:** Clicking a demoted node ID navigates to its detail in the taxonomy panel. Nodes referenced by the debater despite demotion are highlighted in amber — these are the cases where the filter signaled "off-scope" but the debater used it anyway (useful for tuning threshold).

### 10.6 Moderator: Drift Detection Trace

**Where:** Inside the existing "Moderator Intervention" and "Moderator Deliberation" sections in `DiagnosticsPanel.tsx`.

**What it shows (in Moderator Intervention section):**

```
┌─ Drift Detection ─────────────────────────────────────────────┐
│ Patterns checked: 5                                           │
│   1. Metaphor literalization:     not triggered               │
│   2. Implementation spiral:       not triggered               │
│   3. Scope creep:                 not triggered               │
│   4. Risk-level mismatch:         TRIGGERED                   │
│      → "Safetyist cited Knight Capital ($440M) and Boeing     │
│         737 MAX (346 deaths) for a debate scoped to consumer  │
│         product UX. Risk-level mismatch."                     │
│   5. Domain mismatch:             not triggered               │
│                                                               │
│ Topic-specific drift signatures checked:                      │
│   • "Citing catastrophic-scale failures for consumer product" │
│     → MATCHED (Safetyist statement)                           │
│   • "Discussing agentic AI for non-AI product"                │
│     → not matched                                             │
│                                                               │
│ Intervention issued: REDIRECT                                 │
│   Target: Safetyist                                           │
│   Instruction: "Find evidence at the appropriate severity     │
│     level — consumer product failures, not infrastructure     │
│     collapse."                                                │
└───────────────────────────────────────────────────────────────┘
```

**Data source:** Extend `ModeratorDiagnostics.driftDetection` with per-pattern results. Currently the moderator returns `drift_detected: boolean` and `trigger_reasoning: string`. Expand to `drift_patterns: { pattern: string, triggered: boolean, reasoning?: string }[]` plus `topic_drift_signatures: { signature: string, matched: boolean }[]`.

### 10.7 Calibration Dashboard: Topic Alignment Metrics

**Where:** New chart row in `CalibrationDashboard.tsx`, alongside existing Crux Addressed, Utilization Rate, Claims Forgotten charts.

**New metrics (per-debate data points):**

| Metric | Definition | Chart type |
|---|---|---|
| `scope_extraction_populated` | Fraction of TopicScope fields that are non-empty/non-default | Bar (should be near 1.0) |
| `topic_alignment_pass_rate` | Fraction of entries where `topic_aligned: true` on first attempt | Line (target: >0.85) |
| `draft_repair_rate` | Fraction of entries requiring topic-alignment repair retry | Line (target: <0.15) |
| `taxonomy_demotion_rate` | Fraction of injected nodes that were demoted by scope filter | Line (monitor: 0.05-0.25 is healthy) |
| `demoted_node_reference_rate` | Fraction of demoted nodes that debaters referenced anyway | Line (should trend down as prompts improve) |
| `moderator_drift_intervention_rate` | Fraction of moderator turns that triggered a drift pattern | Line (target: <0.10) |

**Data source:** Extend `CalibrationDataPoint` in `calibrationLogger.ts` with these 6 metrics. They're computed from data already available in the pipeline — the extraction, quality gate, filter, and moderator all produce the necessary signals.

**Dashboard integration:** Add a "Topic Alignment" section header with the 6 charts below it. Include a combined "Topic Health Score" sparkline (weighted average of pass rate, 1-repair rate, 1-drift rate) as a quick summary.

### 10.8 Prompt Inspector: Scope Block Preview

**Where:** In `PromptInspector.tsx`, the `=== DEBATE SCOPE ===` block and recap scope reminder should be visible in the assembled prompt preview.

**What it shows:** When previewing any debater prompt, the `DEBATE SCOPE` block appears after `YOUR CHARACTER` with the extracted TopicScope fields rendered. The recap section shows the scope reminder at the bottom. Both are syntax-highlighted distinctly from character and voice blocks.

**Interaction:** Clicking the scope block in the preview opens the Topic Scope Panel (10.2) for the full extracted scope. If the user modifies the topic in the prompt inspector, a "Re-extract scope" button appears.

### 10.9 Flight Recorder Events

The flight recorder should capture topic-alignment events for post-hoc analysis and debugging:

| Event | When | Payload |
|---|---|---|
| `topic_scope_extracted` | After extraction LLM call | Full `TopicScope` object, token count, model, latency |
| `topic_scope_extraction_failed` | When extraction fails | Error details, fallback behavior |
| `draft_topic_alignment_failed` | When quality gate fails `topic_aligned` | Entry index, failure reason, repair hint |
| `draft_topic_alignment_repaired` | When retry succeeds | Entry index, original failure, repair outcome |
| `taxonomy_nodes_demoted` | After scope filter runs | Node IDs, reasons, score adjustments |
| `moderator_drift_detected` | When moderator triggers a drift pattern | Pattern name, trigger reasoning, intervention type |
| `moderator_topic_drift_signature_matched` | When a topic-specific drift signature fires | Signature text, matched entry content |

**Data source:** Each mechanism emits these events via the existing flight recorder API (`flightRecorderInit.ts`). They appear in the flight recorder viewer (`tools/flight-recorder-viewer.html`) with topic-alignment events grouped under a "Topic Scope" category.

### 10.10 Diagnostics Data Flow Summary

```
TopicScope Extraction (M1)
  │
  ├── DebateSession.topic.scope ──────────→ Topic Scope Panel (10.2)
  │                                          Prompt Inspector (10.8)
  │
  ├── flight recorder ────────────────────→ Flight Recorder Viewer (10.9)
  │
  ├──→ Prompt Boundary (M5) ──────────────→ Prompt Inspector preview (10.8)
  │
  ├──→ Draft Quality Gate (M2)
  │      ├── topic_aligned result ────────→ Per-Entry Badge (10.3)
  │      ├── failure_reason + repair ─────→ Draft Quality Detail (10.4)
  │      └── flight recorder ─────────────→ Flight Recorder Viewer (10.9)
  │
  ├──→ Taxonomy Filter (M3)
  │      ├── boosted/demoted/restored ────→ Scope Filter Trace (10.5)
  │      ├── demoted-but-referenced ──────→ Per-Entry Badge amber (10.3)
  │      └── flight recorder ─────────────→ Flight Recorder Viewer (10.9)
  │
  ├──→ Moderator Drift Detection (M4)
  │      ├── per-pattern results ─────────→ Drift Detection Trace (10.6)
  │      ├── interventions issued ────────→ Per-Entry Badge red (10.3)
  │      └── flight recorder ─────────────→ Flight Recorder Viewer (10.9)
  │
  └──→ Calibration Logger
         └── 6 aggregate metrics ─────────→ Calibration Dashboard (10.7)
```

### 10.11 Implementation Ownership

| Component | Owner | Scope |
|---|---|---|
| TopicScope extraction + flight recorder events | DebateTool | `lib/debate/` |
| Extend `EntryDiagnostics` and `CalibrationDataPoint` types | DebateTool | `lib/debate/types.ts` |
| Topic Scope Panel (10.2) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/` |
| Per-Entry Badge (10.3) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/` |
| Draft Quality Detail (10.4) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/DiagnosticsPanel.tsx` |
| Scope Filter Trace (10.5) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/DiagnosticsPanel.tsx` |
| Drift Detection Trace (10.6) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/DiagnosticsPanel.tsx` |
| Calibration Dashboard charts (10.7) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/CalibrationDashboard.tsx` |
| Prompt Inspector scope preview (10.8) | Taxonomy Editor | `taxonomy-editor/src/renderer/components/PromptInspector.tsx` |
| Flight Recorder event display | Diagnostics | `tools/flight-recorder-viewer.html` |

---

## 11. Sign-Off

This design covers 5 of 8 investigation areas (1, 3, 5, 6, 8) with concrete mechanisms, token costs, risk assessments, interaction analysis, and full diagnostics UX integration (Section 10). The remaining 3 areas (2, 4, 7) are deferred with rationale.

Every mechanism that creates or evaluates topic scope data has a corresponding diagnostics surface: extraction → Topic Scope Panel, quality gate → Draft Quality Detail + per-entry badge, taxonomy filter → Scope Filter Trace, moderator → Drift Detection Trace, calibration → dashboard charts, all events → flight recorder. No silent enforcement.

Implementation tickets in DebateTool scope (engine + types), Taxonomy Editor scope (UI panels), and Diagnostics scope (flight recorder viewer).

Signed: Computational Linguist, 2026-06-02
