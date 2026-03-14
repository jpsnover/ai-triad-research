# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

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
        One or more document IDs to reprocess. Accepts pipeline input by value.
    .PARAMETER Model
        AI model to use. Defaults to AI_MODEL env var, then "gemini-3.1-flash-lite-preview".
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
        Invoke-BatchSummary -DocId 'doc-one','doc-two','doc-three'
    .EXAMPLE
        'doc-one','doc-two' | Invoke-BatchSummary
    .EXAMPLE
        Invoke-BatchSummary -DryRun
    #>
    [CmdletBinding()]
    param(
        [switch]$ForceAll,

        [Parameter(ValueFromPipeline)]
        [string[]]$DocId,

        [ValidateSet(
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'claude-opus-4', 'claude-sonnet-4-5', 'claude-haiku-3.5',
            'groq-llama-3.3-70b', 'groq-llama-4-scout'
        )]
        [string]$Model = $(if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.1-flash-lite-preview' }),

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.1,

        [switch]$DryRun,

        [ValidateRange(1, 10)]
        [int]$MaxConcurrent = 1,

        [switch]$SkipConflictDetection
    )

    begin {
        $DocIdList = [System.Collections.Generic.List[string]]::new()
    }

    process {
        if ($DocId) {
            foreach ($Id in $DocId) {
                if (-not [string]::IsNullOrWhiteSpace($Id)) {
                    $DocIdList.Add($Id)
                }
            }
        }
    }

    end {

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Consolidate collected IDs
    $DocIdFilter = @(if ($DocIdList.Count -gt 0) { $DocIdList | Select-Object -Unique })
    $HasDocFilter = $DocIdFilter.Count -gt 0

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

    $Backend = if     ($Model -match '^gemini') { 'gemini' }
               elseif ($Model -match '^claude') { 'claude' }
               elseif ($Model -match '^groq')   { 'groq'   }
               else                             { 'gemini'  }
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
    if ($HasDocFilter)          { Write-Info "Doc filter ($($DocIdFilter.Count)): $($DocIdFilter -join ', ')" }
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

    if ($ForceAll -or $HasDocFilter) {
        $ChangedTaxonomyFiles = @($PovFileMap.Keys)
        if ($ForceAll)      { Write-Info "Force mode — treating all taxonomy files as changed" }
        if ($HasDocFilter)  { Write-Info "Doc filter mode — treating all taxonomy files as changed" }
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

        if ($HasDocFilter -and $ThisDocId -notin $DocIdFilter) { continue }

        $SnapshotFile = Join-Path $MetaFile.DirectoryName 'snapshot.md'
        if (-not (Test-Path $SnapshotFile)) {
            Write-Warn "  SKIP $ThisDocId — snapshot.md missing"
            continue
        }

        $DocPovTags = if ($null -ne $Meta.PSObject.Properties['pov_tags'] -and $null -ne $Meta.pov_tags) { @($Meta.pov_tags) } else { @() }
        $Intersects = $ForceAll -or
                      $HasDocFilter -or
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

    if ($HasDocFilter -and $DocsToProcess.Count -eq 0) {
        $Missing = $DocIdFilter -join ', '
        Write-Fail "No matching documents found: $Missing"
        Write-Info "Check that sources/<doc-id>/ exists and has a metadata.json"
        throw "No matching documents found: $Missing"
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
    $OutputSchema = Get-Prompt -Name 'pov-summary-schema'
    $SystemPrompt = Get-Prompt -Name 'pov-summary-system'

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

        $FnBody        = (Get-Command Invoke-DocumentSummary).ScriptBlock.ToString()
        $AIEnrichPath  = Join-Path $script:ModuleRoot '..' 'AIEnrich.psm1'

        $DocsToProcess | ForEach-Object -Parallel {
            Import-Module $using:AIEnrichPath -Force
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

    } # end
}
