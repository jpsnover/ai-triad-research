# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Generates a multi-POV AI summary for a single document.
.DESCRIPTION
    Core summarization worker called by Invoke-POVSummary and Invoke-BatchSummary.
    Reads the document's snapshot.md, builds a density-scaled prompt with the
    current taxonomy, and calls the AI API to produce a structured JSON summary
    containing per-POV key_points, factual_claims, and unmapped_concepts.

    Documents under ~20,000 estimated tokens use a single API call with density
    validation and one retry.  Larger documents are automatically split into
    semantically coherent chunks (via Split-DocumentChunks), each chunk is
    summarized independently, and results are merged (via Merge-ChunkSummaries)
    with deduplication.

    The output is written to summaries/<doc-id>.json and the source's
    metadata.json is updated with summary_status='current'.
.PARAMETER Doc
    Hashtable with document context: DocId, Meta, PovTags, SnapshotFile, MetaFile.
    Built by the calling cmdlet from the source directory.
.PARAMETER ApiKey
    AI API key for the configured backend.
.PARAMETER Model
    AI model identifier (e.g., 'gemini-2.5-flash').  Must be registered in
    ai-models.json.
.PARAMETER Temperature
    Sampling temperature for the AI call.  Lower values produce more deterministic
    output.
.PARAMETER TaxonomyVersion
    Current taxonomy version string (from TAXONOMY_VERSION file).
.PARAMETER TaxonomyJson
    Serialized JSON of the full taxonomy, injected into the prompt for node
    mapping.
.PARAMETER SystemPromptTemplate
    The system prompt template with {{WORD_COUNT}}, {{KP_MIN}}, etc. placeholders
    for density scaling.
.PARAMETER ChunkSystemPromptTemplate
    Optional override prompt for chunk-level summarization.  If empty, the
    'pov-summary-chunk-system' prompt is loaded from Prompts/.
.PARAMETER OutputSchema
    JSON schema string that the AI response must conform to.
.PARAMETER SummariesDir
    Absolute path to the summaries output directory.
.PARAMETER Now
    ISO timestamp for the generated_at field.
.EXAMPLE
    # Typically called internally by Invoke-POVSummary:
    $Result = Invoke-DocumentSummary -Doc $DocContext -ApiKey $Key -Model 'gemini-2.5-flash' `
        -Temperature 0.1 -TaxonomyVersion '4.2' -TaxonomyJson $TaxJson `
        -SystemPromptTemplate $Prompt -OutputSchema $Schema -SummariesDir $OutDir -Now (Get-Date -Format 'o')
    if ($Result.Success) { Write-Host "Generated $($Result.TotalPoints) key points" }
#>
function Invoke-DocumentSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Doc,
        [Parameter(Mandatory)][string]$ApiKey,
        [Parameter(Mandatory)][string]$Model,
        [Parameter(Mandatory)][double]$Temperature,
        [Parameter(Mandatory)][string]$TaxonomyVersion,
        [Parameter(Mandatory)][string]$TaxonomyJson,
        [Parameter(Mandatory)][string]$SystemPromptTemplate,
        [string]$ChunkSystemPromptTemplate = '',
        [Parameter(Mandatory)][string]$OutputSchema,
        [Parameter(Mandatory)][string]$SummariesDir,
        [Parameter(Mandatory)][string]$Now,
        [switch]$IterativeExtraction,
        [switch]$AutoFire
    )

    Set-StrictMode -Version Latest

    $ThisDocId = $Doc.DocId
    $Meta      = $Doc.Meta
    $ChunkThresholdTokens = 20000   # Documents above this get chunked

    Write-Host "`n  `u{250C}`u{2500} $ThisDocId" -ForegroundColor White
    Write-Host "  `u{2502}  pov: $($Doc.PovTags -join ', ')  |  model: $Model" -ForegroundColor Gray

    # -- Load snapshot --------------------------------------------------------
    $SnapshotText = Get-Content $Doc.SnapshotFile -Raw
    if ([string]::IsNullOrWhiteSpace($SnapshotText)) {
        Write-Host "  `u{2514}`u{2500} SKIP $ThisDocId `u{2014} snapshot.md is empty" -ForegroundColor Yellow
        return @{ Success = $false; DocId = $ThisDocId; Error = 'EmptySnapshot' }
    }
    $EstimatedTokens = [int]($SnapshotText.Length / 4)
    Write-Host "  `u{2502}  snapshot: $($SnapshotText.Length) chars (~$EstimatedTokens tokens est.)" -ForegroundColor Gray

    # -- Decide: single-call or chunked pipeline ------------------------------
    if ($EstimatedTokens -gt $ChunkThresholdTokens) {
        Write-Host "  `u{2502}  `u{2728} Large document — using chunked pipeline" -ForegroundColor Cyan
        return Invoke-ChunkedSummary @PSBoundParameters
    }

    # ========================================================================
    # SINGLE-CALL PATH (small documents) — delegates to shared pipeline
    # ========================================================================

    Write-Host "  `u{2502}  Running extraction pipeline..." -ForegroundColor Gray

    $PipelineResult = Invoke-SummaryPipeline `
        -SnapshotText          $SnapshotText `
        -DocId                 $ThisDocId `
        -Metadata              $Meta `
        -ApiKey                $ApiKey `
        -Model                 $Model `
        -Temperature           $Temperature `
        -TaxonomyVersion       $TaxonomyVersion `
        -SystemPromptTemplate  $SystemPromptTemplate `
        -OutputSchema          $OutputSchema `
        -IterativeExtraction:$IterativeExtraction `
        -AutoFire:$AutoFire

    if (-not $PipelineResult.Success) {
        Write-Host "  `u{2514}`u{2500} `u{2717} FAILED: $ThisDocId — $($PipelineResult.Error)" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = $PipelineResult.Error }
    }

    $Elapsed = [TimeSpan]::FromSeconds($PipelineResult.ElapsedSeconds)
    Write-Host "  `u{2502}  `u{2713} Pipeline complete ($($PipelineResult.Backend)): $([int]$Elapsed.TotalSeconds)s" -ForegroundColor Green

    return Finalize-Summary -SummaryObject $PipelineResult.Summary -ThisDocId $ThisDocId `
        -TaxonomyVersion $TaxonomyVersion -Model $Model -Temperature $Temperature `
        -Now $Now -SummariesDir $SummariesDir -Doc $Doc -Elapsed $Elapsed `
        -TaxonomyJson $PipelineResult.TaxonomyJson `
        -FireStats $PipelineResult.FireStats
}

# ============================================================================
# CHUNKED PIPELINE (large documents)
# ============================================================================

function Invoke-ChunkedSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Doc,
        [Parameter(Mandatory)][string]$ApiKey,
        [Parameter(Mandatory)][string]$Model,
        [Parameter(Mandatory)][double]$Temperature,
        [Parameter(Mandatory)][string]$TaxonomyVersion,
        [Parameter(Mandatory)][string]$TaxonomyJson,
        [Parameter(Mandatory)][string]$SystemPromptTemplate,
        [string]$ChunkSystemPromptTemplate = '',
        [Parameter(Mandatory)][string]$OutputSchema,
        [Parameter(Mandatory)][string]$SummariesDir,
        [Parameter(Mandatory)][string]$Now
    )

    $ThisDocId = $Doc.DocId
    $Meta      = $Doc.Meta
    $SnapshotText = Get-Content $Doc.SnapshotFile -Raw

    # -- Split into chunks ----------------------------------------------------
    $Chunks = @(Split-DocumentChunks -Text $SnapshotText -MaxChunkTokens 15000 -MinChunkTokens 2000)
    $ChunkCount = $Chunks.Count
    Write-Host "  `u{2502}  split into $ChunkCount chunks" -ForegroundColor Cyan

    # -- Load chunk-specific system prompt ------------------------------------
    $ChunkSystemPrompt = if ($ChunkSystemPromptTemplate) {
        $ChunkSystemPromptTemplate
    } else {
        Get-Prompt -Name 'pov-summary-chunk-system'
    }
    $DocHeader = Build-DocHeader -Doc $Doc -Meta $Meta -ThisDocId $ThisDocId

    # -- Process each chunk sequentially (API rate limits) --------------------
    $StartTime = Get-Date
    $ChunkResults = [System.Collections.Generic.List[object]]::new()
    $FailedChunks = 0

    for ($i = 0; $i -lt $ChunkCount; $i++) {
        $ChunkNum = $i + 1
        $ChunkText = $Chunks[$i]
        $ChunkTokens = [int]($ChunkText.Length / 4)

        Write-Host "  `u{2502}  chunk $ChunkNum/$ChunkCount (~$ChunkTokens tokens)..." -ForegroundColor Gray -NoNewline

        # Per-chunk relevance filtering: use chunk text as query for better node selection
        $ChunkTaxonomy = $TaxonomyJson
        try {
            $ChunkRelevant = Get-RelevantTaxonomyNodes -Query $ChunkText `
                -Threshold 0.30 -MaxTotal 150 -MinPerCategory 2 `
                -IncludeSituations -Format context -ApiKey $ApiKey
            if ($ChunkRelevant) {
                $ChunkTaxonomy = $ChunkRelevant
                Write-Verbose "  Chunk $ChunkNum`: RAG-filtered to ~40 nodes"
            }
        }
        catch {
            Write-Verbose "  Chunk $ChunkNum`: RAG fallback — using document-level taxonomy"
        }

        $ChunkPrompt = @"
$ChunkSystemPrompt

=== TAXONOMY (version $TaxonomyVersion) ===
$ChunkTaxonomy

=== OUTPUT SCHEMA (your response must match this structure) ===
$OutputSchema

$DocHeader

--- DOCUMENT SECTION $ChunkNum OF $ChunkCount ---
$ChunkText
"@

        try {
            $AIResult = Invoke-AIApi `
                -Prompt     $ChunkPrompt `
                -Model      $Model `
                -ApiKey     $ApiKey `
                -Temperature $Temperature `
                -MaxTokens  65536 `
                -JsonMode `
                -TimeoutSec 300 `
                -MaxRetries 3 `
                -RetryDelays @(5, 15, 45)

            if ($null -eq $AIResult) {
                Write-Host " `u{2717} null response" -ForegroundColor Red
                $FailedChunks++
                continue
            }

            $ChunkObj = Parse-AIResponse -RawText $AIResult.Text -ThisDocId "$ThisDocId-chunk$ChunkNum" -SummariesDir $SummariesDir
            if ($null -eq $ChunkObj) {
                Write-Host " `u{2717} bad JSON" -ForegroundColor Red
                $FailedChunks++
                continue
            }

            $ChunkResults.Add($ChunkObj)
            $ChunkPts = 0
            foreach ($c in @('accelerationist','safetyist','skeptic')) {
                if ($ChunkObj.pov_summaries.$c -and $ChunkObj.pov_summaries.$c.key_points) {
                    $ChunkPts += @($ChunkObj.pov_summaries.$c.key_points).Count
                }
            }
            Write-Host " `u{2713} $ChunkPts points" -ForegroundColor Green

        } catch {
            Write-Host " `u{2717} $_" -ForegroundColor Red
            $FailedChunks++
        }
    }

    $Elapsed = (Get-Date) - $StartTime

    if ($ChunkResults.Count -eq 0) {
        Write-Host "  `u{2514}`u{2500} `u{2717} All $ChunkCount chunks failed" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = "All $ChunkCount chunks failed" }
    }

    if ($FailedChunks -gt 0) {
        Write-Host "  `u{2502}  `u{26A0} $FailedChunks/$ChunkCount chunks failed (proceeding with $($ChunkResults.Count) successful)" -ForegroundColor Yellow
    }

    # -- Merge chunk results --------------------------------------------------
    Write-Host "  `u{2502}  merging $($ChunkResults.Count) chunk results..." -ForegroundColor Cyan
    $MergedObject = Merge-ChunkSummaries -ChunkResults @($ChunkResults)

    # Convert ordered hashtable to PSCustomObject for consistent downstream handling
    $SummaryObject = [PSCustomObject]$MergedObject

    Write-Host "  `u{2502}  `u{2713} Merged ($([int]$Elapsed.TotalSeconds)s total, $ChunkCount chunks)" -ForegroundColor Green

    # -- Density check on merged result (warn only, no retry for chunked) ----
    $WordCount = ($SnapshotText -split '\s+').Count
    $DensityFloors = Get-DensityFloors -WordCount $WordCount
    $DensityCheck = Test-SummaryDensity -SummaryObject $SummaryObject -Floors $DensityFloors
    if (-not $DensityCheck.Pass) {
        Write-Host "  `u{2502}  `u{26A0} Merged density below floor: $($DensityCheck.Shortfalls -join '; ')" -ForegroundColor Yellow
    }

    return Finalize-Summary -SummaryObject $SummaryObject -ThisDocId $ThisDocId `
        -TaxonomyVersion $TaxonomyVersion -Model $Model -Temperature $Temperature `
        -Now $Now -SummariesDir $SummariesDir -Doc $Doc -Elapsed $Elapsed -ChunkCount $ChunkCount `
        -TaxonomyJson $TaxonomyJson
}

# ============================================================================
# SHARED HELPERS
# ============================================================================

function Get-DensityFloors {
    param([int]$WordCount)

    return @{
        KpMin = [Math]::Max(3,  [int]($WordCount / 500))
        FcMin = [Math]::Max(3,  [int]($WordCount / 800))
        UcMin = [Math]::Max(2,  [int]($WordCount / 2000))
    }
}

function Test-SummaryDensity {
    param(
        [object]$SummaryObject,
        [hashtable]$Floors
    )

    $Camps = @('accelerationist','safetyist','skeptic')
    $Shortfalls = [System.Collections.Generic.List[string]]::new()

    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        $Count = 0
        if ($CampData -and $CampData.key_points) {
            $Count = @($CampData.key_points).Count
        }
        if ($Count -lt $Floors.KpMin) {
            $null = $Shortfalls.Add("$Camp key_points: $Count < $($Floors.KpMin) min")
        }
    }

    $FcCount = 0
    if ($SummaryObject.factual_claims) {
        $FcCount = @($SummaryObject.factual_claims).Count
    }
    if ($FcCount -lt $Floors.FcMin) {
        $null = $Shortfalls.Add("factual_claims: $FcCount < $($Floors.FcMin) min")
    }

    $UcCount = 0
    if ($SummaryObject.unmapped_concepts) {
        $UcCount = @($SummaryObject.unmapped_concepts).Count
    }
    if ($UcCount -lt $Floors.UcMin) {
        $null = $Shortfalls.Add("unmapped_concepts: $UcCount < $($Floors.UcMin) min")
    }

    return @{
        Pass       = ($Shortfalls.Count -eq 0)
        Shortfalls = @($Shortfalls)
    }
}

function Build-DensityRetryNudge {
    param([string[]]$Shortfalls)

    $Lines = @(
        "IMPORTANT: Your previous response was REJECTED because it did not meet the"
        "required output density minimums. Specific shortfalls:"
    )
    foreach ($s in $Shortfalls) {
        $Lines += "  - $s"
    }
    $Lines += @(
        ""
        "Go back through the document and extract MORE points. The document contains"
        "substantially more content than you captured. Read each section, paragraph,"
        "and data point carefully. Every distinct claim, argument, or piece of evidence"
        "should be its own key_point or factual_claim."
    )
    return ($Lines -join "`n")
}

function Build-DensityScaledPrompt {
    param(
        [int]$WordCount,
        [string]$Template
    )

    $Floors = Get-DensityFloors -WordCount $WordCount
    $kpMin = $Floors.KpMin
    $kpMax = [Math]::Max(8,  [int]($WordCount / 200))
    $fcMin = $Floors.FcMin
    $fcMax = [Math]::Max(8,  [int]($WordCount / 300))
    $ucMin = $Floors.UcMin
    $ucMax = [Math]::Max(5,  [int]($WordCount / 800))

    Write-Host "  `u{2502}  ~$WordCount words `u{2192} key_points $kpMin-$kpMax/camp, claims $fcMin-$fcMax, unmapped $ucMin-$ucMax" -ForegroundColor Gray

    return $Template `
        -replace '{{WORD_COUNT}}', $WordCount `
        -replace '{{KP_MIN}}',     $kpMin `
        -replace '{{KP_MAX}}',     $kpMax `
        -replace '{{FC_MIN}}',     $fcMin `
        -replace '{{FC_MAX}}',     $fcMax `
        -replace '{{UC_MIN}}',     $ucMin `
        -replace '{{UC_MAX}}',     $ucMax
}

function Build-DocHeader {
    param(
        [hashtable]$Doc,
        [object]$Meta,
        [string]$ThisDocId
    )

    $Title    = if ($Meta.title) { $Meta.title } else { $ThisDocId }
    $PovTags  = $Doc.PovTags -join ', '
    $TopicTags = if ($null -ne $Meta.PSObject.Properties['topic_tags'] -and $Meta.topic_tags) { $Meta.topic_tags -join ', ' } else { '(none)' }

    return @"
=== DOCUMENT: $ThisDocId ===
Title: $Title
POV tags (pre-classified): $PovTags
Topic tags: $TopicTags
"@
}

function Parse-AIResponse {
    param(
        [string]$RawText,
        [string]$ThisDocId,
        [string]$SummariesDir
    )

    $CleanText = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanText = $CleanText.Trim()

    try {
        return ($CleanText | ConvertFrom-Json -Depth 20)
    } catch {
        Write-Host "  `u{2502}  `u{26A0} JSON parse failed `u{2014} attempting repair" -ForegroundColor Yellow
        $Repaired = Repair-TruncatedJson -Text $RawText
        if ($Repaired) {
            try {
                return ($Repaired | ConvertFrom-Json -Depth 20)
            } catch {
                # fall through
            }
        }
        $DebugPath = Join-Path $SummariesDir "${ThisDocId}.debug-raw.txt"
        Set-Content -Path $DebugPath -Value $RawText -Encoding UTF8
        Write-Host "  `u{2502}  `u{2717} Invalid JSON. Raw saved: $DebugPath" -ForegroundColor Red
        return $null
    }
}

function Finalize-Summary {
    param(
        [object]$SummaryObject,
        [string]$ThisDocId,
        [string]$TaxonomyVersion,
        [string]$Model,
        [double]$Temperature,
        [string]$Now,
        [string]$SummariesDir,
        [hashtable]$Doc,
        [TimeSpan]$Elapsed,
        [int]$ChunkCount = 0,
        [string]$TaxonomyJson = '',
        [object]$FireStats = $null
    )

    # Validate stance values and gather counts
    $ValidStances = @('strongly_aligned','aligned','neutral','opposed','strongly_opposed','not_applicable')
    $Camps        = @('accelerationist','safetyist','skeptic')
    $TotalPoints  = 0
    $NullNodes    = 0

    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        if ($CampData) {
            if ($CampData.key_points) {
                foreach ($kp in $CampData.key_points) {
                    if ($kp.stance -notin $ValidStances) { $kp.stance = 'neutral' }
                }
                $TotalPoints += @($CampData.key_points).Count
                $NullNodes   += @($CampData.key_points | Where-Object { $null -eq $_.taxonomy_node_id }).Count
            }
        }
    }

    $SoProps = $SummaryObject.PSObject.Properties
    $FactualClaims  = if ($SoProps['factual_claims'])    { $SummaryObject.factual_claims }    else { @() }
    $UnmappedConcs  = if ($SoProps['unmapped_concepts']) { $SummaryObject.unmapped_concepts } else { @() }
    $FactualCount   = @($FactualClaims).Count
    $UnmappedCount  = @($UnmappedConcs).Count

    $ChunkLabel = if ($ChunkCount -gt 0) { " ($ChunkCount chunks)" } else { '' }
    Write-Host "  `u{2502}  points: $TotalPoints ($NullNodes unmapped)  factual: $FactualCount  new_concepts: $UnmappedCount$ChunkLabel" -ForegroundColor Gray

    # -- Cross-POV fuzzy match on unmapped concepts ----------------------------
    if ($UnmappedCount -gt 0) {
        try {
            $Resolution = Resolve-UnmappedConcepts -UnmappedConcepts @($SummaryObject.unmapped_concepts)
            if (@($Resolution.Resolved).Count -gt 0) {
                foreach ($R in @($Resolution.Resolved)) {
                    Write-Host "  `u{2502}  `u{2714} Resolved: '$($R.ConceptLabel)' `u{2192} $($R.MatchedNodeId) (score $($R.Score))" -ForegroundColor Green
                }
                $UnmappedConcs = @($Resolution.Remaining)
                if ($SoProps['unmapped_concepts']) {
                    $SummaryObject.unmapped_concepts = $UnmappedConcs
                } else {
                    $SummaryObject | Add-Member -NotePropertyName 'unmapped_concepts' -NotePropertyValue $UnmappedConcs -Force
                }
                $UnmappedCount = $UnmappedConcs.Count
            }
        }
        catch {
            Write-Host "  `u{2502}  `u{26A0} Unmapped concept resolution failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # -- Write summaries/<doc-id>.json ----------------------------------------
    # Detect RAG vs full taxonomy from the context format
    $IsRagFiltered = $TaxonomyJson -match '^\s*=== RELEVANT TAXONOMY NODES'
    if ($IsRagFiltered) {
        $EstNodeCount = ([regex]::Matches($TaxonomyJson, '^\s{2}\w', [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count
    }
    else {
        $EstNodeCount = ([regex]::Matches($TaxonomyJson, '"id"\s*:')).Count
    }

    $TaxFilter = if ($ChunkCount -gt 0) { 'rag_per_chunk' } elseif ($IsRagFiltered) { 'rag' } else { 'full' }

    $UsedFire = $null -ne $FireStats
    $ModelInfo = [ordered]@{
        model             = $Model
        temperature       = $Temperature
        max_tokens        = 32768
        extraction_mode   = if ($UsedFire) { 'fire' } else { 'single_shot' }
        taxonomy_filter   = $TaxFilter
        taxonomy_nodes    = $EstNodeCount
    }

    if ($UsedFire) {
        $ModelInfo['fire_confidence_threshold'] = 0.7
        $ModelInfo['fire_stats'] = [ordered]@{
            api_calls          = $FireStats.total_api_calls
            iterations         = $FireStats.total_iterations
            claims_total       = $FireStats.claims_total
            claims_confident   = $FireStats.claims_confident
            claims_iterated    = $FireStats.claims_iterated
            elapsed_seconds    = $FireStats.elapsed_seconds
            termination_reason = $FireStats.termination_reason
        }
    }

    if ($ChunkCount -gt 0) {
        $ModelInfo['chunked']     = $true
        $ModelInfo['chunk_count'] = $ChunkCount
    }

    $FinalSummary = [ordered]@{
        doc_id            = $ThisDocId
        taxonomy_version  = $TaxonomyVersion
        generated_at      = $Now
        model_info        = $ModelInfo
        pov_summaries     = if ($SoProps['pov_summaries']) { $SummaryObject.pov_summaries } else { [ordered]@{} }
        factual_claims    = @($FactualClaims)
        unmapped_concepts = @($UnmappedConcs)
    }

    $SummaryPath = Join-Path $SummariesDir "${ThisDocId}.json"
    try {
        Set-Content -Path $SummaryPath -Value ($FinalSummary | ConvertTo-Json -Depth 20) -Encoding UTF8
    }
    catch {
        Write-Host "  `u{2514}`u{2500} `u{2717} Failed to write summary: $($_.Exception.Message)" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = "Failed to write summary file: $($_.Exception.Message)" }
    }

    # -- Update metadata.json -------------------------------------------------
    try {
        $MetaRaw     = Get-Content $Doc.MetaFile -Raw
        $MetaUpdated = $MetaRaw | ConvertFrom-Json -Depth 20 -AsHashtable
        $MetaUpdated['summary_version'] = $TaxonomyVersion
        $MetaUpdated['summary_status']  = 'current'
        $MetaUpdated['summary_updated'] = $Now

        # Summary statistics for Source objects
        $claimsByPov = @{ accelerationist = 0; safetyist = 0; skeptic = 0; situations = 0 }
        foreach ($claim in @($FactualClaims)) {
            if (-not $claim.PSObject.Properties['linked_taxonomy_nodes']) { continue }
            foreach ($nodeId in @($claim.linked_taxonomy_nodes)) {
                if     ($nodeId -like 'acc-*') { $claimsByPov['accelerationist']++ }
                elseif ($nodeId -like 'saf-*') { $claimsByPov['safetyist']++ }
                elseif ($nodeId -like 'skp-*') { $claimsByPov['skeptic']++ }
                elseif ($nodeId -like 'sit-*') { $claimsByPov['situations']++ }
            }
        }
        $MetaUpdated['total_claims']      = $FactualCount
        $MetaUpdated['claims_by_pov']     = $claimsByPov
        $MetaUpdated['total_facts']       = $TotalPoints
        $MetaUpdated['unmapped_concepts'] = $UnmappedCount

        Set-Content -Path $Doc.MetaFile -Value ($MetaUpdated | ConvertTo-Json -Depth 10) -Encoding UTF8
    }
    catch {
        Write-Host "  `u{2502}  `u{26A0} Summary written but metadata update failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    Write-Host "  `u{2514}`u{2500} `u{2713} Done: summaries/$ThisDocId.json" -ForegroundColor Green

    return @{
        Success       = $true
        DocId         = $ThisDocId
        TotalPoints   = $TotalPoints
        NullNodes     = $NullNodes
        FactualCount  = $FactualCount
        UnmappedCount = $UnmappedCount
        ElapsedSecs   = [int]$Elapsed.TotalSeconds
        ChunkCount    = $ChunkCount
    }
}
