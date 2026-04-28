# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-POVSummary {
    <#
    .SYNOPSIS
        Processes a single source document through AI to extract a structured
        POV summary mapped to the AI Triad taxonomy.
    .DESCRIPTION
        Implements the core AI summarization loop for ONE document:
            1. Validates inputs and resolves paths
            2. Loads taxonomy version
            3. Delegates extraction to Invoke-SummaryPipeline (CHESS, RAG,
               AutoFire, FIRE/single-shot, density retry, unmapped resolution)
            4. Writes summaries/<doc-id>.json
            5. Updates sources/<doc-id>/metadata.json (summary_status, summary_version)
            6. Runs basic conflict detection
    .PARAMETER DocId
        The document slug ID, e.g. "altman-2024-agi-path".
    .PARAMETER RepoRoot
        Path to the root of the ai-triad-research repository.
        Defaults to the module-resolved repo root.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Model
        AI model to use. Defaults to "gemini-3.1-flash-lite-preview".
        Supports Gemini, Claude, and Groq backends.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.1
    .PARAMETER DryRun
        Build and display the prompt, but do NOT call the API or write any files.
    .PARAMETER Force
        Re-process the document even if summary_status is already "current".
    .PARAMETER FullTaxonomy
        Bypass RAG — inject all taxonomy nodes into the prompt.
    .PARAMETER IterativeExtraction
        Force FIRE iterative extraction.
    .PARAMETER AutoFire
        Enable two-stage FIRE sniff (auto-detect whether FIRE is worthwhile).
    .EXAMPLE
        Invoke-POVSummary -DocId "altman-2024-agi-path"
    .EXAMPLE
        Invoke-POVSummary -DocId "altman-2024-agi-path" -DryRun
    .EXAMPLE
        Invoke-POVSummary -DocId "lecun-2024-critique" -Model "gemini-2.5-flash-lite"
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory, Position = 0, HelpMessage = "Document slug ID, e.g. altman-2024-agi-path")]
        [string]$DocId,

        [string]$RepoRoot    = $script:RepoRoot,

        [string]$ApiKey      = '',

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model       = "gemini-3.1-flash-lite-preview",

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.1,

        [switch]$DryRun,
        [switch]$Force,

        [switch]$FullTaxonomy,

        [switch]$IterativeExtraction,

        [switch]$AutoFire
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # -- STEP 0 — Validate inputs and resolve paths ---------------------------
    Write-Step "Validating inputs"

    $paths = @{
        Root         = $RepoRoot
        TaxonomyDir  = Get-TaxonomyDir
        SourcesDir   = Get-SourcesDir
        SummariesDir = Get-SummariesDir
        ConflictsDir = Get-ConflictsDir
        VersionFile  = Get-VersionFile
        DocDir       = Join-Path (Get-SourcesDir) $DocId
        SnapshotFile = Join-Path (Join-Path (Get-SourcesDir) $DocId) "snapshot.md"
        MetadataFile = Join-Path (Join-Path (Get-SourcesDir) $DocId) "metadata.json"
        SummaryFile  = Join-Path (Get-SummariesDir) "$DocId.json"
    }

    if (-not (Test-Path $paths.Root)) {
        Write-Fail "Repo root not found: $($paths.Root)"
        throw "Repo root not found: $($paths.Root)"
    }

    if (-not (Test-Path $paths.DocDir)) {
        Write-Fail "Document folder not found: $($paths.DocDir)"
        Write-Info "Expected: sources/$DocId/"
        throw "Document folder not found: sources/$DocId/"
    }

    if (-not (Test-Path $paths.SnapshotFile)) {
        Write-Fail "snapshot.md not found: $($paths.SnapshotFile)"
        throw "snapshot.md not found for $DocId"
    }

    if (-not (Test-Path $paths.MetadataFile)) {
        Write-Fail "metadata.json not found: $($paths.MetadataFile)"
        throw "metadata.json not found for $DocId"
    }

    $script:ContextRotStages = @()

    $metadata = Get-Content $paths.MetadataFile -Raw | ConvertFrom-Json
    if ((-not $Force) -and (-not $DryRun) -and ($metadata.summary_status -eq "current")) {
        Write-Warn "Summary is already current (taxonomy v$($metadata.summary_version))."
        Write-Info "Use -Force to re-process anyway."
        return
    }

    foreach ($dir in @($paths.SummariesDir, $paths.ConflictsDir)) {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }

    if (-not $DryRun) {
        if     ($Model -match '^gemini') { $Backend = 'gemini' }
        elseif ($Model -match '^claude') { $Backend = 'claude' }
        elseif ($Model -match '^groq')   { $Backend = 'groq'   }
        else                             { $Backend = 'gemini'  }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            $EnvHint = switch ($Backend) {
                'gemini' { 'GEMINI_API_KEY' }
                'claude' { 'ANTHROPIC_API_KEY' }
                'groq'   { 'GROQ_API_KEY' }
                default  { 'AI_API_KEY' }
            }
            Write-Fail "No API key found for $Backend backend."
            Write-Info "Set $EnvHint or AI_API_KEY, or pass -ApiKey."
            throw "No API key found for $Backend backend."
        }
        $ApiKey = $ResolvedKey
    }

    Write-OK "Doc ID      : $DocId"
    Write-OK "Repo root   : $RepoRoot"
    Write-OK "Model       : $Model"
    Write-OK "Temperature : $Temperature"
    if ($DryRun) { Write-Warn "DRY RUN — no API call, no file writes" }

    # -- STEP 1 — Load taxonomy version ---------------------------------------
    Write-Step "Loading taxonomy"

    if (-not (Test-Path $paths.VersionFile)) {
        Write-Fail "TAXONOMY_VERSION file not found at: $($paths.VersionFile)"
        throw "TAXONOMY_VERSION not found"
    }
    $taxonomyVersion = (Get-Content $paths.VersionFile -Raw).Trim()
    Write-OK "Taxonomy version: $taxonomyVersion"

    # -- STEP 2 — Load snapshot ------------------------------------------------
    Write-Step "Loading document snapshot"

    $snapshotText    = Get-Content $paths.SnapshotFile -Raw
    $snapshotLength  = $snapshotText.Length
    $estimatedTokens = [int]($snapshotLength / 4)

    Write-OK "Snapshot loaded: $snapshotLength chars (~$estimatedTokens tokens estimated)"
    Write-Info "Title from metadata: $($metadata.title)"
    Write-Info "POV tags in metadata: $($metadata.pov_tags -join ', ')"

    if ($estimatedTokens -gt 100000) {
        Write-Warn "Document is very long (~$estimatedTokens tokens). Consider chunking if the API call fails."
    }

    # -- DRY RUN — build prompt locally and display ----------------------------
    if ($DryRun) {
        # Load full taxonomy for display (DryRun has no API key for CHESS/RAG)
        $taxonomyFiles   = @("accelerationist.json", "safetyist.json", "skeptic.json", "situations.json")
        $taxonomyContext = [ordered]@{}
        foreach ($file in $taxonomyFiles) {
            $filePath = Join-Path $paths.TaxonomyDir $file
            if (Test-Path $filePath) {
                $taxonomyContext[$file] = Get-Content $filePath -Raw | ConvertFrom-Json
            }
        }
        $taxonomyJson = $taxonomyContext | ConvertTo-Json -Depth 20 -Compress:$false

        $wordCount = ($snapshotText -split '\s+').Count
        $outputSchema = Get-Prompt -Name 'pov-summary-schema'
        $systemPrompt = Get-Prompt -Name 'pov-summary-system' -Replacements @{
            WORD_COUNT = $wordCount
            KP_MIN     = [Math]::Max(3,  [int]($wordCount / 500))
            KP_MAX     = [Math]::Max(8,  [int]($wordCount / 200))
            FC_MIN     = [Math]::Max(3,  [int]($wordCount / 800))
            FC_MAX     = [Math]::Max(8,  [int]($wordCount / 300))
            UC_MIN     = [Math]::Max(2,  [int]($wordCount / 2000))
            UC_MAX     = [Math]::Max(5,  [int]($wordCount / 800))
        }

        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN: FULL PROMPT PREVIEW" -ForegroundColor Yellow
        Write-Host "$('─' * 72)" -ForegroundColor DarkGray

        Write-Host "`n[SYSTEM PROMPT]" -ForegroundColor Cyan
        Write-Host $systemPrompt -ForegroundColor Gray

        Write-Host "`n[TAXONOMY CONTEXT — first 500 chars]" -ForegroundColor Cyan
        Write-Host $taxonomyJson.Substring(0, [Math]::Min(500, $taxonomyJson.Length)) -ForegroundColor Gray
        Write-Host "... (truncated for display)" -ForegroundColor DarkGray

        Write-Host "`n[DOCUMENT CONTENT — first 500 chars]" -ForegroundColor Cyan
        Write-Host $snapshotText.Substring(0, [Math]::Min(500, $snapshotText.Length)) -ForegroundColor Gray
        Write-Host "... (truncated for display)" -ForegroundColor DarkGray

        Write-Host "`n[OUTPUT SCHEMA]" -ForegroundColor Cyan
        Write-Host $outputSchema -ForegroundColor Gray

        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN complete. No API call made. No files written." -ForegroundColor Yellow
        Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
        return
    }

    # -- STEP 3 — Run extraction pipeline --------------------------------------
    Write-Step "Running extraction pipeline"

    $systemPromptTemplate = Get-Prompt -Name 'pov-summary-system'
    $outputSchema = Get-Prompt -Name 'pov-summary-schema'

    $pipelineResult = Invoke-SummaryPipeline `
        -SnapshotText          $snapshotText `
        -DocId                 $DocId `
        -Metadata              $metadata `
        -ApiKey                $ApiKey `
        -Model                 $Model `
        -Temperature           $Temperature `
        -TaxonomyVersion       $taxonomyVersion `
        -SystemPromptTemplate  $systemPromptTemplate `
        -OutputSchema          $outputSchema `
        -FullTaxonomy:$FullTaxonomy `
        -IterativeExtraction:$IterativeExtraction `
        -AutoFire:$AutoFire

    if (-not $pipelineResult.Success) {
        Write-Fail "Pipeline failed: $($pipelineResult.Error)"
        throw "Pipeline failed for ${DocId}: $($pipelineResult.Error)"
    }

    # Extract results from pipeline
    $summaryObject        = $pipelineResult.Summary
    $factualClaimCount    = $pipelineResult.FactualCount
    $unmappedConceptCount = $pipelineResult.UnmappedCount
    $taxonomyJson         = $pipelineResult.TaxonomyJson
    $fireStats            = $pipelineResult.FireStats
    $usedFire             = $pipelineResult.UsedFire

    # Collect context-rot stages from pipeline
    $ContextRotStages = @($script:ContextRotStages)
    $ContextRotObj = if ($ContextRotStages.Count -gt 0) {
        New-ContextRotMetrics -Pipeline 'summary' -DocId $DocId -Stages $ContextRotStages
    } else { $null }
    $elapsed              = [TimeSpan]::FromSeconds($pipelineResult.ElapsedSeconds)
    $camps                = @('accelerationist', 'safetyist', 'skeptic')

    # Report extraction results
    Write-OK "Pipeline complete in $($pipelineResult.ElapsedSeconds)s ($($pipelineResult.Backend))"
    foreach ($camp in $camps) {
        $campData = $summaryObject.pov_summaries.$camp
        if ($campData -and $campData.key_points) {
            $pointCount = @($campData.key_points).Count
            $nullNodes  = @($campData.key_points | Where-Object { $null -eq $_.taxonomy_node_id }).Count
            Write-OK "  $camp : $pointCount key points ($nullNodes unmapped)"
        }
        else {
            Write-Warn "  $camp : no data returned"
        }
    }
    Write-OK "  factual_claims    : $factualClaimCount"
    Write-OK "  unmapped_concepts : $unmappedConceptCount"

    if ($usedFire -and $fireStats) {
        Write-Info "  FIRE: $($fireStats.total_api_calls) API calls, $($fireStats.total_iterations) iterations, $($fireStats.termination_reason)"
    }

    # -- STEP 4 — Write summary file ------------------------------------------
    Write-Step "Writing summary file"

    # Detect RAG vs full taxonomy from the context format
    $IsRagFiltered = $taxonomyJson -match '^\s*=== RELEVANT TAXONOMY NODES'
    if ($IsRagFiltered) {
        $taxonomyNodeCount = ([regex]::Matches($taxonomyJson, '^\s{2}\w', [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count
    }
    else {
        $taxonomyNodeCount = ([regex]::Matches($taxonomyJson, '"id"\s*:')).Count
    }

    $modelInfo = [ordered]@{
        model             = $Model
        temperature       = $Temperature
        max_tokens        = 32768
        extraction_mode   = if ($usedFire) { 'fire' } else { 'single_shot' }
        taxonomy_filter   = if ($FullTaxonomy) { 'full' } else { 'rag' }
        taxonomy_nodes    = $taxonomyNodeCount
    }

    if ($usedFire -and $fireStats) {
        $modelInfo['fire_confidence_threshold'] = 0.7
        $modelInfo['fire_stats'] = [ordered]@{
            api_calls          = $fireStats.total_api_calls
            iterations         = $fireStats.total_iterations
            claims_total       = $fireStats.claims_total
            claims_confident   = $fireStats.claims_confident
            claims_iterated    = $fireStats.claims_iterated
            elapsed_seconds    = $fireStats.elapsed_seconds
            termination_reason = $fireStats.termination_reason
        }
    }

    $finalSummary = [ordered]@{
        doc_id            = $DocId
        taxonomy_version  = $taxonomyVersion
        generated_at      = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        model_info        = $modelInfo
        pov_summaries     = $summaryObject.pov_summaries
        factual_claims    = $summaryObject.factual_claims
        unmapped_concepts = $summaryObject.unmapped_concepts
        context_rot       = $ContextRotObj
    }

    $summaryJson = $finalSummary | ConvertTo-Json -Depth 20
    try {
        Write-Utf8NoBom -Path $paths.SummaryFile -Value $summaryJson 
        Write-OK "Summary written to: summaries/$DocId.json"
    }
    catch {
        Write-Fail "Failed to write summary file — $($_.Exception.Message)"
        Write-Info "AI response was valid but could not be saved. Check disk space and permissions."
        throw
    }

    # -- STEP 5 — Update metadata.json ----------------------------------------
    Write-Step "Updating metadata"

    try {
        $metaRaw     = Get-Content $paths.MetadataFile -Raw
        $metaUpdated = $metaRaw | ConvertFrom-Json -AsHashtable

        $metaUpdated["summary_version"] = $taxonomyVersion
        $metaUpdated["summary_status"]  = "current"
        $metaUpdated["summary_updated"] = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

        # Summary statistics
        $claimsByPov = @{ accelerationist = 0; safetyist = 0; skeptic = 0; situations = 0 }
        foreach ($claim in @($summaryObject.factual_claims)) {
            foreach ($nodeId in @($claim.linked_taxonomy_nodes)) {
                if     ($nodeId -like 'acc-*') { $claimsByPov['accelerationist']++ }
                elseif ($nodeId -like 'saf-*') { $claimsByPov['safetyist']++ }
                elseif ($nodeId -like 'skp-*') { $claimsByPov['skeptic']++ }
                elseif ($nodeId -like 'sit-*') { $claimsByPov['situations']++ }
            }
        }
        $totalFacts = 0
        foreach ($camp in @('accelerationist', 'safetyist', 'skeptic')) {
            $campData = $summaryObject.pov_summaries.$camp
            if ($campData -and $campData.key_points) {
                $totalFacts += @($campData.key_points).Count
            }
        }
        $metaUpdated["total_claims"]       = $factualClaimCount
        $metaUpdated["claims_by_pov"]      = $claimsByPov
        $metaUpdated["total_facts"]        = $totalFacts
        $metaUpdated["unmapped_concepts"]  = $unmappedConceptCount

        if ($ContextRotObj) {
            $WorstStage = $ContextRotStages | Sort-Object { $_.ratio } | Select-Object -First 1
            $metaUpdated['context_rot'] = [ordered]@{
                cumulative_retention = $ContextRotObj.cumulative_retention
                worst_stage          = if ($WorstStage) { $WorstStage.stage } else { $null }
                worst_ratio          = if ($WorstStage) { $WorstStage.ratio } else { $null }
            }
        }

        Write-Utf8NoBom -Path $paths.MetadataFile -Value ($metaUpdated | ConvertTo-Json -Depth 10) 
        Write-OK "metadata.json updated: summary_status=current, summary_version=$taxonomyVersion"
    }
    catch {
        Write-Warn "Summary written but metadata update failed — $($_.Exception.Message)"
        Write-Info "Run Invoke-POVSummary -Force -DocId '$DocId' to retry."
    }

    # -- STEP 6 — Conflict detection ------------------------------------------
    Write-Step "Running conflict detection"

    $today = Get-Date -Format "yyyy-MM-dd"

    if ($factualClaimCount -eq 0) {
        Write-Info "No factual claims to process."
    } else {
        foreach ($claim in $summaryObject.factual_claims) {

            $claimText   = $claim.claim
            $claimLabel  = $claim.claim_label
            $docPosition = $claim.doc_position
            $hintId      = $claim.potential_conflict_id
            if ($null -ne $claim.linked_taxonomy_nodes) { $linkedNodes = ,@($claim.linked_taxonomy_nodes) } else { $linkedNodes = ,@() }

            # Normalize stance value
            if ($docPosition -in @('supports','disputes','neutral','qualifies')) { $stance = $docPosition } else { $stance = 'neutral' }

            $newInstance = [ordered]@{
                doc_id       = $DocId
                stance       = $stance
                assertion    = $claimText
                date_flagged = $today
            }

            if ($hintId) {
                $existingPath = Join-Path $paths.ConflictsDir "$hintId.json"

                if (Test-Path $existingPath) {
                    $conflictData = Get-Content $existingPath -Raw | ConvertFrom-Json -AsHashtable
                    $alreadyLogged = $conflictData["instances"] | Where-Object { $_["doc_id"] -eq $DocId }
                    if ($alreadyLogged) {
                        Write-Info "  SKIP duplicate conflict instance: $hintId (doc already logged)"
                    } else {
                        $conflictData["instances"] += $newInstance
                        if ($linkedNodes.Count -gt 0) {
                            $existing = @($conflictData["linked_taxonomy_nodes"])
                            $merged   = @(($existing + $linkedNodes) | Select-Object -Unique)
                            $conflictData["linked_taxonomy_nodes"] = $merged
                        }
                        Write-Utf8NoBom -Path $existingPath -Value ($conflictData | ConvertTo-Json -Depth 10) 
                        Write-OK "  Appended to existing conflict: $hintId"
                    }
                } else {
                    Write-Warn "  Suggested conflict '$hintId' not found — creating new file"
                    $newConflict = [ordered]@{
                        claim_id               = $hintId
                        claim_label            = if ($claimLabel) { $claimLabel } else { $claimText.Substring(0, [Math]::Min(80, $claimText.Length)) }
                        description            = $claimText
                        status                 = "open"
                        linked_taxonomy_nodes  = $linkedNodes
                        instances              = @($newInstance)
                        human_notes            = @()
                    }
                    Write-Utf8NoBom -Path $existingPath -Value ($newConflict | ConvertTo-Json -Depth 10) 
                    Write-OK "  Created new conflict file: $hintId.json"
                }
            } else {
                $slug = $claimText.ToLower() -replace '[^\w\s]', '' -replace '\s+', '-'
                $slug = $slug.Substring(0, [Math]::Min(40, $slug.Length)).TrimEnd('-')
                $newId = "conflict-$slug-$($DocId.Substring(0,[Math]::Min(8,$DocId.Length)))"

                $existingMatch = Get-ChildItem $paths.ConflictsDir -Filter "*.json" |
                    Where-Object { $_.BaseName -like "*$($slug.Substring(0,[Math]::Min(20,$slug.Length)))*" } |
                    Select-Object -First 1

                if ($existingMatch) {
                    $conflictData = Get-Content $existingMatch.FullName -Raw | ConvertFrom-Json -AsHashtable
                    $alreadyLogged = $conflictData["instances"] | Where-Object { $_["doc_id"] -eq $DocId }
                    if (-not $alreadyLogged) {
                        $conflictData["instances"] += $newInstance
                        if ($linkedNodes.Count -gt 0) {
                            $existing = @($conflictData["linked_taxonomy_nodes"])
                            $merged   = @(($existing + $linkedNodes) | Select-Object -Unique)
                            $conflictData["linked_taxonomy_nodes"] = $merged
                        }
                        Write-Utf8NoBom -Path $existingMatch.FullName -Value ($conflictData | ConvertTo-Json -Depth 10) 
                        Write-OK "  Appended to fuzzy-matched conflict: $($existingMatch.BaseName)"
                    }
                } else {
                    $newConflictPath = Join-Path $paths.ConflictsDir "$newId.json"
                    $newConflict = [ordered]@{
                        claim_id               = $newId
                        claim_label            = if ($claimLabel) { $claimLabel } else { $claimText.Substring(0, [Math]::Min(80, $claimText.Length)) }
                        description            = $claimText
                        status                 = "open"
                        linked_taxonomy_nodes  = $linkedNodes
                        instances              = @($newInstance)
                        human_notes            = @()
                    }
                    Write-Utf8NoBom -Path $newConflictPath -Value ($newConflict | ConvertTo-Json -Depth 10) 
                    Write-OK "  Created new conflict file: $newId.json"
                }
            }
        }
    }

    # -- STEP 7 — Print human-readable summary to console --------------------
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  POV SUMMARY: $DocId" -ForegroundColor White
    Write-Host "  Taxonomy v$taxonomyVersion  |  Model: $Model" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    foreach ($camp in $camps) {
        $campData = $summaryObject.pov_summaries.$camp
        if (-not $campData) { continue }

        $campColor = switch ($camp) {
            "accelerationist" { "Green"  }
            "safetyist"       { "Red"    }
            "skeptic"         { "Yellow" }
        }
        $campLabel = $camp.ToUpper()

        Write-Host "`n  [$campLabel]" -ForegroundColor $campColor

        if ($campData.key_points) {
            $byCategory = $campData.key_points | Group-Object category
            foreach ($group in $byCategory) {
                Write-Host "    $($group.Name):" -ForegroundColor White
                foreach ($pt in $group.Group) {
                    if ($pt.taxonomy_node_id) { $nodeTag = "[$($pt.taxonomy_node_id)]" } else { $nodeTag = "[UNMAPPED]" }
                    if ($pt.stance) { $ptStance = $pt.stance } else { $ptStance = 'neutral' }
                    Write-Host "      $nodeTag ($ptStance) $($pt.point)" -ForegroundColor Gray
                    if ($pt.verbatim) {
                        Write-Host "        `"$($pt.verbatim)`"" -ForegroundColor DarkGray
                    }
                }
            }
        } else {
            Write-Host "    (no key points extracted)" -ForegroundColor DarkGray
        }
    }

    if ($unmappedConceptCount -gt 0) {
        Write-Host "`n  UNMAPPED CONCEPTS (potential new taxonomy nodes):" -ForegroundColor Magenta
        foreach ($concept in $summaryObject.unmapped_concepts) {
            $cProps = $concept.PSObject.Properties
            $povCat  = "[$( if ($cProps['suggested_pov']) { $concept.suggested_pov } else { '?' } ) / $( if ($cProps['suggested_category']) { $concept.suggested_category } else { '?' } )]"
            if ($cProps['suggested_label']) { $label = $concept.suggested_label } elseif ($cProps['concept']) { $label = $concept.concept } else { $label = '(no label)' }
            if ($cProps['concept']) { $desc = $concept.concept } elseif ($cProps['suggested_description']) { $desc = $concept.suggested_description } else { $desc = '' }
            if ($cProps['reason']) { $reason = $concept.reason } else { $reason = '' }
            Write-Host "    $povCat" -ForegroundColor Magenta
            if ($desc) { Write-Host "    $desc" -ForegroundColor Gray }
            if ($reason) { Write-Host "    Reason: $reason" -ForegroundColor DarkGray }
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Files written:" -ForegroundColor White
    Write-Host "    summaries/$DocId.json" -ForegroundColor Green
    Write-Host "    sources/$DocId/metadata.json  (summary_status=current)" -ForegroundColor Green
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
