# Design Spec: Invoke-TriadDebate PowerShell Cmdlet

**Date:** 2026-03-30
**Status:** Draft — awaiting approval

---

## 1. Overview

A PowerShell cmdlet that runs structured multi-perspective AI debates using the same prompts, logic, and argumentation framework as the Taxonomy Editor's debate tool. Produces debate transcripts, diagnostics, synthesis, and harvest output as files.

---

## 2. Architecture: Shared Debate Library

### The Problem

The debate logic currently lives in TypeScript files inside the Taxonomy Editor's renderer:
- `prompts/debate.ts` — all debate prompts (opening, response, cross-respond, synthesis, probing, fact-check)
- `prompts/argumentNetwork.ts` — claim extraction, AN formatting, commitment formatting
- `utils/taxonomyContext.ts` — BDI context formatting, category-to-BDI mapping
- `utils/taxonomyRelevance.ts` — embedding-based relevance scoring
- `utils/harvestUtils.ts` — harvest extraction and validation
- `data/debateProtocols.ts` — protocol definitions
- `data/debateTopics.ts` — curated topic suggestions
- `hooks/useDebateStore.ts` — debate state machine (flow orchestration + Zustand state)

A PowerShell cmdlet cannot import TypeScript. Copying the logic creates maintenance divergence.

### The Solution

Extract all **pure logic** (prompts, formatters, validators, protocols, topics) into a shared Node.js library at `lib/debate/`. Both the Electron app and the cmdlet consume it.

```
lib/debate/                          ← NEW shared library
├── prompts.mjs                      ← all debate prompt functions
├── argumentNetwork.mjs              ← claim extraction, AN formatting, commitments
├── taxonomyContext.mjs              ← BDI formatting, category mapping
├── taxonomyRelevance.mjs            ← relevance scoring (cosine similarity)
├── harvestUtils.mjs                 ← harvest extraction + validation
├── protocols.mjs                    ← protocol definitions
├── topics.mjs                       ← curated debate topics
├── debateEngine.mjs                 ← orchestration logic (the state machine)
└── index.mjs                        ← barrel export

taxonomy-editor/src/renderer/
├── prompts/debate.ts                ← imports from lib/debate/prompts
├── prompts/argumentNetwork.ts       ← imports from lib/debate/argumentNetwork
├── utils/taxonomyContext.ts         ← imports from lib/debate/taxonomyContext
├── utils/taxonomyRelevance.ts       ← imports from lib/debate/taxonomyRelevance
├── utils/harvestUtils.ts            ← imports from lib/debate/harvestUtils
├── data/debateProtocols.ts          ← imports from lib/debate/protocols
├── data/debateTopics.ts             ← imports from lib/debate/topics
└── hooks/useDebateStore.ts          ← uses debateEngine + Zustand for UI state

scripts/AITriad/Public/
└── Invoke-TriadDebate.ps1           ← cmdlet that calls node lib/debate/cli.mjs
```

### What Gets Extracted vs. What Stays

| Component | Extracted to lib/debate/ | Stays in Electron app |
|-----------|------------------------|----------------------|
| Prompt text generation | Yes | Imports from lib |
| Argument strategy / dialectical moves | Yes | Imports from lib |
| BDI taxonomy context formatting | Yes | Imports from lib |
| Relevance scoring (cosine similarity) | Yes | Imports from lib |
| Claim extraction prompt + validation | Yes | Imports from lib |
| Commitment formatting + anti-repetition | Yes | Imports from lib |
| Edge tension formatting (debater + moderator) | Yes | Imports from lib |
| Harvest extraction + validation | Yes | Imports from lib |
| Protocol definitions + topics | Yes | Imports from lib |
| Debate orchestration (turn sequencing, phase transitions) | Yes (debateEngine.mjs) | useDebateStore wraps engine with Zustand |
| UI state (generating indicator, error display) | No | Stays in useDebateStore |
| IPC calls (generateText, embeddings) | No | Engine accepts an AI adapter interface |
| Diagnostics recording | Yes (data structure) | UI display stays in app |
| React components (transcript, cards) | No | Stays in app |

### AI Adapter Interface

The debate engine doesn't call APIs directly. Instead, it accepts an adapter:

```typescript
interface AIAdapter {
  generateText(prompt: string, model: string): Promise<string>;
  computeEmbeddings(texts: string[], ids: string[]): Promise<{ vectors: number[][] }>;
  computeQueryEmbedding(text: string): Promise<{ vector: number[] }>;
}
```

- **Electron app adapter:** wraps `window.electronAPI.generateText` etc.
- **CLI adapter:** wraps direct Gemini/Claude/Groq API calls (like the existing `.mjs` scripts)

---

## 3. Cmdlet Design: Invoke-TriadDebate

### Synopsis

```powershell
Invoke-TriadDebate
    [-Topic] <string>
    [-DocumentPath <string>]
    [-Url <string>]
    [-CrossCuttingNodeId <string>]
    [-Debaters <string[]>]         # Default: @('Prometheus','Sentinel','Cassandra')
    [-Protocol <string>]           # Default: 'structured'
    [-Model <string>]              # Default: $env:AI_MODEL or 'gemini-2.5-flash'
    [-ApiKey <string>]
    [-Turns <int>]                 # Default: 3 (cross-respond rounds after openings)
    [-ProbeEvery <int>]            # Default: 0 (disabled). E.g., 2 = probe after every 2 turns
    [-ResponseLength <string>]     # 'brief', 'medium', 'detailed'. Default: 'medium'
    [-OutputFormat <string[]>]     # Default: @('json'). Options: 'json', 'markdown', 'pdf'
    [-OutputPath <string>]         # Default: './debates/'
    [-DiagnosticsPath <string>]    # Default: null (no diagnostics file). Path for diagnostics JSON.
    [-HarvestPath <string>]        # Default: null (no harvest file). Path for harvest output JSON.
    [-ClarificationAnswers <string>]  # Pre-supplied answers to clarification questions (skip interactive)
    [-SkipClarification]           # Skip clarification phase entirely
    [-Temperature <double>]        # Default: 0.3
    [-Verbose]
```

### Parameter Groups

**Topic Source** (exactly one required):
- `-Topic "Should the US impose AI licensing?"` — free-form topic string
- `-DocumentPath ./sources/my-doc/snapshot.md` — debate grounded in a document
- `-Url "https://example.com/article"` — debate grounded in a URL
- `-CrossCuttingNodeId cc-005` — debate grounded in a cross-cutting taxonomy node

**Debaters:**
- `-Debaters Prometheus,Sentinel` — only these two debate (minimum 2)
- `-Debaters Prometheus,Sentinel,Cassandra` — all three (default)
- Names are case-insensitive, mapped to POVer IDs

**Flow Control:**
- `-Turns 5` — 5 cross-respond rounds after opening statements
- `-ProbeEvery 2` — moderator generates probing questions after every 2 cross-respond rounds. The top probing question (highest-threat) is automatically injected as the next question, directed at the targeted debater.
- `-SkipClarification` — jump straight to opening statements
- `-ClarificationAnswers "Focus on the economic impact"` — provide answers upfront instead of interactively

**Output:**
- `-OutputFormat json,markdown` — produce both formats
- `-OutputPath ./debates/my-debate` — base path for output files (adds extensions)
- `-DiagnosticsPath ./debates/my-debate-diag.json` — full diagnostics capture
- `-HarvestPath ./debates/my-debate-harvest.json` — harvest candidates for visual review

### Execution Flow

```
1. Load taxonomy (all 4 POV files + edges + policy registry)
2. If -DocumentPath or -Url: load/fetch source content
3. If -CrossCuttingNodeId: load CC node + linked nodes + conflicts
4. CLARIFICATION PHASE (unless -SkipClarification):
   a. Moderator generates 1-3 clarifying questions
   b. If -ClarificationAnswers provided: use them
   c. Else: print questions, prompt user for input (Read-Host)
   d. Synthesize refined topic from answers
5. OPENING STATEMENTS:
   a. For each debater (in order):
      - Compute relevance-filtered taxonomy context
      - Format BDI sections + commitments + edge tensions
      - Generate opening statement
      - Extract claims → argument network
      - Record diagnostics
6. DEBATE ROUNDS (repeat -Turns times):
   a. Moderator selects cross-respond (using edge tensions + AN context)
   b. Selected debater responds
   c. Extract claims → update AN + commitments
   d. Record diagnostics
   e. If -ProbeEvery > 0 and round % ProbeEvery == 0:
      - Generate probing questions
      - Inject top question (directed at targeted debater)
      - Targeted debater responds
      - Extract claims
7. SYNTHESIS:
   a. Generate full synthesis (areas of agreement/disagreement,
      argument map, preferences, policy implications)
   b. Append to transcript
8. OUTPUT:
   a. Write transcript + synthesis to -OutputPath in each -OutputFormat
   b. If -DiagnosticsPath: write full diagnostics JSON
   c. If -HarvestPath: extract harvest candidates and write JSON
9. RETURN result object:
   PSCustomObject with: DebateId, Topic, Turns, OutputFiles,
   DiagnosticsFile, HarvestFile, ClaimCount, DisagreementCount
```

### Output File Formats

**JSON** (`-OutputFormat json`):
```json
{
  "id": "debate-uuid",
  "topic": { "original": "...", "refined": "...", "final": "..." },
  "protocol_id": "structured",
  "model": "gemini-2.5-flash",
  "debaters": ["prometheus", "sentinel", "cassandra"],
  "created_at": "2026-03-30T...",
  "transcript": [ /* same TranscriptEntry schema as UI */ ],
  "argument_network": { "nodes": [...], "edges": [...] },
  "commitments": { "prometheus": {...}, "sentinel": {...}, "cassandra": {...} },
  "synthesis": { /* full SynthesisResult */ },
  "diagnostics": { /* per-entry diagnostics if -DiagnosticsPath */ }
}
```

**Markdown** (`-OutputFormat markdown`):
```markdown
# Debate: Should the US impose AI licensing?

**Date:** 2026-03-30 | **Model:** gemini-2.5-flash | **Protocol:** Structured Debate

## Opening Statements

### Prometheus (Accelerationist)
[statement text]

### Sentinel (Safetyist)
[statement text]

...

## Debate Rounds

### Round 1: Sentinel → Prometheus
**Focus:** [moderator's focus point]
[response text]

...

## Synthesis

### Areas of Agreement
- [point] (Prometheus, Sentinel)

### Areas of Disagreement
- [point] [EMPIRICAL] {belief}
  - Prometheus: [stance]
  - Sentinel: [stance]
  - *Resolution: [prevails] via [criterion]*

### Argument Map
- C1 (Prometheus): [claim]
  ← C2 (Sentinel) rebut via COUNTEREXAMPLE

### Cruxes
- [question] — If yes: [impact]. If no: [impact].
```

**PDF** (`-OutputFormat pdf`): Same content as Markdown, rendered via a Markdown-to-PDF converter.

### Diagnostics File

Full capture of every AI interaction, same structure as the UI diagnostics:

```json
{
  "debate_id": "...",
  "entries": {
    "entry-uuid-1": {
      "prompt": "full prompt text",
      "raw_response": "full AI response",
      "model": "gemini-2.5-flash",
      "response_time_ms": 8200,
      "taxonomy_context": "full BDI block",
      "commitment_context": "commitments injected",
      "edge_tensions": "tensions block (moderator only)",
      "extracted_claims": {
        "accepted": [{ "text": "...", "id": "AN-1", "overlap_pct": 87 }],
        "rejected": [{ "text": "...", "reason": "low overlap", "overlap_pct": 22 }]
      }
    }
  },
  "overview": {
    "total_ai_calls": 12,
    "total_response_time_ms": 98000,
    "move_type_counts": { "DISTINGUISH": 5, "COUNTEREXAMPLE": 3 },
    "disagreement_type_counts": { "EMPIRICAL": 4, "VALUES": 2 }
  }
}
```

### Diagnostics Viewer

```powershell
# Launch the diagnostics viewer on a captured diagnostics file
Show-DebateDiagnostics -Path ./debates/my-debate-diag.json
```

Opens the Taxonomy Editor's diagnostics popout window (`#diagnostics-window`) pre-loaded with the diagnostics file. Reuses the existing `DiagnosticsWindow` component — no new UI code.

### Harvest File + Visual Tool

```powershell
# Launch the harvest review tool on a harvest file
Show-DebateHarvest -Path ./debates/my-debate-harvest.json
```

The harvest file contains the same structure as the HarvestDialog's state:

```json
{
  "debate_id": "...",
  "debate_title": "...",
  "conflicts": [{ /* HarvestConflictItem */ }],
  "steelmans": [{ /* HarvestSteelmanItem */ }],
  "verdicts": [{ /* HarvestVerdictItem */ }],
  "concepts": [{ /* HarvestConceptItem */ }]
}
```

`Show-DebateHarvest` opens the Taxonomy Editor with the harvest file pre-loaded into the HarvestDialog, allowing the user to review, edit, and apply harvest items to the taxonomy.

---

## 4. Implementation Phases

### Phase L1: Extract Shared Library

**Goal:** Move pure logic out of the Electron app into `lib/debate/`.

**Steps:**
1. Create `lib/debate/` directory with `.mjs` modules
2. Extract prompts, formatters, validators, protocols, topics
3. Extract debate engine (orchestration logic without Zustand)
4. Define AIAdapter interface
5. Update Electron app imports to use `lib/debate/`
6. Verify Electron app still builds and works identically

**Validation:** Run the same debate in the UI before and after extraction — output must be identical.

### Phase L2: Build CLI Debate Runner

**Goal:** Node.js script (`lib/debate/cli.mjs`) that runs a debate end-to-end using the shared library.

**Steps:**
1. Implement CLI adapter (direct API calls to Gemini/Claude/Groq)
2. Implement debate orchestration using shared debateEngine
3. Implement output formatters (JSON, Markdown)
4. Implement diagnostics capture
5. Implement harvest extraction
6. Test with all four topic source types

**Validation:** Run the D1-D5 benchmark topics, compare synthesis quality against Electron app output.

### Phase L3: Build PowerShell Cmdlet

**Goal:** `Invoke-TriadDebate` cmdlet that wraps the CLI runner.

**Steps:**
1. Create `Invoke-TriadDebate.ps1` in `Public/`
2. Parameter validation and help documentation
3. Call `node lib/debate/cli.mjs` with JSON-serialized parameters
4. Parse output and return PSCustomObject
5. Add to module exports

**Validation:** Run all parameter combinations, verify output files are produced correctly.

### Phase L4: Build Viewer Cmdlets

**Goal:** `Show-DebateDiagnostics` and `Show-DebateHarvest` cmdlets.

**Steps:**
1. `Show-DebateDiagnostics` launches Electron with `#diagnostics-file?path=...`
2. `Show-DebateHarvest` launches Electron with `#harvest-file?path=...`
3. Add hash-based routing in `App.tsx` for these modes
4. DiagnosticsWindow reads from file instead of IPC when in file mode
5. HarvestDialog reads from file instead of active debate when in file mode

**Validation:** Run a debate via cmdlet, then view diagnostics and harvest via the viewer cmdlets.

---

## 5. Example Usage

### Basic debate

```powershell
Invoke-TriadDebate -Topic "Should the US impose AI licensing?" -Turns 3
```

### Full-featured debate

```powershell
$result = Invoke-TriadDebate `
    -Topic "The burden of proof rests on those claiming current architectures will scale to AGI" `
    -Debaters Prometheus,Sentinel,Cassandra `
    -Protocol structured `
    -Model 'gemini-2.5-flash' `
    -Turns 5 `
    -ProbeEvery 2 `
    -ResponseLength medium `
    -OutputFormat json,markdown `
    -OutputPath './debates/burden-of-proof' `
    -DiagnosticsPath './debates/burden-of-proof-diag.json' `
    -HarvestPath './debates/burden-of-proof-harvest.json' `
    -SkipClarification

# Review results
$result | Format-List

# View diagnostics
Show-DebateDiagnostics -Path $result.DiagnosticsFile

# Review and apply harvest
Show-DebateHarvest -Path $result.HarvestFile
```

### Document-grounded debate

```powershell
Invoke-TriadDebate `
    -DocumentPath '../ai-triad-data/sources/ai-safety-is-category-error-2026/snapshot.md' `
    -Turns 4 `
    -OutputFormat markdown `
    -OutputPath './debates/category-error'
```

### Batch debates from curated topics

```powershell
# Run all 20 curated topics
$topics = node -e "const t = require('./lib/debate/topics.mjs'); t.DEBATE_TOPICS.forEach(t => console.log(t.proposition))"
$topics | ForEach-Object {
    Invoke-TriadDebate -Topic $_ -Turns 3 -OutputFormat json -OutputPath "./debates/batch-$($_.GetHashCode())"
}
```

---

## 6. Open Questions

1. **PDF generation:** Should we use a Node.js library (e.g., `md-to-pdf`) or shell out to `pandoc`?
2. **Embedding computation for relevance scoring:** The CLI needs Python's `sentence_transformers` or the Gemini embedding API. Which should the CLI adapter use?
3. **Interactive clarification:** Should `Read-Host` be the fallback, or should the cmdlet always require `-ClarificationAnswers` or `-SkipClarification`?
4. **Concurrent debates:** Should the cmdlet support `-MaxConcurrent` for batch runs?
