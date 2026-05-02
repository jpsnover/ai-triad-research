# Error Handling Standard

This document defines the project-wide error handling standard for AI Triad Research. All agents and contributors must follow these patterns when writing or modifying code.

## Principles

1. **Detect** — every operation that can fail must be wrapped in error handling.
2. **Recover** — prefer making it work over reporting failure. Retry transient errors, try fallbacks, accept partial results.
3. **Report** — when recovery fails, produce a structured diagnostic for humans AND AI agents.
4. **Never** silently swallow errors or produce bare `throw "something broke"`.

## Structured Error Format

Every unrecoverable error must include these four fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Goal** | What operation was being attempted | "Importing document 'ai-safety-2026.pdf'" |
| **Problem** | What went wrong | "File not found at /data/sources/ai-safety-2026/raw/" |
| **Location** | Function/file where it occurred | "Import-AITriadDocument (Public/Import-AITriadDocument.ps1:42)" |
| **Next Steps** | Specific actions to resolve | "1. Verify the file path exists 2. Check file permissions" |

---

## PowerShell

### Utilities (in `scripts/AITriad/Private/New-ActionableError.ps1`)

#### `New-ActionableError` — Emit a structured error

```powershell
# Basic usage — writes to error stream
New-ActionableError -Goal 'Loading taxonomy' `
    -Problem 'File not found: accelerationist.json' `
    -Location 'Get-Tax (Public/Get-Tax.ps1)' `
    -NextSteps @(
        'Run Install-AITriadData to clone the data repository'
        'Verify $env:AI_TRIAD_DATA_ROOT points to the correct directory'
    )

# Throw instead of Write-Error (use in mandatory operations)
New-ActionableError -Goal '...' -Problem '...' -Location '...' -NextSteps @('...') -Throw

# Capture as string (for logging or embedding in other messages)
$msg = New-ActionableError -Goal '...' -Problem '...' -Location '...' -NextSteps @('...') -PassThru

# Include the original exception for debugging
catch {
    New-ActionableError -Goal '...' -Problem $_.Exception.Message `
        -Location '...' -NextSteps @('...') -InnerError $_
}
```

#### `Invoke-WithRecovery` — Retry + fallback + actionable error

```powershell
# Retry an API call twice, then fail with actionable error
$result = Invoke-WithRecovery -Goal 'Calling Gemini API for summarization' `
    -Location 'Invoke-POVSummary (Public/Invoke-POVSummary.ps1)' `
    -Action { Invoke-GeminiCompletion -Prompt $prompt } `
    -MaxRetries 2 -RetryDelaySeconds 5 `
    -NextSteps @(
        'Run: echo $env:GEMINI_API_KEY | Select-Object -First 8  (verify key is set)'
        'Check API quota at https://aistudio.google.com/apikey'
        'Try a different backend: -Model claude-sonnet-4-20250514'
    )

# With fallback to a different backend
$result = Invoke-WithRecovery -Goal 'Generating AI summary' `
    -Location 'Invoke-DocumentSummary (Private/Invoke-DocumentSummary.ps1)' `
    -Action { Invoke-GeminiCompletion -Prompt $prompt } `
    -Fallback { Invoke-ClaudeCompletion -Prompt $prompt } `
    -MaxRetries 1 `
    -NextSteps @(
        'Check both GEMINI_API_KEY and ANTHROPIC_API_KEY are set'
        'Run Test-Dependencies to verify API connectivity'
    )
```

### Patterns for Common Operations

#### File I/O
```powershell
try {
    $content = Get-Content -Raw -Path $JsonPath | ConvertFrom-Json -Depth 20
}
catch {
    New-ActionableError -Goal "Reading taxonomy file '$($JsonPath | Split-Path -Leaf)'" `
        -Problem $_.Exception.Message `
        -Location "$($MyInvocation.MyCommand.Name) ($($MyInvocation.ScriptName | Split-Path -Leaf):$($MyInvocation.ScriptLineNumber))" `
        -NextSteps @(
            "Verify the file exists: Test-Path '$JsonPath'"
            "Check the file is valid JSON: Get-Content '$JsonPath' -Raw | ConvertFrom-Json"
            'Run Install-AITriadData if data files are missing'
        ) -InnerError $_ -Throw
}
```

#### Validation with early exit
```powershell
if (-not (Test-Path $DataRoot)) {
    New-ActionableError -Goal 'Resolving data directory' `
        -Problem "Data root not found: $DataRoot" `
        -Location 'Resolve-DataPath (Private/Resolve-DataPath.ps1)' `
        -NextSteps @(
            'Clone the data repo: git clone <url> ../ai-triad-data'
            'Or set $env:AI_TRIAD_DATA_ROOT to the data directory path'
            'Or create .aitriad.json with: { "data_root": "../ai-triad-data" }'
        ) -Throw
}
```

---

## TypeScript

### Utilities (in `lib/debate/errors.ts`)

#### `ActionableError` — Structured error class

```typescript
import { ActionableError, errorMessage } from 'lib/debate';

// Throw an actionable error
throw new ActionableError({
  goal: 'Loading taxonomy from disk',
  problem: `File not found: ${filePath}`,
  location: 'taxonomyLoader.ts:loadTaxonomy',
  nextSteps: [
    'Run the PowerShell setup: Import-Module AITriad; Install-AITriadData',
    `Verify the data directory exists: ls ${dataRoot}`,
    'Check .aitriad.json points to the correct data_root',
  ],
});

// Wrap a caught error
try {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
} catch (err) {
  throw new ActionableError({
    goal: `Parsing JSON config at ${path}`,
    problem: errorMessage(err),
    location: 'aiAdapter.ts:loadRegistry',
    nextSteps: [
      `Validate the file: node -e "JSON.parse(require('fs').readFileSync('${path}','utf-8'))"`,
      'Check for trailing commas or syntax errors in the JSON',
    ],
    innerError: err,
  });
}
```

#### Retry + Fallback

Use `withRetry()` from `lib/ai-client/retry.ts` for transient API failures:

```typescript
import { withRetry, CLI_RETRY_CONFIG } from 'lib/ai-client';

const result = await withRetry(
  () => callProvider(fetch, backend, prompt, modelId, apiKey, opts),
  CLI_RETRY_CONFIG,
  `${backend}/${modelId}`,
);
```

#### React error boundaries (Taxonomy Editor)
```typescript
// In catch blocks within React hooks/components
try {
  await loadTaxonomy();
} catch (err) {
  if (err instanceof ActionableError) {
    // Structured error — display goal + next steps in UI
    setError({ message: err.message, steps: err.nextSteps });
  } else {
    // Unexpected error — wrap it
    const wrapped = new ActionableError({
      goal: 'Loading taxonomy data',
      problem: errorMessage(err),
      location: 'useTaxonomyStore:load',
      nextSteps: ['Reload the app', 'Check the developer console for details'],
      innerError: err,
    });
    setError({ message: wrapped.message, steps: wrapped.nextSteps });
  }
}
```

---

## When to Use Which Pattern

| Situation | Pattern |
|-----------|---------|
| Single operation, no retry needed | `try/catch` → `New-ActionableError` / `throw new ActionableError(...)` |
| Transient failures (API, network) | `Invoke-WithRecovery` (PS) / `withRetry()` from `lib/ai-client` (TS) |
| Multiple backends available | `Invoke-WithRecovery` (PS) / fallback chain in `aiAdapter.ts` |
| Validation / precondition checks | `if (!condition)` → `New-ActionableError -Throw` / `throw new ActionableError(...)` |
| Partial results acceptable | Catch per-item, accumulate errors, report summary at end |

## Audit Checklist

When reviewing or modifying code, verify:

- [ ] Every `try/catch` produces an actionable error (not bare `throw` or `console.error`)
- [ ] External calls (API, file I/O, IPC, subprocess) have error handling
- [ ] Transient failures have retry logic
- [ ] Error messages include all four fields (goal, problem, location, next steps)
- [ ] Next steps are specific and actionable (commands to run, settings to check)
- [ ] Recovery is attempted before failure (retry, fallback, partial results)
- [ ] Errors are not silently swallowed (no empty catch blocks)
