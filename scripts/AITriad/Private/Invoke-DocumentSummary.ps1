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
    AI model identifier (e.g., 'gemini-3.1-flash-lite').  Must be registered in
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
    $Result = Invoke-DocumentSummary -Doc $DocContext -ApiKey $Key -Model 'gemini-3.1-flash-lite' `
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
    $script:ContextRotStages = @()  # accumulator for context-rot instrumentation

    Write-Host "`n  ┌─ $ThisDocId" -ForegroundColor White
    Write-Host "  │  pov: $($Doc.PovTags -join ', ')  |  model: $Model" -ForegroundColor Gray

    # -- Load snapshot --------------------------------------------------------
    $SnapshotText = Get-Content $Doc.SnapshotFile -Raw
    if ([string]::IsNullOrWhiteSpace($SnapshotText)) {
        Write-Host "  └─ SKIP $ThisDocId — snapshot.md is empty" -ForegroundColor Yellow
        return @{ Success = $false; DocId = $ThisDocId; Error = 'EmptySnapshot' }
    }
    $EstimatedTokens = [int]($SnapshotText.Length / 4)
    Write-Host "  │  snapshot: $($SnapshotText.Length) chars (~$EstimatedTokens tokens est.)" -ForegroundColor Gray

    # -- Decide: single-call or chunked pipeline ------------------------------
    if ($EstimatedTokens -gt $ChunkThresholdTokens) {
        Write-Host "  │  ✨ Large document — using chunked pipeline" -ForegroundColor Cyan
        return Invoke-ChunkedSummary @PSBoundParameters
    }

    # ========================================================================
    # SINGLE-CALL PATH (small documents) — delegates to shared pipeline
    # ========================================================================

    Write-Host "  │  Running extraction pipeline..." -ForegroundColor Gray

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
        Write-Host "  └─ ✗ FAILED: $ThisDocId — $($PipelineResult.Error)" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = $PipelineResult.Error }
    }

    $Elapsed = [TimeSpan]::FromSeconds($PipelineResult.ElapsedSeconds)
    Write-Host "  │  ✓ Pipeline complete ($($PipelineResult.Backend)): $([int]$Elapsed.TotalSeconds)s" -ForegroundColor Green

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
    $Chunks = @(Split-DocumentChunks -Text $SnapshotText -MaxChunkTokens 6000 -MinChunkTokens 1500)
    $ChunkCount = $Chunks.Count
    Write-Host "  │  split into $ChunkCount chunks" -ForegroundColor Cyan

    # -- Context-rot: chunking metrics ----------------------------------------
    $InputTokensEst = [int]($SnapshotText.Length / 4)
    $ChunkTokensSum = 0
    foreach ($c in $Chunks) { $ChunkTokensSum += [int]($c.Length / 4) }
    $script:ContextRotStages += @(New-ContextRotStage `
        -Stage 'chunking' -InUnits 'tokens_est' -InCount $InputTokensEst `
        -OutUnits 'tokens_est' -OutCount $ChunkTokensSum `
        -Flags @{ chunk_count = $ChunkCount })

    # -- Load chunk-specific system prompt ------------------------------------
    if ($ChunkSystemPromptTemplate) {
        $ChunkSystemPrompt = $ChunkSystemPromptTemplate
    } else {
        $ChunkSystemPrompt = Get-Prompt -Name 'pov-summary-chunk-system'
    }
    $DocHeader = Build-DocHeader -Doc $Doc -Meta $Meta -ThisDocId $ThisDocId

    # -- Pre-compute all chunk RAG query embeddings in ONE batch subprocess ----
    # Get-RelevantTaxonomyNodes embeds the query via a cold ~6s model-load per
    # call; batching all chunk queries up front loads the model once. Queries are
    # truncated to 2000 chars to match Get-RelevantTaxonomyNodes' own truncation.
    $ChunkQueryTexts = [System.Collections.Generic.List[string]]::new()
    foreach ($Ck in $Chunks) {
        if ($Ck.Length -gt 2000) { $ChunkQueryTexts.Add($Ck.Substring(0, 2000)) } else { $ChunkQueryTexts.Add($Ck) }
    }
    $ChunkQueryEmb = Invoke-BatchEmbeddings -Texts $ChunkQueryTexts.ToArray()

    # -- Process each chunk sequentially (API rate limits) --------------------
    $StartTime = Get-Date
    $ChunkResults = [System.Collections.Generic.List[object]]::new()
    $FailedChunks = 0
    $ChunkRAGMetrics = [System.Collections.Generic.List[object]]::new()
    $ChunkExtractionStats = @{ TotalPoints = 0; NullNodes = 0; FactualClaims = 0; UnmappedConcepts = 0; PromptChars = 0 }

    for ($i = 0; $i -lt $ChunkCount; $i++) {
        $ChunkNum = $i + 1
        $ChunkText = $Chunks[$i]
        $ChunkTokens = [int]($ChunkText.Length / 4)

        Write-Host "  │  chunk $ChunkNum/$ChunkCount (~$ChunkTokens tokens)..." -ForegroundColor Gray -NoNewline

        # Per-chunk relevance filtering: use chunk text as query for better node selection
        $ChunkTaxonomy = $null
        $script:LastRAGMetrics = $null
        try {
            # Use the pre-computed (batched) query vector when available; falls
            # back to an in-call encode if the batch produced no vector for it.
            if ($ChunkText.Length -gt 2000) { $ChunkQueryText = $ChunkText.Substring(0, 2000) } else { $ChunkQueryText = $ChunkText }
            if ($ChunkQueryEmb.ContainsKey($ChunkQueryText)) { $ChunkQVec = $ChunkQueryEmb[$ChunkQueryText] } else { $ChunkQVec = @() }
            $ChunkRelevant = Get-RelevantTaxonomyNodes -Query $ChunkText -QueryVector $ChunkQVec `
                -MaxTotal 150 -TopK 60 -MinPerCategory 2 `
                -IncludeSituations -Format context -ApiKey $ApiKey
            if ($ChunkRelevant) {
                $ChunkTaxonomy = $ChunkRelevant
                Write-Verbose "  Chunk $ChunkNum`: RAG-filtered to ~40 nodes"
            }
        }
        catch {
            Write-Verbose "  Chunk $ChunkNum`: RAG fallback — using compact taxonomy"
        }
        if ($script:LastRAGMetrics) {
            $null = $ChunkRAGMetrics.Add($script:LastRAGMetrics)
            $script:LastRAGMetrics = $null
        }
        if (-not $ChunkTaxonomy) {
            $ChunkTaxonomy = Build-CompactTaxonomy
        }

        $ChunkSysInstruction = @"
$ChunkSystemPrompt

=== OUTPUT SCHEMA (your response must match this structure) ===
$OutputSchema
"@

        $ChunkPrompt = @"
=== TAXONOMY (version $TaxonomyVersion) ===
$ChunkTaxonomy

$DocHeader

--- DOCUMENT SECTION $ChunkNum OF $ChunkCount ---
$ChunkText
"@

        try {
            $__ApiSw = [System.Diagnostics.Stopwatch]::StartNew()
            $AIResult = Invoke-AIApi `
                -Prompt     $ChunkPrompt `
                -SystemInstruction $ChunkSysInstruction `
                -Model      $Model `
                -ApiKey     $ApiKey `
                -Temperature $Temperature `
                -MaxTokens  65536 `
                -JsonMode `
                -TimeoutSec 600 `
                -MaxRetries 3 `
                -RetryDelays @(5, 15, 45)
            $__ApiSw.Stop()
            Add-StageTiming -Name 'api.extraction (chunk)' -Milliseconds $__ApiSw.Elapsed.TotalMilliseconds

            if ($null -eq $AIResult) {
                Write-Host " ✗ null response" -ForegroundColor Red
                $FailedChunks++
                continue
            }

            if ($AIResult.PSObject.Properties['Truncated'] -and $AIResult.Truncated) {
                Write-Host " ⚠ TRUNCATED — output exceeded model limit, extraction may be incomplete" -ForegroundColor Yellow
            }

            $ChunkObj = Parse-AIResponse -RawText $AIResult.Text -ThisDocId "$ThisDocId-chunk$ChunkNum" -SummariesDir $SummariesDir
            if ($null -eq $ChunkObj) {
                Write-Host " ✗ bad JSON" -ForegroundColor Red
                $FailedChunks++
                continue
            }

            $ChunkResults.Add($ChunkObj)
            $ChunkPts = 0
            $ChunkNulls = 0
            foreach ($c in @('accelerationist','safetyist','skeptic')) {
                $campObj = $ChunkObj.pov_summaries.$c
                if ($campObj -and $campObj.PSObject.Properties['key_points'] -and $campObj.key_points) {
                    $pts = @($campObj.key_points)
                    $ChunkPts += $pts.Count
                    $ChunkNulls += @($pts | Where-Object { $null -eq $_.taxonomy_node_id }).Count
                }
            }
            $ChunkFacts = if ($ChunkObj.PSObject.Properties['factual_claims'] -and $ChunkObj.factual_claims) { @($ChunkObj.factual_claims).Count } else { 0 }
            $ChunkUnmapped = if ($ChunkObj.PSObject.Properties['unmapped_concepts'] -and $ChunkObj.unmapped_concepts) { @($ChunkObj.unmapped_concepts).Count } else { 0 }
            $ChunkExtractionStats.TotalPoints += $ChunkPts
            $ChunkExtractionStats.NullNodes += $ChunkNulls
            $ChunkExtractionStats.FactualClaims += $ChunkFacts
            $ChunkExtractionStats.UnmappedConcepts += $ChunkUnmapped
            $ChunkExtractionStats.PromptChars += $ChunkPrompt.Length
            if ($ChunkPts -eq 0) {
                Write-Host " ⚠ 0 points (chunk may be non-substantive or extraction failed silently)" -ForegroundColor Yellow
            } elseif ($ChunkPts -lt 3) {
                Write-Host " ⚠ $ChunkPts points (sparse)" -ForegroundColor Yellow
            } else {
                Write-Host " ✓ $ChunkPts points" -ForegroundColor Green
            }

        } catch {
            Write-Host " ✗ $_" -ForegroundColor Red
            $FailedChunks++
        }
    }

    $Elapsed = (Get-Date) - $StartTime

    if ($ChunkResults.Count -eq 0) {
        Write-Host "  └─ ✗ All $ChunkCount chunks failed" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = "All $ChunkCount chunks failed" }
    }

    if ($FailedChunks -gt 0) {
        Write-Host "  │  ⚠ $FailedChunks/$ChunkCount chunks failed (proceeding with $($ChunkResults.Count) successful)" -ForegroundColor Yellow
    }

    # -- Context-rot: aggregated per-chunk RAG + extraction metrics -----------
    if ($ChunkRAGMetrics.Count -gt 0) {
        $TotalIn = 0; $TotalOut = 0; $TotalForced = 0
        $BeliefsSum = 0; $DesiresSum = 0; $IntentionsSum = 0
        $MinNodes = [int]::MaxValue; $MaxNodes = 0
        foreach ($rm in $ChunkRAGMetrics) {
            $TotalIn += $rm.in_count; $TotalOut += $rm.out_count
            $TotalForced += ($rm.flags.below_threshold_forced ?? 0)
            $BeliefsSum += ($rm.flags.beliefs_selected ?? 0)
            $DesiresSum += ($rm.flags.desires_selected ?? 0)
            $IntentionsSum += ($rm.flags.intentions_selected ?? 0)
            if ($rm.out_count -lt $MinNodes) { $MinNodes = [int]$rm.out_count }
            if ($rm.out_count -gt $MaxNodes) { $MaxNodes = [int]$rm.out_count }
        }
        $script:ContextRotStages += @(New-ContextRotStage `
            -Stage 'rag_filtering' -InUnits 'nodes' -InCount ([int]($TotalIn / $ChunkRAGMetrics.Count)) `
            -OutUnits 'nodes' -OutCount ([int]($TotalOut / $ChunkRAGMetrics.Count)) `
            -Flags @{
                chunk_count            = $ChunkRAGMetrics.Count
                avg_nodes_selected     = [Math]::Round($TotalOut / $ChunkRAGMetrics.Count, 0)
                min_nodes_selected     = $MinNodes
                max_nodes_selected     = $MaxNodes
                total_below_threshold  = $TotalForced
                avg_beliefs            = [Math]::Round($BeliefsSum / $ChunkRAGMetrics.Count, 0)
                avg_desires            = [Math]::Round($DesiresSum / $ChunkRAGMetrics.Count, 0)
                avg_intentions         = [Math]::Round($IntentionsSum / $ChunkRAGMetrics.Count, 0)
            })
    }
    if ($ChunkExtractionStats.TotalPoints -gt 0 -or $ChunkExtractionStats.PromptChars -gt 0) {
        $TotalItems = $ChunkExtractionStats.TotalPoints + $ChunkExtractionStats.FactualClaims + $ChunkExtractionStats.UnmappedConcepts
        $NullRate = if ($ChunkExtractionStats.TotalPoints -gt 0) {
            [Math]::Round($ChunkExtractionStats.NullNodes / $ChunkExtractionStats.TotalPoints, 4)
        } else { 0 }
        $script:ContextRotStages += @(New-ContextRotStage `
            -Stage 'extraction' -InUnits 'prompt_chars' -InCount $ChunkExtractionStats.PromptChars `
            -OutUnits 'items' -OutCount $TotalItems `
            -Flags @{
                null_node_rate    = $NullRate
                total_points      = $ChunkExtractionStats.TotalPoints
                factual_claims    = $ChunkExtractionStats.FactualClaims
                unmapped_concepts = $ChunkExtractionStats.UnmappedConcepts
                chunk_count       = $ChunkResults.Count
            })
    }

    # -- Merge chunk results --------------------------------------------------
    Write-Host "  │  merging $($ChunkResults.Count) chunk results..." -ForegroundColor Cyan
    $__MergeSw = [System.Diagnostics.Stopwatch]::StartNew()
    $MergedObject = Merge-ChunkSummaries -ChunkResults @($ChunkResults)
    $__MergeSw.Stop()
    Add-StageTiming -Name 'merge.total (incl. embed dedup)' -Milliseconds $__MergeSw.Elapsed.TotalMilliseconds

    # Capture context-rot merge metrics before stripping the internal field
    if ($MergedObject['_merge_metrics']) {
        $script:ContextRotStages += @($MergedObject['_merge_metrics'])
        $MergedObject.Remove('_merge_metrics')
    }

    # Convert ordered hashtable to PSCustomObject for consistent downstream handling
    $SummaryObject = [PSCustomObject]$MergedObject

    Write-Host "  │  ✓ Merged ($([int]$Elapsed.TotalSeconds)s total, $ChunkCount chunks)" -ForegroundColor Green

    # -- Density check on merged result (warn only, no retry for chunked) ----
    # Scale floors by merge discount — chunked extraction produces less per-unit
    # than single-pass because each chunk has limited cross-chunk context
    $WordCount = ($SnapshotText -split '\s+').Count
    $DensityFloors = Get-DensityFloors -WordCount $WordCount
    $MergeDiscount = 1 / [Math]::Sqrt($ChunkCount)
    $DensityFloors.KpMin = [Math]::Max(3, [int]($DensityFloors.KpMin * $MergeDiscount))
    $DensityFloors.UcMin = [Math]::Max(1, [int]($DensityFloors.UcMin * $MergeDiscount))
    $DensityFloors.TotalFloor = [Math]::Max(6, [int]($DensityFloors.TotalFloor * $MergeDiscount))
    $DensityCheck = Test-SummaryDensity -SummaryObject $SummaryObject -Floors $DensityFloors
    if (-not $DensityCheck.Pass) {
        Write-Host "  │  ⚠ Merged density below floor: $($DensityCheck.Shortfalls -join '; ')" -ForegroundColor Yellow
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

    $kpTarget = [Math]::Max(3,  [int]($WordCount / 500))
    return @{
        KpMin      = $kpTarget
        UcMin      = [Math]::Max(2,  [int]($WordCount / 2000))
        TotalFloor = [Math]::Max(6,  $kpTarget * 2)
    }
}

function Test-SummaryDensity {
    param(
        [object]$SummaryObject,
        [hashtable]$Floors
    )

    $Camps = @('accelerationist','safetyist','skeptic')
    $Shortfalls = [System.Collections.Generic.List[string]]::new()

    # Collect empty_cells declared by the model (licensed emptiness per REC-1)
    $EmptyCellSet = [System.Collections.Generic.HashSet[string]]::new()
    if ($SummaryObject.PSObject.Properties['empty_cells'] -and $SummaryObject.empty_cells) {
        foreach ($ec in @($SummaryObject.empty_cells)) {
            if ($ec.PSObject.Properties['camp'] -and $ec.PSObject.Properties['category']) {
                [void]$EmptyCellSet.Add("$($ec.camp)|$($ec.category)")
            }
        }
    }

    # Total key_points across all camps (replaces per-camp floors)
    $TotalKp = 0
    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        $Count = 0
        if ($CampData -and $CampData.PSObject.Properties['key_points'] -and $CampData.key_points) {
            $Count = @($CampData.key_points).Count
        }
        $TotalKp += $Count

        # Flag camps with zero points and no empty_cell declaration
        if ($Count -eq 0) {
            $Categories = @('Desires','Beliefs','Intentions')
            $AllDeclared = $true
            foreach ($cat in $Categories) {
                if (-not $EmptyCellSet.Contains("$Camp|$cat")) {
                    $AllDeclared = $false
                    break
                }
            }
            if (-not $AllDeclared) {
                $null = $Shortfalls.Add("$Camp has 0 key_points without empty_cells declarations")
            }
        }
    }

    $TotalFloor = if ($Floors.ContainsKey('TotalFloor')) { $Floors.TotalFloor } else { 6 }
    if ($TotalKp -lt $TotalFloor) {
        $null = $Shortfalls.Add("total key_points: $TotalKp < $TotalFloor across all camps")
    }

    $UcCount = 0
    if ($SummaryObject.PSObject.Properties['unmapped_concepts'] -and $SummaryObject.unmapped_concepts) {
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
        "IMPORTANT: Your previous response did not meet extraction effort requirements."
        "Specific shortfalls:"
    )
    foreach ($s in $Shortfalls) {
        $Lines += "  - $s"
    }
    $Lines += @(
        ""
        "Go back through the document and extract MORE points. Examine ALL nine BDI"
        "cells (3 POV camps x 3 categories). For each cell, extract every distinct"
        "point the document actually contains. If a cell is genuinely empty, declare"
        "it in the empty_cells array with a reason. Every distinct claim, argument,"
        "or piece of evidence should be its own key_point or factual_claim."
        "Include a canonical_proposition for every key_point."
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
    $ucMin = $Floors.UcMin
    $ucMax = [Math]::Max(5,  [int]($WordCount / 800))
    $totalFloor = $Floors.TotalFloor

    Write-Host "  │  ~$WordCount words → key_points $kpMin-$kpMax/camp (target), total floor $totalFloor, unmapped $ucMin-$ucMax" -ForegroundColor Gray

    return $Template `
        -replace '{{WORD_COUNT}}',   $WordCount `
        -replace '{{KP_MIN}}',       $kpMin `
        -replace '{{KP_MAX}}',       $kpMax `
        -replace '{{UC_MIN}}',       $ucMin `
        -replace '{{UC_MAX}}',       $ucMax `
        -replace '{{TOTAL_FLOOR}}',  $totalFloor
}

function Build-CompactTaxonomy {
    <#
    .SYNOPSIS
        Builds a compact taxonomy context (~5-10K tokens) for prompt injection
        when full RAG embedding is unavailable.
    .DESCRIPTION
        Loads the four taxonomy files and emits only id, category, and label per node.
        This is ~95% smaller than the full taxonomy JSON while still providing
        enough context for the LLM to map claims to node IDs.
    #>
    $TaxDir = Get-TaxonomyDir
    $Lines = [System.Text.StringBuilder]::new()
    [void]$Lines.AppendLine("=== COMPACT TAXONOMY (id | category | label — full descriptions omitted for brevity) ===")
    [void]$Lines.AppendLine("")

    $TaxFiles = [ordered]@{
        'accelerationist.json' = 'Accelerationist'
        'safetyist.json'       = 'Safetyist'
        'skeptic.json'         = 'Skeptic'
        'situations.json'      = 'Situations'
    }

    foreach ($FileName in $TaxFiles.Keys) {
        $FilePath = Join-Path $TaxDir $FileName
        if (-not (Test-Path $FilePath)) { continue }
        $Data = Get-Content $FilePath -Raw | ConvertFrom-Json
        [void]$Lines.AppendLine("--- $($TaxFiles[$FileName]) ---")
        foreach ($Node in $Data.nodes) {
            $Cat = if ($null -ne $Node.PSObject.Properties['category'] -and $Node.category) { "[$($Node.category)]" } else { '' }
            [void]$Lines.AppendLine("  $($Node.id) $Cat $($Node.label)")
        }
        [void]$Lines.AppendLine("")
    }

    Write-Verbose "Pipeline: compact taxonomy built (~$([int]($Lines.Length / 4)) tokens est.)"
    return $Lines.ToString()
}

function Build-DocHeader {
    param(
        [hashtable]$Doc,
        [object]$Meta,
        [string]$ThisDocId
    )

    if ($Meta.title) { $Title = $Meta.title } else { $Title = $ThisDocId }
    $PovTags  = $Doc.PovTags -join ', '
    if ($null -ne $Meta.PSObject.Properties['topic_tags'] -and $Meta.topic_tags) { $TopicTags = $Meta.topic_tags -join ', ' } else { $TopicTags = '(none)' }

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
        return ($CleanText | ConvertFrom-Json)
    } catch {
        Write-Host "  │  ⚠ JSON parse failed — attempting repair" -ForegroundColor Yellow
        $Repaired = Repair-TruncatedJson -Text $RawText
        if ($Repaired) {
            try {
                return ($Repaired | ConvertFrom-Json)
            } catch {
                # fall through
            }
        }
        $DebugPath = Join-Path $SummariesDir "${ThisDocId}.debug-raw.txt"
        Write-Utf8NoBom -Path $DebugPath -Value $RawText 
        Write-Host "  │  ✗ Invalid JSON. Raw saved: $DebugPath" -ForegroundColor Red
        return $null
    }
}

$script:ValidStances = @('strongly_aligned','aligned','neutral','opposed','strongly_opposed','not_applicable')

$script:StanceKeywordMap = @{
    strongly_aligned = @('strongly_align','strongly_support','fully_align','fully_support',
                         'enthusiastic','wholehearted','completely_agree','fully_endorse',
                         'strongly agree','fully agree','totally agree','completely support')
    aligned          = @('align','support','agree','endorse','advocate','favor','embrace',
                         'concur','approve','accept','positive','promote','back','champion',
                         'sympathetic','pro','affirmative','encourage')
    opposed          = @('oppose','disagree','reject','dispute','challenge','contest','resist',
                         'deny','refute','counter','critical','against','negative','skeptical',
                         'pushback','push back','object','sucks','bad','wrong','flawed','harmful')
    strongly_opposed = @('strongly_oppose','strongly_disagree','vehemently','adamant',
                         'completely_reject','fundamentally_oppose','categorically',
                         'strongly reject','totally reject','completely disagree','dangerous',
                         'catastrophic','existential threat','reckless','unconscionable')
    not_applicable   = @('not_applicable','n/a','irrelevant','no_stance','no stance','unrelated',
                         'does not address','not relevant','outside scope')
}

function Resolve-Stance {
    param([string]$Raw)

    if ([string]::IsNullOrWhiteSpace($Raw)) { return 'neutral' }

    $Lower = $Raw.Trim().ToLowerInvariant() -replace '[_\-]',' '

    if ($Lower -in $script:ValidStances) { return $Lower }
    $Normalized = $Lower -replace '\s+','_'
    if ($Normalized -in $script:ValidStances) { return $Normalized }

    foreach ($Stance in 'strongly_opposed','strongly_aligned','opposed','aligned','not_applicable') {
        foreach ($Kw in $script:StanceKeywordMap[$Stance]) {
            $KwNorm = $Kw -replace '[_\-]',' '
            if ($Lower -match [regex]::Escape($KwNorm)) { return $Stance }
        }
    }

    return 'neutral'
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

    # -- Schema validation (Gap 3.4) --------------------------------------------
    # Use a helper that works on both PSCustomObject and OrderedDictionary
    # (Merge-ChunkSummaries returns OrderedDictionary, single-call returns PSCustomObject)
    function Has-Field($Obj, [string]$Name) {
        if ($Obj -is [System.Collections.IDictionary]) { return $Obj.Contains($Name) }
        if ($Obj.PSObject.Properties[$Name]) { return $true }
        return $false
    }
    function Get-Field($Obj, [string]$Name) {
        if ($Obj -is [System.Collections.IDictionary]) { return $Obj[$Name] }
        $P = $Obj.PSObject.Properties[$Name]
        if ($P) { return $P.Value }
        return $null
    }

    $Camps        = @('accelerationist','safetyist','skeptic')
    $SchemaErrors = [System.Collections.Generic.List[string]]::new()

    if (-not (Has-Field $SummaryObject 'pov_summaries')) {
        $SchemaErrors.Add("Missing required field: pov_summaries")
    } else {
        $PovSums = Get-Field $SummaryObject 'pov_summaries'
        foreach ($Camp in $Camps) {
            $CampData = Get-Field $PovSums $Camp
            if ($null -eq $CampData) {
                $SchemaErrors.Add("Missing camp in pov_summaries: $Camp")
            } else {
                $KP = Get-Field $CampData 'key_points'
                if ($null -eq $KP) {
                    $SchemaErrors.Add("pov_summaries.$Camp.key_points missing or not an array")
                } else {
                    # Force-array: ConvertFrom-Json unwraps single-element arrays to scalars
                    $KP = @($KP)
                    if ($CampData -is [System.Collections.IDictionary]) { $CampData['key_points'] = $KP }
                    else { $CampData.key_points = $KP }
                }
            }
        }
    }
    if (-not (Has-Field $SummaryObject 'factual_claims')) {
        $SchemaErrors.Add("Missing required field: factual_claims")
    } else {
        $FC = Get-Field $SummaryObject 'factual_claims'
        # Force-array: ConvertFrom-Json unwraps single-element arrays to scalars
        if ($null -ne $FC) {
            $FC = @($FC)
            # Write back the forced array so downstream code sees an array
            if ($SummaryObject -is [System.Collections.IDictionary]) { $SummaryObject['factual_claims'] = $FC }
            else { $SummaryObject.factual_claims = $FC }
        } else {
            $SchemaErrors.Add("Missing required field: factual_claims")
        }
    }
    if (-not (Has-Field $SummaryObject 'unmapped_concepts')) {
        # Not an error — field may be absent if all concepts were resolved. Default to empty array.
        if ($SummaryObject -is [System.Collections.IDictionary]) { $SummaryObject['unmapped_concepts'] = @() }
        else { $SummaryObject | Add-Member -NotePropertyName 'unmapped_concepts' -NotePropertyValue @() -Force }
    } else {
        $UC = Get-Field $SummaryObject 'unmapped_concepts'
        # Force-array: ConvertFrom-Json unwraps single-element arrays to scalars; null → empty
        $UC = if ($null -ne $UC) { @($UC) } else { @() }
        if ($SummaryObject -is [System.Collections.IDictionary]) { $SummaryObject['unmapped_concepts'] = $UC }
        else { $SummaryObject.unmapped_concepts = $UC }
    }

    foreach ($Err in $SchemaErrors) {
        Write-Host "  │  ✗ Schema: $Err" -ForegroundColor Red
    }

    if ($SchemaErrors.Count -gt 0 -and -not (Has-Field $SummaryObject 'pov_summaries')) {
        return @{ Success = $false; DocId = $ThisDocId; Error = "Schema validation failed: $($SchemaErrors -join '; ')" }
    }

    # -- Validate stance values and gather counts --------------------------------
    $TotalPoints  = 0
    $NullNodes    = 0

    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        if ($CampData) {
            if (Has-Field $CampData 'key_points') {
                $kpList = Get-Field $CampData 'key_points'
                if ($kpList) {
                    foreach ($kp in $kpList) {
                        if ($kp.stance -notin $script:ValidStances) { $kp.stance = Resolve-Stance $kp.stance }
                    }
                    $TotalPoints += @($kpList).Count
                    $NullNodes   += @($kpList | Where-Object { $null -eq $_.taxonomy_node_id }).Count
                }
            }
        }
    }

    # -- Validate taxonomy_node_id existence (Gap 3.1) ---------------------------
    $InvalidNodeIds = [System.Collections.Generic.List[string]]::new()
    $NodeIdSet = Get-TaxonomyNodeIdSet
    if ($null -ne $NodeIdSet -and $NodeIdSet.Count -gt 0) {
        foreach ($Camp in $Camps) {
            $CampData = $SummaryObject.pov_summaries.$Camp
            if (-not $CampData -or -not (Has-Field $CampData 'key_points')) { continue }
            $kpList769 = Get-Field $CampData 'key_points'
            if (-not $kpList769) { continue }
            foreach ($kp in $kpList769) {
                if (-not $kp.taxonomy_node_id) { continue }
                if (-not $NodeIdSet.Contains($kp.taxonomy_node_id)) {
                    $InvalidNodeIds.Add("$Camp/$($kp.taxonomy_node_id)")
                    $BadId = $kp.taxonomy_node_id
                    $kp.taxonomy_node_id = $null
                    $NullNodes++
                    if (-not $SummaryObject.PSObject.Properties['unmapped_concepts']) {
                        $SummaryObject | Add-Member -NotePropertyName 'unmapped_concepts' -NotePropertyValue @() -Force
                    }
                    $SummaryObject.unmapped_concepts = @($SummaryObject.unmapped_concepts) + @(
                        [PSCustomObject]@{
                            suggested_label = $BadId
                            concept         = $kp.point
                            reason          = "Hallucinated node ID '$BadId' not found in taxonomy — moved from $Camp key_points"
                        }
                    )
                }
            }
        }
        if ($InvalidNodeIds.Count -gt 0) {
            Write-Host "  │  ⚠ Hallucinated node IDs moved to unmapped: $($InvalidNodeIds -join ', ')" -ForegroundColor Yellow
        }
    }

    # -- Cross-camp consistency check (Gap 3.3) --------------------------------
    $NodeStanceMap = @{}
    $CrossCampWarnings = [System.Collections.Generic.List[string]]::new()
    foreach ($Camp in $Camps) {
        $CampData = $SummaryObject.pov_summaries.$Camp
        if (-not $CampData -or -not (Has-Field $CampData 'key_points')) { continue }
        $kpList800 = Get-Field $CampData 'key_points'
        if (-not $kpList800) { continue }
        foreach ($kp in $kpList800) {
            if (-not $kp.taxonomy_node_id) { continue }
            $Key = "$($kp.taxonomy_node_id)|$($kp.stance)"
            if ($NodeStanceMap.ContainsKey($Key)) {
                $PriorCamp = $NodeStanceMap[$Key]
                if ($PriorCamp -ne $Camp) {
                    $CrossCampWarnings.Add("Cross-camp agreement: $PriorCamp + $Camp both '$($kp.stance)' on $($kp.taxonomy_node_id)")
                }
            } else {
                $NodeStanceMap[$Key] = $Camp
            }
        }
    }
    foreach ($Warn in $CrossCampWarnings) {
        Write-Host "  │  ⚠ $Warn" -ForegroundColor Yellow
    }

    $SoProps = $SummaryObject.PSObject.Properties
    if ($SoProps['factual_claims'] -and $null -ne $SummaryObject.factual_claims) { $FactualClaims = $SummaryObject.factual_claims } else { $FactualClaims = @() }
    if ($SoProps['unmapped_concepts'] -and $null -ne $SummaryObject.unmapped_concepts) { $UnmappedConcs = $SummaryObject.unmapped_concepts } else { $UnmappedConcs = @() }
    $FactualCount   = @($FactualClaims).Count
    $UnmappedCount  = @($UnmappedConcs).Count

    if ($ChunkCount -gt 0) { $ChunkLabel = " ($ChunkCount chunks)" } else { $ChunkLabel = '' }
    Write-Host "  │  points: $TotalPoints ($NullNodes unmapped)  factual: $FactualCount  new_concepts: $UnmappedCount$ChunkLabel" -ForegroundColor Gray

    # -- Cross-POV fuzzy match on unmapped concepts ----------------------------
    if ($UnmappedCount -gt 0) {
        try {
            $Resolution = Resolve-UnmappedConcepts -UnmappedConcepts @($SummaryObject.unmapped_concepts)
            if (@($Resolution.Resolved).Count -gt 0) {
                foreach ($R in @($Resolution.Resolved)) {
                    Write-Host "  │  ✔ Resolved: '$($R.ConceptLabel)' → $($R.MatchedNodeId) (score $($R.Score))" -ForegroundColor Green
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
            Write-Host "  │  ⚠ Unmapped concept resolution failed: $($_.Exception.Message)" -ForegroundColor Yellow
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

    if ($ChunkCount -gt 0) { $TaxFilter = 'rag_per_chunk' } elseif ($IsRagFiltered) { $TaxFilter = 'rag' } else { $TaxFilter = 'full' }

    $UsedFire = $null -ne $FireStats
    if ($UsedFire) { $ExtractionMode = 'fire' } else { $ExtractionMode = 'single_shot' }
    $ModelInfo = [ordered]@{
        model             = $Model
        temperature       = $Temperature
        max_tokens        = 32768
        extraction_mode   = $ExtractionMode
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

    if ($SoProps['pov_summaries']) { $PovSummariesVal = $SummaryObject.pov_summaries } else { $PovSummariesVal = [ordered]@{} }
    # -- Build context-rot metrics from stages collected during processing ----
    $ContextRotStages = @($script:ContextRotStages)
    $ContextRotObj = if ($ContextRotStages.Count -gt 0) {
        New-ContextRotMetrics -Pipeline 'summary' -DocId $ThisDocId -Stages $ContextRotStages
    } else { $null }

    $FinalSummary = [ordered]@{
        doc_id            = $ThisDocId
        taxonomy_version  = $TaxonomyVersion
        generated_at      = $Now
        model_info        = $ModelInfo
        context_rot       = $ContextRotObj
        pov_summaries     = $PovSummariesVal
        factual_claims    = @($FactualClaims)
        unmapped_concepts = @($UnmappedConcs)
    }
    $AllWarnings = [System.Collections.Generic.List[string]]::new()
    foreach ($e in $SchemaErrors)       { $AllWarnings.Add("Schema: $e") }
    foreach ($n in $InvalidNodeIds)     { $AllWarnings.Add("Hallucinated node ID: $n") }
    foreach ($w in $CrossCampWarnings)  { $AllWarnings.Add($w) }
    if ($AllWarnings.Count -gt 0) {
        $FinalSummary['warnings'] = @($AllWarnings)
    }

    $SummaryPath = Join-Path $SummariesDir "${ThisDocId}.json"
    try {
        Write-Utf8NoBom -Path $SummaryPath -Value ($FinalSummary | ConvertTo-Json -Depth 20) 
    }
    catch {
        Write-Host "  └─ ✗ Failed to write summary: $($_.Exception.Message)" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = "Failed to write summary file: $($_.Exception.Message)" }
    }

    # -- Update metadata.json -------------------------------------------------
    try {
        $MetaRaw     = Get-Content $Doc.MetaFile -Raw
        $MetaUpdated = $MetaRaw | ConvertFrom-Json -AsHashtable
        $MetaUpdated['summary_version'] = $TaxonomyVersion
        $MetaUpdated['summary_status']  = 'current'
        $MetaUpdated['summary_updated'] = $Now

        # Summary statistics for Source objects
        $nodeRefsByPov = @{ accelerationist = 0; safetyist = 0; skeptic = 0; situations = 0 }
        $primaryPovDist = @{ accelerationist = 0; safetyist = 0; skeptic = 0; situations = 0 }
        foreach ($claim in @($FactualClaims)) {
            if (-not $claim.PSObject.Properties['linked_taxonomy_nodes']) { continue }
            $PrimaryAssigned = $false
            foreach ($nodeId in @($claim.linked_taxonomy_nodes)) {
                if ($null -eq $nodeId) { continue }
                if     ($nodeId -like 'acc-*') { $nodeRefsByPov['accelerationist']++; if (-not $PrimaryAssigned) { $primaryPovDist['accelerationist']++; $PrimaryAssigned = $true } }
                elseif ($nodeId -like 'saf-*') { $nodeRefsByPov['safetyist']++;       if (-not $PrimaryAssigned) { $primaryPovDist['safetyist']++;       $PrimaryAssigned = $true } }
                elseif ($nodeId -like 'skp-*') { $nodeRefsByPov['skeptic']++;         if (-not $PrimaryAssigned) { $primaryPovDist['skeptic']++;         $PrimaryAssigned = $true } }
                elseif ($nodeId -like 'sit-*') { $nodeRefsByPov['situations']++;      if (-not $PrimaryAssigned) { $primaryPovDist['situations']++;      $PrimaryAssigned = $true } }
            }
        }
        $MetaUpdated['total_claims']              = $FactualCount
        $MetaUpdated['node_references_by_pov']    = $nodeRefsByPov
        $MetaUpdated['primary_pov_distribution']  = $primaryPovDist
        $MetaUpdated.Remove('claims_by_pov')
        $MetaUpdated['total_facts']       = $TotalPoints
        $MetaUpdated['unmapped_concepts'] = $UnmappedCount
        if ($ContextRotObj) {
            $WorstStage = $ContextRotStages | Sort-Object { $_.ratio } | Select-Object -First 1
            $MetaUpdated['context_rot'] = [ordered]@{
                cumulative_retention = $ContextRotObj.cumulative_retention
                worst_stage          = $WorstStage.stage
                worst_ratio          = $WorstStage.ratio
            }
        }

        Write-Utf8NoBom -Path $Doc.MetaFile -Value ($MetaUpdated | ConvertTo-Json -Depth 10) 
    }
    catch {
        Write-Host "  │  ⚠ Summary written but metadata update failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    Write-Host "  └─ ✓ Done: summaries/$ThisDocId.json" -ForegroundColor Green

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
