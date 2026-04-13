# Per-Turn Debater Response Validation

**Status:** design
**Audience:** maintainers of `lib/debate/`
**Companion to:** `debate-system-overview.md`, `debate-diagnostics-proposal.md`, `debate-observability-proposal.md`

## 1. Purpose

After a debater (Prometheus / Sentinel / Cassandra) returns a JSON turn response,
run a quality gate that answers two questions:

1. **Is this turn advancing the debate?** — does it move toward a conclusion,
   either by narrowing a disagreement, forcing a falsifiable prediction,
   conceding-and-pivoting, or proposing a synthesis?
2. **Is it surfacing a taxonomy clarification?** — does new evidence or
   argument imply that a POV node should be narrowed, broadened, split,
   merged, or retired?

If the turn is low-signal ("yes, and also…" repetition; rehashed taxonomy;
vague claims without targets), reject it, synthesize a **targeted repair
prompt**, and retry. Cap retries to keep the debate moving.

This layer sits **between** `parsePoverResponse()` (helpers.ts:276) and
claim extraction / argument-network update in
`runCrossRespondRound()` (debateEngine.ts:687). Existing post-hoc checks
(steelman NLI, sycophancy guard, fact-check via `google_search`,
`neutralEvaluator`) stay where they are — they run too late to steer the
turn, and they're expensive. This gate is cheap, synchronous, and
corrective.

## 2. What counts as "forward progress"

A turn advances the debate if it does at least one of the following,
*beyond what the last two turns already did*:

| Move | Evidence in response |
|---|---|
| **Distinguish** | Names a condition under which opponent's claim holds vs. fails; `move_types` includes `DISTINGUISH`; introduces a new taxonomy ref not in prior 3 turns. |
| **Concede-and-pivot** | Admits a bounded point; reframes around a narrower claim; `move_types` includes `CONCEDE-AND-PIVOT`. |
| **Force falsifiability** | Proposes an observable test, timeline, or metric; `my_claims` contains a `precise` claim (not `general`/`abstract`). |
| **Narrow the crux** | `disagreement_type` is set; claim is scoped to a specific operator / regime / timeline, not civilization-scale. |
| **Surface a taxonomy gap** | `taxonomy_refs` includes a node with a `relevance` that *qualifies* the node (e.g. "applies only under condition X") — a signal for the post-debate harvest. |

A turn is **low-signal** if all of the following are true:

- No new `taxonomy_refs` beyond those used in the previous two turns by this agent;
- `my_claims` is empty or all claims are `abstract` specificity;
- `move_types` is a repeat of the agent's last turn (e.g. `ASSERT, ASSERT`);
- `statement` paraphrases the opening without adding mechanism or evidence;
- No `CONCEDE` or `DISTINGUISH` after round 4 (synthesis phase expects narrowing).

## 3. Validator architecture

Two-stage: a cheap deterministic pass, then an LLM judge for the
semantic call. Both produce a `TurnValidation`.

```ts
// Proposed — add to lib/debate/turnValidator.ts
export interface TurnValidation {
  outcome: 'pass' | 'retry' | 'accept_with_flag';
  score: number;          // 0.0–1.0 composite
  dimensions: {
    schema:     { pass: boolean; issues: string[] };  // JSON shape, enum values, node-id existence
    grounding:  { pass: boolean; issues: string[] };  // taxonomy_refs exist, relevance substantive
    advancement:{ pass: boolean; signals: string[] }; // moves-vs-history, new refs, claim specificity
    clarifies:  { pass: boolean; signals: string[] }; // taxonomy-revision hints (narrow/broaden/merge)
  };
  repairHints: string[];  // feeds the revised-prompt generator
  retryBudget: number;    // decremented each attempt
}
```

### Stage A — deterministic checks (no LLM)

Runs in < 5 ms. Borrows idioms from `validators.ts`.

- **Schema.** `move_types ⊆ MOVE_CATALOG`; `disagreement_type ∈ {EMPIRICAL,VALUES,DEFINITIONAL}`;
  every `my_claims[i].targets[j]` resolves to an AN node id; `policy_refs[i].policy_id`
  resolves to the policy registry.
- **Grounding.** Every `taxonomy_refs[i].node_id` exists in the loaded taxonomy
  (reuse the node-set built in `validators.ts:63-69`). Reject any `relevance`
  shorter than ~40 chars or matching stop-phrases ("important", "relevant",
  "supports my view") — these are filler.
- **Advancement heuristics.**
  - New-ref count vs. last 2 same-agent turns (≥1 new ref in exploration, ≥2 in synthesis).
  - Move repetition: flag if `move_types` equals this agent's previous turn.
  - Claim specificity: at least one claim ≠ `abstract` after round 3.
- **Length / structure.** 3–5 paragraphs as `DETAIL_INSTRUCTION` specifies; flag single-paragraph or >7-paragraph responses.

Any Stage A fail with `severity: error` short-circuits to `retry` without
calling the judge — the model can be redirected from the rule violation alone.

### Stage B — LLM judge (one cheap call)

Only when Stage A is clean. Use a small model (Haiku 4.5 or Gemini Flash),
temperature 0, no streaming. Prompt skeleton:

```
You are a debate-progress referee. You do NOT take sides. You judge
ONE turn against the last two turns of the same debate.

Phase: {thesis-antithesis|exploration|synthesis}
Agent: {Prometheus|Sentinel|Cassandra}

Previous turns (last 2, any agent): {{transcript_window}}
Current turn (JSON): {{turn_json}}
Taxonomy nodes cited this turn: {{cited_node_summaries}}

Decide:
1. ADVANCES — does this turn do something the last two did not?
   (distinguish, concede-and-pivot, falsifiable prediction, narrowed crux, new steelman)
2. CLARIFIES_TAXONOMY — does it imply a taxonomy edit? Choose zero or more:
   narrow <node_id> | broaden <node_id> | split <node_id> | merge <ids...>
   | qualify <node_id> | retire <node_id> | new_node <label>
   Only mark a hint when the turn contains evidence for it — never speculative.
3. WEAKNESSES — list at most 3, each <= 15 words. Each weakness must name
   a concrete fix the debater could apply on retry.

Return JSON:
{ "advances": bool, "advancement_reason": "…",
  "clarifies_taxonomy": [ { "action": "...", "node_id": "...", "evidence_claim_id": "..." } ],
  "weaknesses": ["…"],
  "recommend": "pass" | "retry" | "accept_with_flag" }
```

`accept_with_flag` means "weak but not worth a retry — log it and move on"
(e.g. round 1 thesis-antithesis where shallow restatement is expected).

### Composite decision

```
outcome =
  deterministic_errors > 0                                 → retry
  judge.recommend == "retry" AND retryBudget > 0           → retry
  judge.recommend == "retry" AND retryBudget == 0          → accept_with_flag
  judge.recommend == "accept_with_flag"                    → accept_with_flag
  else                                                     → pass

score = 0.4·schema + 0.3·grounding + 0.2·advancement + 0.1·clarifies
```

## 4. Revised-prompt generator

When `outcome == 'retry'`, do not re-send the original prompt. Synthesize
a repair prompt by appending a **Critique** block to the same base
`crossRespondPrompt()` output (debateEngine.ts:856). The block is
deterministically built from `TurnValidation`, not free-form:

```
Your prior response was rejected for the following reasons:
{{#each repairHints}}
- {{this}}
{{/each}}

Do NOT repeat the rejected response. On this retry you MUST:
{{#if schema.issues}}• fix the JSON issues above before anything else{{/if}}
{{#if grounding.issues}}• replace filler `relevance` strings with one concrete
   sentence explaining the mechanism by which the cited node supports or
   complicates your claim{{/if}}
{{#if !advancement.pass}}• include at least one NEW move from: DISTINGUISH,
   CONCEDE-AND-PIVOT, or a falsifiable prediction with a timeline{{/if}}
{{#if phase == "synthesis" && !clarifies.pass}}• propose one taxonomy
   clarification in `taxonomy_refs[i].relevance` — name the node and whether
   its description should be narrowed, broadened, or split, and cite the
   evidence from this turn{{/if}}

Keep your `statement` to 3–5 paragraphs. Do not restate your opening.
```

Principles:

- **Name the violation, name the fix.** Never just "try harder".
- **Constrain, don't re-prompt.** Repair instructions are additive to the
  original prompt, so the agent keeps role/phase context.
- **Never quote the bad response back** — it anchors the model on its own
  mistake. Summarize the defect instead.
- **Escalate model on second retry.** If retry #1 uses the default model and
  still fails Stage A, retry #2 promotes to the next tier (Flash → Pro,
  Haiku → Sonnet). Document the escalation in the turn's provenance.

## 5. Retry policy

**Hard cap: 2 retries.** A turn gets at most 3 total attempts (the
original plus 2 repairs). After the second failed retry the outcome
degrades to `accept_with_flag` and the debate continues — never loop
further.

| Attempt | Model tier | Repair prompt | Cap on statement length |
|---|---|---|---|
| 0 (original) | config.model | `crossRespondPrompt()` | default |
| 1 (retry #1) | same | + critique block | unchanged |
| 2 (retry #2) | next tier up | + critique block + explicit schema snippet | tighter (trim ×0.8) |
| — | — | — | `accept_with_flag`, log, continue |

Record every attempt in `DebateSession.turns[i].attempts[]` with the
`TurnValidation` that produced the retry. This is the primary data
source for the diagnostics window (§7).

## 5a. Configuration

Validation is **enabled by default** and controlled via `DebateConfig.turnValidation`:

```ts
// types.ts — add to DebateConfig
turnValidation?: {
  /** Master switch. Default: true. */
  enabled?: boolean;
  /** Max retries per turn. Hard-capped at 2 (higher values are clamped). Default: 2. */
  maxRetries?: 0 | 1 | 2;
  /** Skip the LLM judge (Stage B) and use only deterministic checks. Default: false. */
  deterministicOnly?: boolean;
  /** Model override for the Stage-B judge. Default: claude-haiku-4-5-20251001. */
  judgeModel?: string;
  /** Per-phase sampling to control cost. Default: all phases judged. */
  sampleRate?: { 'thesis-antithesis'?: number; exploration?: number; synthesis?: number };
}
```

Resolution order:

1. CLI flag / PowerShell parameter (`-DisableTurnValidation`, `-MaxTurnRetries N`)
2. `DebateConfig.turnValidation` in the session spec
3. Environment variable (`AI_TRIAD_TURN_VALIDATION=off`)
4. Built-in default (`enabled: true, maxRetries: 2`)

When `enabled: false`, `validateTurn()` returns `{ outcome: 'pass', score: 1, … }`
without calling the judge, and no `attempts[]` entries are recorded
beyond attempt 0. This keeps the code path identical for downstream
consumers whether validation is on or off.

## 5b. Diagnostics integration

The diagnostics window must surface per-turn validation data as a
first-class view, not a debug-only flag. Concretely:

1. **Per-turn schema.** `DebateSession.turns[i]` carries:
   - `validation: TurnValidation` — the accepted verdict (last attempt).
   - `attempts: TurnAttempt[]` — every attempt with its `TurnValidation`,
     the repair prompt delta that was applied (not the full prompt), the
     model used, latency, and token count.
2. **Diagnostics panel rows.** Each turn gets:
   - Four traffic lights for `dimensions.{schema,grounding,advancement,clarifies}`.
   - A badge for `outcome` (`pass` / `accept_with_flag` / `retried×N`).
   - A numeric `score` (0.0–1.0).
   - Drill-down: expand to show `weaknesses`, `repairHints`, and the
     diff between attempt 0 and the accepted attempt.
3. **Aggregate metrics** on the session header:
   - retry rate per agent, per phase;
   - `accept_with_flag` count (unrecovered turns);
   - average `score` trend across the debate.
4. **Export.** `debateExport.ts` must include `turns[*].validation` and
   `attempts[*]` in the JSON export so post-hoc analysis tools see the
   full validation trail.
5. **Live toggle.** The diagnostics window exposes an "enabled" switch
   that writes to `DebateConfig.turnValidation.enabled` for the
   *next* turn (not retroactive). Useful when tuning prompts.

Reuse the existing diagnostics plumbing (`debate-diagnostics-proposal.md`)
rather than inventing a parallel channel.

## 6. Taxonomy-clarification routing

The Stage-B judge's `clarifies_taxonomy` array is **not** applied during
the debate. It is appended to `DebateSession.taxonomy_suggestions` with
`source: 'turn-validator'` and shown in the harvest dialog alongside the
post-debate `taxonomyRefinementPrompt()` output (prompts.ts:1584). This:

- preserves the existing human-in-the-loop harvest checkpoint,
- gives editors richer suggestions than the single post-hoc pass,
- distinguishes mid-debate suggestions (evidence-rich, turn-local) from
  end-of-debate suggestions (holistic, synthesis-driven).

If two turn-validator suggestions for the same node conflict ("narrow" +
"broaden"), surface both with their evidence — the editor resolves it.

## 7. Integration points

All wiring is local to `lib/debate/`:

1. **New file** `lib/debate/turnValidator.ts` — `validateTurn()`,
   `buildRepairPrompt()`, `TurnValidation` type, Stage-A rule set,
   Stage-B judge client.
2. **debateEngine.ts:869** — after `this.generate()` and
   `parsePoverResponse()`, call `validateTurn()`. On `retry`, loop with
   repair prompt; on `accept_with_flag`, tag the turn and continue.
3. **types.ts** — extend `DebateSession.turns[i]` with
   `validation: TurnValidation` and `attempts: TurnAttempt[]`;
   extend `DebateConfig` with the `turnValidation` block from §5a.
4. **Diagnostics window** — implement the surfaces defined in §5b
   (traffic lights, attempt drill-down, aggregates, export, live toggle).
5. **CLI / PowerShell** — add `-DisableTurnValidation` and `-MaxTurnRetries`
   to `cli.ts` and `Show-TriadDialogue.ps1`; clamp the latter to `[0, 2]`.
6. **neutralEvaluator.ts** — unchanged. Checkpoint remains independent.

## 8. Worked example

**Turn (rejected):**
```json
{ "statement": "AI systems pose significant risks. We must proceed with
  caution. History shows rushed technology causes harm. This is why safety
  matters.",
  "taxonomy_refs": [{"node_id":"saf-beliefs-003","relevance":"supports my view"}],
  "move_types": ["ASSERT"], "my_claims": [],
  "disagreement_type": "VALUES" }
```

**Validator output:**
- schema: pass
- grounding: **fail** — `relevance` is filler ("supports my view")
- advancement: **fail** — `ASSERT` repeats prior turn; no new refs; no claims
- clarifies: fail
- repairHints: ["`relevance` must explain mechanism", "no new taxonomy_refs vs. prior 2 turns", "claims array empty after round 3"]
- outcome: **retry**

**Repair prompt addendum (appended to original cross-respond prompt):**
> Your prior response was rejected for the following reasons:
> - `relevance` must explain mechanism, not restate support
> - no new taxonomy refs vs. your last two turns
> - `my_claims` was empty after round 3
>
> On this retry you MUST:
> - replace filler relevance strings with one sentence naming the mechanism…
> - include at least one NEW move from: DISTINGUISH, CONCEDE-AND-PIVOT, or a falsifiable prediction with a timeline
> - populate `my_claims` with at least one claim scoped to an operator, regime, or timeline…

## 9. Open questions

- **Judge cost vs. eval coverage.** Running the judge every turn for a
  10-round triad = 30 extra calls. Haiku/Flash keeps it cheap, but
  consider sampling (e.g. every turn in synthesis, every 2nd in exploration).
- **Self-reference loop risk.** The judge sees its own prior verdicts via
  transcript? Keep the judge stateless — pass only the two prior turns,
  never prior validations.
- **Agent-specific repair.** Cassandra's skepticism can look like
  non-advancement. Add an agent-aware allowance: repeated `QUESTION_FRAMING`
  is fine for Cassandra in rounds 1–2 but not in synthesis.
- **Interaction with sycophancy guard.** If the guard has already fired
  for this agent in this round, bias the validator toward `retry` (the
  agent has already drifted — catch it here instead of later).
