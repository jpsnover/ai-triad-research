# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared pipeline worker for POV summary extraction.
# Single source of truth for: CHESS → RAG → Prompt → FIRE/Single-shot → Density → Unmapped resolution
# Called by Invoke-POVSummary (interactive) and Invoke-DocumentSummary (batch).
# Dot-sourced by AITriad.psm1 — do NOT export.

function Invoke-SummaryPipeline {
    <#
    .SYNOPSIS
        Core summary extraction pipeline — shared by all callers.
    .DESCRIPTION
        Executes the 7-stage extraction pipeline:
        1. CHESS pre-classification (identify relevant POVs)
        2. RAG node selection (filter taxonomy to relevant nodes)
        3. AutoFire Stage 1 sniff (pre-extraction)
        4. Prompt construction (system + taxonomy + schema + document)
        5. AI extraction (FIRE iterative or single-shot with density retry)
        6. AutoFire Stage 2 sniff + re-run (post-extraction)
        7. Unmapped concept resolution

        Does NOT handle: path resolution, file writing, metadata updates,
        console reporting, or batch coordination. Those are caller concerns.
    .PARAMETER SnapshotText
        The document text to summarize.
    .PARAMETER DocId
        Document slug ID (for logging).
    .PARAMETER Metadata
        Parsed metadata.json hashtable.
    .PARAMETER ApiKey
        Resolved AI API key.
    .PARAMETER Model
        AI model identifier.
    .PARAMETER Temperature
        Sampling temperature.
    .PARAMETER TaxonomyVersion
        Current taxonomy version string.
    .PARAMETER SystemPromptTemplate
        System prompt template with density placeholders.
    .PARAMETER OutputSchema
        JSON schema string for the AI response.
    .PARAMETER FullTaxonomy
        Bypass RAG — inject all taxonomy nodes.
    .PARAMETER IterativeExtraction
        Force FIRE iterative extraction.
    .PARAMETER AutoFire
        Enable two-stage FIRE sniff.
    .PARAMETER TaxonomyJsonOverride
        Pre-computed taxonomy JSON (for chunked pipeline passing parent-level taxonomy).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SnapshotText,
        [Parameter(Mandatory)][string]$DocId,
        [Parameter(Mandatory)][object]$Metadata,
        [Parameter(Mandatory)][string]$ApiKey,
        [Parameter(Mandatory)][string]$Model,
        [double]$Temperature = 0.1,
        [Parameter(Mandatory)][string]$TaxonomyVersion,
        [Parameter(Mandatory)][string]$SystemPromptTemplate,
        [Parameter(Mandatory)][string]$OutputSchema,
        [switch]$FullTaxonomy,
        [switch]$IterativeExtraction,
        [switch]$AutoFire,
        [string]$TaxonomyJsonOverride = '',
        [int]$RagMaxTotal = 300
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $PipelineStart = Get-Date
    if (-not (Test-Path variable:script:ContextRotStages)) { $script:ContextRotStages = @() }

    $WordCount = ($SnapshotText -split '\s+').Count
    $EstimatedTokens = [int]($SnapshotText.Length / 4)

    # ── Stage 1: CHESS + RAG taxonomy selection ───────────────────────────────
    $TaxonomyJson = $null

    if ($TaxonomyJsonOverride) {
        $TaxonomyJson = $TaxonomyJsonOverride
        Write-Verbose "Pipeline: using caller-provided taxonomy context"
    }
    elseif ($FullTaxonomy) {
        $TaxFiles = @("accelerationist.json", "safetyist.json", "skeptic.json", "situations.json")
        $TaxContext = [ordered]@{}
        $TaxDir = Get-TaxonomyDir
        foreach ($F in $TaxFiles) {
            $P = Join-Path $TaxDir $F
            if (Test-Path $P) { $TaxContext[$F] = Get-Content $P -Raw | ConvertFrom-Json }
        }
        $TaxonomyJson = $TaxContext | ConvertTo-Json -Depth 20 -Compress:$false
        Write-Verbose "Pipeline: full taxonomy injected"
    }
    else {
        $QueryWords = ($SnapshotText -split '\s+') | Select-Object -First 500
        $QueryText = "$($Metadata.title). $($QueryWords -join ' ')"

        try {
            $RelevantPovs = Get-DocumentPovClassification -QueryText $QueryText -ApiKey $ApiKey
            Write-Verbose "Pipeline: CHESS classified POVs: $($RelevantPovs -join ', ')"

            $AllPovs = @('accelerationist', 'safetyist', 'skeptic')
            $TaxonomyJson = Get-RelevantTaxonomyNodes -Query $QueryText `
                -Threshold 0.30 -MaxTotal $RagMaxTotal -MinPerCategory 3 `
                -POV $AllPovs -IncludeSituations -Format context
            Write-Verbose "Pipeline: RAG selected ~$([int]($TaxonomyJson.Length / 4)) tokens of taxonomy"
        }
        catch {
            Write-Verbose "Pipeline: RAG failed ($($_.Exception.Message)) — falling back to compact taxonomy"
            $TaxonomyJson = Build-CompactTaxonomy
        }
    }

    # ── Stage 2: AutoFire Stage 1 — pre-extraction sniff (always runs) ───────
    if (-not $IterativeExtraction) {
        if ($Metadata.PSObject.Properties['source_type']) { $SourceType = $Metadata.source_type } else { $SourceType = 'unknown' }
        $Sniff1 = Test-FireRequired -WordCount $WordCount -IsChunked:($EstimatedTokens -gt 20000) -SourceType $SourceType
        if ($Sniff1.ShouldFire) {
            Write-Verbose "Pipeline AutoFire Stage 1: $($Sniff1.Reason) — switching to FIRE"
            $IterativeExtraction = $true
        }
    }

    # ── Stage 3: Prompt construction ──────────────────────────────────────────
    $SystemPrompt = Build-DensityScaledPrompt -WordCount $WordCount -Template $SystemPromptTemplate

    # Policy registry context
    $PolicyBlock = ''
    $PolicyPath = Join-Path (Get-TaxonomyDir) 'policy_actions.json'
    if (Test-Path $PolicyPath) {
        try {
            $PolicyReg = Get-Content -Raw -Path $PolicyPath | ConvertFrom-Json
            if ($PolicyReg.policies -and $PolicyReg.policies.Count -gt 0) {
                $PolicyLines = $PolicyReg.policies | ForEach-Object { "$($_.id): $($_.action)" }
                $PB = $PolicyLines -join "`n"
                if ($PB.Length -gt 5000) { $PB = $PB.Substring(0, 5000) + "`n... (truncated)" }
                $PolicyBlock = "`n=== POLICY REGISTRY (use pol-NNN IDs when referencing policy actions) ===`n$PB"
            }
        }
        catch { }
    }

    # Vocabulary constraints (standardized terms + bare-term ban)
    $VocabularyBlock = Build-VocabularyBlock
    if ($VocabularyBlock) { Write-Verbose "Pipeline: vocabulary block injected ($([int]($VocabularyBlock.Length / 4)) tokens est.)" }

    if ($Metadata.PSObject.Properties['pov_tags']) { $PovTagLine = $Metadata.pov_tags -join ', ' } else { $PovTagLine = '' }
    if ($Metadata.PSObject.Properties['topic_tags']) { $TopicTagLine = $Metadata.topic_tags -join ', ' } else { $TopicTagLine = '' }
    if ($Metadata.PSObject.Properties['title']) { $TitleLine = $Metadata.title } else { $TitleLine = $DocId }

    $SysInstruction = @"
$SystemPrompt
$PolicyBlock
$VocabularyBlock
=== OUTPUT SCHEMA (your response must match this structure) ===
$OutputSchema
"@

    $FullPrompt = @"
=== TAXONOMY (version $TaxonomyVersion) ===
$TaxonomyJson

=== DOCUMENT: $DocId ===
Title: $TitleLine
POV tags (pre-classified): $PovTagLine
Topic tags: $TopicTagLine

--- DOCUMENT CONTENT ---
$SnapshotText
"@

    Write-Verbose "Pipeline: system instruction ($([int]($SysInstruction.Length / 4)) tokens est.) + prompt ($([int]($FullPrompt.Length / 4)) tokens est.)"

    # ── Stage 4: AI extraction ────────────────────────────────────────────────
    $SummaryObject = $null
    $FireStats = $null
    $AiBackend = ''
    $DensityCheck = $null

    if ($IterativeExtraction) {
        Write-Verbose "Pipeline: using FIRE iterative extraction"
        $FireResult = Invoke-IterativeExtraction `
            -Prompt $FullPrompt -SystemInstruction $SysInstruction `
            -Model $Model -ApiKey $ApiKey -Temperature $Temperature

        $SummaryObject = $FireResult.Summary
        $AiBackend = $FireResult.Backend
        $FireStats = $FireResult.FireStats
    }
    else {
        # Single-shot with density validation + retry
        Write-Verbose "Pipeline: using single-shot extraction"
        $DensityFloors = Get-DensityFloors -WordCount $WordCount
        $MaxRetries = 1
        $DensityRetryNudge = ''

        for ($Attempt = 0; $Attempt -le $MaxRetries; $Attempt++) {
            $AttemptPrompt = $FullPrompt
            if ($Attempt -gt 0 -and $DensityRetryNudge) {
                Write-Verbose "Pipeline: density retry $Attempt/$MaxRetries"
                $AttemptPrompt = $FullPrompt + "`n`n" + $DensityRetryNudge
            }

            $AiResult = Invoke-AIApi `
                -Prompt      $AttemptPrompt `
                -SystemInstruction $SysInstruction `
                -Model       $Model `
                -ApiKey      $ApiKey `
                -Temperature $Temperature `
                -MaxTokens   32768 `
                -JsonMode `
                -TimeoutSec  600

            if ($null -eq $AiResult) {
                return @{ Success = $false; DocId = $DocId; Error = 'API call returned null' }
            }

            $AiBackend = $AiResult.Backend
            Write-Verbose "Pipeline: response from $AiBackend"

            $CleanedText = $AiResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
            try {
                $SummaryObject = $CleanedText.Trim() | ConvertFrom-Json
            }
            catch {
                # Try repair
                $Repaired = Repair-TruncatedJson -Text $CleanedText
                try { $SummaryObject = $Repaired | ConvertFrom-Json } catch { $SummaryObject = $null }
            }

            if ($null -eq $SummaryObject) {
                return @{ Success = $false; DocId = $DocId; Error = 'InvalidJson' }
            }

            # Density check
            $DensityCheck = Test-SummaryDensity -SummaryObject $SummaryObject -Floors $DensityFloors
            if ($DensityCheck.Pass) { break }

            $DensityRetryNudge = Build-DensityRetryNudge -Shortfalls $DensityCheck.Shortfalls
            Write-Verbose "Pipeline: density check failed — $($DensityCheck.Shortfalls -join '; ')"

            if ($Attempt -eq $MaxRetries) {
                Write-Verbose 'Pipeline: accepting under-dense result after retries'
            }
        }
    }

    if ($null -eq $SummaryObject) {
        return @{ Success = $false; DocId = $DocId; Error = 'No summary produced' }
    }

    # ── Stage 5: AutoFire Stage 2 — post-extraction sniff (always runs) ──────
    if (-not $IterativeExtraction -and $null -ne $SummaryObject) {
        $Sniff2 = Test-FireRequired -SummaryObject $SummaryObject
        if ($Sniff2.ShouldFire) {
            Write-Verbose "Pipeline AutoFire Stage 2: $($Sniff2.Reason) — re-running with FIRE"
            $FireResult = Invoke-IterativeExtraction `
                -Prompt $FullPrompt -Model $Model -ApiKey $ApiKey -Temperature $Temperature
            if ($FireResult.Summary) {
                $SummaryObject = $FireResult.Summary
                $AiBackend = $FireResult.Backend
                $FireStats = $FireResult.FireStats
            }
        }
    }

    # ── Stage 6: Unmapped concept resolution ──────────────────────────────────
    if ($SummaryObject.unmapped_concepts -and @($SummaryObject.unmapped_concepts).Count -gt 0) {
        try {
            $Resolution = Resolve-UnmappedConcepts -UnmappedConcepts @($SummaryObject.unmapped_concepts)
            if ($Resolution.Resolved.Count -gt 0) {
                $SummaryObject.unmapped_concepts = $Resolution.Remaining
                Write-Verbose "Pipeline: resolved $($Resolution.Resolved.Count) unmapped concept(s)"
            }
        }
        catch {
            Write-Verbose "Pipeline: unmapped resolution failed — $($_.Exception.Message)"
        }
    }

    # ── Stage 7: Collect stats and return ─────────────────────────────────────
    $Elapsed = (Get-Date) - $PipelineStart
    $Camps = @('accelerationist', 'safetyist', 'skeptic')
    $TotalPoints = 0; $NullNodes = 0
    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        if ($CampData -and $CampData.key_points) {
            $TotalPoints += @($CampData.key_points).Count
            $NullNodes += @($CampData.key_points | Where-Object { $null -eq $_.taxonomy_node_id }).Count
        }
    }
    if ($SummaryObject.factual_claims) { $FactualCount = @($SummaryObject.factual_claims).Count } else { $FactualCount = 0 }
    if ($SummaryObject.unmapped_concepts) { $UnmappedCount = @($SummaryObject.unmapped_concepts).Count } else { $UnmappedCount = 0 }

    # ── Context-rot: extraction + RAG metrics ────────────────────────────────
    $NullNodeRate = if ($TotalPoints -gt 0) { [Math]::Round($NullNodes / $TotalPoints, 4) } else { 0 }
    $DensityFloorHit = if ($null -ne $DensityCheck -and -not $DensityCheck.Pass) { 1 } else { 0 }
    $script:ContextRotStages += @(New-ContextRotStage `
        -Stage 'extraction' -InUnits 'prompt_chars' -InCount $FullPrompt.Length `
        -OutUnits 'items' -OutCount ($TotalPoints + $FactualCount + $UnmappedCount) `
        -Flags @{
            null_node_rate    = $NullNodeRate
            density_floor_hit = $DensityFloorHit
            total_points      = $TotalPoints
            factual_claims    = $FactualCount
            unmapped_concepts = $UnmappedCount
            used_fire         = if ($IterativeExtraction) { 1 } else { 0 }
        })
    if ((Test-Path variable:script:LastRAGMetrics) -and $script:LastRAGMetrics) {
        $script:ContextRotStages += @($script:LastRAGMetrics)
        $script:LastRAGMetrics = $null
    }

    return @{
        Success        = $true
        DocId          = $DocId
        Summary        = $SummaryObject
        Backend        = $AiBackend
        TotalPoints    = $TotalPoints
        NullNodes      = $NullNodes
        FactualCount   = $FactualCount
        UnmappedCount  = $UnmappedCount
        ElapsedSeconds = [Math]::Round($Elapsed.TotalSeconds, 1)
        FireStats      = $FireStats
        TaxonomyJson   = $TaxonomyJson
        UsedFire       = [bool]$IterativeExtraction
    }
}
