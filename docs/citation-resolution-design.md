# Design: Hybrid Citation Resolution for the Debate Pipeline

**Status:** Draft
**Author:** Taxonomy Editor
**Date:** 2026-05-19

## Problem

~14% of all judge repair hints across recent debates are citation-related — malformed ArXiv IDs, fabricated legislation, future-dated papers, unverifiable URLs. The draft stage LLM fabricates empirical citations as part of its argumentation, the judge catches them, and the retry loop oscillates between fixing citations and satisfying other quality dimensions (see S21 analysis: 5 orchestration attempts, 2-state oscillation between "fix citations" and "make claims concrete").

This wastes tokens, time, and often degrades statement quality through unnecessary retries.

## Root Cause

The draft stage asks the LLM to argue persuasively, which incentivizes citing evidence. But the LLM has no access to real citation databases — it can only fabricate plausible-sounding references. The evidence system (`evidenceFromSummaries.ts`) injects real source evidence before drafting, but the LLM still fabricates additional citations beyond what's provided.

## Design: Hybrid Citation Resolution

Two mechanisms, selected automatically based on whether the model's backend supports tool calling.

### Path B: Tool-Calling (Gemini, Claude)

When the backend supports tools, the draft-stage LLM can call a `lookup_citation` tool during generation to find real sources instead of fabricating them.

#### Tool Definition

```typescript
interface CitationTool {
  name: 'lookup_citation';
  description: 'Search for real academic papers, legislation, or reports that support a claim. Returns verified citations with titles, authors, dates, and URLs. Use this instead of citing sources from memory.';
  parameters: {
    query: string;        // Natural language: "evidence that alignment training reduces covert actions"
    source_type?: string; // 'academic' | 'legislation' | 'report' | 'any'
  };
}
```

#### Tool Implementation

```
lookup_citation(query, source_type?)
  1. Search the pre-loaded evidence index by semantic similarity
     (query embedding vs evidence embeddings — reuse existing embed infrastructure)
  2. Return top 3-5 matches as structured citations:
     { title, authors, year, url, key_finding, doc_id, relevance_score }
  3. If no good matches (score < threshold), return empty with message:
     "No verified sources found for this claim. State the claim without citation
      or qualify it as a position rather than an empirical finding."
```

#### Tool-Call Loop

The `generate()` call returns a tool-call request instead of text. The pipeline:
1. Executes `lookup_citation` with the provided arguments
2. Sends the result back to the LLM as a tool response
3. LLM incorporates the real citation and continues generating
4. Repeat if the LLM makes additional tool calls (cap at 5 per draft)

#### ai-client Changes Required

```typescript
// lib/ai-client/types.ts — extend GenerateOptions
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  id: string; // provider-assigned call ID
}

export interface ToolResult {
  id: string;
  content: string; // JSON-serialized result
}

export interface GenerateOptions {
  // ... existing fields ...
  tools?: ToolDefinition[];
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];  // present when LLM wants to call tools
}
```

Provider implementations:
- **Gemini**: Map `ToolDefinition` to `functionDeclarations`, handle `functionCall` parts in response
- **Claude**: Map to `tools` array with `input_schema`, handle `tool_use` content blocks
- **Groq/OpenAI**: Ignore `tools` field (or pass through for OpenAI if supported) — falls back to Path A

### Path A: Citation Bank + Post-Draft Scrub (Groq, OpenAI, fallback)

When tools aren't available, constrain the LLM via prompt engineering and validate deterministically.

#### Pre-Draft: Build Citation Bank

Before the draft stage, build a citation bank from available sources:

```typescript
interface CitationBankEntry {
  doc_id: string;
  title: string;
  authors: string[];
  year: string;
  url: string | null;
  key_findings: string[];  // extracted from summary
  source_type: string;     // 'academic' | 'legislation' | 'report'
}

function buildCitationBank(
  evidenceIndex: SourceEvidenceIndex,
  summaries: Map<string, Summary>,
  topic: string,
): CitationBankEntry[]
```

Sources:
1. Evidence index entries relevant to the topic (already retrieved by evidence stage)
2. Summary metadata (title, authors, URL from source metadata.json)
3. Policy registry entries (legislation names, official URLs)

#### Prompt Injection

Add to the draft prompt, after the evidence block:

```
CITATION RULES:
You may cite sources from the VERIFIED SOURCES list below. Use the exact title
and attribution provided. Do NOT invent paper titles, arXiv IDs, legislation
names, or URLs from memory — if a claim needs a source not in the list,
state it as your analytical position rather than an empirical finding.

VERIFIED SOURCES:
1. "Title" (Authors, Year) — key finding
2. ...
```

#### Post-Draft Scrub

After draft generation, deterministically validate citations:

```typescript
function scrubCitations(
  draft: string,
  bank: CitationBankEntry[],
): { cleanedDraft: string; removed: string[]; warnings: string[] }
```

1. Regex-extract citation-like patterns:
   - ArXiv IDs: `arXiv:\d{4}\.\d{4,5}`
   - Quoted titles: `"[Title]"` or `'[Title]'`
   - URL patterns: `https?://...`
   - Legislation patterns: `\b[A-Z][a-z]+ Act\b`, `\bExecutive Order \d+\b`
2. For each extracted citation, fuzzy-match against the bank (title similarity, URL match)
3. If no match found:
   - Remove the citation and surrounding attribution clause
   - Or replace with a hedged phrasing: "Research suggests..." → keep claim, drop fake source
4. Return cleaned draft + list of removed citations for diagnostics

### Hybrid Selection Logic

```typescript
// In turnPipeline.ts, draft stage setup
const backend = resolveBackend(input.model);
const supportsTools = backend === 'gemini' || backend === 'claude';

// Always build the citation bank (needed for both paths + post-draft validation)
const citationBank = buildCitationBank(evidenceIndex, summaries, input.topic);

if (supportsTools) {
  // Path B: tool-calling
  const tools = [citationToolDefinition];
  const draftRaw = await generateWithTools(prompt, input.model, tools, citationBank, {
    temperature: temps.draft_temperature,
    maxToolCalls: 5,
  });
} else {
  // Path A: citation bank injection + post-draft scrub
  const bankBlock = formatCitationBank(citationBank);
  const draftRaw = await generate(promptWithBank, input.model, {
    temperature: temps.draft_temperature,
  });
  draft = scrubCitations(draftRaw, citationBank);
}

// Both paths: final validation against the bank
const citationWarnings = validateCitationsAgainstBank(draft, citationBank);
```

### Post-Draft Validation (Both Paths)

Even with tool calling, the LLM might still fabricate. A final deterministic pass runs on both paths:

```typescript
function validateCitationsAgainstBank(
  draftText: string,
  bank: CitationBankEntry[],
): CitationWarning[]
```

Returns warnings for any citation-like strings not matched in the bank. These feed into the stage validation as specific, actionable hints — not vague "citation malformed" feedback.

## File Ownership

| File | Owner | Changes |
|------|-------|---------|
| `lib/ai-client/types.ts` | Shared Lib | Add `ToolDefinition`, `ToolCall`, `ToolResult` to `GenerateOptions`/`ProviderResult` |
| `lib/ai-client/providers/gemini.ts` | Shared Lib | Handle `tools` → `functionDeclarations`, parse `functionCall` responses |
| `lib/ai-client/providers/claude.ts` | Shared Lib | Handle `tools` → Claude tool format, parse `tool_use` blocks |
| `lib/ai-client/providers/groq.ts` | Shared Lib | Ignore `tools` field (no-op) |
| `lib/ai-client/providers/openai.ts` | Shared Lib | Ignore or pass-through `tools` field |
| `lib/debate/citationResolution.ts` | Shared Lib | New module: `CitationBankEntry`, `buildCitationBank`, `scrubCitations`, `validateCitationsAgainstBank`, `formatCitationBank`, `citationToolDefinition`, `executeCitationLookup` |
| `lib/debate/turnPipeline.ts` | Shared Lib | Wire hybrid selection in draft stage, integrate tool-call loop, add post-draft validation |
| `lib/debate/prompts.ts` | Shared Lib | Add citation bank prompt template |
| `lib/debate/evidenceFromSummaries.ts` | Shared Lib | Expose evidence entries for citation bank building (may already be sufficient) |

## Sequencing

1. **ai-client tool support** — types + Gemini provider + Claude provider (Groq/OpenAI no-op)
2. **Citation resolution module** — bank builder, scrubber, validator, tool definition
3. **Pipeline integration** — hybrid selection, tool-call loop, prompt changes, post-draft validation
4. **Validation improvements** — replace vague "malformed citation" hints with specific bank-miss warnings

Steps 1-2 can run in parallel. Step 3 depends on both. Step 4 can be done alongside step 3.

## Expected Impact

- Eliminates the oscillation pattern (S21-style 5-run retries caused by citation issues)
- Reduces citation-related repair hints from ~14% to near zero
- Faster debates: fewer orchestration retries → fewer LLM calls per turn
- Higher quality statements: LLM effort goes to argumentation, not citation fabrication
- Backend-agnostic: works with all 4 supported providers

## Risks

- **Citation bank coverage**: If the evidence corpus is too narrow for the topic, the LLM may be unable to cite anything, producing uncited claims. Mitigation: allow the LLM to state positions without citations when no source is available, and don't penalize uncited analytical claims.
- **Tool-call latency**: Each tool call adds a round-trip. Mitigation: cap at 5 calls per draft; the evidence index lookup is local and fast (<10ms).
- **Post-draft scrub aggressiveness**: Removing citations might break sentence flow. Mitigation: replace with hedged phrasing rather than deleting, and let the LLM see what was removed in the stage validation hints.
- **Provider API differences**: Gemini and Claude have different tool-calling protocols. Mitigation: abstract behind `ToolDefinition`/`ToolCall`/`ToolResult` types; provider-specific mapping is confined to each provider file.
