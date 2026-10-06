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
        AI model to use. Defaults to AI_MODEL env var, then "gemini-3.5-flash-lite".
        Supports Gemini, Claude, and Groq backends.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.1
    .PARAMETER DryRun
        Show the plan without making API calls or writing files.
    .PARAMETER MaxConcurrent
        Number of documents to process in parallel. Default: 1.
    .PARAMETER SkipConflictDetection
        Do not call Invoke-QbafConflictAnalysis after each summary.
    .PARAMETER IterativeExtraction
        Use FIRE iterative extraction for all documents. Routes each document
        through Invoke-POVSummary with -IterativeExtraction. Incompatible with
        -MaxConcurrent > 1.
    .PARAMETER AutoFire
        Use two-stage AutoFire sniff per document. Routes each document through
        Invoke-POVSummary with -AutoFire. Incompatible with -MaxConcurrent > 1.
    .PARAMETER ImportedToday
        Process only documents whose date_ingested matches today's date.
        Useful after importing a batch to summarize just the new documents.
    .PARAMETER ImportedSince
        Process only documents whose date_ingested is on or after this date.
        Useful for summarizing documents imported within a recent window.
    .EXAMPLE
        Invoke-BatchSummary -ImportedToday
        # Summarize only documents imported today.
    .EXAMPLE
        Invoke-BatchSummary -ImportedSince (Get-Date).AddDays(-7)
        # Summarize documents imported in the last 7 days.
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
    .LINK
        Show-AITriadHelp
    .LINK
        Invoke-POVSummary
    .LINK
        Get-Summary
    .LINK
        Repair-AITSummaryMappings
    .LINK
        Test-ExtractionQuality
    .LINK
        Repair-UnmappedConcepts
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [switch]$ForceAll,

        [Parameter(ValueFromPipelineByPropertyName)]
        [Alias('Id')]
        [string[]]$DocId,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = $(if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.5-flash-lite' }),

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.1,

        [switch]$DryRun,

        [ValidateRange(1, 10)]
        [int]$MaxConcurrent = 1,

        [switch]$SkipConflictDetection,

        [switch]$IterativeExtraction,

        [switch]$AutoFire,

        [Parameter(HelpMessage = 'Process only documents imported today (date_ingested = today)')]
        [switch]$ImportedToday,

        [Parameter(HelpMessage = 'Process only documents whose date_ingested is on or after this date')]
        [datetime]$ImportedSince,

        [Parameter(HelpMessage = 'Print a per-stage timing trace (embeddings, API calls, merge) at the end. Use with -MaxConcurrent 1 for accurate aggregation.')]
        [switch]$TimingTrace
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

    # Wire -WhatIf into the existing -DryRun logic
    if ($WhatIfPreference) { $DryRun = [switch]::new($true) }

    # Per-stage timing trace (opt-in). Reset the accumulator at the start of the
    # run; the report is printed at the end.
    $TimingEnabled = $TimingTrace -or $env:AITRIAD_TIMING
    if ($TimingEnabled) { Reset-StageTiming }
    $MaxConcurrent = Resolve-BatchConcurrency -MaxConcurrent $MaxConcurrent -TimingEnabled ([bool]$TimingEnabled)

    # Consolidate collected IDs
    $DocIdFilter = @($DocIdList | Select-Object -Unique)
    $HasDocFilter = $DocIdFilter.Count -gt 0
    # $null when -ImportedSince was not bound.
    $ImportedSinceFilter = $PSBoundParameters['ImportedSince']

    # -- Paths ----------------------------------------------------------------
    $RepoRoot      = $script:RepoRoot
    $SourcesDir    = Get-SourcesDir
    $SummariesDir  = Get-SummariesDir
    $TaxonomyDir   = Get-TaxonomyDir
    $VersionFile   = Get-VersionFile
    $ConflictsDir  = Get-ConflictsDir

    # -- POV file -> camp mapping ---------------------------------------------
    $PovFileMap = [ordered]@{
        'accelerationist.json' = @('accelerationist')
        'safetyist.json'       = @('safetyist')
        'skeptic.json'         = @('skeptic')
        'situations.json'      = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    }

    # -- STEP 0 — Validate environment ---------------------------------------
    Write-Step "Validating environment"

    $Backend = Resolve-BatchSummaryBackend -Model $Model
    $ApiKey  = Resolve-AIApiKey -ExplicitKey '' -Backend $Backend
    Assert-BatchSummaryEnvironment -Backend $Backend -ApiKey $ApiKey -DryRun:$DryRun `
        -RequiredPath @($SourcesDir, $TaxonomyDir, $VersionFile) -EnsureDirectory @($SummariesDir, $ConflictsDir)

    $TaxonomyVersion = (Get-Content -Path $VersionFile -Raw).Trim()

    Write-BatchSummaryBanner -RepoRoot $RepoRoot -TaxonomyVersion $TaxonomyVersion -Model $Model `
        -Temperature $Temperature -MaxConcurrent $MaxConcurrent -DryRun:$DryRun -ForceAll:$ForceAll `
        -DocIdFilter $DocIdFilter -SkipConflictDetection:$SkipConflictDetection `
        -ImportedToday:$ImportedToday -ImportedSince $ImportedSinceFilter

    # -- STEP 1 — Load the full taxonomy -------------------------------------
    Write-Step "Loading taxonomy"
    $TaxonomyContext = Read-BatchSummaryTaxonomy -TaxonomyDir $TaxonomyDir -FileName @($PovFileMap.Keys)
    $TaxonomyJson = $TaxonomyContext | ConvertTo-Json -Depth 20

    # -- STEP 2 — Determine which taxonomy files changed ----------------------
    Write-Step "Determining affected camps"

    $ChangedTaxonomyFiles = @(Get-BatchChangedTaxonomyFile -PovFileMap $PovFileMap -RepoRoot $RepoRoot -ForceAll:$ForceAll -HasDocFilter $HasDocFilter)
    if ($ChangedTaxonomyFiles.Count -eq 0) {
        Write-OK "No taxonomy files changed. Nothing to reprocess."
        return
    }
    Write-OK "Changed taxonomy files: $($ChangedTaxonomyFiles -join ', ')"

    $AffectedCamps = @($ChangedTaxonomyFiles | ForEach-Object { $PovFileMap[$_] } | Select-Object -Unique)
    Write-OK "Affected POV camps: $($AffectedCamps -join ', ')"

    # -- STEP 3 — Collect and triage source documents -------------------------
    Write-Step "Triaging source documents"

    $AllMetaFiles = @(Get-BatchSourceMetaFile -SourcesDir $SourcesDir -ImportedToday:$ImportedToday -ImportedSince $ImportedSinceFilter)
    if ($AllMetaFiles.Count -eq 0) {
        Write-Warn "No source documents found in $SourcesDir"
        return
    }

    $Triage = Select-BatchDocument -MetaFile $AllMetaFiles -DocIdFilter $DocIdFilter -AffectedCamp $AffectedCamps -ForceAll:$ForceAll
    $DocsToProcess = $Triage.Process
    $DocsToSkip    = $Triage.Skip

    Write-OK "Documents to reprocess : $($DocsToProcess.Count)"
    Write-OK "Documents to mark current (no reprocess): $($DocsToSkip.Count)"

    # -- DRY RUN — print plan and return --------------------------------------
    if ($DryRun) {
        Write-BatchDryRunPlan -DocsToProcess $DocsToProcess -DocsToSkip $DocsToSkip
        return
    }

    # -- STEP 4 — Mark non-affected docs as current ---------------------------
    Write-Step "Marking non-affected documents as current"
    $Now = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'
    Set-BatchDocCurrent -Doc $DocsToSkip -TaxonomyVersion $TaxonomyVersion -Now $Now

    # -- STEP 5 — Shared prompt components ------------------------------------
    $SharedParams = @{
        ApiKey                     = $ApiKey
        Model                      = $Model
        Temperature                = $Temperature
        TaxonomyVersion            = $TaxonomyVersion
        TaxonomyJson               = $TaxonomyJson
        OutputSchema               = Get-Prompt -Name 'pov-summary-schema'
        SystemPromptTemplate       = Get-Prompt -Name 'pov-summary-system' -AllowUnresolved
        ChunkSystemPromptTemplate  = Get-Prompt -Name 'pov-summary-chunk-system' -AllowUnresolved
        SummariesDir               = $SummariesDir
        Now                        = $Now
    }

    # -- STEP 5b — Load debate context for contested nodes --------------------
    $DebateContext = Get-BatchDebateContext -HarvestsDir (Join-Path (Get-DataRoot) 'harvests')

    # -- STEP 6 — Process documents -------------------------------------------
    Write-Step "Processing $($DocsToProcess.Count) document(s)"
    $Results = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
    Invoke-BatchDocumentSet -Doc $DocsToProcess -SharedParams $SharedParams -DebateContext $DebateContext -Results $Results `
        -MaxConcurrent $MaxConcurrent -IterativeExtraction:$IterativeExtraction -AutoFire:$AutoFire

    # -- STEP 7 — Conflict detection for successful summaries -----------------
    if (-not $SkipConflictDetection) { Invoke-BatchConflictDetection -Result @($Results) }

    # -- STEP 8 — Final report ------------------------------------------------
    $Succeeded = @($Results | Where-Object { $_.Success })
    $Failed    = @($Results | Where-Object { -not $_.Success })

    Write-BatchSummaryReport -Succeeded $Succeeded -Failed $Failed -ProcessCount $DocsToProcess.Count `
        -SkipCount $DocsToSkip.Count -TaxonomyVersion $TaxonomyVersion -Model $Model

    # -- STEP 8b — Log extraction metrics for calibration ----------------------
    Write-BatchExtractionMetric -Succeeded $Succeeded -Failed $Failed -DocumentsTotal $DocsToProcess.Count `
        -Model $Model -Temperature $Temperature -TaxonomyVersion $TaxonomyVersion `
        -IterativeExtraction:$IterativeExtraction -AutoFire:$AutoFire -SourcesDir $SourcesDir -SummariesDir $SummariesDir

    # -- STEP 8c — Rebuild source index ----------------------------------------
    Update-BatchSourceIndex

    # -- STEP 9 — Post-batch policy registry drift check (read-only, t/3943) --
    Test-BatchPolicyRegistryDrift

    if ($TimingEnabled) { Write-StageTimingReport }

    if ($Failed.Count -gt 0) {
        throw "$($Failed.Count) document(s) failed during batch summarization."
    }

    } # end
}
