# Backend-Neutral Prompt Caching Design

This document is an audit of AITriad's debate engine prompt construction and a design spec for a backend-neutral prompt caching layer. No code changes accompany this document.

## 1. Inventory of Current State

The debate engine's prompt architecture is richer than a simple five-type model. The core is a **4-stage pipeline** (BRIEF -> PLAN -> DRAFT -> CITE) that runs for both opening statements and cross-respond turns, orchestrated by a **moderator selection** prompt between turns, followed by a **multi-phase synthesis** after all rounds complete. In total, a 3-persona, 3-round debate makes roughly 40 API calls.

All prompts are constructed in `lib/debate/prompts.ts` (2,489 lines). They are assembled as flat template-literal strings and passed to `lib/debate/aiAdapter.ts`, which wraps them in a single `user` message for Claude/Groq/OpenAI or a single `text` part for Gemini. No system messages are used today.

The adapter (`aiAdapter.ts`) returns only the text content of responses. **Token usage metadata is discarded.** The PowerShell adapter (`scripts/AIEnrich.psm1`) does extract usage, but the debate engine doesn't use it. **No prompt caching of any kind is implemented** — no `cache_control` headers, no Gemini explicit caching, no response caching.

### 1.1 Shared Instruction Blocks (Layer 1 Candidates)

These constants in `prompts.ts` are identical across all calls regardless of persona, topic, audience, or turn:

| Block | Lines | Approx chars | Approx tokens |
|-------|-------|-------------|--------------|
| `TAXONOMY_USAGE` | 70-80 | 1,450 | 360 |
| `MUST_CORE_BEHAVIORS` | 84-122 | 4,000 | 1,000 |
| `SHOULD_WHEN_RELEVANT` | 254-480 | 16,350 | 4,090 |
| `MUST_EXTENDED` | 126-154 | 2,320 | 580 |
| `STEELMAN_INSTRUCTION` | 242-252 | 640 | 160 |
| `DIALECTICAL_MOVES` | 482-574 | 6,630 | 1,660 |
| `COUNTER_TACTICS` | 576-607 | 2,350 | 590 |
| `OUTPUT_FORMAT` | 609-648 | 2,100 | 525 |
| **Total** | | **~35,840** | **~8,965** |

Phase-specific blocks (`PHASE_INSTRUCTIONS`, `CONSTRUCTIVE_MOVES`) add ~3,500 chars / ~875 tokens but vary by debate phase, so they belong in Layer 2 or 3.

The `AUDIENCE_DIRECTIVES` record (lines 28-54) contains all five audience definitions (~3,500 chars total), but only one audience's `readingLevel` + `detailInstruction` + `moderatorBias` is interpolated per call (~400-700 chars depending on audience). The selected audience is stable for the entire debate. It is grouped in Layer 3 alongside taxonomy context because both are stable within a pipeline run, and audience alone is too small (~100-175 tokens) to justify a separate cache layer.

`POVER_INFO` (from `types.ts`) and the `otherDebaters()` helper (lines 15-21) produce persona descriptions from constants. These are Layer 1 data assembled per-persona, making the output Layer 2.

The `allInstructions(phase)` function (lines 212-240) assembles the Layer 1 blocks with phase-specific additions. In the current prompt structure, these blocks are concatenated inline inside the DRAFT prompt. The BRIEF, PLAN, and CITE prompts do **not** include them — only DRAFT does. This is important: the full ~9,000-token instruction set appears only in the draft stage.

### 1.2 Per Prompt Type

#### BRIEF (Strategic Analysis)

**Opening**: `briefOpeningStagePrompt()` at `prompts.ts:1235`
**Regular turn**: `briefStagePrompt()` at `prompts.ts:1420`
**Called from**: `turnPipeline.ts:189` (turn), `turnPipeline.ts` opening pipeline

Static portion (~2,500 chars / ~625 tokens): role framing ("You are an analytical assistant..."), phase instructions (selected from constant record), JSON output schema. Dynamic portion (~5,000-13,000 chars / ~1,250-3,250 tokens): `taxonomyContext` (3-8KB), `topic`, `recentTranscript` (2-5KB), `focusPoint`, `addressing`, `priorStatements` (opening only).

**Backend**: whatever `config.model` resolves to via `aiAdapter.ts`. Temperature: 0.15.

**Meets minimum prefix size**: The static portion alone (~625 tokens) is below Claude's 2,048-token Sonnet minimum. However, once persona framing + taxonomy context are included as Layer 2-3, the prefix exceeds all provider minimums comfortably.

**Cache-poisoning risks**: None found. No timestamps, UUIDs, or random content in the prompt body.

#### PLAN (Argument Strategy)

**Opening**: `planOpeningStagePrompt()` at `prompts.ts:1275`
**Regular turn**: `planStagePrompt()` at `prompts.ts:1469`
**Called from**: `turnPipeline.ts` after BRIEF

Static portion (~3,000 chars / ~750 tokens): persona framing, available moves list (from constant), JSON schema. Dynamic portion (~1,000-2,000 chars / ~250-500 tokens): prior stage `brief` output, `priorMoves` history, `priorFlaggedHints`.

**Cache-poisoning risks**: None. The `priorMoves` block is constructed from deterministic debate history.

#### DRAFT (Full Response Generation)

**Opening**: `draftOpeningStagePrompt()` at `prompts.ts:1301`
**Regular turn**: `draftStagePrompt()` at `prompts.ts:1516`
**Called from**: `turnPipeline.ts` after PLAN

This is the heavyweight. Static portion (~25,000 chars / ~6,250 tokens): persona framing + `getReadingLevel()` + `getDetailInstruction()` + `MUST_CORE_BEHAVIORS` + `MUST_EXTENDED` + `STEELMAN_INSTRUCTION` + phase-specific directive. Dynamic portion (~8,000-18,000 chars / ~2,000-4,500 tokens): `brief` + `plan` outputs from prior stages, `focusPoint`, `addressing`, document instructions.

Notably, the draft stage prompt in the **4-stage pipeline** omits `allInstructions()` — it includes only `MUST_CORE_BEHAVIORS`, `MUST_EXTENDED`, and `STEELMAN_INSTRUCTION` directly. The `SHOULD_WHEN_RELEVANT`, `DIALECTICAL_MOVES`, `COUNTER_TACTICS`, and `OUTPUT_FORMAT` blocks are **not** in the pipeline draft prompt. These appear only in the legacy monolithic `crossRespondPrompt()` (line 1115-1218), which calls `allInstructions(phase)` at line 1182.

This means the pipeline draft's static prefix is actually ~7,000 chars / ~1,750 tokens (the three instruction blocks it does include), not the full ~36,000 char set. The taxonomy context and audience directives push the total prefix to ~10,000-15,000 chars / ~2,500-3,750 tokens including Layer 2-3.

Temperature: 0.7.

**Cache-poisoning risks**: None. All dynamic content is clearly in the variable suffix (prior stage outputs, assignment text).

**Meets minimum prefix size**: Yes for all providers. The combined Layer 1-3 prefix (instructions + persona + audience + taxonomy) ranges from 2,500 to 3,750 tokens, exceeding all provider minimums.

#### CITE (Taxonomy Grounding)

**Opening**: `citeOpeningStagePrompt()` at `prompts.ts:1361`
**Regular turn**: `citeStagePrompt()` at `prompts.ts:1576`
**Called from**: `turnPipeline.ts` after DRAFT

Static portion (~2,000 chars / ~500 tokens): role framing ("You are a grounding analyst"), JSON schema, grounding instructions. Dynamic portion (~4,000-6,000 chars / ~1,000-1,500 tokens): `brief` + `plan` + `draft` outputs from prior stages, `taxonomyContext`, citation history (`priorRefs`, `uncited` lists).

**Cache-poisoning risks**: None.

**Meets minimum prefix size**: The static-only portion (500 tokens) is below most minimums. But this prompt has a structural challenge: the taxonomy context (which is the main content the model needs for grounding) changes per persona, making the cacheable prefix thin. The prior stage outputs are per-turn variable. This prompt may benefit less from caching than the others.

#### MODERATOR (Responder Selection)

`crossRespondSelectionPrompt()` at `prompts.ts:1049`
**Called from**: `debateEngine.ts` at the start of each cross-respond round

Static portion (~4,500 chars / ~1,125 tokens): role framing, moderator instructions, rhetorical dynamics guidance, JSON schema. Dynamic portion (~4,000-15,000 chars / ~1,000-3,750 tokens): `recentTranscript`, `activePovers`, `edgeContext` (argument network analysis), `schemeSection` (critical questions), `metaphorSection`, phase objectives, audience bias line.

**Cache-poisoning risks**: The `metaphorReframe` parameter injects a metaphor prompt selected via `selectReframingMetaphor()` (line 1038), which uses `round % available.length` — deterministic, not random. No risk.

#### SYNTHESIS (Post-Debate Analysis)

Three functions:
- `synthExtractPrompt()` at `prompts.ts:1638` — extract agreement/disagreement
- `synthMapPrompt()` at `prompts.ts:1674` — build argument map
- `synthEvaluatePrompt()` at `prompts.ts:1738` — evaluate synthesis quality

Each has a small static portion (~1,500-2,000 chars / ~375-500 tokens) and takes the full transcript as dynamic input. Called once per debate. Low caching leverage — single-use prompts.

#### LEGACY MONOLITHIC PROMPT

`crossRespondPrompt()` at `prompts.ts:1115` — contains ALL instruction blocks via `allInstructions(phase)` plus inline taxonomy context. This is the legacy single-prompt path that was replaced by the 4-stage pipeline. It **is** still exported and could be used as a fallback, but the engine's `runCrossRespondRound()` uses `runTurnPipeline()` exclusively.

This prompt has the highest caching potential because it packs ~36,000 chars of static instructions before any variable content. However, it's not actively used.

#### UTILITY PROMPTS

- `clarificationPrompt()` (line 693): 1 call per debate if enabled. Low leverage.
- `entrySummarizationPrompt()` (referenced at `debateEngine.ts:383`): 1 call per turn. Small prompt, low leverage.
- `midDebateGapPrompt()`: 1 call per debate. Low leverage.
- `contextCompressionPrompt()`: conditional, 0-1 calls per debate.
- `missingArgumentsPrompt()`, `taxonomyRefinementPrompt()`: 1 call each, post-synthesis.

None of these utility prompts share significant static content with the main pipeline prompts. They're not worth individual caching investment.

### 1.3 Cache-Poisoning Inventory

**No cache-poisoning issues found in any active prompt.** Specifically:

- `Date.now()` / `new Date()` — used only for timing and metadata (`debateEngine.ts:179,345,350` etc.), never interpolated into prompt text
- `crypto.randomUUID()` via `generateId()` (`helpers.ts:13`) — used for entry IDs, never in prompts
- `Math.random()` — used for debater order shuffling (`debateEngine.ts:813`) and cross-POV node sampling (`debateEngine.ts:1139`), but the shuffled results are used for control flow, not prompt text. Exception: `crossPovNodeIds` are sampled with `Math.random()` and then included in the CITE prompt's refs block. This is Layer 4 content, so it doesn't affect caching, but the non-determinism means two identical debate configurations will produce different CITE prompts.
- `toLocaleString('en-US', ...)` in `truncationNotice()` (`prompts.ts:666-668`) — used only for source document truncation notices, which are Layer 4 content
- `JSON.stringify` — not used for prompt construction; prompts are template literals
- No `Date`, `timestamp`, `uuid`, or `random` calls found in any prompt template function

**One confirmed risk**: The `taxonomyContext` builder (`taxonomyContext.ts:88`) sorts nodes by relevance score with no tie-breaker. When nodes have equal scores, their order depends on insertion order from the source JSON, which is not guaranteed stable. This can produce byte-level differences in the taxonomy block across otherwise-identical pipeline stages within the same turn, destroying implicit cache matches on OpenAI and Gemini. **Fix required before implementation** — see Section 11, "Taxonomy Context Stability."

### 1.4 Existing Backend Abstraction

The current `AIAdapter` interface (`aiAdapter.ts:21-23`) is minimal:

```typescript
export interface AIAdapter {
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
}
```

It accepts a flat string prompt and returns a flat string response. There is no way to pass structured messages, system prompts, cache directives, or receive usage metadata. This interface must be extended, not replaced — the existing `generateText` signature should remain for backward compatibility with callers that don't need caching.

The PowerShell adapter (`AIEnrich.psm1:194-496`) has a richer return type that includes `Usage` (InputTokens, OutputTokens, TotalTokens), `Backend`, `Model`, `Truncated`, and `RawResponse`. It extracts usage from all four providers. The design should unify the TypeScript adapter's return type to match this level of detail.

## 2. Decision Required: Prompt Reordering

The entire envelope design hinges on one question: **is prompt reordering acceptable in exchange for cacheability?**

The current code interleaves persona framing, audience directives, and instruction blocks inside a single flat prompt. The proposed envelope pushes stable content (instruction blocks) to the front and moves them into system messages for most providers. This is not just a serialization change — it alters what the model attends to first and changes the system-vs-user message boundary, both of which can affect output quality.

**If yes (reordering is acceptable):** The full envelope approach described in this document applies. Layers 1-3 are ordered by cache stability, maximizing prefix reuse across personas, turns, and stages.

**If no (reordering is not acceptable):** A less aggressive split is needed. Options, in order of caching yield:

1. **System/user split only.** Move instruction blocks into a system message but preserve their interleaved position relative to persona/audience content. Cache benefit comes from the system-vs-user boundary, not from reordering within the system message. Yields implicit caching on all providers but sacrifices cross-persona Layer 1 sharing on Claude (because persona content is mixed into the cached prefix).

2. **Layer 2 absorption.** Move instruction blocks into Layer 2 alongside persona framing, preserving the original interleaved order within each persona's prefix. Cross-persona sharing is lost, but per-persona cross-turn sharing is preserved. Layer 1 becomes empty or trivially small.

3. **No restructuring.** Keep the flat-string prompt, add cache breakpoints at a single point (after the longest stable prefix the current order happens to produce). Minimal engineering cost, minimal cache yield.

This decision should be made before implementation begins. Stage 5 of the rollout (Section 7) validates the choice with A/B measurement, but the rollout plan should have a pre-committed fallback: if quality degrades by more than the threshold defined in Stage 5, which of the three alternatives above will be adopted?

**Recommendation:** Proceed with the full envelope (option "yes") and pre-commit to fallback option 1 (system/user split without internal reordering) if Stage 5 shows regression.

## 3. Proposed `PromptEnvelope` Type

The four-layer model maps well to the codebase, with one refinement: the boundary between Layer 2 and Layer 3 is blurrier than expected because the pipeline DRAFT prompt interleaves persona framing (Layer 2) with audience directives (Layer 3) before the instruction blocks (Layer 1). The envelope must allow Layer 1 content to be placed first regardless of how the prompt template orders things.

```typescript
/**
 * A structured prompt that separates content by cache stability.
 * Layers are concatenated in order (1 -> 2 -> 3 -> 4) to form
 * the prompt prefix. Provider adapters place cache breakpoints
 * between layers.
 */
export interface PromptEnvelope {
  /**
   * Layer 1: Immutable per prompt family. Assembled from source-code
   * constants only — no config values, no runtime state. Content must be
   * byte-identical across all calls that share the same prompt type
   * within a deploy.
   */
  layer1_static: string;

  /**
   * Layer 2: Stable per persona + prompt role. Changes only when the
   * debater or prompt type changes. Persona framing, role-specific
   * instructions, phase-specific blocks.
   */
  layer2_persona: string;

  /**
   * Layer 3: Stable per persona per turn. Identical across all 4 pipeline
   * stages (BRIEF/PLAN/DRAFT/CITE) within a single persona's turn, but
   * changes between turns as the transcript grows and taxonomy relevance
   * is re-scored. Contains: taxonomy context, audience directives,
   * source document.
   */
  layer3_turn: string;

  /**
   * Layer 4: Per-stage variable content. Transcript, prior stage outputs,
   * moderator focus point, assignment text. Never cached.
   */
  layer4_variable: string;

  /** Metadata for cache key computation and telemetry. */
  meta: {
    promptType: PromptType;
    persona?: PoverId;
    audience?: DebateAudience;
    phase?: DebatePhase;
    /** Hash of layer1 content, computed once at startup. */
    layer1Hash?: string;
  };
}

export type PromptType =
  | 'brief' | 'plan' | 'draft' | 'cite'
  | 'moderator' | 'synth_extract' | 'synth_map' | 'synth_evaluate'
  | 'clarification' | 'summarization' | 'gap_injection'
  | 'missing_args' | 'taxonomy_refinement' | 'legacy_monolithic';
```

### Validation Rules

1. **Layer 1 must be immutable per prompt family.** It should be computed once at module load and frozen. No function calls that read config, environment, or runtime state. The `allInstructions()` call is acceptable because it assembles from `const` strings, but it must be called with a fixed phase value or no phase (the phase-specific part moves to Layer 2).
2. **Layer 1 content must be byte-identical** across all calls within a deploy. A test (Section 9) enforces this.
3. **Layer 2 may depend on persona and prompt type** but not on debate configuration, topic, or turn state.
4. **Layer 3 is stable per persona per turn.** It may depend on debate configuration (topic, audience) and on the current transcript state (for taxonomy relevance scoring), but must be identical across all 4 pipeline stages within a single persona's turn.
5. **The `taxonomyContext` block belongs in Layer 3.** It is re-scored each turn against `topic + recentTranscript` (see `debateEngine.ts:525-527`) and diversified against `priorRefs` (line 554-558). It changes between turns but is computed once and passed to all 4 stages within a pipeline run. Audience directives are also Layer 3 — stable per debate, but grouping them with taxonomy avoids a near-empty layer.

### Worked Example: Migrating `draftStagePrompt`

Current construction at `prompts.ts:1516-1573`:

```typescript
export function draftStagePrompt(input: StagePromptInput, brief: string, plan: string): string {
  // ... phase directive computed from input.phase ...
  return `You are ${input.label}, an AI debater representing the ${input.pov} perspective...
Your personality: ${input.personality}.
${otherDebaters(input.label)}
${getReadingLevel(input.audience)}
${getDetailInstruction(input.audience)}

${MUST_CORE_BEHAVIORS}

${MUST_EXTENDED}

${STEELMAN_INSTRUCTION}

=== SITUATION BRIEF ===
${brief}

=== YOUR ARGUMENT PLAN ===
${plan}

=== YOUR ASSIGNMENT ===
Address ${input.addressing} on this point: ${input.focusPoint}
...`;
}
```

Migrated to envelope:

```typescript
export function draftStageEnvelope(
  input: StagePromptInput, brief: string, plan: string
): PromptEnvelope {
  const phaseDirective = /* ... same logic ... */;

  return {
    layer1_static: [
      MUST_CORE_BEHAVIORS,
      MUST_EXTENDED,
      STEELMAN_INSTRUCTION,
    ].join('\n\n'),

    layer2_persona: [
      `You are ${input.label}, an AI debater representing the ${input.pov} perspective on AI policy.`,
      `Your personality: ${input.personality}.`,
      otherDebaters(input.label),
      phaseDirective,
    ].join('\n'),

    layer3_turn: [
      getReadingLevel(input.audience),
      getDetailInstruction(input.audience),
      input.taxonomyContext,
    ].join('\n\n'),

    layer4_variable: [
      '=== SITUATION BRIEF ===',
      brief,
      '',
      '=== YOUR ARGUMENT PLAN ===',
      plan,
      '',
      '=== YOUR ASSIGNMENT ===',
      `Address ${input.addressing === 'general' ? 'the panel' : input.addressing} on this point: ${input.focusPoint}`,
      '',
      /* ... JSON schema, claim sketching instructions ... */
      '',
      RECENCY_ANCHOR,
    ].join('\n'),

    meta: {
      promptType: 'draft',
      persona: input.label.toLowerCase() as PoverId,
      audience: input.audience,
      phase: input.phase,
    },
  };
}
```

This reorders the prompt so that stable content comes first. The original prompt interleaves persona framing with instruction blocks; the envelope cleanly separates them. This reordering changes the prompt text the model sees, which will require validation that output quality is maintained — see rollout Stage 5 (Section 7) and the gating decision in Section 2.

### Layer 1 Pre-computation

To enforce the "immutable per prompt family" rule, Layer 1 content should be computed once:

```typescript
// Computed at module load, frozen, never changes.
const DRAFT_LAYER1 = Object.freeze(
  [MUST_CORE_BEHAVIORS, MUST_EXTENDED, STEELMAN_INSTRUCTION].join('\n\n')
);

// Hash for cache key and poisoning detection.
const DRAFT_LAYER1_HASH = computeHash(DRAFT_LAYER1);
```

The hash allows cache key computation without comparing full strings and provides a drift detection signal.

### Recency Anchor

Because the envelope places instruction blocks (Layer 1) at the start of the system message and the active assignment at the end of the user message (Layer 4), there is a risk that models under-weight the behavioral constraints as context length grows. As a lightweight mitigation, every envelope should append a compressed instruction reminder at the end of Layer 4:

```typescript
const RECENCY_ANCHOR = Object.freeze(
  'Reminder: Your response must strictly follow all MUST_CORE_BEHAVIORS ' +
  'and STEELMAN_INSTRUCTION rules defined earlier in this conversation.'
);
```

This is a ~30-token constant appended to the variable layer, so it does not affect caching. It reinforces instruction adherence without duplicating the full instruction set. The anchor text is identical across all prompts, making it easy to maintain.

## 4. Proposed `LLMBackend` Interface

```typescript
export interface GenerateRequest {
  envelope: PromptEnvelope;
  model: string;
  options: GenerateOptions;
  /** Provider-specific cache hints. Adapters may ignore unsupported hints. */
  cacheHint?: CacheHint;
}

export interface CacheHint {
  /**
   * Which layers to mark as cacheable prefix.
   * Default: [1, 2, 3] — cache everything except Layer 4.
   * Set to [1] to cache only Layer 1, etc.
   */
  cacheableLayers?: (1 | 2 | 3)[];
  /** Claude-specific: request extended 1-hour TTL instead of default 5min. */
  extendedTtl?: boolean;
}

export interface GenerateResponse {
  text: string;
  usage: CacheUsage;
  model: string;
  backend: string;
  responseTimeMs: number;
}

export interface CacheUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  /** Tokens read from cache (provider-reported, 0 if not supported). */
  cacheReadTokens: number;
  /** Tokens written to cache on this request (provider-reported, 0 if not supported). */
  cacheWriteTokens: number;
  /** Tokens that were neither cached nor cache-read (uncached input). */
  uncachedInputTokens: number;

  /** Cache hit ratio: cacheReadTokens / inputTokens. 0-1, 0 if no caching. */
  cacheHitRatio: number;

  /** Provider-specific raw usage for debugging. Not normalized. */
  raw?: Record<string, unknown>;
}

export interface LLMBackend {
  /** Generate with structured envelope and cache awareness. */
  generate(request: GenerateRequest): Promise<GenerateResponse>;

  /** Legacy compatibility: flat string prompt, no caching. */
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
}
```

### Provider Usage Mapping

> **To be verified against current provider docs before implementation.** Response field names, billing behavior, and cache minimum thresholds are exactly the kind of details that change between API versions. The mappings below reflect code inspection and provider documentation as of April 2026.

| CacheUsage field | Claude | OpenAI | Gemini | Groq |
|-----------------|--------|--------|--------|------|
| `inputTokens` | `usage.input_tokens` | `usage.input_tokens` | `usageMetadata.promptTokenCount` | `usage.prompt_tokens` |
| `outputTokens` | `usage.output_tokens` | `usage.output_tokens` | `usageMetadata.candidatesTokenCount` | `usage.completion_tokens` |
| `cacheReadTokens` | `usage.cache_read_input_tokens` | `usage.prompt_tokens_details.cached_tokens` | `usageMetadata.cached_content_token_count` | `usage.prompt_tokens_details.cached_tokens` (if available) |
| `cacheWriteTokens` | `usage.cache_creation_input_tokens` | 0 (not reported) | 0 (not separately reported) | 0 (not reported) |
| `uncachedInputTokens` | `inputTokens - cacheReadTokens - cacheWriteTokens` | `inputTokens - cacheReadTokens` | `inputTokens - cacheReadTokens` | `inputTokens - cacheReadTokens` |

**What's lost in normalization:**

- Claude distinguishes cache write cost (25% more than base for 5-min TTL, 2x more for 1-hour TTL) and cache read discount (90% cheaper). The `CacheUsage` struct reports token counts but not pricing — cost computation must happen at a higher layer using provider-specific rates.
- Claude's 5-minute vs 1-hour TTL distinction is captured by the `extendedTtl` flag on the request side but not in the response (Claude doesn't report which TTL was used in the response).
- OpenAI's caching is fully implicit — there's no write event to report, and cached tokens are billed at 50% discount. The `cacheWriteTokens` field will always be 0 for OpenAI.
- Gemini's implicit caching (2.5 Flash/Pro) doesn't report cache writes at all. Its explicit Context Caching API reports cached content separately but uses a different billing model (per-token storage cost per hour). The `CacheUsage` struct doesn't model storage costs.
- Groq's caching support is model-dependent and the response format for cached token reporting varies. The `raw` field preserves whatever they return.

## 5. Per-Provider Adapter Specs

### 5.1 Claude Adapter

**Current state** (`aiAdapter.ts:198-248`): Sends a single `user` message. Does not use system messages. Does not extract usage. Does not use `cache_control`.

**Proposed changes:**

The adapter must restructure the flat prompt into Claude's messages format with `cache_control` breakpoints:

```typescript
// Pseudocode for Claude envelope -> API request
function buildClaudeRequest(req: GenerateRequest): ClaudeApiBody {
  const layers = req.envelope;
  const system: ClaudeContentBlock[] = [];

  // Layer 1: static instructions as first system block, cached
  system.push({
    type: 'text',
    text: layers.layer1_static,
    cache_control: { type: 'ephemeral' },  // breakpoint 1
  });

  // Layer 2: persona-specific as second system block, cached
  if (layers.layer2_persona) {
    system.push({
      type: 'text',
      text: layers.layer2_persona,
      cache_control: { type: 'ephemeral' },  // breakpoint 2
    });
  }

  // Layer 3: per-turn context (taxonomy + audience) as third system block, cached
  if (layers.layer3_turn) {
    system.push({
      type: 'text',
      text: layers.layer3_turn,
      cache_control: { type: 'ephemeral' },  // breakpoint 3
    });
  }

  return {
    model: resolvedModelId,
    system,
    messages: [{ role: 'user', content: layers.layer4_variable }],
    max_tokens: req.options.maxTokens ?? 8192,
    temperature: req.options.temperature ?? 0.7,
  };
}
```

**Cache breakpoint placement (3 of 4 allowed):**

1. **After Layer 1** (~1,750 tokens for draft, ~500 for others). This is the highest-value breakpoint: Layer 1 is identical across all prompts that share the same instruction set. A Prometheus draft and a Sentinel draft hit the same Layer 1 cache. A draft and a brief do not (different instruction sets), so this breakpoint serves within-stage, cross-persona reuse.

2. **After Layer 2** (~2,200-3,000 tokens cumulative). This captures persona + role. Within a single debate, each persona makes multiple calls at the same stage type (e.g., Prometheus brief in round 1 and round 3). Layer 1+2 will be identical for those calls. This breakpoint enables cross-turn, same-persona reuse.

3. **After Layer 3** (~5,000-15,000 tokens cumulative including taxonomy). This captures everything stable for a single persona's turn. The taxonomy context is re-scored each turn against the current transcript, so this cache is hit only within the 4-stage pipeline run (BRIEF → PLAN → DRAFT → CITE) for one persona. The first stage writes the cache; stages 2-4 read it. This yields 3 cache reads per pipeline run — the tightest but most reliable reuse window.

**The fourth breakpoint is reserved** for future use (e.g., splitting Layer 3 into taxonomy and source document if source documents are large enough to justify separate caching).

**TTL strategy:** Default to 5-minute TTL. The primary reuse window is the 4-stage pipeline within a single persona's turn, which typically completes in 30-90 seconds — well within the 5-minute TTL. Layer 1+2 cache entries may also survive across rounds if the round completes quickly enough, but this is a bonus, not the design target. For longer debates (8+ rounds) or batch debate runs, the 1-hour TTL may be worth the 2x write cost for Layer 1+2 entries (which are stable across rounds for the same persona), but Layer 3 entries change every turn regardless. The adapter should accept the `extendedTtl` flag from `CacheHint` but default to `false`.

**TTL expiry risk within a turn:** The 4-stage pipeline is sequential, and the retry logic (`aiAdapter.ts:105-131`) uses delays of `[5, 15, 45]` seconds. A single stage with full retry exhaustion can take ~4-5 minutes (180s timeout + 65s retries). While unlikely, multiple retried stages within one turn could breach the 5-minute TTL. Rather than dynamically switching to the 1-hour TTL (which doubles write cost), the pipeline should track cumulative elapsed time and, if it exceeds ~3.5 minutes before the final stage, accept that the last stage will incur a cache write at the normal 1.25x rate. This is cheaper than switching all remaining writes to 2x. The baseline measurement phase (Section 6.4) should capture per-turn elapsed times to quantify how often this scenario occurs in practice.

**Minimum prefix size check:** Claude Opus 4.7 requires 4,096 tokens. The draft stage's Layer 1 alone is ~1,750 tokens — below minimum. Layer 1+2 together reach ~2,500-3,000 tokens — still below Opus minimum. Only Layer 1+2+3 (with taxonomy) reliably exceeds 4,096. For Sonnet 4.6 (2,048 minimum), Layer 1+2 for draft may suffice. **Recommendation:** For Opus, consolidate breakpoints 1 and 2 into a single breakpoint after Layer 2, effectively caching Layers 1+2 as a unit. For Sonnet, use all three breakpoints. The adapter should check the model family and adjust breakpoint placement accordingly.

### 5.2 OpenAI Adapter

**Current state** (`aiAdapter.ts:303-353`): Uses OpenAI's Responses API (`/v1/responses`), sends prompt as flat `input` string. No cache directives.

**Proposed changes:**

OpenAI's prompt caching is implicit and prefix-based — no special headers needed. The adapter's job is to structure the prompt so the prefix is stable.

For the Responses API, the adapter should move Layer 1-3 into a system instruction (the `instructions` field) and Layer 4 into the `input` field. OpenAI caches the longest matching prefix automatically.

There's no `prompt_cache_key` parameter in OpenAI's current API. Caching is purely prefix-based. The adapter doesn't need to compute a cache key — it just needs to ensure prompt ordering is consistent.

The adapter should extract `usage.prompt_tokens_details.cached_tokens` from the response (if present) and map it to `CacheUsage.cacheReadTokens`.

### 5.3 Gemini Adapter

**Current state** (`aiAdapter.ts:148-196`): Sends prompt as a single `text` part in `contents`. No system instruction. No caching directives.

**Proposed changes:**

Gemini 2.5 Flash and Pro support implicit caching on requests over 1,024 / 2,048 tokens respectively. The adapter should move Layer 1-3 into `systemInstruction` and Layer 4 into `contents`:

```typescript
{
  systemInstruction: {
    parts: [{ text: layers.layer1_static + '\n\n' + layers.layer2_persona + '\n\n' + layers.layer3_turn }]
  },
  contents: [{ parts: [{ text: layers.layer4_variable }] }],
  generationConfig: { ... }
}
```

This structure ensures the prefix (system instruction) is identical across all 4 stages within a single persona's pipeline run, enabling implicit cache hits within that run.

**Explicit caching (Context Caching API):** For batch debate runs (running many debates with the same taxonomy), Gemini's explicit caching via `cachedContents.create` could cache the entire Layer 1-3 block. The cache has a minimum of 32,768 tokens for explicit caching, which the debate engine's combined Layer 1-3 typically doesn't reach (it's usually 5,000-15,000 tokens). Explicit caching is not worth pursuing for the current workload unless source documents are very large. **Recommendation:** Implicit only.

The adapter should extract `usageMetadata.cached_content_token_count` from the response for telemetry.

### 5.4 Groq Adapter

**Current state** (`aiAdapter.ts:250-299`): Uses OpenAI-compatible chat completions endpoint. Single `user` message.

**Proposed changes:**

Groq supports implicit prefix caching on select models. Like OpenAI, the adapter's job is prompt ordering, not explicit directives.

The adapter should move Layer 1-3 into a `system` message and Layer 4 into the `user` message:

```typescript
messages: [
  { role: 'system', content: layer1 + '\n\n' + layer2 + '\n\n' + layer3 },
  { role: 'user', content: layer4 },
]
```

**Model coverage caveats:** Groq's caching support is model-dependent. As of the current model registry (`ai-models.json`), the Groq models available are:
- `llama-3.3-70b-versatile` — caching support unclear
- `llama-3.1-8b-instant` — likely no caching (small model)
- `llama-4-scout-17b-16e` — likely supports caching
- `qwen/qwen3-32b` — caching support unclear
- `moonshotai/kimi-k2-instruct*` — caching support unclear

Groq's documentation should be checked for current caching support. The adapter should attempt structured prompting (system + user) regardless, as it's good practice even without caching, and gracefully report `cacheReadTokens: 0` when the provider doesn't return cache metrics.

## 6. Telemetry Plan

### 6.1 `CacheUsage` Population

The `CacheUsage` struct (defined in Section 4) is populated by each provider adapter from its raw response. The adapter is responsible for:
1. Extracting provider-specific usage fields
2. Computing derived fields with defensive clamping (see below)
3. Preserving the raw response usage in the `raw` field

**Normalization rules for derived fields:**

Providers may report partial, inconsistent, or missing token counts. To prevent negative values or bogus ratios, all derived fields must be clamped:

```typescript
usage.uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
usage.cacheHitRatio = inputTokens > 0
  ? Math.min(1, Math.max(0, cacheReadTokens / inputTokens))
  : 0;
```

If a provider does not report `cacheReadTokens` or `cacheWriteTokens`, default them to `0` before computing derived fields. Log a warning if `cacheReadTokens + cacheWriteTokens > inputTokens`, as this indicates a provider accounting inconsistency worth investigating.

### 6.2 Emission Points

Metrics should be emitted at two levels:

**Per-call level** (in the adapter's `generate` method):
- Log a structured JSON line to stderr with: `timestamp`, `debateId`, `turnIndex`, `stageIndex`, `backend`, `model`, `promptType`, `persona`, `audience`, `phase`, all `CacheUsage` fields, `responseTimeMs`, `layer1Hash`, `layer3Hash`
- This integrates with the existing `process.stderr.write` pattern used for retry logging
- **Log persistence**: stderr from the debate engine subprocess must be captured to a durable log file, not just displayed in the terminal. The PowerShell caller (`Show-TriadDialogue`) should redirect stderr to a per-debate log file at `$env:AI_TRIAD_DATA_ROOT/logs/debate-{debateId}-cache.jsonl`. If the engine is invoked via `npm run debate`, the CLI wrapper should do the same. These logs must survive the process exit and be retained for at least 30 days for cost reconciliation against provider billing

**Per-debate level** (in `debateEngine.ts`, extending existing `DebateDiagnostics`):
- Aggregate per-debate: total input/output tokens, total cache reads/writes, overall hit ratio
- Per-prompt-type breakdown: hit rate for brief vs draft vs cite vs moderator
- Per-persona breakdown: are all three personas hitting cache equally?

### 6.3 Dashboard Metrics

The telemetry should support answering:

1. **Cache hit rate** per `(promptType, audience, backend)` — the primary efficiency metric. Initial hypotheses (to be validated against baseline measurements): ~75% for Layer 1+2 hits within a debate (cross-turn reuse depends on TTL survival between rounds), ~75% for Layer 3 hits within a pipeline run (3 of 4 stages hit the first stage's cache). Layer 3 hits across different turns are 0% by design — taxonomy context is re-scored each turn. These are targets to test, not expected outcomes.
2. **Write-vs-read token ratio** — high writes and low reads indicate cache churn or poisoning. Should trend toward many reads per write.
3. **Latency split** by hit/miss — cache hits should show lower TTFT (time to first token). If they don't, the prefix may be too short to cache or the provider isn't actually caching.
4. **Cost impact** — `(cacheReadTokens * read_rate + cacheWriteTokens * write_rate + uncachedInputTokens * base_rate)` vs `(inputTokens * base_rate)`. Provider rates are external config.
5. **Poisoning detection** — Layer 1 hash drift (should be constant within a deploy), Layer 3 hash drift within a single pipeline run (should be constant across all 4 stages).

### 6.4 Baseline Measurement Plan

Before any prompt restructuring, instrument the current code to measure:

1. **Current token usage per call** — the TypeScript adapter currently discards this. Step 1 of the rollout (Section 7) adds extraction.
2. **Call pattern** — how many calls per debate, per prompt type, per persona. The engine already tracks `apiCallCount` and `totalResponseTimeMs` in diagnostics; extend with per-call breakdown.
3. **Prompt sizes** — log `layer4_variable.length` (i.e., the full prompt since there's no layering yet) for each call. This establishes the "no caching" baseline.

Run for at least one week of normal usage, covering a variety of topics and audiences, to establish:
- Average tokens per call by prompt type
- Average debate cost
- Response time distribution
- Any natural variance in prompt sizes (e.g., do taxonomy contexts vary significantly across topics?)

## 7. Staged Rollout Plan

### Stage 1: Instrument Token Usage (no behavior change)

**What**: Extract and log usage metadata from all four provider responses in `aiAdapter.ts`. Add a `CacheUsage` return path alongside the existing `string` return for backward compatibility.

**How**: Add a parallel method or wrapper that returns `GenerateResponse` instead of `string`. The existing `generateText` continues to work unchanged. The engine switches to the new method where it's ready.

**Success criteria**: Usage data appears in debug logs for every API call. No change to debate output quality.

**Rollback**: Remove the logging. No risk.

**Duration**: Ship immediately, measure for 1 week.

### Stage 2: Baseline Measurement (1 week)

**What**: Run debates as normal, collecting per-call usage telemetry.

**Watching**: Token counts per prompt type, response times, overall debate costs. This is the "before" data.

**Success criteria**: At least 10 complete debates with telemetry data across at least 2 backends.

### Stage 3: Introduce `PromptEnvelope` Type (no migration)

**What**: Add the `PromptEnvelope` type, `CacheHint`, `CacheUsage`, and `LLMBackend` interface to the codebase. Add envelope-building functions alongside existing prompt functions (e.g., `draftStageEnvelope` next to `draftStagePrompt`). Do not call them yet.

**Success criteria**: Type checks pass. A **content coverage test** verifies that every substantive substring present in the original prompt function's output appears in exactly one layer of the corresponding envelope, and that no content is dropped or duplicated. This test does not require order preservation (the envelope intentionally reorders content). Additionally, a **round-trip sanity check** verifies that the flattened envelope (`layer1 + '\n\n' + layer2 + '\n\n' + layer3 + '\n\n' + layer4`) contains all the same instruction blocks, persona framing, and variable content as the original prompt — verified by checking for the presence of known sentinel strings from each layer.

**Rollback**: Delete the new files. No production impact.

### Stage 4: Migrate DRAFT Stage (one prompt type)

**What**: Switch the draft stage in `runTurnPipeline` to use `draftStageEnvelope` + `LLMBackend.generate()` instead of `draftStagePrompt` + `generateText()`.

**Why draft first**: It has the largest static prefix (~7,000 chars of instruction blocks) and runs once per turn per persona — the highest-frequency, highest-token-count prompt type. It's where caching leverage is greatest.

**Important**: The envelope reorders prompt content (instructions first, persona second). This changes what the model sees. Run A/B comparisons on 5-10 debates to verify output quality is maintained. Compare turn validation pass rates, grounding confidence, and claim extraction rates between old and new prompt ordering.

**Success criteria**: Cache hit ratio >0% on the Claude backend (confirming breakpoints work). Turn validation pass rate within 5% of baseline. No degradation in debate quality.

**Rollback**: Revert to `draftStagePrompt`. One-line change in `turnPipeline.ts`.

**Duration**: Ship, measure for 1 week.

### Stage 5: Quality Validation (1 week)

**What**: Run at least 5 full debates using the envelope-based draft stage. Compare against baseline debates.

**Watching**: Turn validation pass rates, grounding confidence scores, claim extraction funnels, judge audit scores (if available). The prompt reordering may subtly change model behavior — this week is for catching that.

**Success criteria**: No statistically significant regression in any quality metric. Cache hit ratio for draft stage's Layer 3 > 60% within pipeline runs (target: 3 of 4 stages hit cache). Layer 1+2 cross-round hits are a bonus — any value > 0% confirms TTL survival.

### Stage 6: Migrate Remaining Prompt Types

**What**: Migrate BRIEF, PLAN, CITE, and MODERATOR to envelope pattern. Utility prompts (clarification, summarization, etc.) are low-leverage and can be migrated last or left as-is.

**Order**: BRIEF and PLAN first (they're structurally simpler and their output feeds into DRAFT), then CITE (depends on prior stages), then MODERATOR (independent call path).

**Success criteria**: All pipeline stages use envelopes. Within-pipeline-run cache hit ratio >60% (3 of 4 stages). Overall debate cache hit ratio >30% (accounting for pipeline-run granularity of Layer 3).

### Stage 7: Cache-Poisoning Lint (CI)

**What**: Add the determinism test (Section 9) to the CI pipeline. This locks in the guarantee that Layer 1 content is stable.

**Success criteria**: CI fails if someone adds `Date.now()` to a prompt template.

## 8. Failure Modes and Operational Monitoring

### 8.1 Graceful Degradation Contract

Caching is an optimization, not a correctness requirement. If any caching mechanism fails, the debate must still complete with correct output. The following failures must degrade gracefully:

| Failure | Behavior | Detection |
|---------|----------|-----------|
| Envelope construction throws | Fall back to `generateText` with flattened `layer1 + layer2 + layer3 + layer4` as a plain string. Log the error. Debate continues without caching. | Per-call log shows `envelope_fallback: true` |
| Provider rejects system message | Retry with all layers concatenated into a single user message (current behavior). Log the rejection. | Per-call log shows `system_message_rejected: true` |
| Hash assertion fails at startup | Log a warning, **do not abort**. The debate engine must still start. Cache breakpoints may be suboptimal but the prompt is still correct. | Startup log shows `layer1_hash_mismatch: true` with expected vs actual hashes |
| Provider returns no cache fields | Default all cache metrics to 0. Debate output is unaffected. | `cacheReadTokens === 0 && cacheWriteTokens === 0` for all calls to that provider |
| Layer 3 hash differs across stages within a pipeline run | Taxonomy sort non-determinism (see Section 11, "Taxonomy Context Stability"). Cache hits are lost but prompts are correct. | `layer3Hash` differs between stages in the same `(debateId, turnIndex)` group |

**The key invariant:** Every `generate()` call that fails must fall back to `generateText()` with the concatenated envelope. The debate must never abort due to a caching-related error.

### 8.2 Silent Degradation Risks

These failures produce correct debate output but silently eliminate cache benefit:

| Risk | Cause | How to detect |
|------|-------|---------------|
| **Cache never hits** | Prefix below provider minimum; provider silently changed minimum token count | `cacheReadTokens === 0` for >20 consecutive calls on a provider that should support caching |
| **Cache always writes, never reads** | Layer content differs between stages within a pipeline run (sort non-determinism, embedding non-determinism) | `cacheWriteTokens > 0 && cacheReadTokens === 0` within a pipeline run |
| **Legacy path used instead of envelope** | Code path regression; a caller invokes `generateText` instead of `generate` | Per-call log missing `promptType` field (legacy path doesn't log envelope metadata) |
| **Layer assignment bug** | Content that should be in Layer 3 placed in Layer 4 (e.g., taxonomy context in the variable portion) | Layer 3 is unexpectedly small (< 500 tokens for DRAFT) or Layer 4 is unexpectedly large |
| **Recency anchor stale** | Anchor references instruction block names that were renamed | Manual review during any instruction block rename |
| **Provider billing model changed** | Cache reads no longer discounted, or write premium changed | Monthly cost reconciliation: compare `predicted_cost` (from telemetry) vs `actual_cost` (from provider invoice) |

### 8.3 Alerting Thresholds

After the rollout stabilizes (post-Stage 7), the following conditions should trigger investigation:

| Alert | Condition | Severity | Likely cause |
|-------|-----------|----------|-------------|
| **Cache miss spike** | Layer 3 hit rate drops below 50% within pipeline runs for >3 consecutive debates | Warning | Sort non-determinism, embedding non-determinism on retry, taxonomy context mutation |
| **Zero cache activity** | `cacheReadTokens === 0 && cacheWriteTokens === 0` for all calls in a complete debate on Claude | Error | Envelope not being used, or provider API change broke `cache_control` |
| **Hash drift** | `layer1Hash` value changes between debates without a corresponding code deploy | Error | Non-deterministic content in Layer 1 (should be impossible if Section 9 tests pass) |
| **Cost regression** | Per-debate cost exceeds 120% of baseline average (from Stage 2) for >5 consecutive debates | Warning | Cache writes without reads (paying 1.25x overhead with no offset) |
| **Telemetry gap** | A debate completes but its `debate-{id}-cache.jsonl` log file is missing or empty | Error | Log capture broken; operating blind |

### 8.4 Operational Runbook: "Cache Hit Rate Is Zero"

1. **Check the log file exists** at `$env:AI_TRIAD_DATA_ROOT/logs/debate-{debateId}-cache.jsonl`. If missing, the log capture pipeline is broken — fix that first.
2. **Check `cacheWriteTokens`** in the log. If writes are also zero, the envelope path isn't being used — check that `turnPipeline.ts` calls `generate()` not `generateText()`.
3. **Check `layer3Hash`** consistency within a pipeline run. If it differs between stages, taxonomy sorting is non-deterministic — re-verify the tie-breaker fix.
4. **Check provider response `raw` field** for cache-related fields. If the provider stopped returning them, the usage mapping (Section 4) needs updating.
5. **Check prefix size** against provider minimums. If Layer 1+2 is below minimum, consolidate breakpoints per the recommendation in Section 5.1.
6. **Try a manual test**: run a single debate with Claude, inspect the raw API response for `cache_read_input_tokens`. If present and non-zero, the provider is caching but the adapter isn't extracting correctly.

### 8.5 Post-Rollout Lifecycle

After the staged rollout completes, the caching system transitions from "experiment" to "infrastructure." The following ongoing activities are required:

- **Monthly cost reconciliation**: Compare predicted cost (from per-call telemetry) against actual provider invoices. A >10% discrepancy means the billing model assumptions (Section 11, "Cost-Benefit Reality Check") are wrong and the ROI calculation needs revision.
- **Quarterly provider audit**: Verify that the response field mappings in the provider usage mapping table (Section 4) still match current provider documentation. Provider APIs change; the adapter must track.
- **On any `prompts.ts` change**: Re-run the determinism test (Section 9.1) and update the hash file if Layer 1 content changed. CI enforces this, but the developer should understand *why* the hash changed.
- **On any `taxonomyContext.ts` or `taxonomyRelevance.ts` change**: Verify the sort tie-breaker is preserved. Add new sorts with the tie-breaker from the start.

## 9. Cache-Poisoning Prevention

### 9.1 Layer Determinism Test

A unit test that constructs every envelope-building function twice with different timestamps, UUIDs, and random seeds, and asserts that Layers 1, 2, and 3 are byte-identical:

```typescript
describe('prompt envelope determinism', () => {
  for (const promptType of ['draft', 'brief', 'plan', 'cite', 'moderator'] as const) {
    it(`${promptType}: layers 1-3 are deterministic`, () => {
      // Mock Date.now, Math.random, crypto.randomUUID
      const original = { now: Date.now, random: Math.random };
      try {
        Date.now = () => 1000000;
        Math.random = () => 0.1;

        const env1 = buildEnvelope(promptType, sampleInput());

        Date.now = () => 9999999;
        Math.random = () => 0.9;

        const env2 = buildEnvelope(promptType, sampleInput());

        expect(env1.layer1_static).toBe(env2.layer1_static);
        expect(env1.layer2_persona).toBe(env2.layer2_persona);
        expect(env1.layer3_turn).toBe(env2.layer3_turn);
        // layer4 is allowed to differ
      } finally {
        Date.now = original.now;
        Math.random = original.random;
      }
    });
  }
});
```

### 9.2 Static Analysis Check

A grep-based CI check that flags dangerous calls reachable from prompt construction:

```bash
# Flag dynamic content generators in prompt construction code
rg '(Date\.now|new Date|Math\.random|crypto\.randomUUID|uuid|performance\.now)' \
   lib/debate/prompts.ts lib/debate/taxonomyContext.ts \
   --no-heading --line-number
```

If this finds any hits, CI fails with a message explaining why dynamic content in prompt templates is prohibited and pointing to this design doc.

This check is coarse — it will flag legitimate uses (e.g., a comment mentioning `Date.now`) and miss subtler sources of nondeterminism (data ordering, locale effects, upstream scoring drift). **It is a supplement, not a gatekeeper.** The hash assertion (Section 9.3) is the primary guardrail for cache determinism; this grep catches common mistakes early in the development cycle before they reach a hash mismatch.

### 9.3 Layer 1 Hash Assertion

At startup, compute `SHA-256(layer1_static)` for each prompt type and compare against a checked-in hash file. If the hash changes, it means someone modified an instruction block that should be immutable per prompt family. This is expected during development but should be a deliberate act — the developer must update the hash file, which creates a visible diff in code review. **This is the primary determinism guardrail** — it catches all sources of drift regardless of cause, including the subtle ones (data ordering, locale, floating-point) that the grep check in Section 9.2 cannot detect.

## 10. Implementation Guide

This section translates the design into concrete file changes for the implementer.

### 10.1 File Plan

**New files to create:**

| File | Contents | Approx lines |
|------|----------|-------------|
| `lib/debate/cacheTypes.ts` | `PromptEnvelope`, `PromptType`, `CacheHint`, `CacheUsage`, `GenerateRequest`, `GenerateResponse`, `LLMBackend` interfaces. Normalization helpers (`clampCacheUsage`, `emptyCacheUsage`). | ~120 |
| `lib/debate/envelopes.ts` | Envelope-building functions (`draftStageEnvelope`, `briefStageEnvelope`, etc.) alongside pre-computed Layer 1 constants (`DRAFT_LAYER1`, hashes). `RECENCY_ANCHOR` constant. | ~400 |
| `lib/debate/layer1Hashes.json` | Checked-in SHA-256 hashes for each prompt type's Layer 1. Updated manually when instruction blocks change. | ~15 |

**Files to modify:**

| File | Change | Risk |
|------|--------|------|
| `aiAdapter.ts` | Add `generate(req: GenerateRequest): Promise<GenerateResponse>` to each backend. Extract usage fields from raw responses. Keep `generateText` unchanged. | Medium — touching all 4 provider functions |
| `turnPipeline.ts` | Add an `EnvelopeStageGenerateFn` type alongside `StageGenerateFn`. Pipeline stages call envelope builders when an envelope-aware generator is provided, flat prompt builders otherwise. | Medium — dual-path logic |
| `debateEngine.ts` | Modify `stageGenerate` closures (lines 819, 1186) to use `generate()` when available, with bookkeeping (`apiCallCount`, `totalResponseTimeMs`) preserved. Aggregate `CacheUsage` into `DebateDiagnostics`. | Low — wrapper change |
| `taxonomyContext.ts` | Add deterministic tie-breaker to all 5 sort calls (lines 149, 195, 231, 278, 375). | Low |
| `taxonomyRelevance.ts` | Add deterministic tie-breaker to both sort calls (lines 84, 108). | Low |
| `types.ts` | Extend `DebateDiagnostics` with cache telemetry fields. | Low |
| `index.ts` | Re-export from `cacheTypes.ts` and `envelopes.ts`. | Trivial |

**Files NOT modified:** `prompts.ts` (existing prompt functions remain unchanged; envelope builders in the new `envelopes.ts` call into them or parallel their logic), `debateExport.ts`, `schemas.ts`, `helpers.ts`.

### 10.2 The Pipeline Dual-Path Problem

The current pipeline signature:

```typescript
type StageGenerateFn = (prompt: string, model: string, options: GenerateOptions, label: string) => Promise<string>;
```

The caching layer needs:

```typescript
type EnvelopeGenerateFn = (envelope: PromptEnvelope, model: string, options: GenerateOptions, label: string) => Promise<GenerateResponse>;
```

The pipeline must support both during the staged rollout (Stages 4-6 migrate one prompt type at a time). The recommended approach:

```typescript
interface PipelineGenerators {
  legacy: StageGenerateFn;
  envelope?: EnvelopeGenerateFn;
}
```

Each stage checks `generators.envelope` first. If present, it calls the envelope builder for that stage and uses the envelope path. If absent, it falls back to the legacy prompt builder and flat `generate`. This lets individual stages migrate independently.

The `stageGenerate` closure in `debateEngine.ts` (lines 819, 1186) wraps both paths, preserving `apiCallCount++` and `totalResponseTimeMs += delta` for both. When using the envelope path, it also aggregates `CacheUsage` into a per-pipeline-run accumulator that flows into `DebateDiagnostics`.

### 10.3 The Fallback Response

When `generate()` fails and falls back to `generateText()`, the adapter must synthesize a `GenerateResponse`:

```typescript
function fallbackResponse(text: string, startMs: number): GenerateResponse {
  return {
    text,
    usage: emptyCacheUsage(),
    model: 'unknown',
    backend: 'unknown',
    responseTimeMs: Date.now() - startMs,
  };
}
```

`emptyCacheUsage()` returns all fields as 0 with `raw: undefined`. This makes fallback responses visible in telemetry (zero cache fields with non-zero `inputTokens` once Stage 1 instrumentation is in place) without breaking any downstream logic.

### 10.4 Sort Fix Inventory

Seven sort calls require deterministic tie-breakers, not five as noted elsewhere in this document:

| File | Line | Sorts by | Tie-breaker to add |
|------|------|----------|-------------------|
| `taxonomyContext.ts` | 149 | node relevance score | `a.id.localeCompare(b.id)` |
| `taxonomyContext.ts` | 195 | vulnerability score | `a.id.localeCompare(b.id)` |
| `taxonomyContext.ts` | 231 | situation node score | `a.id.localeCompare(b.id)` |
| `taxonomyContext.ts` | 278 | interpretation text length | `a.text.localeCompare(b.text)` |
| `taxonomyContext.ts` | 375 | node relevance score (manifest) | `a.id.localeCompare(b.id)` |
| `taxonomyRelevance.ts` | 84 | category node score | `a.node.id.localeCompare(b.node.id)` |
| `taxonomyRelevance.ts` | 108 | situation node score | `a.node.id.localeCompare(b.node.id)` |

### 10.5 Implementation Order

1. **Sort fixes** (taxonomyContext.ts, taxonomyRelevance.ts) — prerequisite, can ship immediately
2. **Stage 1**: Add usage extraction to `aiAdapter.ts` (4 provider functions) — no new types needed, just log the raw usage fields
3. **Stage 2**: Baseline measurement — no code changes, just run debates
4. **Stage 3**: Create `cacheTypes.ts` and `envelopes.ts`. Write content coverage tests. No callers yet.
5. **Stage 4**: Add `generate()` to `aiAdapter.ts`. Modify `turnPipeline.ts` to support `PipelineGenerators`. Migrate DRAFT stage in `debateEngine.ts`.
6. **Stage 5**: Quality validation — no code changes
7. **Stage 6**: Migrate BRIEF, PLAN, CITE, MODERATOR in `envelopes.ts` + `turnPipeline.ts`
8. **Stage 7**: Add CI checks — determinism test, grep lint, hash assertion

### 10.6 Maintainer's Guide: Common Tasks

This subsection covers the recurring tasks that future maintainers will encounter.

#### Adding a New Prompt Type

1. Write the prompt function in `prompts.ts` as usual (flat string return).
2. Write a corresponding envelope builder in `envelopes.ts`. Decide which content belongs in each layer:
   - **Layer 1**: Instruction blocks that are identical across all calls of this type (use existing pre-computed constants like `DRAFT_LAYER1` if the instruction set is shared; create a new one if not).
   - **Layer 2**: Persona-specific content (name, personality, role framing) and phase-specific directives.
   - **Layer 3**: Content that's stable within a pipeline run but changes between turns (taxonomy context, audience directives).
   - **Layer 4**: Everything else (prior stage outputs, assignment, transcript).
3. If the new prompt type has a unique Layer 1, add its hash to `layer1Hashes.json` by running the hash computation and committing the result.
4. Add the new type to the `PromptType` union in `cacheTypes.ts`.
5. Add a determinism test case for the new type in the test file (Section 9.1 pattern).
6. Add a content coverage test verifying the envelope contains all content from the flat prompt.

#### Modifying an Instruction Block

Instruction blocks (`MUST_CORE_BEHAVIORS`, `MUST_EXTENDED`, `STEELMAN_INSTRUCTION`, etc.) are Layer 1 content. Modifying them changes the Layer 1 hash, which triggers a CI failure.

1. Make the change in `prompts.ts`.
2. Run the determinism test locally — it will fail with the old hash.
3. Run the hash computation script to generate the new hash.
4. Update `layer1Hashes.json` with the new hash.
5. Commit both changes together. The hash file diff in code review makes the Layer 1 change visible.

This is intentional friction — Layer 1 changes invalidate all cached prefixes, so they should be deliberate.

#### Adding a New Sort Call

Any `.sort()` in `taxonomyContext.ts` or `taxonomyRelevance.ts` **must** include a deterministic tie-breaker. The pattern:

```typescript
.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
```

If the items don't have an `id` field, use whatever stable string identifier they have. If sorting by something other than score, add a secondary sort on a stable field. The grep lint (Section 9.2) won't catch a missing tie-breaker — the hash assertion (Section 9.3) will catch it only if it causes Layer 3 drift, and only at runtime. **This is a convention that must be maintained by code review.**

#### Adding a New Provider

1. Add a `generateVia[Provider]` function in `aiAdapter.ts` following the existing pattern.
2. Add the provider to the usage mapping table (Section 4) with the response field names for cache metrics.
3. Add the provider to the `generate()` method with provider-specific system/user message structuring.
4. If the provider has explicit cache directives (like Claude's `cache_control`), handle them in the adapter. If caching is implicit (like OpenAI), just structure the prompt correctly.
5. Default any unsupported cache fields to 0. Preserve the raw response in `CacheUsage.raw` for debugging.
6. Update the Groq-style caveat section if the provider's caching support is model-dependent.

#### The Ongoing Tax

This caching layer adds the following maintenance burden:

- **Hash file updates** when instruction blocks change (~2 minutes, happens rarely)
- **Sort tie-breaker convention** on any new sort in taxonomy code (code review catch)
- **Quarterly provider API audit** to verify response field mappings still work (~30 minutes)
- **Monthly cost reconciliation** against provider invoices (~15 minutes if telemetry is flowing)
- **Envelope builders** for new prompt types (~30 minutes per type, follows a template)

The Layer 1 hash file is the most visible friction point. If it becomes burdensome, consider replacing the checked-in hash with a test that computes the hash at test time and asserts it's identical across two invocations (the determinism test already does this — the hash file is redundant with it and could be dropped in favor of the test alone).

## 11. Open Questions and Risks

### Prompt Reordering Changes Model Behavior

See Section 2 for the full decision framework and fallback options. This is the highest-risk aspect of the design and is now treated as a gating decision rather than a rollout concern.

### System Message vs User Message

The current code puts everything in a single `user` message. Moving Layer 1 to a `system` message (as proposed for Claude and Gemini) changes the model's interpretation. System messages are treated as meta-instructions; user messages are treated as direct requests. The instruction blocks (`MUST_CORE_BEHAVIORS`, etc.) are arguably system-level content that belongs in a system message anyway, but this is a behavioral change that needs testing.

### The Pipeline Architecture Limits Cross-Stage Caching

The 4-stage pipeline (BRIEF -> PLAN -> DRAFT -> CITE) means each stage has a different prompt structure with different static content. Layer 1 content is shared across stages only if we make a single universal instruction block. Currently, DRAFT includes `MUST_CORE_BEHAVIORS + MUST_EXTENDED + STEELMAN_INSTRUCTION` while BRIEF and PLAN do not. If we want cross-stage Layer 1 sharing, we'd need to include the full instruction set in all stages (wasteful for BRIEF/PLAN which don't need it) or accept that Layer 1 caching is stage-specific.

**Recommendation:** Accept stage-specific Layer 1. Cross-persona sharing within the same stage type is the primary win. Cross-stage sharing is a bonus if achievable.

### Legacy Monolithic Prompt

The `crossRespondPrompt()` function (line 1115) is exported but not used by the pipeline. It contains the full `allInstructions(phase)` block (~36KB) and would benefit enormously from caching (all instruction blocks + taxonomy in a single prompt). If there's ever a reason to reintroduce the monolithic path (e.g., for models that perform better with a single large prompt), it would be the highest-leverage caching target. Worth keeping in mind but not worth designing for now.

### Taxonomy Context Stability

The taxonomy context is **per-persona per-turn**, not per-debate. `getRelevantTaxonomyContext()` (`debateEngine.ts:522-570`) builds a relevance query from `topic + recentTranscript` (line 526-527), computes embedding-based or lexical similarity scores against all taxonomy nodes, applies a diversification penalty against recently-cited nodes (line 554-558), then selects and formats the top-scoring nodes. The transcript grows every turn, so the relevance scores — and therefore the selected nodes — change between turns.

However, taxonomy context **is** stable within a single persona's pipeline run. It is computed once per turn (`debateEngine.ts:832` for openings, `debateEngine.ts:1096` for cross-respond) and passed as a string to all 4 stages (BRIEF, PLAN, DRAFT, CITE). This makes it valid Layer 3 content: the 4 calls within a pipeline run share it, giving 3 cache hits per pipeline run.

**Cache reuse profile for taxonomy context:**

| Scope | Reuse? | Why |
|-------|--------|-----|
| Within a pipeline run (4 stages) | Yes | Computed once, passed to all stages |
| Same persona, different round | No | Transcript changed, scores re-computed |
| Different persona, same round | No | Different POV filter, different priorRefs |
| On retry (same persona, same round) | Likely | Same transcript state; embedding call may introduce minor non-determinism |

**Required pre-implementation fix:** All `.sort()` calls in `taxonomyContext.ts` (lines 148-150, 195, 230-231) and `taxonomyRelevance.ts` (lines 84, 108) currently sort by `b.score - a.score` with **no tie-breaker**. When two nodes have identical relevance scores, their order depends on insertion order from the source JSON, which is not guaranteed stable. For implicit caching on OpenAI and Gemini, a single byte difference in the taxonomy block destroys the prefix match. **All taxonomy sorts must use a deterministic tie-breaker: score descending, then node ID ascending.** Example:

```typescript
.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
```

A unit test must exercise tie-breaking scenarios: construct nodes with identical scores and verify the output order is the same regardless of input order. This fix should be applied before Stage 2 (baseline measurement) so that the baseline itself reflects deterministic behavior.

### Source of Truth: Canonical Types and Constants

This design document must reference code-defined names exactly. The following are the canonical definitions — all prose in this document should use these names only.

**Audience values** (`lib/debate/types.ts:100-105`):
`'policymakers'` | `'technical_researchers'` | `'industry_leaders'` | `'academic_community'` | `'general_public'`

There is no `'unspecified'` value. The code defaults to `'policymakers'` when audience is undefined (`audience ?? 'policymakers'` in `prompts.ts:56-65`).

**Persona IDs** (`lib/debate/types.ts`): `'prometheus'` | `'sentinel'` | `'cassandra'`

**Debate phases**: as defined by the `DebatePhase` type in `types.ts`.

**Prompt types**: as enumerated in the `PromptType` union in Section 3 of this document, which should be kept in sync with the actual prompt-building functions in `prompts.ts`.

> Earlier drafts of this document used `policy_makers`, `academics`, and `unspecified` — these do not exist in the codebase. Any remaining references to those names are errors.

### PowerShell Pipeline Is Out of Scope

The PowerShell adapter (`AIEnrich.psm1`) has its own backend implementations that don't use the TypeScript debate engine. The caching design here applies to the TypeScript debate pipeline only. If the PowerShell cmdlets are used to invoke debates (via `Show-TriadDialogue`), they call into the TypeScript engine via Node.js, so the TypeScript caching layer handles those calls. Direct `Invoke-AIApi` calls from other PowerShell cmdlets (metadata extraction, summarization, etc.) would need separate caching work.

### Electron App AI Calls Are Out of Scope

The summary-viewer (`generateContent.ts`) and POViewer (`aiEngine.ts`) have their own independent AI adapters. These are simpler workloads (single prompts, no multi-turn debate) and don't have the repeated-prefix pattern that makes caching valuable. They're out of scope for this design.

### Token Count Estimates Are Rough

The token counts in this document use a ~4 chars/token heuristic. Actual tokenization varies by model and content. The baseline measurement phase (Stage 2) will produce accurate per-provider token counts. The key claims — "Layer 1 for draft is ~1,750 tokens" — are directional, not precise.

### OpenAI API Path

The current adapter uses OpenAI's Responses API (`/v1/responses`) rather than the Chat Completions API (`/v1/chat/completions`). The Responses API has a different structure for system instructions (`instructions` field at the top level vs `system` role message). The adapter spec in Section 5.2 should use whichever API the project standardizes on. Both support implicit prefix caching.

### Cost-Benefit Reality Check

For Claude, cache reads are billed at 10% of base input token cost. Cache writes are billed at 125% (5-min) or 200% (1-hour) of base cost. A cache write that's read 2+ times within the TTL window is net positive at 5-min TTL. For the debate pipeline:

- **Layer 1+2** (~3,000 tokens for draft) is written once per persona per 5-min window and read 3x within the same pipeline run (stages 2-4 hit stage 1's cache) → **always net positive** (3 reads easily covers the 1.25x write premium). If the TTL survives between rounds, additional cross-round reads are pure profit.
- **Layer 1+2+3** (~5,000-15,000 tokens including taxonomy) is written once per persona per turn and read 3x within the same pipeline run → **always net positive** for the same reason. However, Layer 3 does NOT carry across turns (taxonomy is re-scored each turn), so every turn pays one full write. The write cost is offset by 3 reads within the same turn.
- **Layer 1 alone** (~1,750 tokens for draft, ~500 for others) — shared across personas within the same stage type. Prometheus draft writes it; Sentinel and Cassandra draft reads it. This saves 2 writes per round for the draft stage, but only if those calls happen within the 5-min TTL (they do — the moderator selects one responder per round, so this sharing only occurs in the opening phase where all 3 personas run sequentially).

**Worst-case cost (zero cache hits):** If caching provides no hits at all (e.g., provider doesn't actually cache, or prefix is below minimum), the only cost increase is the 1.25x write overhead on Layer 1+2+3. For a typical debate with ~40 calls averaging ~5,000 input tokens: `40 × 5,000 × 0.25 = 50,000 tokens` of pure overhead (~$0.15 at Claude Sonnet rates). This is the maximum downside — small enough that a failed rollout is cheap.

**Best-case savings:** 3 cache reads per 4-call pipeline run at 90% discount. For 6 pipeline runs (3 openings + 3 cross-respond) × 3 cached reads × ~5,000 tokens: `18 × 5,000 × 0.90 = 81,000 tokens` saved. Net of write overhead, roughly 40-50% reduction in input token cost.

The strongest ROI is Layer 1+2+3 caching within the 4-stage pipeline for a single persona's turn. Cross-turn reuse of Layer 1+2 is a bonus that depends on TTL survival.

### Security Considerations

The envelope design introduces a system/user message boundary that does not exist in the current code. This has security implications.

#### Prompt Injection via Source Documents

The current code puts everything in a single `user` message — there is no privilege boundary within the prompt. The envelope design moves instruction blocks (Layer 1) and persona framing (Layer 2) into system messages, while variable content (Layer 4) stays in the user message. This creates a privilege escalation surface: if a source document, transcript entry, or taxonomy node description contains adversarial text designed to override system instructions (e.g., "Ignore all previous instructions and..."), it now crosses a system/user boundary rather than being inline with the instructions it's trying to override.

**Risk level: Low for this project.** The source documents are curated AI policy research papers, not arbitrary user-uploaded content. The taxonomy is maintained by the project team. The transcript is generated by the debate engine itself. There is no untrusted user input in the prompt pipeline today.

**However**, if the system is ever extended to accept user-uploaded documents or external taxonomy contributions, this becomes a real risk. The design should note this as a constraint:

> **Constraint:** Layer 4 content must never contain untrusted user input without sanitization. If the debate engine is extended to accept arbitrary source documents, input sanitization must be added before content enters Layer 4. This is not required for the current curated-document workflow.

#### Cross-Persona Cache Sharing and Information Leakage

Layer 1 is shared across personas — a Prometheus draft and a Sentinel draft hit the same Layer 1 cache on Claude. This is safe because Layer 1 contains only instruction blocks that are identical for all personas. There is no persona-specific information in Layer 1.

Layer 2 is persona-specific and not shared. Layer 3 is per-persona per-turn and not shared.

**No cross-persona information leakage through the cache.** Each persona's prompt contains different Layer 2+3 content, so cache entries are naturally isolated by prefix. A Sentinel call cannot hit a Prometheus cache entry because the Layer 2 prefix differs.

#### Cache Poisoning as an Attack Vector

If an attacker could modify the instruction block constants in `prompts.ts`, they could inject malicious instructions that would be cached and served to all subsequent calls. This is not a new attack vector — the same attacker could modify the prompt code directly today. The caching layer does not increase the attack surface here. The hash assertion (Section 9.3) provides an additional detection layer: a tampered instruction block would change the hash, creating a visible alert.

#### API Key Exposure

The caching design does not change how API keys are handled. Keys are resolved per-call in the adapter and never appear in prompt text or cache keys. No change to the key management risk profile.
