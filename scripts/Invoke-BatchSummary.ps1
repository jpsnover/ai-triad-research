#Requires -Version 7.0
<#
.SYNOPSIS
    Smart batch POV summarization.

.DESCRIPTION
    Triggered by GitHub Actions when TAXONOMY_VERSION changes.
    Only re-summarizes documents whose pov_tags overlap with changed taxonomy files.

    Logic:
        1. Read TAXONOMY_VERSION from repo root.
        2. Determine which taxonomy/*.json files changed (via git diff or -ForceAll flag).
        3. Derive the affected POV camps from changed filenames.
        4. Find all sources/*/metadata.json where pov_tags intersects with affected camps.
        5. For each matched doc, call Gemini API with current taxonomy as context.
        6. Write result to summaries/<doc-id>.json (replace).
        7. Update metadata.json: summary_version and summary_status: current.
        8. For unmatched docs, update summary_status: current (no reprocess needed).
        9. Call Find-Conflict.ps1 for each newly generated summary.

.PARAMETER ForceAll
    Reprocess every document regardless of POV.

.PARAMETER DocId
    Reprocess a single document by its ID.

.PARAMETER Model
    Gemini model to use. Defaults to AI_MODEL env var, then "gemini-2.5-flash".

.PARAMETER Temperature
    Sampling temperature (0.0-1.0). Default: 0.1

.PARAMETER DryRun
    Resolve which documents would be processed and show the plan, but make
    no API calls and write no files.

.PARAMETER MaxConcurrent
    Number of documents to process in parallel. Default: 1 (sequential).
    Set to 3-5 for gemini-2.5-flash-lite; keep at 1 for gemini-2.5-flash to avoid 429s.

.PARAMETER SkipConflictDetection
    Do not call Find-Conflict.ps1 after each summary. Useful when running
    conflict detection separately as a post-batch step.

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1
    # Smart mode — git diff determines which docs need reprocessing

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1 -ForceAll
    # Reprocess every doc regardless of POV tag

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1 -DocId 'some-document-id'
    # Reprocess a single document by ID

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1 -DryRun
    # Show what would be processed without calling the API

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1 -ForceAll -Model gemini-2.5-flash-lite -MaxConcurrent 4
    # Fast full reprocess using flash-lite model with parallelism

.NOTES
    Environment variables:
        AI_API_KEY      Gemini API key (required unless -DryRun)
        AI_MODEL        Model identifier, e.g. gemini-2.5-flash (optional override)
#>

[CmdletBinding()]
param(
    [switch]$ForceAll,
    [string]$DocId,

    [ValidateSet('gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro')]
    [string]$Model = $(if ($env:AI_MODEL -match '^gemini-') { $env:AI_MODEL } else { 'gemini-2.5-flash' }),

    [ValidateRange(0.0, 1.0)]
    [double]$Temperature = 0.1,

    [switch]$DryRun,

    [ValidateRange(1, 10)]
    [int]$MaxConcurrent = 1,

    [switch]$SkipConflictDetection
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
$RepoRoot      = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SourcesDir    = Join-Path $RepoRoot 'sources'
$SummariesDir  = Join-Path $RepoRoot 'summaries'
$TaxonomyDir   = Join-Path $RepoRoot 'taxonomy'
$VersionFile   = Join-Path $RepoRoot 'TAXONOMY_VERSION'
$ConflictsDir  = Join-Path $RepoRoot 'conflicts'
$FindConflictScript = Join-Path $PSScriptRoot 'Find-Conflict.ps1'

# ─────────────────────────────────────────────────────────────────────────────
# Console helpers
# ─────────────────────────────────────────────────────────────────────────────
function Write-Step  { param([string]$M) Write-Host "`n▶  $M"     -ForegroundColor Cyan   }
function Write-OK    { param([string]$M) Write-Host "   ✓  $M"   -ForegroundColor Green  }
function Write-Warn  { param([string]$M) Write-Host "   ⚠  $M"   -ForegroundColor Yellow }
function Write-Fail  { param([string]$M) Write-Host "   ✗  $M"   -ForegroundColor Red    }
function Write-Info  { param([string]$M) Write-Host "   →  $M"   -ForegroundColor Gray   }

# ─────────────────────────────────────────────────────────────────────────────
# POV file → camp mapping
# cross-cutting.json affects all three camps because the concepts it defines
# are cited by all camps; a change to it can shift any document's mapping.
# ─────────────────────────────────────────────────────────────────────────────
$PovFileMap = [ordered]@{
    'accelerationist.json' = @('accelerationist')
    'safetyist.json'       = @('safetyist')
    'skeptic.json'         = @('skeptic')
    'cross-cutting.json'   = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 0 — Validate environment
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Validating environment"

# Resolve API key — only required for real runs
$ApiKey = $env:AI_API_KEY
if (-not $DryRun -and [string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Fail "No API key found. Set the AI_API_KEY environment variable:"
    Write-Info '  $env:AI_API_KEY = "AIza..."'
    exit 1
}

# Validate repo structure
foreach ($req in @($SourcesDir, $TaxonomyDir, $VersionFile)) {
    if (-not (Test-Path $req)) {
        Write-Fail "Required path not found: $req"
        Write-Info "Run Initialize-AITriadRepo.ps1 to scaffold the repository."
        exit 1
    }
}

# Ensure output directories exist
foreach ($dir in @($SummariesDir, $ConflictsDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

# Read taxonomy version
$TaxonomyVersion = (Get-Content -Path $VersionFile -Raw).Trim()

Write-OK "Repo root         : $RepoRoot"
Write-OK "Taxonomy version  : $TaxonomyVersion"
Write-OK "Model             : $Model"
Write-OK "Temperature       : $Temperature"
Write-OK "MaxConcurrent     : $MaxConcurrent"
if ($DryRun)                { Write-Warn "DRY RUN — no API calls, no file writes" }
if ($ForceAll)              { Write-Warn "FORCE ALL — every document will be reprocessed" }
if ($DocId)                 { Write-Info "Single doc mode: $DocId" }
if ($SkipConflictDetection) { Write-Info "Conflict detection: skipped" }

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Load the full taxonomy (done once; shared across all API calls)
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Loading taxonomy"

$TaxonomyContext = [ordered]@{}
foreach ($FileName in $PovFileMap.Keys) {
    $FilePath = Join-Path $TaxonomyDir $FileName
    if (-not (Test-Path $FilePath)) {
        Write-Fail "Taxonomy file missing: $FilePath"
        exit 1
    }
    $TaxonomyContext[$FileName] = Get-Content -Path $FilePath -Raw | ConvertFrom-Json
    $NodeCount = $TaxonomyContext[$FileName].nodes.Count
    Write-OK "  $FileName ($NodeCount nodes)"
}
$TaxonomyJson = $TaxonomyContext | ConvertTo-Json -Depth 20

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Determine which taxonomy files changed since the previous version
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Determining affected camps"

$ChangedTaxonomyFiles = @()

if ($ForceAll -or $DocId) {
    # Force mode: treat all taxonomy files as changed
    $ChangedTaxonomyFiles = @($PovFileMap.Keys)
    if ($ForceAll) { Write-Info "Force mode — treating all taxonomy files as changed" }
    if ($DocId)    { Write-Info "Single-doc mode — treating all taxonomy files as changed" }

} else {
    # Smart mode: use git diff to find which taxonomy/*.json files changed
    $GitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)

    if (-not $GitAvailable) {
        Write-Warn "git not found — falling back to ForceAll mode"
        $ChangedTaxonomyFiles = @($PovFileMap.Keys)
    } else {
        # Find the previous tag/commit so we can diff against it.
        # Strategy: look for the most recent commit that changed TAXONOMY_VERSION
        # that isn't HEAD (i.e., the commit just before the current version bump).
        try {
            Push-Location $RepoRoot

            # Get the two most recent commits that touched TAXONOMY_VERSION
            $VersionCommits = @(git log --pretty=format:"%H" -- TAXONOMY_VERSION 2>$null |
                              Select-Object -First 2)

            if ($VersionCommits.Count -ge 2) {
                $PrevCommit = $VersionCommits[1]   # commit before the version bump
                $CurrCommit = $VersionCommits[0]   # the version bump commit (HEAD or near)

                # Diff taxonomy/ between those two commits
                $GitDiffOutput = git diff --name-only "${PrevCommit}..${CurrCommit}" -- taxonomy/ 2>$null
                Write-Info "Git diff range: $($PrevCommit.Substring(0,8))...$($CurrCommit.Substring(0,8))"

            } else {
                # First-ever version commit — treat everything as changed
                Write-Info "No previous version commit found; treating all files as changed"
                $GitDiffOutput = $PovFileMap.Keys | ForEach-Object { "taxonomy/$_" }
            }

            foreach ($ChangedPath in $GitDiffOutput) {
                $ChangedFile = Split-Path $ChangedPath -Leaf
                if ($PovFileMap.Contains($ChangedFile)) {
                    $ChangedTaxonomyFiles += $ChangedFile
                }
            }

        } catch {
            Write-Warn "git diff failed: $_ — falling back to ForceAll mode"
            $ChangedTaxonomyFiles = @($PovFileMap.Keys)
        } finally {
            Pop-Location
        }
    }
}

$ChangedTaxonomyFiles = $ChangedTaxonomyFiles | Select-Object -Unique

if ($ChangedTaxonomyFiles.Count -eq 0) {
    Write-OK "No taxonomy files changed. Nothing to reprocess."
    exit 0
}

Write-OK "Changed taxonomy files: $($ChangedTaxonomyFiles -join ', ')"

# Derive the set of affected camps from the changed files
$AffectedCamps = @()
foreach ($File in $ChangedTaxonomyFiles) {
    $AffectedCamps += $PovFileMap[$File]
}
$AffectedCamps = $AffectedCamps | Select-Object -Unique
Write-OK "Affected POV camps: $($AffectedCamps -join ', ')"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Collect and triage source documents
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Triaging source documents"

$AllMetaFiles = @(Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse |
                Where-Object { $_.FullName -notmatch '_inbox' })

if ($AllMetaFiles.Count -eq 0) {
    Write-Warn "No source documents found in $SourcesDir"
    exit 0
}

$DocsToProcess  = [System.Collections.Generic.List[hashtable]]::new()
$DocsToSkip     = [System.Collections.Generic.List[hashtable]]::new()

foreach ($MetaFile in $AllMetaFiles) {
    $Meta     = Get-Content $MetaFile.FullName -Raw | ConvertFrom-Json
    $ThisDocId = $Meta.id

    # Single-doc override
    if ($DocId -and $ThisDocId -ne $DocId) { continue }

    $SnapshotFile = Join-Path $MetaFile.DirectoryName 'snapshot.md'
    if (-not (Test-Path $SnapshotFile)) {
        Write-Warn "  SKIP $ThisDocId — snapshot.md missing"
        continue
    }

    # Check if this doc's POV tags intersect with affected camps
    $DocPovTags = if ($null -ne $Meta.PSObject.Properties['pov_tags'] -and $null -ne $Meta.pov_tags) { @($Meta.pov_tags) } else { @() }
    $Intersects = $ForceAll -or
                  $DocId    -or
                  @($DocPovTags | Where-Object { $_ -in $AffectedCamps }).Count -gt 0

    $Entry = @{
        DocId        = $ThisDocId
        MetaFile     = $MetaFile.FullName
        SnapshotFile = $SnapshotFile
        Meta         = $Meta
        PovTags      = $DocPovTags
    }

    if ($Intersects) {
        $DocsToProcess.Add($Entry)
    } else {
        $DocsToSkip.Add($Entry)
    }
}

if ($DocId -and $DocsToProcess.Count -eq 0) {
    Write-Fail "Document not found: $DocId"
    Write-Info "Check that sources/$DocId/ exists and has a metadata.json"
    exit 1
}

Write-OK "Documents to reprocess : $($DocsToProcess.Count)"
Write-OK "Documents to mark current (no reprocess): $($DocsToSkip.Count)"

# ─────────────────────────────────────────────────────────────────────────────
# DRY RUN — print plan and exit
# ─────────────────────────────────────────────────────────────────────────────
if ($DryRun) {
    Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
    Write-Host "  DRY RUN PLAN" -ForegroundColor Yellow
    Write-Host "$('─' * 72)" -ForegroundColor DarkGray

    Write-Host "`n  WOULD REPROCESS ($($DocsToProcess.Count) docs):" -ForegroundColor Cyan
    foreach ($Doc in $DocsToProcess) {
        Write-Host "    $($Doc.DocId)  [pov: $($Doc.PovTags -join ', ')]" -ForegroundColor White
    }

    Write-Host "`n  WOULD MARK CURRENT — no API call ($($DocsToSkip.Count) docs):" -ForegroundColor Gray
    foreach ($Doc in $DocsToSkip) {
        Write-Host "    $($Doc.DocId)  [pov: $($Doc.PovTags -join ', ')]" -ForegroundColor DarkGray
    }

    Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
    Write-Host "  DRY RUN complete. No API calls made. No files written." -ForegroundColor Yellow
    Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
    exit 0
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Mark non-affected docs as current without reprocessing
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Marking non-affected documents as current"

$Now = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'

foreach ($Doc in $DocsToSkip) {
    try {
        $MetaRaw     = Get-Content $Doc.MetaFile -Raw
        $MetaUpdated = $MetaRaw | ConvertFrom-Json -AsHashtable
        $MetaUpdated['summary_version'] = $TaxonomyVersion
        $MetaUpdated['summary_status']  = 'current'
        $MetaUpdated['summary_updated'] = $Now
        Set-Content -Path $Doc.MetaFile -Value ($MetaUpdated | ConvertTo-Json -Depth 10) -Encoding UTF8
        Write-Info "  Marked current: $($Doc.DocId)"
    } catch {
        Write-Warn "  Could not update metadata for $($Doc.DocId): $_"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Shared prompt components (built once, reused per document)
# ─────────────────────────────────────────────────────────────────────────────

# Output schema Gemini must conform to — identical to Invoke-POVSummary.ps1
$OutputSchema = @'
{
  "pov_summaries": {
    "accelerationist": {
      "stance": "<one of: strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable>",
      "key_points": [
        {
          "taxonomy_node_id": "<node id from taxonomy, e.g. acc-goals-001, OR null if no match>",
          "category": "<Goals/Values | Data/Facts | Methods>",
          "point": "<1-2 sentences describing what this document says, from the Accelerationist lens>",
          "verbatim": "<3-5 sentences quoted verbatim from the document that best capture this point>",
          "excerpt_context": "<brief pointer to where in the document this appears, e.g. Section 2, paragraph 3>"
        }
      ]
    },
    "safetyist": {
      "stance": "<one of: strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable>",
      "key_points": [
        {
          "taxonomy_node_id": "<node id, e.g. saf-goals-001, OR null if no match>",
          "category": "<Goals/Values | Data/Facts | Methods>",
          "point": "<1-2 sentences describing what this document says, from the Safetyist lens>",
          "verbatim": "<3-5 sentences quoted verbatim from the document that best capture this point>",
          "excerpt_context": "<brief pointer to location in document>"
        }
      ]
    },
    "skeptic": {
      "stance": "<one of: strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable>",
      "key_points": [
        {
          "taxonomy_node_id": "<node id, e.g. skp-goals-001, OR null if no match>",
          "category": "<Goals/Values | Data/Facts | Methods>",
          "point": "<1-2 sentences describing what this document says, from the Skeptic lens>",
          "verbatim": "<3-5 sentences quoted verbatim from the document that best capture this point>",
          "excerpt_context": "<brief pointer to location in document>"
        }
      ]
    }
  },
  "factual_claims": [
    {
      "claim": "<a specific empirical or factual claim made in the document>",
      "doc_position": "<supports | disputes | neutral>",
      "potential_conflict_id": "<existing conflict id if relevant, e.g. conflict-scaling-laws-001, OR null>"
    }
  ],
  "unmapped_concepts": [
    {
      "concept": "<a concept in the document that does not map to any existing taxonomy node>",
      "suggested_label": "<A short label for this concept, e.g. 'AI-driven economic growth'>", 
      "suggested_description": "<A 1-2 sentence description of the concept, suitable for a taxonomy node description>",     
      "suggested_pov": "<accelerationist | safetyist | skeptic | cross-cutting>",
      "Accelerationist Interpretation:" "<If suggested_pov is 'cross-cutting', provide a brief interpretation of how this concept might be viewed from the accelerationist camp's perspective>",
      "Accelerationist Interpretation:" "<If suggested_pov is 'cross-cutting', provide a brief interpretation of how this concept might be viewed from the accelerationist camp's perspective>",
      "Safetyist Interpretation:" "<If suggested_pov is 'cross-cutting', provide a brief interpretation of how this concept might be viewed from the safetyist camp's perspective>",
      "Skeptic Interpretation:" "<If suggested_pov is 'cross-cutting', provide a brief interpretation of how this concept might be viewed from the skeptic camp's perspective>",
      "Linked Nodes": "<POV-specifc notes taht relate to this cross cutting concept.  Links this shared theme to the specific perspective claims in the taxonomy.>",
      "Conflict IDs": "<Links to documented conflicts where this cross-cutting concept is a point of disagreement between perspectives, e.g. conflict-scaling-laws-001>",
      "suggested_category": "<Goals/Values | Data/Facts | Methods>",
      "reason": "<why this concept might deserve a new taxonomy node>"
    }
  ]
}
'@

$SystemPrompt = @"
You are a research analyst for the AI Triad project at the Berkman Klein Center.

Your job is to read a source document and produce a structured analysis that maps
the document's content to three Points of View (POV camps):
  - Accelerationist: AI as revolutionary force for abundance and solving existential problems
  - Safetyist: AI poses catastrophic/existential risks; alignment must precede deployment
  - Skeptic: AI causes immediate, measurable harms (bias, labor displacement, privacy)

For EACH POV camp you must identify:
  1. Goals/Values  — desired end-states the document supports or opposes
  2. Data/Facts    — empirical claims the document asserts or disputes
  3. Methods       — interpretive frameworks or policy approaches it endorses or rejects

RULES:
  - Map every point to a taxonomy node ID from the provided taxonomy where possible.
    Use the exact node IDs (e.g. "acc-goals-001", "saf-data-002", "skp-methods-001").
  - If a point does not fit any existing node, set taxonomy_node_id to null and describe
    it in the unmapped_concepts array. This is how the taxonomy grows.
  - For Data/Facts points only: if the document's claim contradicts or supports an
    existing conflict entry, include the conflict_id in factual_claims.
  - stance must be ONE of: strongly_aligned | aligned | neutral | opposed |
    strongly_opposed | not_applicable
  - For each key_point, the "verbatim" field must contain 1-5 sentences copied
    EXACTLY from the document (word-for-word) that best capture the point being made.
    Use the minimum number of sentences needed to convey the core idea. Do NOT
    paraphrase, summarize, or alter the text in any way — copy it verbatim.
  - Return ONLY a valid JSON object. No markdown fences, no preamble, no explanation
    outside the JSON.
  - Be precise and specific. Every key_point must reference a real passage in the document.
"@

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Core per-document summarization function
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-DocumentSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Doc,
        [Parameter(Mandatory)][string]$ApiKey,
        [Parameter(Mandatory)][string]$Model,
        [Parameter(Mandatory)][double]$Temperature,
        [Parameter(Mandatory)][string]$TaxonomyVersion,
        [Parameter(Mandatory)][string]$TaxonomyJson,
        [Parameter(Mandatory)][string]$SystemPrompt,
        [Parameter(Mandatory)][string]$OutputSchema,
        [Parameter(Mandatory)][string]$SummariesDir,
        [Parameter(Mandatory)][string]$Now
    )

    $ThisDocId = $Doc.DocId
    $Meta      = $Doc.Meta

    Write-Host "`n  ┌─ $ThisDocId" -ForegroundColor White
    Write-Host "  │  pov: $($Doc.PovTags -join ', ')  |  model: $Model" -ForegroundColor Gray

    # ── Load snapshot ─────────────────────────────────────────────────────────
    $SnapshotText = Get-Content $Doc.SnapshotFile -Raw
    if ([string]::IsNullOrWhiteSpace($SnapshotText)) {
        Write-Host "  └─ SKIP $ThisDocId — snapshot.md is empty" -ForegroundColor Yellow
        return @{ Success = $false; DocId = $ThisDocId; Error = 'EmptySnapshot' }
    }
    $EstimatedTokens = [int]($SnapshotText.Length / 4)
    Write-Host "  │  snapshot: $($SnapshotText.Length) chars (~$EstimatedTokens tokens est.)" -ForegroundColor Gray

    if ($EstimatedTokens -gt 100000) {
        Write-Host "  │  ⚠ Very long document (~$EstimatedTokens tokens). May hit context limits." -ForegroundColor Yellow
    }

    # ── Build prompt ──────────────────────────────────────────────────────────
    $FullPrompt = @"
$SystemPrompt

=== TAXONOMY (version $TaxonomyVersion) ===
$TaxonomyJson

=== OUTPUT SCHEMA (your response must match this structure) ===
$OutputSchema

=== DOCUMENT: $ThisDocId ===
Title: $(if ($Meta.title) { $Meta.title } else { $ThisDocId })
POV tags (pre-classified): $($Doc.PovTags -join ', ')
Topic tags: $(if ($null -ne $Meta.PSObject.Properties['topic_tags'] -and $Meta.topic_tags) { $Meta.topic_tags -join ', ' } else { '(none)' })

--- DOCUMENT CONTENT ---
$SnapshotText
"@

    # ── Call Gemini API ───────────────────────────────────────────────────────
    $ApiUrl = "https://generativelanguage.googleapis.com/v1beta/models/${Model}:generateContent?key=$ApiKey"

    $RequestBody = @{
        contents = @(@{
            parts = @(@{ text = $FullPrompt })
        })
        generationConfig = @{
            temperature      = $Temperature
            responseMimeType = 'application/json'
            maxOutputTokens  = 16384
        }
        safetySettings = @(
            @{ category = 'HARM_CATEGORY_HARASSMENT';        threshold = 'BLOCK_NONE' }
            @{ category = 'HARM_CATEGORY_HATE_SPEECH';       threshold = 'BLOCK_NONE' }
            @{ category = 'HARM_CATEGORY_SEXUALLY_EXPLICIT'; threshold = 'BLOCK_NONE' }
            @{ category = 'HARM_CATEGORY_DANGEROUS_CONTENT'; threshold = 'BLOCK_NONE' }
        )
    } | ConvertTo-Json -Depth 20

    $StartTime = Get-Date

    $MaxRetries    = 3
    $RetryDelays   = @(5, 15, 45)   # seconds — exponential backoff for 429s
    $Response      = $null
    $LastError     = $null

    for ($Attempt = 0; $Attempt -lt $MaxRetries; $Attempt++) {
        try {
            $Response = Invoke-RestMethod `
                -Uri         $ApiUrl `
                -Method      POST `
                -ContentType 'application/json' `
                -Body        $RequestBody `
                -TimeoutSec  120 `
                -ErrorAction Stop
            $LastError = $null
            break
        } catch {
            $LastError  = $_
            $StatusCode = $_.Exception.Response.StatusCode.value__

            if ($StatusCode -eq 429 -and $Attempt -lt ($MaxRetries - 1)) {
                $Delay = $RetryDelays[$Attempt]
                Write-Host "  │  ⚠ Rate limited (429). Retrying in ${Delay}s... (attempt $($Attempt+1)/$MaxRetries)" -ForegroundColor Yellow
                Start-Sleep -Seconds $Delay
            } elseif ($StatusCode -eq 503 -and $Attempt -lt ($MaxRetries - 1)) {
                $Delay = $RetryDelays[$Attempt]
                Write-Host "  │  ⚠ Service unavailable (503). Retrying in ${Delay}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $Delay
            } else {
                break
            }
        }
    }

    if ($null -ne $LastError -or $null -eq $Response) {
        $StatusCode = if ($LastError) { $LastError.Exception.Response.StatusCode.value__ } else { '?' }
        Write-Host "  └─ ✗ FAILED (HTTP $StatusCode): $ThisDocId" -ForegroundColor Red

        $ErrMsg = switch ($StatusCode) {
            400 { "Bad request — prompt may be malformed or exceed token limits" }
            401 { "Invalid API key — check AI_API_KEY" }
            403 { "Forbidden — ensure Gemini API is enabled in your Google Cloud project" }
            429 { "Rate limit exceeded after $MaxRetries retries" }
            500 { "Gemini internal server error" }
            503 { "Gemini service unavailable after $MaxRetries retries" }
            default { "HTTP $StatusCode" }
        }
        Write-Host "     $ErrMsg" -ForegroundColor DarkRed

        return @{ Success = $false; DocId = $ThisDocId; Error = $ErrMsg }
    }

    $Elapsed = (Get-Date) - $StartTime
    Write-Host "  │  ✓ Response: $([int]$Elapsed.TotalSeconds)s" -ForegroundColor Green

    # ── Parse and validate JSON ───────────────────────────────────────────────
    $RawText    = $Response.candidates[0].content.parts[0].text
    $CleanText  = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanText  = $CleanText.Trim()

    try {
        $SummaryObject = $CleanText | ConvertFrom-Json -Depth 20
    } catch {
        $DebugPath = Join-Path $SummariesDir "${ThisDocId}.debug-raw.txt"
        Set-Content -Path $DebugPath -Value $RawText -Encoding UTF8
        Write-Host "  └─ ✗ Invalid JSON from Gemini. Raw saved: $DebugPath" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = 'InvalidJson' }
    }

    # Validate stance values and gather counts for reporting
    $ValidStances = @('strongly_aligned','aligned','neutral','opposed','strongly_opposed','not_applicable')
    $Camps        = @('accelerationist','safetyist','skeptic')
    $TotalPoints  = 0
    $NullNodes    = 0

    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        if ($CampData) {
            if ($CampData.stance -notin $ValidStances) { $CampData.stance = 'neutral' }
            if ($CampData.key_points) {
                $TotalPoints += @($CampData.key_points).Count
                $NullNodes   += @($CampData.key_points | Where-Object { $null -eq $_.taxonomy_node_id }).Count
            }
        }
    }

    $FactualCount   = if ($SummaryObject.factual_claims)   { @($SummaryObject.factual_claims).Count }   else { 0 }
    $UnmappedCount  = if ($SummaryObject.unmapped_concepts) { @($SummaryObject.unmapped_concepts).Count } else { 0 }

    Write-Host "  │  points: $TotalPoints ($NullNodes unmapped)  factual: $FactualCount  new_concepts: $UnmappedCount" -ForegroundColor Gray

    # ── Write summaries/<doc-id>.json ─────────────────────────────────────────
    $FinalSummary = [ordered]@{
        doc_id            = $ThisDocId
        taxonomy_version  = $TaxonomyVersion
        generated_at      = $Now
        ai_model          = $Model
        temperature       = $Temperature
        pov_summaries     = $SummaryObject.pov_summaries
        factual_claims    = $SummaryObject.factual_claims
        unmapped_concepts = $SummaryObject.unmapped_concepts
    }

    $SummaryPath = Join-Path $SummariesDir "${ThisDocId}.json"
    Set-Content -Path $SummaryPath -Value ($FinalSummary | ConvertTo-Json -Depth 20) -Encoding UTF8

    # ── Update metadata.json ──────────────────────────────────────────────────
    $MetaRaw     = Get-Content $Doc.MetaFile -Raw
    $MetaUpdated = $MetaRaw | ConvertFrom-Json -AsHashtable
    $MetaUpdated['summary_version'] = $TaxonomyVersion
    $MetaUpdated['summary_status']  = 'current'
    $MetaUpdated['summary_updated'] = $Now
    Set-Content -Path $Doc.MetaFile -Value ($MetaUpdated | ConvertTo-Json -Depth 10) -Encoding UTF8

    Write-Host "  └─ ✓ Done: summaries/$ThisDocId.json" -ForegroundColor Green

    return @{
        Success       = $true
        DocId         = $ThisDocId
        TotalPoints   = $TotalPoints
        NullNodes     = $NullNodes
        FactualCount  = $FactualCount
        UnmappedCount = $UnmappedCount
        ElapsedSecs   = [int]$Elapsed.TotalSeconds
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — Process documents (sequential or parallel)
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Processing $($DocsToProcess.Count) document(s)"

# Capture shared state needed inside the scriptblock
$SharedParams = @{
    ApiKey          = $ApiKey
    Model           = $Model
    Temperature     = $Temperature
    TaxonomyVersion = $TaxonomyVersion
    TaxonomyJson    = $TaxonomyJson
    SystemPrompt    = $SystemPrompt
    OutputSchema    = $OutputSchema
    SummariesDir    = $SummariesDir
    Now             = $Now
}

$Results = [System.Collections.Concurrent.ConcurrentBag[object]]::new()

if ($MaxConcurrent -le 1) {
    # ── Sequential processing ─────────────────────────────────────────────────
    foreach ($Doc in $DocsToProcess) {
        $Result = Invoke-DocumentSummary -Doc $Doc @SharedParams
        $Results.Add($Result)
    }
} else {
    # ── Parallel processing (PowerShell 7 ForEach-Object -Parallel) ───────────
    Write-Info "Running $MaxConcurrent parallel workers"

    # Capture function body as a string to inject into parallel scope
    $FnBody = (Get-Command Invoke-DocumentSummary).ScriptBlock.ToString()

    $DocsToProcess | ForEach-Object -Parallel {
        # Re-define the function in this runspace
        $fn = [scriptblock]::Create("function Invoke-DocumentSummary {$using:FnBody}")
        . $fn

        $bag    = $using:Results
        $Result = Invoke-DocumentSummary -Doc $_ @using:SharedParams
        [void]$bag.Add($Result)

    } -ThrottleLimit $MaxConcurrent
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8 — Conflict detection for successful summaries
# ─────────────────────────────────────────────────────────────────────────────
if (-not $SkipConflictDetection -and (Test-Path $FindConflictScript)) {
    Write-Step "Running conflict detection"

    $SuccessfulDocs = $Results | Where-Object { $_.Success }

    foreach ($Result in $SuccessfulDocs) {
        try {
            & $FindConflictScript -DocId $Result.DocId
            Write-Info "  Conflict detection: $($Result.DocId)"
        } catch {
            Write-Warn "  Find-Conflict.ps1 failed for $($Result.DocId): $_"
        }
    }
} elseif (-not $SkipConflictDetection) {
    Write-Info "Find-Conflict.ps1 not found at $FindConflictScript — skipping conflict detection"
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9 — Final report
# ─────────────────────────────────────────────────────────────────────────────
$Succeeded = @($Results | Where-Object { $_.Success })
$Failed    = @($Results | Where-Object { -not $_.Success })

Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
Write-Host "  BATCH SUMMARY  —  taxonomy v$TaxonomyVersion  |  model: $Model" -ForegroundColor White
Write-Host "$('═' * 72)" -ForegroundColor Cyan
Write-Host "  Reprocessed   : $($Succeeded.Count) / $($DocsToProcess.Count) succeeded" -ForegroundColor $(if ($Failed.Count -eq 0) { 'Green' } else { 'Yellow' })
Write-Host "  Marked current: $($DocsToSkip.Count) (no reprocess needed)" -ForegroundColor Gray

if ($Succeeded.Count -gt 0) {
    $TotalPts      = ($Succeeded | Measure-Object -Property TotalPoints   -Sum).Sum
    $TotalUnmapped = ($Succeeded | Measure-Object -Property UnmappedCount -Sum).Sum
    $TotalFacts    = ($Succeeded | Measure-Object -Property FactualCount  -Sum).Sum
    $TotalSecs     = ($Succeeded | Measure-Object -Property ElapsedSecs   -Sum).Sum
    Write-Host "  Total points  : $TotalPts ($TotalUnmapped new concepts)" -ForegroundColor White
    Write-Host "  Factual claims: $TotalFacts" -ForegroundColor White
    Write-Host "  Total API time: ${TotalSecs}s (~$([int]($TotalSecs / [Math]::Max(1,$Succeeded.Count)))s/doc avg)" -ForegroundColor Gray
}

if ($Failed.Count -gt 0) {
    Write-Host "`n  FAILED ($($Failed.Count)):" -ForegroundColor Red
    foreach ($F in $Failed) {
        Write-Host "    ✗ $($F.DocId)  — $($F.Error)" -ForegroundColor Red
    }
    Write-Host "`n  Re-run failed documents individually:" -ForegroundColor Yellow
    foreach ($F in $Failed) {
        Write-Host "    .\scripts\Invoke-BatchSummary.ps1 -DocId '$($F.DocId)'" -ForegroundColor DarkYellow
    }
}

Write-Host "`n  Output: summaries/*.json  |  metadata updated in sources/*/metadata.json"
Write-Host "$('═' * 72)`n" -ForegroundColor Cyan

# Exit non-zero if any documents failed, so GitHub Actions marks the job as failed
if ($Failed.Count -gt 0) { exit 1 }
exit 0
