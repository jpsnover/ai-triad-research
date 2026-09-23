# Topic Scope — Theory of Success, Extraction, and Use

**Last updated:** 2026-09-23

The **Topic Scope** is a structured description of what a debate topic is about, extracted by the
engine at setup time before any debater speaks. It names the topic's core proposition, the relevant
intellectual disciplines, the boundaries of what is and is not in scope, the textual patterns that
signal a turn has drifted, and the contextual risk level.

This document explains what problem the scope solves, the theory for why it should solve it, how it
is extracted, and how it is used during the debate. It is the reference behind the `TheoryLink` in
the DebateDiagnostics Overview panel (t/3593). That panel is the human-readable window onto the
per-session scope health metrics that measure whether the mechanism is working.

For the scope type definition see `lib/debate/types/session.ts` (`TopicScope`, `TopicScopeRiskLevel`,
t/336). For the extraction prompt see
`lib/debate/prompts/topic-crux.ts` (`topicScopeExtractionPrompt`). For the enforcement filter see
`lib/debate/taxonomyRelevance.ts` (`applyTopicConstraintFilter`).

## The problem: debate turns drift from the topic in ways the taxonomy cannot prevent

The core driver of drift is the taxonomy's structure. Every taxonomy node is grounded in an
intellectual tradition, not in a particular debate topic. `acc-beliefs-003` expresses an
accelerationist belief about AI capability timelines; it applies to dozens of different questions
equally well. When the engine selects nodes to inject into a debater's context, it selects by
relevance to the query vector — but relevance is cosine similarity, and cosine similarity is topic-
agnostic at fine grain. A node about AI lab governance scores high for "Should AI labs be regulated?"
but also for "Should pharmaceutical trials require pre-registration?" if both questions activate the
same governance vocabulary.

Two failure modes follow. First, **off-scope injection**: a node whose content belongs to an
adjacent but distinct debate (AI consciousness, bioweapons, nuclear risk) scores relevantly enough
on embedding similarity to be injected, and the debater incorporates it. The debate drifts into
territory the researcher did not intend to measure. Second, **drift accumulation**: individual turns
each drift only slightly, but the cumulative effect over a full debate is a final debate about a
different question than the one the session was initialized with. Both failure modes produce
calibration data that is assigned to the wrong question.

## The theory of success

The scope mechanism is a bet with a specific, falsifiable mechanism:

> If the topic is pre-analyzed to identify its exact disciplinary footprint, its off-scope neighbors,
> and the textual patterns that signal a turn has left the topic's territory — and if that analysis
> is then applied as a continuous filter on taxonomy injection and a per-turn alignment check — then
> drift will be detectable before it accumulates rather than only diagnosable after the debate ends.

Three parts must all hold:

1. **Extraction accuracy.** The LLM must produce a scope object that correctly identifies the topic's
   disciplinary boundaries. A scope that lists `AI safety` as an off-scope topic for a debate *about*
   AI safety is worse than no scope — it actively demotes the correct nodes and poaches the
   researcher's question. `constraint_confidence = 'explicit'` means the topic statement named its
   own boundaries; `'inferred'` means the LLM guessed them. Inferred scopes require more caution.

2. **Enforcement reduces wrong-node injection.** The filter demotes nodes whose text matches off-scope
   vocabulary and boosts nodes matching the topic's discipline terms. The measurable success criterion
   is a *lower* `taxonomy_demotion_rate` (the scope correctly admits in-scope nodes) combined with a
   *low* `demoted_node_reference_rate` (demoted nodes are not being referenced anyway, confirming the
   demotion was correct rather than wasteful). If `demoted_node_reference_rate` is high, the scope is
   demoting nodes that would have contributed — the constraint is too aggressive.

3. **Alignment check catches turns that slipped through.** After each turn is drafted, the turn is
   scored for topic alignment. A turn that fails the check is regenerated. The measurable outcome is
   a non-zero `draft_repair_rate` on sessions where drift would otherwise occur, and a `topic_alignment_rate`
   that is higher post-repair than the raw pre-repair baseline would be.

The scope is **not** assumed to work automatically. A scope that fires zero demotions and zero
alignment repairs in a full debate either ran on a topic so narrow that no drift was possible, or
produced a scope so permissive that it never activated. The diagnostics exist to distinguish the two.

## How it is extracted

Extraction runs as `extractTopicScope` in `lib/debate/topicPipeline.ts` (t/336), called at the end
of the topic setup phase after `runTopicCritique` has run. It uses the final topic string (post-
reframe if a reframe was applied) and, when available, `topic.critique.scope_additions` — an array
of scope hints that the topic critique passes forward.

The extraction calls `topicScopeExtractionPrompt` (in `lib/debate/prompts/topic-crux.ts`) via the
model assigned to the `scope` stage (`resolveStageModel('scope')`). The prompt asks the LLM to
return a structured JSON object with the following fields:

| Field | Description | Sparsity warning threshold |
|-------|-------------|---------------------------|
| `core_proposition` | The single declarative claim the topic is asserting | — |
| `relevant_disciplines` | Named fields the debate draws on (AI safety, political philosophy, etc.) | — |
| `on_scope_evidence` | Source types that should be treated as authoritative | — |
| `key_tensions` | The central disagreements the debate should resolve | — |
| `off_scope_topics` | Topics adjacent but out of bounds for this debate | < 3 triggers WARN |
| `drift_signatures` | Phrases / patterns that appear when a turn has drifted | < 2 triggers WARN |
| `example_ceiling` | The most concrete example allowed before it becomes off-scope | — |
| `risk_level` | `low` / `medium` / `high` / `catastrophic` / `unspecified` | — |
| `domain` | Top-level domain string (e.g. `"AI governance"`) | — |
| `product_type` | Narrow product framing if applicable, else `null` | — |
| `time_horizon` | Near / mid / long-term framing if named, else `null` | — |
| `excluded_scenarios` | Concrete scenarios explicitly ruled out | — |
| `explicit_qualifiers` | Scope-narrowing phrases stated in the topic string | — |
| `constraint_confidence` | `'explicit'` if topic named its own boundaries; `'inferred'` otherwise | — |

If the LLM returns fewer than 3 `off_scope_topics` or fewer than 2 `drift_signatures`, the engine
logs a `WARN` and stores the scope anyway with a note that "enforcement may be weak." This is not a
skip — a partial scope is still used — but the WARN signals that the two fields the enforcement
filter depends on most are thin.

If parsing fails entirely (non-JSON response or empty object), extraction is skipped, `session.topic.scope`
stays `undefined`, and the debate continues without any scope enforcement. This path logs a flight
recorder `warn` via `topic_scope_extraction_failed`.

The `scope_extraction_populated` calibration metric (0–1) reports the fraction of the six key fields
(`core_proposition`, `relevant_disciplines`, `key_tensions`, `off_scope_topics`, `drift_signatures`,
`example_ceiling`) that are non-empty. A low value (< 0.5) with extraction nominally succeeding means
the LLM returned shallow content for most fields — a model or prompt problem, not a parse failure.

## How it is used

### Taxonomy injection filter

At each turn, the engine calls `selectRelevantNodes` (in `lib/debate/taxonomyRelevance.ts`) to choose
which POV nodes to inject into the debater's context. When `session.topic.scope` is present, the
selection passes through `applyTopicConstraintFilter` before finalizing the injected set.

The filter operates on every candidate node's text content:

- **Demotion** — if the node's text overlaps with `off_scope_topics` or `excluded_scenarios` terms
  (keyword overlap; penalty factor ×0.7), the node is penalized and pushed down the ranked list.
  `risk_level = 'low' | 'medium'` applies a lighter demotion; `'high' | 'catastrophic'` applies
  the full penalty. The demotion is recorded in the turn's `scope_filter_trace` (stored in the
  transcript entry's `injection_manifest`), with `nodeId`, `reason`, `originalScore`, and `newScore`.

- **Boosting** — if the node's text matches `relevant_disciplines` terms, the node is boosted.
  Boosts are also recorded in the trace.

The calibration metrics that measure this path are:
- `taxonomy_demotion_rate` — fraction of injected-candidate nodes that were demoted across the
  session. Low + non-zero: scope is active but not aggressive. Zero: scope never triggered — either
  the topic had no off-scope neighbors in the taxonomy, or the scope object's off-scope terms were
  too specific to match any node vocabulary.
- `demoted_node_reference_rate` — of the nodes demoted at injection, what fraction did the debater
  reference anyway (via `taxonomy_refs`)? A high value here means the demotions were wrong: the
  debater found those nodes relevant despite the scope and cited them, which suggests the off-scope
  classification was too broad.

### Per-turn topic alignment check

After each turn is drafted (inside `runTurn-stages.ts`), the drafted text is scored against
`session.topic.scope.drift_signatures` and optionally against the resolution embedding. A turn that
fails the alignment check (`topic_aligned = false`) is flagged in entry diagnostics and regenerated
once (`repaired = true`). The regenerated turn is scored again; if it still fails, the draft is
accepted as-is with the failure recorded.

The calibration metrics:
- `topic_alignment_rate` — fraction of scored turns that passed alignment (or were repaired to pass).
  Values below 0.8 in a multi-round debate indicate either weak drift signatures, a genuinely
  hard-to-stay-on-topic question, or a scope that was extracted incorrectly.
- `draft_repair_rate` — fraction of turns that required regeneration. High rates on a topic where
  `taxonomy_demotion_rate` is near zero suggest the scope is working at the text layer (catching
  drift in prose) even though it has few node-level demotions to make.

## Current status

The scope mechanism is **deployed but undercharacterized**. The extraction and filter code are in
production (`lib/debate/topicPipeline.ts`, `lib/debate/taxonomyRelevance.ts`), and all four
calibration metrics (`taxonomy_demotion_rate`, `demoted_node_reference_rate`, `topic_alignment_rate`,
`draft_repair_rate`) are logged per session.

**Open audit findings** (per the TL instruction that fields tracing to nothing are recorded as
findings, not smoothed over):

1. **`taxonomy_demotion_rate` is zero for most sessions.** The filter requires off-scope term overlap
   at the keyword level. Taxonomy nodes are typically phrased in abstract academic vocabulary, and
   the off-scope topics the LLM generates tend to be high-level labels (`"nuclear risk"`,
   `"bioweapons"`). These rarely share four-character word stems with individual node descriptions.
   The filter architecture (keyword overlap, not embedding distance) may be the wrong gate for this
   vocabulary mismatch. This has not been systematically measured against a baseline of "zero scope"
   sessions.

2. **`demoted_node_reference_rate` is not independently validated.** It is computed only over
   sessions where demotions occurred; for most sessions it is `null`. The intended interpretive range
   (< 0.15 = scope is accurate; > 0.30 = scope is too aggressive) is not yet empirically calibrated.

3. **`constraint_confidence = 'inferred'` is the common case.** Most topic strings do not name their
   own disciplinary boundaries, so the LLM infers them. Whether inferred scopes are substantively
   different from explicit ones — in extraction quality, demotion rate, or alignment rate — has not
   been measured.

4. **Sparsity warnings fire frequently.** The `off_scope_topics < 3 || drift_signatures < 2` guard
   triggers on a non-trivial share of sessions (exact rate unquantified). Sessions with sparse scopes
   proceed without repair; the downstream effect on alignment and demotion rates has not been
   isolated.

The DebateDiagnostics Overview `TheoryLink` (t/3593) surfaces these four metrics per session so
that evidence accumulates naturally without a separate audit sweep.
