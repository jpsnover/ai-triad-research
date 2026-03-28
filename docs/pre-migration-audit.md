# Pre-Migration Audit: Prompts and Error Handling

**Date:** 2026-03-28
**Context:** Before executing the DOLCE+AIF+BDI migration plan, this audit identifies prompt engineering issues and error handling gaps that must be fixed. These are prerequisites — executing the migration on a fragile codebase will produce unreliable results that are hard to diagnose.

---

## Part 1: Prompt Engineering Findings

### Critical Issues (fix before migration)

#### P1. Template variables appear unresolved to the AI

The `pov-summary-system.prompt` uses `{{KP_MIN}}`, `{{KP_MAX}}`, etc. These are substituted by `Get-Prompt -Replacements` before being sent to the AI. However, if substitution fails silently (wrong key name, missing caller), the AI receives literal `{{KP_MIN}}` strings. **No prompt currently validates that all placeholders were substituted.**

**Fix:** Add a post-substitution check in `Get-Prompt`:
```powershell
if ($Text -match '\{\{[A-Z_]+\}\}') {
    $Remaining = [regex]::Matches($Text, '\{\{[A-Z_]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
    Write-Warning "Unresolved placeholders in prompt '$Name': $($Remaining -join ', ')"
}
```

#### P2. Schema file has malformed character

`pov-summary-schema.prompt` line 89 has a Unicode checkmark (`√`) before a field definition — a copy-paste artifact that corrupts the JSON schema the AI sees. This must be removed.

#### P3. `attribute-extraction-schema.prompt` says all 10 fields are REQUIRED, but `attribute-extraction.prompt` marks `policy_actions` and `possible_fallacies` as "0-3" (allowing empty arrays)

These are compatible (empty array satisfies "required") but the language is confusing to the AI. Reword the schema to say "REQUIRED (may be empty array)" for clarity.

#### P4. `edge-discovery.prompt` defines SUPPORTS and SUPPORTED_BY as separate types

These are inverses. The migration plan (Phase 5) eliminates SUPPORTED_BY, but until then the prompt confuses the AI about when to use which. **The fix is already in the migration plan** — no separate action needed, but flag this as a known issue.

#### P5. `ai-triad-analysis-prompt.md` uses adversarial modes

Part 1 says "resist urges to invent" (conservative), Part 2 says "challenge the existing structure" (exploratory). These are contradictory when run as a single prompt. **Split into two separate prompts** or add explicit transition language: "You have now completed the conservative pass. Switch to exploratory mode for Part 2."

#### P6. `potentialEdges.ts` has contradictory `inbound` flag definition

Line 49 says edges go "FROM existing nodes TO the concept" but line 102 says "FROM the target TO the concept." These describe different directions. **Pick one definition and fix the other.**

### High Issues (fix during Phase 1-2)

#### P7. Confidence scales are inconsistent across prompts

- `attribute-extraction.prompt`: "high/medium/low" (string)
- `edge-discovery.prompt`: 0.5-1.0 (numeric)
- `fallacy-analysis.prompt`: "likely/possible/borderline" (string)
- `cross-cutting-candidates.prompt`: 0.0-1.0 (numeric, different range)

**Recommendation:** Don't unify retroactively (would break existing data). Instead, add a CONFIDENCE SCALE definition to each prompt that explains what the range means with anchoring examples.

#### P8. Fallacy cap of 0-3 creates silent data loss

If a node genuinely has 4+ fallacies, the prompt forces the AI to drop one. Add: "If you identify more than 3, include the 3 most significant and note 'additional fallacies omitted' in the explanation of the third."

#### P9. No grounding examples for subjective judgments

Prompts ask for "borderline" fallacy confidence, "cohesion_score >= 0.50", and "genuinely unique" nodes without examples of what these look like. **Add 1-2 calibration examples** to each subjective scale.

#### P10. `debate.ts` source document truncation is silent

Documents >50K chars are truncated with `[Content truncated]` but the debater is never told which sections were removed. **Add a truncation notice:** "Note: this document was truncated at 50,000 characters. Sections after [last heading before truncation] are not available."

#### P11. `metadata-extraction.prompt` lacks output examples

Every other prompt has a schema prompt companion. This one has no examples, making the AI guess at format. **Add a companion schema or at least one example output.**

### Medium Issues (fix opportunistically)

#### P12. Vocabulary overload: "assumption" means 3 different things

- `attribute-extraction.prompt`: `assumes` field (list of things this position takes for granted)
- `edge-discovery.prompt`: ASSUMES edge type (logical dependency between nodes)
- `debate.ts`: `key_assumptions` (beliefs the debater depends on)

These are related but distinct. Add a clarifying note to each: "Note: 'assumes' here means [specific definition], distinct from the ASSUMES edge type."

#### P13. `graph-query.prompt` is a skeleton with no task specification

The prompt defines the system but never specifies the actual question. It depends entirely on context injection. **Add a validation instruction:** "If no QUESTION is provided below, respond with {error: 'No question provided'}."

#### P14. Schema-prompt duplication for fallacies

Both `fallacy-analysis-schema.prompt` and `attribute-extraction-schema.prompt` define `possible_fallacies`. If one changes, the other must too. **Consider importing one from the other**, or at minimum add a comment: "This schema must match fallacy-analysis-schema.prompt."

---

## Part 2: PowerShell Error Handling Findings

### Critical (fix before migration — these cause silent data loss or mysterious failures)

#### E1. `ConvertFrom-Json` missing `-Depth 20` across 25+ files

PowerShell defaults to depth 2. Deeply nested structures (graph_attributes → policy_actions → linked_taxonomy_nodes) are **silently truncated**. This is active data corruption during every read-write cycle.

**Files:** Nearly every file that reads taxonomy or summary JSON. Most impactful:
- `Invoke-BatchSummary.ps1` (reads taxonomy, writes summaries)
- `Find-Conflict.ps1` (reads summaries)
- `Find-PolicyAction.ps1` (reads taxonomy with policy actions)
- `Update-PolicyRegistry.ps1` (reads/writes policy registry)
- `Invoke-AttributeExtraction.ps1` (reads/writes graph_attributes)

**Fix:** Global search-and-replace: `ConvertFrom-Json` → `ConvertFrom-Json -Depth 20`. This is a safe change with no behavioral difference except it stops truncating.

#### E2. `$ErrorActionPreference = 'Stop'` missing in 15+ functions

Without this, non-terminating errors (failed file reads, bad JSON) continue silently. Later code crashes with "cannot index null" — masking the original error.

**Most impactful missing locations:**
- `Get-Tax.ps1`
- `Update-Snapshot.ps1`
- Multiple Private/ helper functions

**Fix:** Audit every public function. Every one should start with:
```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

#### E3. JSON parsing without try/catch in batch operations

25+ instances of `ConvertFrom-Json` without error handling. A single corrupt file (common during migration) crashes the entire batch.

**Fix:** Wrap all JSON parsing in batch contexts:
```powershell
try {
    $Data = Get-Content -Raw $Path | ConvertFrom-Json -Depth 20 -ErrorAction Stop
} catch {
    Write-Warning "Failed to parse $Path`: $($_.Exception.Message)"
    Write-Warning "Skipping this file. Check for corruption or partial writes."
    continue  # Skip this item in the batch, don't crash everything
}
```

### High (fix before Phase 2 and Phase 5 — these affect data migration reliability)

#### E4. Error messages lack context

Current pattern: `Write-Warn "Could not update metadata for $($Doc.DocId): $_"`

The `$_` in a catch block is often a .NET exception with no file path, no expected format, no next steps. During migration, this makes failures un-diagnosable.

**Fix pattern for all catch blocks during migration:**
```powershell
catch {
    Write-Warning "FAILED: [operation] for [identifier]"
    Write-Warning "  File: $FilePath"
    Write-Warning "  Error: $($_.Exception.Message)"
    Write-Warning "  Next steps: [specific guidance]"
    Write-Verbose "  Stack: $($_.ScriptStackTrace)"
}
```

#### E5. Empty catch blocks in `Repair-TruncatedJson` and `DocConverters`

Errors are caught and silently swallowed. When JSON repair fails, the caller gets `$null` with no indication of what went wrong.

**Fix:** Add `Write-Verbose` to every catch block so `-Verbose` mode reveals what happened:
```powershell
catch {
    Write-Verbose "JSON repair strategy 1 failed: $($_.Exception.Message)"
}
```

#### E6. No timeout on Neo4j API calls

`Invoke-CypherQuery.ps1` and `Export-TaxonomyToGraph.ps1` use `Invoke-RestMethod` without `-TimeoutSec`. If Neo4j is down, the process hangs indefinitely.

**Fix:** Add `-TimeoutSec 30` to all `Invoke-RestMethod` calls.

---

## Part 3: TypeScript Error Handling Findings

### Critical (fix before migration)

#### T1. `JSON.parse` without try/catch in main process fileIO

Both taxonomy-editor and summary-viewer `fileIO.ts` call `JSON.parse(raw)` on taxonomy files without error handling. A corrupted file crashes the main process — the app won't start.

**Files:**
- `taxonomy-editor/src/main/fileIO.ts` (lines 135, 151, 161)
- `summary-viewer/src/main/fileIO.ts` (line 52)

**Fix:**
```typescript
try {
  return JSON.parse(raw);
} catch (err) {
  console.error(`[fileIO] Invalid JSON in ${filePath}:`, err);
  throw new Error(`Cannot parse ${path.basename(filePath)}: ${err instanceof Error ? err.message : err}. Check file for corruption.`);
}
```

#### T2. Race condition in useDebateStore async operations

`runClarification`, `submitAnswersAndSynthesize`, and other async actions don't check if the active debate changed during the `await`. If the user switches debates mid-generation, the wrong debate gets updated.

**Fix:** Capture debate ID at start, validate before state update:
```typescript
const debateId = get().activeDebateId;
// ... after await ...
if (debateId !== get().activeDebateId) {
  console.warn('[debate] Active debate changed during generation, discarding');
  return;
}
```

#### T3. IPC handlers don't return errors to renderer

Async IPC handlers like `update-node-embeddings` and `generate-text` can reject, but the error doesn't reach the renderer as structured data. The renderer hangs or gets an opaque error.

**Fix:** Wrap all async handlers:
```typescript
ipcMain.handle('update-node-embeddings', async (_event, nodes) => {
  try {
    await updateNodeEmbeddings(nodes);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
```

### High (fix during Phase 1-2)

#### T4. Raw exception text shown to users

Store actions catch errors and set `similarError: message` or `potentialEdgesError: message` where `message` is the raw exception. Users see "ENOENT: no such file" instead of "Embeddings not found. Run Update-TaxEmbeddings to generate them."

**Fix:** Create a `mapErrorToUserMessage` utility that translates common errors:
- ENOENT → "Data file not found"
- Python → "Embedding service unavailable"
- 429 → "API rate limited, try again in a minute"
- JSON parse → "Received invalid response from AI"

#### T5. File writes without error handling in fileIO

`fs.writeFileSync` in both apps' `fileIO.ts` and `embeddings.ts` has no try/catch. Disk full or permission errors corrupt files.

**Fix:** Wrap writes with error handling. For critical files (taxonomy, edges), write to a `.tmp` file first, then rename (atomic write):
```typescript
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, content, 'utf-8');
fs.renameSync(tmpPath, filePath);
```

#### T6. Unvalidated data shapes from IPC

Renderer code casts IPC returns (`as Record<string, TaxonomyNode>`) without validating the actual shape. If the main process returns null or a different shape, the renderer crashes later with a cryptic error.

**Fix:** Validate after every IPC call that returns data:
```typescript
const taxonomy = await window.electronAPI.loadTaxonomy();
if (!taxonomy || typeof taxonomy !== 'object') {
  throw new Error('Failed to load taxonomy data');
}
```

---

## Part 4: Prioritized Fix Plan

These fixes should be executed BEFORE the migration, as a "Phase 0.5" prerequisite.

### Batch 1: Silent Data Loss Prevention (do immediately)

| Fix | Files | Effort | Impact |
|-----|-------|--------|--------|
| E1: Add `-Depth 20` to all `ConvertFrom-Json` | 25+ PS files | 30 min (global search-replace) | Prevents silent truncation |
| P2: Fix malformed `√` in pov-summary-schema.prompt | 1 file | 2 min | Prevents schema corruption |
| P1: Add unresolved-placeholder check to Get-Prompt | 1 file | 10 min | Prevents broken prompts |

### Batch 2: Crash Prevention (do before Phase 1)

| Fix | Files | Effort | Impact |
|-----|-------|--------|--------|
| T1: JSON.parse try/catch in fileIO (both apps) | 2 files | 15 min | Prevents app crash on corrupt data |
| E2: Add `$ErrorActionPreference = 'Stop'` | 15+ PS files | 30 min (audit + add) | Prevents silent cascading failures |
| T3: IPC handler error propagation | 2 files | 30 min | Prevents renderer hangs |
| P6: Fix `inbound` flag contradiction in potentialEdges.ts | 1 file | 5 min | Prevents wrong edge directions |

### Batch 3: Migration Reliability (do before Phase 2)

| Fix | Files | Effort | Impact |
|-----|-------|--------|--------|
| E3: JSON try/catch in batch operations | 10+ PS files | 1 hour | Prevents batch crashes on corrupt files |
| E4: Contextual error messages in catch blocks | 10+ PS files | 1 hour | Makes migration failures diagnosable |
| T2: Race condition guard in useDebateStore | 1 file | 30 min | Prevents data corruption during async ops |
| T5: Atomic file writes for critical data | 4 files | 30 min | Prevents corruption on write failures |

### Batch 4: User Experience (do during Phase 1)

| Fix | Files | Effort | Impact |
|-----|-------|--------|--------|
| T4: User-friendly error messages | 2 store files | 30 min | Users can act on errors |
| P10: Silent truncation notice in debate | 1 file | 10 min | Debaters know what they're missing |
| P11: Add metadata-extraction schema example | 1 file | 15 min | Better AI output |

### Batch 5: Prompt Quality (do during Phases 1-4)

| Fix | Files | Effort | Impact |
|-----|-------|--------|--------|
| P5: Split adversarial modes in ai-triad-analysis | 1 file | 30 min | Prevents contradictory AI behavior |
| P7: Confidence scale anchoring examples | 4 files | 30 min | Better calibrated AI output |
| P8: Fallacy cap overflow handling | 2 files | 10 min | No silent data loss |
| P9: Grounding examples for subjective scales | 5 files | 1 hour | More consistent AI output |

---

## Relationship to Migration Plan

Add to `dolce-aif-bdi-implementation-plan.md`:

**New prerequisite for Phase 1:**
> Phase 0.5 — Pre-Migration Code Hardening. Execute Batches 1-2 from pre-migration-audit.md. Verify: all `ConvertFrom-Json` calls have `-Depth 20`, all functions have `$ErrorActionPreference = 'Stop'`, all main-process JSON.parse calls have try/catch, placeholder validation in Get-Prompt.

**New prerequisite for Phase 2:**
> Execute Batch 3 from pre-migration-audit.md. Verify: batch JSON operations have try/catch, error messages include file paths and next steps, atomic file writes for taxonomy files.
