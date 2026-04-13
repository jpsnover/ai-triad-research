# Debate Turn Validation — Implementation Spec

**Design doc:** `docs/debate-turn-validation.md`
**Scope of this spec:** MVP implementation of Stage-A (deterministic) +
Stage-B (LLM judge) validation with retry loop, config plumbing, and
diagnostics persistence. UI polish and full diagnostics window wiring are
**out of scope** for this pass — we persist everything needed so the UI
can be added later without data migration.

## Deliverables

1. `lib/debate/turnValidator.ts` — new module.
2. `lib/debate/types.ts` — new `TurnValidation`, `TurnAttempt`,
   `TurnValidationConfig` types; extend `DebateSession.turn_validations`,
   `DebateConfig.turnValidation`.
3. `lib/debate/debateEngine.ts` — retry loop around cross-respond turn;
   record attempts.
4. `lib/debate/cli.ts` — `--no-turn-validation`, `--max-turn-retries <0-2>` flags.
5. `scripts/AITriad/Public/Show-TriadDialogue.ps1` — matching
   `-DisableTurnValidation` and `-MaxTurnRetries` params.
6. No new tests in this pass. Leave hooks so future Pester/vitest tests
   can exercise `validateTurn()` in isolation.

Non-goals (tracked as follow-up):
- Diagnostics window UI for traffic lights, attempt diff, aggregates.
- Live on/off toggle from diagnostics window.
- Per-phase sampling rate (persisted in config but not yet honored).
- Routing `clarifies_taxonomy` hints into `taxonomy_suggestions` during debate.

## Step 1 — Types (types.ts)

Add, near the bottom of the module (after `ExtractionSummary`):

```ts
// ── Turn validation (see docs/debate-turn-validation.md) ──

export interface TurnValidationConfig {
  enabled?: boolean;                 // default true
  maxRetries?: 0 | 1 | 2;            // default 2, clamped
  deterministicOnly?: boolean;       // default false
  judgeModel?: string;               // default 'claude-haiku-4-5-20251001'
  sampleRate?: {                     // 0..1 per phase; default 1 (always)
    'thesis-antithesis'?: number;
    exploration?: number;
    synthesis?: number;
  };
}

export type TurnValidationOutcome = 'pass' | 'retry' | 'accept_with_flag' | 'skipped';

export interface TurnValidationDimensions {
  schema:      { pass: boolean; issues: string[] };
  grounding:   { pass: boolean; issues: string[] };
  advancement: { pass: boolean; signals: string[] };
  clarifies:   { pass: boolean; signals: string[] };
}

export interface TaxonomyClarificationHint {
  action: 'narrow' | 'broaden' | 'split' | 'merge' | 'qualify' | 'retire' | 'new_node';
  node_id?: string;
  node_ids?: string[];     // for merge
  label?: string;          // for new_node
  evidence_claim_id?: string;
  rationale: string;
}

export interface TurnValidation {
  outcome: TurnValidationOutcome;
  score: number;                  // 0..1
  dimensions: TurnValidationDimensions;
  repairHints: string[];
  clarifies_taxonomy: TaxonomyClarificationHint[];
  judge_used: boolean;
  judge_model?: string;
}

export interface TurnAttempt {
  attempt: number;                 // 0 = original
  model: string;
  prompt_delta: string;            // '' on attempt 0; critique block only on retries
  raw_response: string;
  response_time_ms: number;
  validation: TurnValidation;
}
```

Extend `DebateConfig` (debateEngine.ts:79):

```ts
turnValidation?: TurnValidationConfig;
```

Extend `DebateSession` (types.ts:99):

```ts
/** Per-entry turn-validation trail. Keyed by transcript entry id. */
turn_validations?: Record<string, { attempts: TurnAttempt[]; final: TurnValidation }>;
```

## Step 2 — turnValidator.ts

New module exporting:

```ts
export interface ValidateTurnParams {
  statement: string;
  taxonomyRefs: TaxonomyRef[];
  meta: PoverResponseMeta;
  phase: DebatePhase;
  speaker: PoverId;
  round: number;
  priorTurns: TranscriptEntry[];          // last 2 same-agent turns
  knownNodeIds: ReadonlySet<string>;      // POV + situation + conflict
  policyIds: ReadonlySet<string>;
  config: Required<TurnValidationConfig>;
  callJudge: (prompt: string, label: string) => Promise<string>;
}

export async function validateTurn(p: ValidateTurnParams): Promise<TurnValidation>;
export function buildRepairPrompt(basePrompt: string, v: TurnValidation, attempt: number): string;
export function resolveTurnValidationConfig(c: TurnValidationConfig | undefined): Required<TurnValidationConfig>;
```

### Stage A — deterministic

Rules (each produces a `string` issue on failure):

1. `move_types` subset of `MOVE_CATALOG` (import from prompts.ts).
2. `disagreement_type` ∈ {EMPIRICAL, VALUES, DEFINITIONAL} when present.
3. Every `taxonomyRefs[i].node_id` ∈ `knownNodeIds`.
4. Every `policy_refs[i]` string or `.policy_id` ∈ `policyIds` (warning only — don't block).
5. `relevance` length ≥ 40 chars, not matching `/^(supports|relevant|important|my view)/i`.
6. Length sanity: `statement` has 3–5 double-newline blocks (paragraphs).
   Warning outside that range (not a hard fail).
7. Novelty: at least 1 `node_id` not in the union of `priorTurns[*].taxonomy_refs[*].node_id`.
   Required when `phase != 'thesis-antithesis'`.
8. Move repetition: `meta.move_types` must not equal the most recent
   same-agent turn's `move_types` exactly.
9. Claim specificity: after `round >= 3`, at least one `meta.my_claims[i].claim`
   must not look abstract. Heuristic: contains a number, a named entity
   (CapWord), or one of `within|by \d{4}|percent|%|per year`.

Rule severity:
- **error** (blocks without calling judge, counts as Stage-A fail): 1, 2, 3, 5.
- **warning** (counts against dimensions but doesn't short-circuit): 4, 6, 7, 8, 9.

### Stage B — judge

Runs only when Stage A has no errors AND sampling allows. Prompt defined
in docs §3. Parse JSON with `parseJsonRobust`. On parse failure, fall
back to `{ recommend: 'pass' }` so a broken judge doesn't tank the debate.

### Composite

```
dimensions.schema.pass      = rules 1..3 passed
dimensions.grounding.pass   = rules 3, 4, 5 passed
dimensions.advancement.pass = rules 7..9 passed AND judge.advances
dimensions.clarifies.pass   = judge.clarifies_taxonomy.length > 0 (informational)

outcome:
  if Stage-A has error-severity issues and retryBudget > 0  → retry
  elif judge.recommend == 'retry' and retryBudget > 0       → retry
  elif judge.recommend == 'retry' and retryBudget == 0      → accept_with_flag
  elif judge.recommend == 'accept_with_flag'                → accept_with_flag
  else                                                      → pass

score = 0.4·schema + 0.3·grounding + 0.2·advancement + 0.1·clarifies
        (each dimension contributes 1 if pass, else 0)
```

### buildRepairPrompt

Append a `--- REPAIR INSTRUCTIONS ---` section to the base prompt with
the rule violations + Stage-B weaknesses. On attempt 2, additionally
paste the minimal JSON schema reminder (`statement`, `taxonomy_refs`,
`move_types`, `my_claims`, `disagreement_type`) inline.

### resolveTurnValidationConfig

Merge user config with defaults; clamp `maxRetries` into `[0, 2]`; pick
`judgeModel` default; default `sampleRate` entries to 1.

## Step 3 — Engine integration

In `runCrossRespondRound()` (debateEngine.ts:687), replace the single
`this.generate() → parsePoverResponse() → addEntry()` sequence with a
loop:

```ts
const vConfig = resolveTurnValidationConfig(this.config.turnValidation);
const attempts: TurnAttempt[] = [];
let current = await this.generate(prompt, `${info.label} cross-respond`);
let parsed = parsePoverResponse(current);
let validation: TurnValidation;
let finalPrompt = prompt;

for (let attempt = 0; ; attempt++) {
  validation = vConfig.enabled
    ? await validateTurn({ ...params, config: vConfig, callJudge: (p, l) => this.generate(p, l) })
    : { outcome: 'skipped', score: 1, /* zero-fill */ };

  attempts.push({
    attempt, model: this.config.model,
    prompt_delta: attempt === 0 ? '' : diffAgainst(prompt, finalPrompt),
    raw_response: current,
    response_time_ms: elapsed,  // capture per attempt
    validation,
  });

  if (validation.outcome !== 'retry' || attempt >= vConfig.maxRetries) break;

  finalPrompt = buildRepairPrompt(prompt, validation, attempt + 1);
  current = await this.generate(finalPrompt, `${info.label} cross-respond (retry ${attempt + 1})`);
  parsed = parsePoverResponse(current);
}
```

Then proceed with the existing `addEntry` using the last `parsed`.

After `addEntry`, persist:

```ts
this.session.turn_validations ||= {};
this.session.turn_validations[entry.id] = { attempts, final: validation };
```

On `accept_with_flag`, set `entry.metadata.turn_validation_flagged = true`
so downstream consumers can style the transcript entry.

## Step 4 — CLI / PowerShell flags

`lib/debate/cli.ts`:

- `--no-turn-validation` → `turnValidation: { enabled: false }`
- `--max-turn-retries <0|1|2>` → `turnValidation: { maxRetries: N }`
  (reject other values with actionable error).

`scripts/AITriad/Public/Show-TriadDialogue.ps1`:

- `[switch]$DisableTurnValidation`
- `[ValidateSet(0,1,2)][int]$MaxTurnRetries = 2`

Both thread into the same `DebateConfig.turnValidation` shape. Don't add
env var resolution in this pass — defer until a user asks for it.

## Step 5 — Type check

Run `npx tsc --noEmit` from `taxonomy-editor/` (covers lib/ via the
bridge alias). Fix any type errors introduced by this change only;
pre-existing errors listed elsewhere stay pre-existing.

## Risk / rollback

- Feature is gated by `turnValidation.enabled` defaulting to `true`. To
  disable globally, flip the default or pass the CLI flag.
- Judge failures are swallowed into `pass` — a broken judge cannot
  stall a debate.
- Retry budget capped at 2 means worst-case ×3 latency and cost on a
  single turn. With a Haiku-tier judge, this is ~1–3s extra per retry.
- The validation trail lives on `DebateSession.turn_validations` —
  absence is always tolerated by future readers.

## Follow-ups (separate spec later)

- Diagnostics window panel: traffic lights, attempt diff, aggregates,
  live toggle.
- Route `clarifies_taxonomy` into `taxonomy_suggestions` with
  `source: 'turn-validator'`.
- Per-phase sampling honored in `validateTurn`.
- Vitest suite for `turnValidator.ts` with golden rule cases.
