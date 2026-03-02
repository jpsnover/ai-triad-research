function Invoke-BatchSummary {
    <#
    .SYNOPSIS
        Smart batch POV summarization.
    .DESCRIPTION
        Triggered by GitHub Actions when TAXONOMY_VERSION changes.
        Only re-summarizes documents whose pov_tags overlap with changed taxonomy files.
    .PARAMETER ForceAll
        Reprocess every document regardless of POV.
    .PARAMETER DocId
        Reprocess a single document by its ID.
    .PARAMETER Model
        AI model to use. Defaults to AI_MODEL env var, then "gemini-2.5-flash".
        Supports Gemini, Claude, and Groq backends.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.1
    .PARAMETER DryRun
        Show the plan without making API calls or writing files.
    .PARAMETER MaxConcurrent
        Number of documents to process in parallel. Default: 1.
    .PARAMETER SkipConflictDetection
        Do not call Find-Conflict after each summary.
    .EXAMPLE
        Invoke-BatchSummary
    .EXAMPLE
        Invoke-BatchSummary -ForceAll
    .EXAMPLE
        Invoke-BatchSummary -DocId 'some-document-id'
    .EXAMPLE
        Invoke-BatchSummary -DryRun
    #>
    [CmdletBinding()]
    param(
        [switch]$ForceAll,
        [string]$DocId,

        [ValidateSet(
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'claude-opus-4', 'claude-sonnet-4-5', 'claude-haiku-3.5',
            'groq-llama-3.3-70b', 'groq-llama-4-scout'
        )]
        [string]$Model = $(if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-2.5-flash' }),

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.1,

        [switch]$DryRun,

        [ValidateRange(1, 10)]
        [int]$MaxConcurrent = 1,

        [switch]$SkipConflictDetection
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # -- Paths ----------------------------------------------------------------
    $RepoRoot      = $script:RepoRoot
    $SourcesDir    = Join-Path $RepoRoot 'sources'
    $SummariesDir  = Join-Path $RepoRoot 'summaries'
    $TaxonomyDir   = Join-Path $RepoRoot 'taxonomy' 'Origin'
    $VersionFile   = Join-Path $RepoRoot 'TAXONOMY_VERSION'
    $ConflictsDir  = Join-Path $RepoRoot 'conflicts'

    # -- POV file -> camp mapping ---------------------------------------------
    $PovFileMap = [ordered]@{
        'accelerationist.json' = @('accelerationist')
        'safetyist.json'       = @('safetyist')
        'skeptic.json'         = @('skeptic')
        'cross-cutting.json'   = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
    }

    # -- STEP 0 — Validate environment ---------------------------------------
    Write-Step "Validating environment"

    $ModelInfo = $script:ModelRegistry[$Model]
    $Backend   = if ($ModelInfo) { $ModelInfo.Backend } else { 'gemini' }
    $ApiKey    = Resolve-AIApiKey -ExplicitKey '' -Backend $Backend
    if (-not $DryRun -and [string]::IsNullOrWhiteSpace($ApiKey)) {
        $EnvHint = switch ($Backend) {
            'gemini' { 'GEMINI_API_KEY' }
            'claude' { 'ANTHROPIC_API_KEY' }
            'groq'   { 'GROQ_API_KEY' }
            default  { 'AI_API_KEY' }
        }
        Write-Fail "No API key found. Set $EnvHint or AI_API_KEY."
        throw "No API key found for $Backend backend."
    }

    foreach ($req in @($SourcesDir, $TaxonomyDir, $VersionFile)) {
        if (-not (Test-Path $req)) {
            Write-Fail "Required path not found: $req"
            throw "Required path not found: $req"
        }
    }

    foreach ($dir in @($SummariesDir, $ConflictsDir)) {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }

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

    # -- STEP 1 — Load the full taxonomy -------------------------------------
    Write-Step "Loading taxonomy"

    $TaxonomyContext = [ordered]@{}
    foreach ($FileName in $PovFileMap.Keys) {
        $FilePath = Join-Path $TaxonomyDir $FileName
        if (-not (Test-Path $FilePath)) {
            Write-Fail "Taxonomy file missing: $FilePath"
            throw "Taxonomy file missing: $FileName"
        }
        $TaxonomyContext[$FileName] = Get-Content -Path $FilePath -Raw | ConvertFrom-Json
        $NodeCount = $TaxonomyContext[$FileName].nodes.Count
        Write-OK "  $FileName ($NodeCount nodes)"
    }
    $TaxonomyJson = $TaxonomyContext | ConvertTo-Json -Depth 20

    # -- STEP 2 — Determine which taxonomy files changed ----------------------
    Write-Step "Determining affected camps"

    $ChangedTaxonomyFiles = @()

    if ($ForceAll -or $DocId) {
        $ChangedTaxonomyFiles = @($PovFileMap.Keys)
        if ($ForceAll) { Write-Info "Force mode — treating all taxonomy files as changed" }
        if ($DocId)    { Write-Info "Single-doc mode — treating all taxonomy files as changed" }
    } else {
        $GitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)

        if (-not $GitAvailable) {
            Write-Warn "git not found — falling back to ForceAll mode"
            $ChangedTaxonomyFiles = @($PovFileMap.Keys)
        } else {
            try {
                Push-Location $RepoRoot

                $VersionCommits = @(git log --pretty=format:"%H" -- TAXONOMY_VERSION 2>$null |
                                  Select-Object -First 2)

                if ($VersionCommits.Count -ge 2) {
                    $PrevCommit = $VersionCommits[1]
                    $CurrCommit = $VersionCommits[0]

                    $GitDiffOutput = git diff --name-only "${PrevCommit}..${CurrCommit}" -- taxonomy/Origin/ 2>$null
                    Write-Info "Git diff range: $($PrevCommit.Substring(0,8))...$($CurrCommit.Substring(0,8))"
                } else {
                    Write-Info "No previous version commit found; treating all files as changed"
                    $GitDiffOutput = $PovFileMap.Keys | ForEach-Object { "taxonomy/Origin/$_" }
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
        return
    }

    Write-OK "Changed taxonomy files: $($ChangedTaxonomyFiles -join ', ')"

    $AffectedCamps = @()
    foreach ($File in $ChangedTaxonomyFiles) {
        $AffectedCamps += $PovFileMap[$File]
    }
    $AffectedCamps = $AffectedCamps | Select-Object -Unique
    Write-OK "Affected POV camps: $($AffectedCamps -join ', ')"

    # -- STEP 3 — Collect and triage source documents -------------------------
    Write-Step "Triaging source documents"

    $AllMetaFiles = @(Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse |
                    Where-Object { $_.FullName -notmatch '_inbox' })

    if ($AllMetaFiles.Count -eq 0) {
        Write-Warn "No source documents found in $SourcesDir"
        return
    }

    $DocsToProcess  = [System.Collections.Generic.List[hashtable]]::new()
    $DocsToSkip     = [System.Collections.Generic.List[hashtable]]::new()

    foreach ($MetaFile in $AllMetaFiles) {
        $Meta     = Get-Content $MetaFile.FullName -Raw | ConvertFrom-Json
        $ThisDocId = $Meta.id

        if ($DocId -and $ThisDocId -ne $DocId) { continue }

        $SnapshotFile = Join-Path $MetaFile.DirectoryName 'snapshot.md'
        if (-not (Test-Path $SnapshotFile)) {
            Write-Warn "  SKIP $ThisDocId — snapshot.md missing"
            continue
        }

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
        throw "Document not found: $DocId"
    }

    Write-OK "Documents to reprocess : $($DocsToProcess.Count)"
    Write-OK "Documents to mark current (no reprocess): $($DocsToSkip.Count)"

    # -- DRY RUN — print plan and return --------------------------------------
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
        return
    }

    # -- STEP 4 — Mark non-affected docs as current ---------------------------
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

    # -- STEP 5 — Shared prompt components ------------------------------------
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
          "verbatim": "<1-5 sentences quoted verbatim from the document that best capture this point>",
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
          "verbatim": "<1-5 sentences quoted verbatim from the document that best capture this point>",
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
          "verbatim": "<1-5 sentences quoted verbatim from the document that best capture this point>",
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
      "suggested_pov": "<accelerationist | safetyist | skeptic | cross-cutting>",
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
  3. Methods       — The logic models, interpretive lenses, or policy approaches used to process data in light of their goals and values (The How they think)

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

    # -- STEP 6 — Process documents -------------------------------------------
    Write-Step "Processing $($DocsToProcess.Count) document(s)"

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
        foreach ($Doc in $DocsToProcess) {
            $Result = Invoke-DocumentSummary -Doc $Doc @SharedParams
            $Results.Add($Result)
        }
    } else {
        Write-Info "Running $MaxConcurrent parallel workers"

        $FnBody = (Get-Command Invoke-DocumentSummary).ScriptBlock.ToString()

        $DocsToProcess | ForEach-Object -Parallel {
            $fn = [scriptblock]::Create("function Invoke-DocumentSummary {$using:FnBody}")
            . $fn

            $bag    = $using:Results
            $Result = Invoke-DocumentSummary -Doc $_ @using:SharedParams
            [void]$bag.Add($Result)

        } -ThrottleLimit $MaxConcurrent
    }

    # -- STEP 7 — Conflict detection for successful summaries -----------------
    if (-not $SkipConflictDetection) {
        Write-Step "Running conflict detection"

        $SuccessfulDocs = $Results | Where-Object { $_.Success }

        foreach ($Result in $SuccessfulDocs) {
            try {
                Find-Conflict -DocId $Result.DocId
                Write-Info "  Conflict detection: $($Result.DocId)"
            } catch {
                Write-Warn "  Find-Conflict failed for $($Result.DocId): $_"
            }
        }
    }

    # -- STEP 8 — Final report ------------------------------------------------
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
            Write-Host "    `u{2717} $($F.DocId)  — $($F.Error)" -ForegroundColor Red
        }
        Write-Host "`n  Re-run failed documents individually:" -ForegroundColor Yellow
        foreach ($F in $Failed) {
            Write-Host "    Invoke-BatchSummary -DocId '$($F.DocId)'" -ForegroundColor DarkYellow
        }
    }

    Write-Host "`n  Output: summaries/*.json  |  metadata updated in sources/*/metadata.json"
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan

    if ($Failed.Count -gt 0) {
        throw "$($Failed.Count) document(s) failed during batch summarization."
    }
}
