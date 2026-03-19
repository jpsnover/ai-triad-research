# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-TaxonomyProposal {
    <#
    .SYNOPSIS
        Uses AI to generate structured taxonomy improvement proposals based on health data.
    .DESCRIPTION
        Feeds taxonomy health metrics (orphan nodes, unmapped concepts, stance variance,
        coverage imbalances) to an AI model which returns structured NEW/SPLIT/MERGE/RELABEL
        proposals in JSON format.

        Proposals are written to taxonomy/proposals/proposal-{timestamp}.json.
    .PARAMETER Model
        AI model to use. Defaults to env default or 'gemini-3.1-flash-lite-preview'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.3 (slightly creative).
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .PARAMETER DryRun
        Build and display the prompt preview, but do NOT call the API or write files.
    .PARAMETER OutputFile
        Path for the proposal JSON. Defaults to taxonomy/proposals/proposal-{timestamp}.json.
    .PARAMETER HealthData
        Pre-computed health data hashtable from Get-TaxonomyHealth -PassThru.
        If omitted, health data is computed fresh.
    .EXAMPLE
        Invoke-TaxonomyProposal -DryRun
    .EXAMPLE
        Invoke-TaxonomyProposal -Model 'gemini-2.5-flash'
    .EXAMPLE
        $h = Get-TaxonomyHealth -PassThru
        Invoke-TaxonomyProposal -HealthData $h
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet(
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'claude-opus-4', 'claude-sonnet-4-5', 'claude-haiku-3.5',
            'groq-llama-3.3-70b', 'groq-llama-4-scout'
        )]
        [string]$Model       = 'gemini-3.1-flash-lite-preview',

        [string]$ApiKey      = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [string]$RepoRoot    = $script:RepoRoot,
        [switch]$DryRun,
        [string]$OutputFile  = '',
        [hashtable]$HealthData = $null
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── 1. Validate environment ────────────────────────────────────────────────
    Write-Step "Validating environment"

    if (-not (Test-Path $RepoRoot)) {
        Write-Fail "Repo root not found: $RepoRoot"
        throw "Repo root not found: $RepoRoot"
    }

    if (-not $DryRun) {
        $Backend = if     ($Model -match '^gemini') { 'gemini' }
                   elseif ($Model -match '^claude') { 'claude' }
                   elseif ($Model -match '^groq')   { 'groq'   }
                   else                             { 'gemini'  }
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

    Write-OK "Model       : $Model"
    Write-OK "Temperature : $Temperature"
    if ($DryRun) { Write-Warn "DRY RUN — no API call, no file writes" }

    # ── 2. Compute or accept health data ───────────────────────────────────────
    Write-Step "Preparing health data"

    if ($HealthData) {
        Write-OK "Using pre-computed health data ($($HealthData.SummaryCount) summaries)"
    } else {
        $HealthData = Get-TaxonomyHealthData -RepoRoot $RepoRoot
        Write-OK "Computed fresh health data ($($HealthData.SummaryCount) summaries)"
    }

    # ── 3. Build compact data representations ──────────────────────────────────
    Write-Step "Building prompt context"

    # Taxonomy nodes (compact: id, pov, category, label, description only)
    $CompactNodes = @()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $CompactNodes += @{
                id          = $Node.id
                pov         = $PovKey
                category    = if ($PovKey -eq 'cross-cutting') { 'Cross-Cutting' } else { $Node.category }
                label       = $Node.label
                description = $Node.description
            }
        }
    }
    $TaxonomyNodesJson = $CompactNodes | ConvertTo-Json -Depth 10 -Compress

    # Unmapped concepts (freq >= 2, or top 30)
    $UnmappedForPrompt = @($HealthData.UnmappedConcepts |
        Where-Object { $_.Frequency -ge 2 } |
        ForEach-Object {
            @{
                concept           = $_.Concept
                frequency         = $_.Frequency
                suggested_pov     = $_.SuggestedPov
                suggested_category = $_.SuggestedCategory
                contributing_docs = $_.ContributingDocs
                reasons           = $_.Reasons
            }
        })
    if ($UnmappedForPrompt.Count -eq 0) {
        $UnmappedForPrompt = @($HealthData.UnmappedConcepts | Select-Object -First 30 |
            ForEach-Object {
                @{
                    concept           = $_.Concept
                    frequency         = $_.Frequency
                    suggested_pov     = $_.SuggestedPov
                    suggested_category = $_.SuggestedCategory
                    contributing_docs = $_.ContributingDocs
                    reasons           = $_.Reasons
                }
            })
    }
    $UnmappedJson = $UnmappedForPrompt | ConvertTo-Json -Depth 10 -Compress

    # Citation stats: orphans, most-cited, high-variance
    $CitationStats = @{
        orphan_nodes = @($HealthData.OrphanNodes | ForEach-Object {
            @{ id = $_.Id; pov = $_.POV; category = $_.Category; label = $_.Label }
        })
        most_cited = @($HealthData.MostCited | ForEach-Object {
            @{ id = $_.Id; pov = $_.POV; label = $_.Label; citations = $_.Citations; doc_count = $_.DocIds.Count }
        })
        high_variance = @($HealthData.HighVarianceNodes | ForEach-Object {
            @{ id = $_.Id; pov = $_.POV; label = $_.Label; total_stances = $_.TotalStances; distribution = $_.Distribution }
        })
    }
    $CitationStatsJson = $CitationStats | ConvertTo-Json -Depth 10 -Compress

    # Coverage balance
    $CoverageBalanceJson = $HealthData.CoverageBalance | ConvertTo-Json -Depth 10 -Compress

    Write-OK "Compact nodes       : $($CompactNodes.Count)"
    Write-OK "Unmapped for prompt : $($UnmappedForPrompt.Count)"
    Write-OK "Orphan nodes        : $($CitationStats.orphan_nodes.Count)"
    Write-OK "High-variance nodes : $($CitationStats.high_variance.Count)"

    # ── 4. Load prompt template ────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'taxonomy-proposal' -Replacements @{
        TAXONOMY_VERSION = $HealthData.TaxonomyVersion
        SUMMARY_COUNT    = $HealthData.SummaryCount.ToString()
    }

    # ── 5. Assemble full prompt ────────────────────────────────────────────────
    $FullPrompt = @"
$SystemPrompt

=== HEALTH DATA ===

--- EXISTING TAXONOMY NODES ---
$TaxonomyNodesJson

--- UNMAPPED CONCEPTS (sorted by frequency) ---
$UnmappedJson

--- CITATION STATISTICS (orphans, most-cited, high-variance) ---
$CitationStatsJson

--- COVERAGE BALANCE (nodes per POV per category) ---
$CoverageBalanceJson
"@

    $PromptLength = $FullPrompt.Length
    $EstTokens    = [int]($PromptLength / 4)
    Write-OK "Prompt assembled: $PromptLength chars (~$EstTokens tokens est.)"

    # ── 6. DRY RUN — print and return ─────────────────────────────────────────
    if ($DryRun) {
        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN: PROMPT PREVIEW" -ForegroundColor Yellow
        Write-Host "$('─' * 72)" -ForegroundColor DarkGray

        Write-Host "`n[SYSTEM PROMPT — first 800 chars]" -ForegroundColor Cyan
        Write-Host $SystemPrompt.Substring(0, [Math]::Min(800, $SystemPrompt.Length)) -ForegroundColor Gray
        Write-Host "... (truncated for display)" -ForegroundColor DarkGray

        Write-Host "`n[TAXONOMY NODES — $($CompactNodes.Count) nodes, first 400 chars]" -ForegroundColor Cyan
        Write-Host $TaxonomyNodesJson.Substring(0, [Math]::Min(400, $TaxonomyNodesJson.Length)) -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[UNMAPPED CONCEPTS — $($UnmappedForPrompt.Count) entries]" -ForegroundColor Cyan
        $UnmappedPreview = $UnmappedJson.Substring(0, [Math]::Min(400, $UnmappedJson.Length))
        Write-Host $UnmappedPreview -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[CITATION STATISTICS]" -ForegroundColor Cyan
        Write-Host $CitationStatsJson.Substring(0, [Math]::Min(400, $CitationStatsJson.Length)) -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[COVERAGE BALANCE]" -ForegroundColor Cyan
        Write-Host $CoverageBalanceJson -ForegroundColor Gray

        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN complete. No API call made. No files written." -ForegroundColor Yellow
        Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
        return
    }

    # ── 7. Call Invoke-AIApi ───────────────────────────────────────────────────
    Write-Step "Calling AI API ($Model)"

    $StartTime = Get-Date
    Write-Info "Sending request..."

    $AiResult = Invoke-AIApi `
        -Prompt      $FullPrompt `
        -Model       $Model `
        -ApiKey      $ApiKey `
        -Temperature $Temperature `
        -MaxTokens   16384 `
        -JsonMode `
        -TimeoutSec  120

    if ($null -eq $AiResult) {
        throw "AI API call returned null"
    }

    $Elapsed = (Get-Date) - $StartTime
    Write-OK "Response received from $($AiResult.Backend) in $([int]$Elapsed.TotalSeconds)s"

    # ── 8. Parse and validate response ─────────────────────────────────────────
    Write-Step "Parsing AI response"

    $RawText     = $AiResult.Text
    $CleanedText = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanedText = $CleanedText.Trim()

    try {
        $ProposalObject = $CleanedText | ConvertFrom-Json -Depth 20
        Write-OK "Valid JSON received"
    }
    catch {
        Write-Warn "JSON parse failed — attempting repair"
        $Repaired = Repair-TruncatedJson -Text $RawText
        if ($Repaired) {
            try {
                $ProposalObject = $Repaired | ConvertFrom-Json -Depth 20
                Write-OK "JSON repaired successfully"
            }
            catch {
                $ProposalObject = $null
            }
        }
        if ($null -eq $ProposalObject) {
            $DebugPath = Join-Path $RepoRoot 'taxonomy' 'proposals' "proposal-debug-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
            $ProposalsDir = Join-Path $RepoRoot 'taxonomy' 'proposals'
            if (-not (Test-Path $ProposalsDir)) { New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null }
            Set-Content -Path $DebugPath -Value $RawText -Encoding UTF8
            Write-Fail "AI returned invalid JSON. Raw response saved: $DebugPath"
            throw "AI returned invalid JSON for taxonomy proposal"
        }
    }

    # Validate presence of proposals array
    if (-not $ProposalObject.proposals) {
        Write-Warn "Response missing 'proposals' array — may be empty or malformed"
        $ProposalObject | Add-Member -NotePropertyName 'proposals' -NotePropertyValue @() -ErrorAction SilentlyContinue
    }

    $ProposalCount = $ProposalObject.proposals.Count
    Write-OK "$ProposalCount proposal(s) generated"

    # ── 9. Write proposal file ─────────────────────────────────────────────────
    Write-Step "Writing proposal file"

    $ProposalsDir = Join-Path $RepoRoot 'taxonomy' 'proposals'
    if (-not (Test-Path $ProposalsDir)) {
        New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null
    }

    $Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (-not $OutputFile) {
        $OutputFile = Join-Path $ProposalsDir "proposal-$Timestamp.json"
    }

    # Enrich with metadata
    $FinalProposal = [ordered]@{
        generated_at     = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
        model            = $Model
        taxonomy_version = $HealthData.TaxonomyVersion
        summary_count    = $HealthData.SummaryCount
        proposals        = $ProposalObject.proposals
    }

    $ProposalJson = $FinalProposal | ConvertTo-Json -Depth 20
    try {
        Set-Content -Path $OutputFile -Value $ProposalJson -Encoding UTF8
        Write-OK "Proposal written to: $OutputFile"
    }
    catch {
        Write-Fail "Failed to write proposal file — $($_.Exception.Message)"
        Write-Info "Proposal data was generated but NOT saved. Check path and permissions."
        throw
    }

    # ── 10. Print human-readable summary ───────────────────────────────────────
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  TAXONOMY PROPOSALS" -ForegroundColor White
    Write-Host "  Model: $Model  |  Taxonomy v$($HealthData.TaxonomyVersion)  |  $ProposalCount proposal(s)" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    $ActionTypes = @('NEW', 'SPLIT', 'MERGE', 'RELABEL')
    foreach ($Action in $ActionTypes) {
        $Group = @($ProposalObject.proposals | Where-Object { $_.action -eq $Action })
        if ($Group.Count -eq 0) { continue }

        $ActionColor = switch ($Action) {
            'NEW'     { 'Green'   }
            'SPLIT'   { 'Cyan'    }
            'MERGE'   { 'Yellow'  }
            'RELABEL' { 'Magenta' }
        }

        Write-Host "`n  [$Action] ($($Group.Count))" -ForegroundColor $ActionColor

        foreach ($P in $Group) {
            $IdStr = if ($P.suggested_id) { "[$($P.suggested_id)]" } else { '' }
            $TargetStr = if ($P.target_node_id) { " (target: $($P.target_node_id))" } else { '' }
            Write-Host "    $IdStr $($P.label)$TargetStr" -ForegroundColor White
            Write-Host "      POV: $($P.pov)  |  Category: $($P.category)" -ForegroundColor Gray
            if ($P.rationale) {
                $RatSnippet = if ($P.rationale.Length -gt 120) {
                    $P.rationale.Substring(0, 120) + '...'
                } else { $P.rationale }
                Write-Host "      Rationale: $RatSnippet" -ForegroundColor DarkGray
            }
            if ($P.PSObject.Properties['children'] -and $P.children.Count -gt 0) {
                Write-Host "      Children:" -ForegroundColor Gray
                foreach ($Child in $P.children) {
                    Write-Host "        [$($Child.suggested_id)] $($Child.label)" -ForegroundColor Gray
                }
            }
            if ($P.PSObject.Properties['merge_node_ids'] -and $P.merge_node_ids.Count -gt 0) {
                Write-Host "      Merging: $($P.merge_node_ids -join ', ') → $($P.surviving_node_id)" -ForegroundColor Gray
            }
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Output: $OutputFile" -ForegroundColor Green
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
