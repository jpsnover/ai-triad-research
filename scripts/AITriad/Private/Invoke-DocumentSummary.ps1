# Per-document Gemini summarization worker.
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

    # -- Call Gemini API ------------------------------------------------------
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
    $RetryDelays   = @(5, 15, 45)
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
                Write-Host "  `u{2502}  `u{26A0} Rate limited (429). Retrying in ${Delay}s... (attempt $($Attempt+1)/$MaxRetries)" -ForegroundColor Yellow
                Start-Sleep -Seconds $Delay
            } elseif ($StatusCode -eq 503 -and $Attempt -lt ($MaxRetries - 1)) {
                $Delay = $RetryDelays[$Attempt]
                Write-Host "  `u{2502}  `u{26A0} Service unavailable (503). Retrying in ${Delay}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $Delay
            } else {
                break
            }
        }
    }

    if ($null -ne $LastError -or $null -eq $Response) {
        $StatusCode = if ($LastError) { $LastError.Exception.Response.StatusCode.value__ } else { '?' }
        Write-Host "  `u{2514}`u{2500} `u{2717} FAILED (HTTP $StatusCode): $ThisDocId" -ForegroundColor Red

        $ErrMsg = switch ($StatusCode) {
            400 { "Bad request `u{2014} prompt may be malformed or exceed token limits" }
            401 { "Invalid API key `u{2014} check AI_API_KEY" }
            403 { "Forbidden `u{2014} ensure Gemini API is enabled in your Google Cloud project" }
            429 { "Rate limit exceeded after $MaxRetries retries" }
            500 { "Gemini internal server error" }
            503 { "Gemini service unavailable after $MaxRetries retries" }
            default { "HTTP $StatusCode" }
        }
        Write-Host "     $ErrMsg" -ForegroundColor DarkRed

        return @{ Success = $false; DocId = $ThisDocId; Error = $ErrMsg }
    }

    $Elapsed = (Get-Date) - $StartTime
    Write-Host "  `u{2502}  `u{2713} Response: $([int]$Elapsed.TotalSeconds)s" -ForegroundColor Green

    # -- Parse and validate JSON ----------------------------------------------
    $RawText    = $Response.candidates[0].content.parts[0].text
    $CleanText  = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanText  = $CleanText.Trim()

    try {
        $SummaryObject = $CleanText | ConvertFrom-Json -Depth 20
    } catch {
        $DebugPath = Join-Path $SummariesDir "${ThisDocId}.debug-raw.txt"
        Set-Content -Path $DebugPath -Value $RawText -Encoding UTF8
        Write-Host "  `u{2514}`u{2500} `u{2717} Invalid JSON from Gemini. Raw saved: $DebugPath" -ForegroundColor Red
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
