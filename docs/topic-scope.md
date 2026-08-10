# Topic Scope

**Topic Scope** is the debate engine's structured understanding of what a debate is
*about* — and, just as importantly, what it is *not* about. It is extracted once,
before the first turn, and then used to keep the three debaters (Accelerationist,
Safetyist, Skeptic) arguing the actual question instead of drifting into adjacent
territory.

The **Topic Scope** panel in Debate Diagnostics shows the scope object that was
extracted for the debate you are viewing. This document explains what that object
is, why it exists, how it is produced, and how to read it.

---

## Theory

### The problem: a topic is a string, drift is silent

A debate topic starts life as one sentence of free text. On its own, that string is
useful for one thing — computing embedding similarity to rank relevant taxonomy
nodes. It cannot answer the question a downstream stage actually needs: *does this
statement stay inside the debate's scope?*

Without a structured answer, drift is invisible. The motivating case (debate
`ad8379a1`): a user scoped a debate to "a low-risk consumer product with no agentic
or other AI features," and the Safetyist promptly cited Knight Capital's \$440M
trading loss and the Boeing 737 MAX's 346 deaths. Every quality gate passed — the
sources were real, the argument was falsifiable, it engaged the opponent — because
none of them checked the one thing that was wrong: the *severity level* had nothing
to do with a low-risk toy.

The insight is that a topic must be treated as a **constraint enforcer**, not just a
**query generator**. Topic Scope is that constraint, made explicit and machine-
readable.

### Scope applies to *every* debate, not just constrained ones

A common misconception is that scope only matters when the user writes explicit
qualifiers ("low-risk", "consumer product"). In fact, the seven **universal fields**
below are inferred for every topic — abstract policy propositions and philosophical
questions drift just as readily as applied product debates. A debate about "physical
limits halting AI scaling" can wander into alignment philosophy or labor
displacement with no user constraint in sight. Scope names those exits ahead of time.

### Demote, don't ban

Scope enforcement is deliberately soft. A debater who uses a higher-severity example
*briefly and as a clearly-marked analogy* is doing legitimate rhetoric, not drifting.
The engine therefore steers rather than forbids: off-scope material is deprioritized
and the debater is reminded of the frame, but nothing is hard-blocked on a single
reference. The threshold is **sustained off-scope framing**, not **any mention**.

---

## The scope object

Topic Scope is a single object with thirteen fields, defined as `TopicScope` in
`lib/debate/types/session.ts`. It has two groups.

### Seven universal fields (inferred for every topic)

| Field | Meaning |
|---|---|
| `core_proposition` | The specific claim or question being debated, in one sentence. |
| `relevant_disciplines` | Academic/professional domains evidence should be drawn from. |
| `on_scope_evidence` | Types of facts, data, and examples that count as relevant. |
| `key_tensions` | The 2–4 central disagreements the topic will generate. |
| `off_scope_topics` | Adjacent subjects debaters predictably drift toward. |
| `drift_signatures` | Concrete argument patterns that signal a debater has left scope. |
| `example_ceiling` | The maximum severity/type of example proportionate to the topic. |

### User-constraint fields (populated when the topic states them)

| Field | Meaning |
|---|---|
| `risk_level` | `low` / `medium` / `high` / `catastrophic` / `unspecified`. |
| `domain` | The subject domain, if stated or clearly implied. |
| `product_type` | The specific product under discussion, or `null`. |
| `time_horizon` | Any temporal bound the topic sets, or `null`. |
| `excluded_scenarios` | Scenarios the topic explicitly rules out. |
| `explicit_qualifiers` | Verbatim qualifier phrases the user wrote. |

One metadata field records how the scope was derived:

- `constraint_confidence` — `explicit` when the user stated constraints directly,
  `inferred` when the analyst deduced them. Enforcement is firmer for `explicit`
  scope and gentler for `inferred`.

---

## Implementation

### Extraction — one LLM call, before the debate

Scope is produced by `TopicPipeline.extractTopicScope()` in
`lib/debate/topicPipeline.ts`, which runs after topic critique and before the first
turn. It:

1. Builds the prompt with `topicScopeExtractionPrompt()`
   (`lib/debate/prompts/topic-crux.ts`), which instructs an LLM to fill in every
   field and supplies worked examples. Dimensional detail surfaced by topic critique
   is folded in as additional context.
2. Runs the call on the `scope` stage model.
3. Parses the response with `parseJsonRobust` and coerces each field to its expected
   type, defaulting `core_proposition` to the raw topic and `risk_level` to
   `unspecified` when the model omits them.
4. Runs a quality check: if the result has fewer than **3** `off_scope_topics` or
   fewer than **2** `drift_signatures`, it logs a "sparse output" warning — scope is
   still stored, but enforcement will be weak.
5. Stores the result at `session.topic.scope` and emits a `topic_scope_extracted`
   flight-recorder event.

Cost is one call of roughly 800–1,200 tokens, once per debate — negligible against a
typical debate budget.

### Graceful degradation

Extraction never blocks a debate. If the LLM returns an unparseable response or the
call throws, the pipeline logs `topic_scope_extraction_failed`, leaves
`session.topic.scope` unset, and continues. A debate with no scope simply runs
without scope enforcement — exactly as the system did before the feature existed.

### Enforcement — high-attention prompt placement

Once extracted, scope is published to a module singleton via `setTopicScope()` in
`lib/debate/prompts/state.ts` (wired in at `debateEngine.ts`). Readers pull it with
`getTopicScope()`; `hasMeaningfulScope()` gates all use, so an empty or failed scope
is a no-op.

Two helpers render the scope into debater prompts at the positions where model
attention is highest, countering the Lost-in-the-Middle effect that buried the
original constraint:

- **`formatDebateScopeBlock()`** — a `This debate is about… / Draw evidence from… /
  Off-scope… / Example ceiling…` block placed near the **top** of the debater prompt
  (primacy zone), via `prompts/shared-helpers.ts` and `prompts/turn-pipeline.ts`.
- **`formatScopeReminder()`** — a one-line reminder appended to the recap section
  (recency zone).

The moderator prompt (`prompts/moderator.ts`) also receives the scope, letting it
watch for `drift_signatures` and risk-level or domain mismatch across turns.

---

## Usage — reading the panel

The **Topic Scope** panel (Debate Diagnostics → Topic Scope) renders
`session.topic.scope` once per debate. Reading it top to bottom:

- **Core proposition + badges.** The one-line proposition, followed by chips for
  `domain`, `product_type`, `time_horizon`, a color-coded `risk_level`, and the
  `constraint_confidence` (green = `explicit`, amber = `inferred`).
- **Relevant Disciplines / Key Tensions / On-Scope Evidence.** The positive frame —
  where good arguments should come from and what they should grapple with.
- **Off-Scope Topics / Drift Signatures.** The negative frame — the exits the engine
  is watching. If a debater's argument matches one of these, expect to see it flagged
  elsewhere in diagnostics (Exclusion Guard, moderator interventions).
- **Example Ceiling / Qualifiers / Excluded Scenarios.** The severity and boundary
  constraints, most of which come from explicit user wording.

### What each signal tells you

- **No panel at all** — scope extraction was skipped or failed for this debate.
  Enforcement was inactive; check the flight recorder for
  `topic_scope_extraction_failed`.
- **`inferred` confidence with thin Off-Scope/Drift lists** — the extractor produced
  sparse output (the "sparse output" warning above). Treat downstream scope
  enforcement as best-effort for this debate.
- **A debater cites something in Off-Scope Topics** — the interesting case. A single
  clearly-marked analogy is fine by design; sustained off-scope framing is what the
  moderator and exclusion guard are there to catch.

For the design rationale and the full enforcement architecture, see
`research/comp-linguist/docs/topic-alignment-design.md`. For the related runtime
guard that checks individual statements against excluded material, see
`docs/scope-enforcement.md`.
