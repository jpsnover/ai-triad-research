# Per-document AI summarization worker.
# Extracted from Invoke-BatchSummary.ps1 — called once per document.

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

    if ($EstimatedTokens -gt 100000) {
        Write-Host "  `u{2502}  `u{26A0} Very long document (~$EstimatedTokens tokens). May hit context limits." -ForegroundColor Yellow
    }

    # -- Build prompt ---------------------------------------------------------
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

    # -- Call AI API ----------------------------------------------------------
    $StartTime = Get-Date

    $AIResult = Invoke-AIApi `
        -Prompt     $FullPrompt `
        -Model      $Model `
        -ApiKey     $ApiKey `
        -Temperature $Temperature `
        -MaxTokens  16384 `
        -JsonMode `
        -TimeoutSec 120 `
        -MaxRetries 3 `
        -RetryDelays @(5, 15, 45)

    if ($null -eq $AIResult) {
        Write-Host "  `u{2514}`u{2500} `u{2717} FAILED: $ThisDocId" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = 'API call returned null' }
    }

    $Elapsed = (Get-Date) - $StartTime
    Write-Host "  `u{2502}  `u{2713} Response ($($AIResult.Backend)): $([int]$Elapsed.TotalSeconds)s" -ForegroundColor Green

    # -- Parse and validate JSON ----------------------------------------------
    $RawText    = $AIResult.Text
    $CleanText  = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanText  = $CleanText.Trim()

    try {
        $SummaryObject = $CleanText | ConvertFrom-Json -Depth 20
    } catch {
        $DebugPath = Join-Path $SummariesDir "${ThisDocId}.debug-raw.txt"
        Set-Content -Path $DebugPath -Value $RawText -Encoding UTF8
        Write-Host "  `u{2514}`u{2500} `u{2717} Invalid JSON from AI. Raw saved: $DebugPath" -ForegroundColor Red
        return @{ Success = $false; DocId = $ThisDocId; Error = 'InvalidJson' }
    }

    # Validate stance values and gather counts
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

    $FactualCount   = if ($SummaryObject.factual_claims)    { @($SummaryObject.factual_claims).Count }    else { 0 }
    $UnmappedCount  = if ($SummaryObject.unmapped_concepts) { @($SummaryObject.unmapped_concepts).Count } else { 0 }

    Write-Host "  `u{2502}  points: $TotalPoints ($NullNodes unmapped)  factual: $FactualCount  new_concepts: $UnmappedCount" -ForegroundColor Gray

    # -- Write summaries/<doc-id>.json ----------------------------------------
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

    # -- Update metadata.json -------------------------------------------------
    $MetaRaw     = Get-Content $Doc.MetaFile -Raw
    $MetaUpdated = $MetaRaw | ConvertFrom-Json -AsHashtable
    $MetaUpdated['summary_version'] = $TaxonomyVersion
    $MetaUpdated['summary_status']  = 'current'
    $MetaUpdated['summary_updated'] = $Now
    Set-Content -Path $Doc.MetaFile -Value ($MetaUpdated | ConvertTo-Json -Depth 10) -Encoding UTF8

    Write-Host "  `u{2514}`u{2500} `u{2713} Done: summaries/$ThisDocId.json" -ForegroundColor Green

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
