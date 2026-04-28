# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Compares two debate session JSON files side-by-side for A/B evaluation.
.DESCRIPTION
    Extracts key quality metrics from two debate sessions and produces a
    structured comparison. Designed for evaluating the impact of parameter
    changes (e.g., truncation limit, model, rounds) on debate quality.
.PARAMETER SessionA
    Path to the first debate session JSON file.
.PARAMETER SessionB
    Path to the second debate session JSON file.
.PARAMETER LabelA
    Display label for session A (default: 'A').
.PARAMETER LabelB
    Display label for session B (default: 'B').
.PARAMETER PassThru
    Return the comparison object instead of printing a table.
.EXAMPLE
    Compare-DebateRuns -SessionA debate-50k.json -SessionB debate-100k.json -LabelA '50K' -LabelB '100K'
#>
function Compare-DebateRuns {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateScript({ Test-Path $_ })][string]$SessionA,
        [Parameter(Mandatory)][ValidateScript({ Test-Path $_ })][string]$SessionB,
        [string]$LabelA = 'A',
        [string]$LabelB = 'B',
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest

    function Get-DebateMetrics([string]$Path) {
        $S = Get-Content $Path -Raw | ConvertFrom-Json

        $AnNodes = 0; $AnEdges = 0
        if ($S.argument_network) {
            if ($S.argument_network.nodes) { $AnNodes = @($S.argument_network.nodes).Count }
            if ($S.argument_network.edges) { $AnEdges = @($S.argument_network.edges).Count }
        }

        $ClaimCoverage = 0
        if ($S.claim_coverage) {
            $Total = @($S.claim_coverage).Count
            $Discussed = @($S.claim_coverage | Where-Object { $_.discussed }).Count
            if ($Total -gt 0) { $ClaimCoverage = [Math]::Round($Discussed / $Total * 100, 1) }
        }

        $AcceptRate = 0
        if ($S.extraction_summary) {
            $AcceptRate = [Math]::Round(($S.extraction_summary.acceptance_rate ?? 0) * 100, 1)
        }

        $UniqueNodes = 0
        $AllNodeIds = [System.Collections.Generic.HashSet[string]]::new()
        if ($S.transcript) {
            foreach ($Entry in $S.transcript) {
                if ($Entry.taxonomy_refs) {
                    foreach ($Ref in $Entry.taxonomy_refs) {
                        [void]$AllNodeIds.Add($Ref.node_id ?? $Ref)
                    }
                }
            }
            $UniqueNodes = $AllNodeIds.Count
        }

        $TaxUtilization = 0
        if ($S.taxonomy_gap_analysis -and $S.taxonomy_gap_analysis.pov_coverage) {
            $Rates = @()
            foreach ($Pov in @('accelerationist','safetyist','skeptic')) {
                $PovData = $S.taxonomy_gap_analysis.pov_coverage.$Pov
                if ($PovData -and $PovData.PSObject.Properties['utilization_rate']) {
                    $Rates += $PovData.utilization_rate
                }
            }
            if ($Rates.Count -gt 0) { $TaxUtilization = [Math]::Round(($Rates | Measure-Object -Average).Average * 100, 1) }
        }

        $NeutralScore = 0
        if ($S.neutral_evaluations -and @($S.neutral_evaluations).Count -gt 0) {
            $Last = @($S.neutral_evaluations)[-1]
            if ($Last.overall_score) { $NeutralScore = [Math]::Round($Last.overall_score, 2) }
        }

        $TotalAiTime = 0
        if ($S.diagnostics -and $S.diagnostics.overview) {
            $TotalAiTime = [Math]::Round(($S.diagnostics.overview.total_response_time_ms ?? 0) / 1000, 1)
        }

        $CharsTruncated = 0; $SectionsLost = 0
        if ($S.context_rot -and $S.context_rot.stages) {
            $TruncStage = @($S.context_rot.stages | Where-Object { $_.stage -eq 'document_truncation' }) | Select-Object -First 1
            if ($TruncStage -and $TruncStage.flags) {
                $CharsTruncated = $TruncStage.flags.chars_truncated ?? 0
                $SectionsLost = $TruncStage.flags.sections_lost ?? 0
            }
        }

        $Retention = 0
        if ($S.context_rot) { $Retention = $S.context_rot.cumulative_retention ?? 0 }

        return [ordered]@{
            an_nodes         = $AnNodes
            an_edges         = $AnEdges
            claim_coverage   = $ClaimCoverage
            accept_rate      = $AcceptRate
            unique_nodes     = $UniqueNodes
            tax_utilization  = $TaxUtilization
            neutral_score    = $NeutralScore
            total_ai_time_s  = $TotalAiTime
            chars_truncated  = $CharsTruncated
            sections_lost    = $SectionsLost
            cumulative_retention = $Retention
        }
    }

    $MetricsA = Get-DebateMetrics $SessionA
    $MetricsB = Get-DebateMetrics $SessionB

    $Comparison = [ordered]@{
        label_a  = $LabelA
        label_b  = $LabelB
        file_a   = $SessionA
        file_b   = $SessionB
        metrics  = [ordered]@{}
    }

    foreach ($Key in $MetricsA.Keys) {
        $VA = $MetricsA[$Key]
        $VB = $MetricsB[$Key]
        $Delta = $VB - $VA
        $Comparison.metrics[$Key] = [ordered]@{ a = $VA; b = $VB; delta = $Delta }
    }

    if ($PassThru) { return $Comparison }

    # Pretty-print table
    $Labels = @{
        an_nodes         = 'AN nodes'
        an_edges         = 'AN edges'
        claim_coverage   = 'Claim coverage %'
        accept_rate      = 'Extraction accept %'
        unique_nodes     = 'Unique taxonomy nodes'
        tax_utilization  = 'Taxonomy utilization %'
        neutral_score    = 'Neutral eval score'
        total_ai_time_s  = 'Total AI time (s)'
        chars_truncated  = 'Chars truncated'
        sections_lost    = 'Sections lost'
        cumulative_retention = 'Context retention'
    }

    $Header = "  A/B COMPARISON: $LabelA vs $LabelB"
    $Sep = '  ' + ('-' * 55)
    Write-Host "`n$Header" -ForegroundColor White
    Write-Host $Sep -ForegroundColor Gray
    Write-Host ('  {0,-25} {1,8} {2,8} {3,8}' -f 'Metric', $LabelA, $LabelB, 'Delta') -ForegroundColor Cyan

    foreach ($Key in $MetricsA.Keys) {
        $VA = $MetricsA[$Key]
        $VB = $MetricsB[$Key]
        $Delta = $VB - $VA
        $DeltaStr = if ($Delta -gt 0) { "+$Delta" } elseif ($Delta -eq 0) { '=' } else { "$Delta" }
        $Color = if ($Key -eq 'total_ai_time_s' -or $Key -eq 'chars_truncated' -or $Key -eq 'sections_lost') {
            if ($Delta -le 0) { 'Green' } elseif ($Delta -gt 0) { 'Yellow' } else { 'Gray' }
        } else {
            if ($Delta -gt 0) { 'Green' } elseif ($Delta -lt 0) { 'Yellow' } else { 'Gray' }
        }
        Write-Host ('  {0,-25} {1,8} {2,8} ' -f ($Labels[$Key] ?? $Key), $VA, $VB) -ForegroundColor Gray -NoNewline
        Write-Host ('{0,8}' -f $DeltaStr) -ForegroundColor $Color
    }
    Write-Host $Sep -ForegroundColor Gray
}
