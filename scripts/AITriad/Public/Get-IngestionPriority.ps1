# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-IngestionPriority {
    <#
    .SYNOPSIS
        Identifies and ranks research gaps to guide source ingestion priorities.
    .DESCRIPTION
        Scores taxonomy gaps by type (orphan nodes, one-sided conflicts, echo chambers,
        coverage imbalance, etc.) and ranks them to suggest which sources should be
        ingested next. Optionally calls an LLM to generate search queries per gap.
    .PARAMETER TopN
        Number of top gaps to return (1-50, default 10).
    .PARAMETER POV
        Filter to a single POV or 'all' (default).
    .PARAMETER OutputFile
        Optional path to write results as JSON.
    .PARAMETER NoAI
        Skip LLM-generated search queries; return raw ranked gaps only.
    .PARAMETER Model
        AI model override.
    .PARAMETER ApiKey
        AI API key override.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Get-IngestionPriority -NoAI
    .EXAMPLE
        Get-IngestionPriority -TopN 5 -OutputFile priority.json
    #>
    [CmdletBinding()]
    param(
        [ValidateRange(1, 50)]
        [int]$TopN = 10,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'all')]
        [string]$POV = 'all',

        [string]$OutputFile,

        [switch]$NoAI,

        [string]$Model,

        [string]$ApiKey,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $Model) {
        $Model = if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.1-flash-lite-preview' }
    }

    # ── Step 1: Gather health data ────────────────────────────────────────────
    Write-Step 'Computing taxonomy health data with graph metrics'
    $Health = Get-TaxonomyHealthData -RepoRoot $RepoRoot -GraphMode

    # Build node label lookup
    $NodeLabelMap = @{}
    $NodePovMap   = @{}
    foreach ($NC in $Health.NodeCitations) {
        $NodeLabelMap[$NC.Id] = $NC.Label
        $NodePovMap[$NC.Id]   = $NC.POV
    }

    Write-OK "Scanned $($Health.SummaryCount) summaries, $($Health.NodeCitations.Count) nodes"

    # ── Step 2: Score gaps ────────────────────────────────────────────────────
    Write-Step 'Scoring research gaps'
    $Gaps = [System.Collections.Generic.List[PSObject]]::new()
    $GapCounter = 0

    # --- Orphan nodes (score 10) ---
    foreach ($Orphan in $Health.OrphanNodes) {
        if ($Orphan.POV -eq 'situations') { continue }
        if ($POV -ne 'all' -and $Orphan.POV -ne $POV) { continue }
        $GapCounter++
        $Gaps.Add([PSCustomObject][ordered]@{
            gap_id      = "gap-$GapCounter"
            type        = 'orphan_node'
            score       = 10
            pov         = $Orphan.POV
            node_id     = $Orphan.Id
            label       = $Orphan.Label
            description = "Node [$($Orphan.Id)] '$($Orphan.Label)' has zero citations across all summaries."
        })
    }

    # --- One-sided conflicts (score 8) ---
    $ConflictDir = Get-ConflictsDir
    if (Test-Path $ConflictDir) {
        foreach ($File in Get-ChildItem -Path $ConflictDir -Filter '*.json' -File) {
            try {
                $Conflict = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json -Depth 20
            }
            catch { continue }

            $Instances = @($Conflict.instances)
            if ($Instances.Count -lt 2) { continue }

            $Stances = @($Instances | ForEach-Object { $_.stance } | Select-Object -Unique)
            if ($Stances.Count -eq 1) {
                $GapCounter++
                $Gaps.Add([PSCustomObject][ordered]@{
                    gap_id      = "gap-$GapCounter"
                    type        = 'one_sided_conflict'
                    score       = 8
                    pov         = 'all'
                    node_id     = $Conflict.claim_id
                    label       = $Conflict.claim_label
                    description = "Conflict '$($Conflict.claim_label)' has $($Instances.Count) instances all with stance '$($Stances[0])' — missing opposing viewpoint."
                })
            }
        }
    }

    # --- High-frequency unmapped concepts (score 7) ---
    foreach ($UC in $Health.StrongCandidates) {
        $GapCounter++
        $Gaps.Add([PSCustomObject][ordered]@{
            gap_id      = "gap-$GapCounter"
            type        = 'unmapped_concept'
            score       = 7
            pov         = if ($UC.SuggestedPov) { $UC.SuggestedPov } else { 'unknown' }
            node_id     = $null
            label       = $UC.Concept
            description = "Concept '$($UC.Concept)' appeared $($UC.Frequency) times across $($UC.ContributingDocs.Count) docs but is not mapped to any taxonomy node."
        })
    }

    # --- Echo chamber nodes (score 6) ---
    if ($Health.GraphHealth -and $Health.GraphHealth.EchoChamberNodes) {
        foreach ($ECId in $Health.GraphHealth.EchoChamberNodes) {
            $ECPov = $NodePovMap[$ECId]
            if ($POV -ne 'all' -and $ECPov -ne $POV) { continue }
            $GapCounter++
            $Gaps.Add([PSCustomObject][ordered]@{
                gap_id      = "gap-$GapCounter"
                type        = 'echo_chamber_node'
                score       = 6
                pov         = $ECPov
                node_id     = $ECId
                label       = if ($NodeLabelMap.ContainsKey($ECId)) { $NodeLabelMap[$ECId] } else { $ECId }
                description = "Node [$ECId] has many SUPPORTS edges but zero cross-POV CONTRADICTS — needs challenging sources."
            })
        }
    }

    # --- Coverage imbalance (score 5) ---
    $Categories = @('Beliefs', 'Desires', 'Intentions')
    foreach ($Cat in $Categories) {
        $Counts = @(@('accelerationist', 'safetyist', 'skeptic') | ForEach-Object { $Health.CoverageBalance[$_][$Cat] })
        $Min = ($Counts | Measure-Object -Minimum).Minimum
        $Max = ($Counts | Measure-Object -Maximum).Maximum
        if ($Min -gt 0 -and $Max / $Min -gt 2) {
            $WeakPov = @('accelerationist', 'safetyist', 'skeptic') |
                Where-Object { $Health.CoverageBalance[$_][$Cat] -eq $Min } |
                Select-Object -First 1
            if ($POV -ne 'all' -and $WeakPov -ne $POV) { continue }
            $GapCounter++
            $Gaps.Add([PSCustomObject][ordered]@{
                gap_id      = "gap-$GapCounter"
                type        = 'coverage_imbalance'
                score       = 5
                pov         = $WeakPov
                node_id     = $null
                label       = "$Cat coverage gap ($WeakPov)"
                description = "$WeakPov has only $Min nodes in $Cat vs max $Max — $([Math]::Round($Max/$Min, 1))x imbalance."
            })
        }
    }

    # --- Single-POV citations (score 4) ---
    foreach ($NC in $Health.NodeCitations) {
        if ($NC.POV -eq 'situations') { continue }
        if ($NC.Citations -eq 0) { continue }
        if ($POV -ne 'all' -and $NC.POV -ne $POV) { continue }

        # Check if this node is only cited from docs tagged with a single POV
        $SourcesDir = Get-SourcesDir
        $DocPovs = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($DId in $NC.DocIds) {
            $MetaPath = Join-Path $SourcesDir $DId 'metadata.json'
            if (Test-Path $MetaPath) {
                try {
                    $Meta = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json -Depth 20
                    if ($Meta.pov_tags) {
                        foreach ($PT in $Meta.pov_tags) { [void]$DocPovs.Add($PT) }
                    }
                }
                catch { }
            }
        }
        if ($DocPovs.Count -eq 1) {
            $GapCounter++
            $Gaps.Add([PSCustomObject][ordered]@{
                gap_id      = "gap-$GapCounter"
                type        = 'single_pov_citations'
                score       = 4
                pov         = $NC.POV
                node_id     = $NC.Id
                label       = $NC.Label
                description = "Node [$($NC.Id)] '$($NC.Label)' is only cited by docs tagged as '$($DocPovs | Select-Object -First 1)' — needs diverse sources."
            })
        }
    }

    # Sort by score descending, take TopN
    $RankedGaps = @($Gaps | Sort-Object { $_.score } -Descending | Select-Object -First $TopN)
    Write-OK "Found $($Gaps.Count) total gaps, showing top $($RankedGaps.Count)"

    # ── Step 3: Optional AI search query generation ───────────────────────────
    $AIRecommendations = $null
    if (-not $NoAI -and $RankedGaps.Count -gt 0) {
        Write-Step 'Generating search queries with AI'

        try {
            $Backend = if     ($Model -match '^gemini') { 'gemini' }
                       elseif ($Model -match '^claude') { 'claude' }
                       elseif ($Model -match '^groq')   { 'groq'   }
                       else                             { 'gemini'  }

            $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
            if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
                Write-Warn "No API key found for $Backend — falling back to -NoAI mode"
                $NoAI = $true
            }
            else {
                $GapsText = ($RankedGaps | ForEach-Object {
                    "- $($_.gap_id) [score=$($_.score), type=$($_.type), pov=$($_.pov)]: $($_.description)"
                }) -join "`n"

                $PromptBody = Get-Prompt -Name 'ingestion-priority' -Replacements @{ GAPS = $GapsText }

                $AIResult = Invoke-AIApi `
                    -Prompt     $PromptBody `
                    -Model      $Model `
                    -ApiKey     $ResolvedKey `
                    -Temperature 0.2 `
                    -MaxTokens  4096 `
                    -JsonMode `
                    -TimeoutSec 120 `
                    -MaxRetries 3 `
                    -RetryDelays @(5, 15, 45)

                if ($AIResult -and $AIResult.Text) {
                    $ResponseText = $AIResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
                    $AIRecommendations = ($ResponseText | ConvertFrom-Json -Depth 20).recommendations
                    Write-OK "AI generated $($AIRecommendations.Count) search recommendations ($($AIResult.Backend))"
                }
                else {
                    Write-Warn "AI returned no result"
                }
            }
        }
        catch {
            Write-Warn "AI query generation failed: $_"
        }
    }

    # ── Step 4: Build result ──────────────────────────────────────────────────
    $ResultGaps = @($RankedGaps | ForEach-Object {
        $Gap = $_
        $Entry = [ordered]@{
            gap_id      = $Gap.gap_id
            type        = $Gap.type
            score       = $Gap.score
            pov         = $Gap.pov
            node_id     = $Gap.node_id
            label       = $Gap.label
            description = $Gap.description
        }
        if ($AIRecommendations) {
            $Rec = $AIRecommendations | Where-Object { $_.gap_id -eq $Gap.gap_id } | Select-Object -First 1
            if ($Rec) {
                $Entry['search_query'] = $Rec.search_query
                $Entry['rationale']    = $Rec.rationale
            }
        }
        [PSCustomObject]$Entry
    })

    $Result = [ordered]@{
        generated_at = (Get-Date -Format 'o')
        total_gaps   = $Gaps.Count
        shown        = $ResultGaps.Count
        ai_enhanced  = ($null -ne $AIRecommendations)
        gaps         = $ResultGaps
    }

    # ── Step 5: Console output ────────────────────────────────────────────────
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  INGESTION PRIORITY — $($Gaps.Count) gaps found, top $($ResultGaps.Count) shown" -ForegroundColor White
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    foreach ($G in $ResultGaps) {
        $ScoreColor = if ($G.score -ge 8) { 'Red' } elseif ($G.score -ge 6) { 'Yellow' } else { 'Gray' }
        Write-Host "`n  [$($G.score.ToString().PadLeft(2))] $($G.type)" -ForegroundColor $ScoreColor -NoNewline
        Write-Host "  ($($G.pov))" -ForegroundColor DarkGray
        Write-Host "       $($G.label)" -ForegroundColor White
        Write-Host "       $($G.description)" -ForegroundColor DarkGray

        if ($G.PSObject.Properties['search_query'] -and $G.search_query) {
            Write-Host "       Search: $($G.search_query)" -ForegroundColor Cyan
        }
        if ($G.PSObject.Properties['rationale'] -and $G.rationale) {
            Write-Host "       Why: $($G.rationale)" -ForegroundColor Gray
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan

    # ── JSON export ───────────────────────────────────────────────────────────
    if ($OutputFile) {
        try {
            $Json = $Result | ConvertTo-Json -Depth 20
            Set-Content -Path $OutputFile -Value $Json -Encoding UTF8
            Write-OK "Exported to $OutputFile"
        }
        catch {
            Write-Warn "Failed to write $OutputFile — $($_.Exception.Message)"
        }
    }

    return $Result
}
