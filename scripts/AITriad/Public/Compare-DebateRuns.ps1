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
        if ($S.PSObject.Properties['argument_network'] -and $S.argument_network) {
            if ($S.argument_network.PSObject.Properties['nodes'] -and $S.argument_network.nodes) { $AnNodes = @($S.argument_network.nodes).Count }
            if ($S.argument_network.PSObject.Properties['edges'] -and $S.argument_network.edges) { $AnEdges = @($S.argument_network.edges).Count }
        }

        $ClaimCoverage = 0
        if ($S.PSObject.Properties['claim_coverage'] -and $S.claim_coverage) {
            $Total = @($S.claim_coverage).Count
            $Discussed = @($S.claim_coverage | Where-Object { $_.PSObject.Properties['discussed'] -and $_.discussed }).Count
            if ($Total -gt 0) { $ClaimCoverage = [Math]::Round($Discussed / $Total * 100, 1) }
        }

        $AcceptRate = 0
        if ($S.PSObject.Properties['extraction_summary'] -and $S.extraction_summary) {
            $AcceptRate = [Math]::Round(($S.extraction_summary.acceptance_rate ?? 0) * 100, 1)
        }

        $UniqueNodes = 0
        $AllNodeIds = [System.Collections.Generic.HashSet[string]]::new()
        if ($S.PSObject.Properties['transcript'] -and $S.transcript) {
            foreach ($Entry in $S.transcript) {
                if ($null -eq $Entry) { continue }
                if ($Entry.PSObject.Properties['taxonomy_refs'] -and $Entry.taxonomy_refs) {
                    foreach ($Ref in $Entry.taxonomy_refs) {
                        if ($null -eq $Ref) { continue }
                        [void]$AllNodeIds.Add($Ref.node_id ?? $Ref)
                    }
                }
            }
            $UniqueNodes = $AllNodeIds.Count
        }

        $TaxUtilization = 0
        if ($S.PSObject.Properties['taxonomy_gap_analysis'] -and $S.taxonomy_gap_analysis -and
            $S.taxonomy_gap_analysis.PSObject.Properties['pov_coverage'] -and $S.taxonomy_gap_analysis.pov_coverage) {
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
        if ($S.PSObject.Properties['neutral_evaluations'] -and $S.neutral_evaluations -and @($S.neutral_evaluations).Count -gt 0) {
            $Last = @($S.neutral_evaluations)[-1]
            if ($null -ne $Last -and $Last.PSObject.Properties['overall_score'] -and $Last.overall_score) {
                $NeutralScore = [Math]::Round($Last.overall_score, 2)
            }
        }

        $TotalAiTime = 0
        if ($S.PSObject.Properties['diagnostics'] -and $S.diagnostics -and
            $S.diagnostics.PSObject.Properties['overview'] -and $S.diagnostics.overview) {
            $TotalAiTime = [Math]::Round(($S.diagnostics.overview.total_response_time_ms ?? 0) / 1000, 1)
        }

        $CharsTruncated = 0; $SectionsLost = 0
        if ($S.PSObject.Properties['context_rot'] -and $S.context_rot -and
            $S.context_rot.PSObject.Properties['stages'] -and $S.context_rot.stages) {
            $TruncStage = @($S.context_rot.stages | Where-Object { $_.PSObject.Properties['stage'] -and $_.stage -eq 'document_truncation' }) | Select-Object -First 1
            if ($TruncStage -and $TruncStage.PSObject.Properties['flags'] -and $TruncStage.flags) {
                $CharsTruncated = $TruncStage.flags.chars_truncated ?? 0
                $SectionsLost = $TruncStage.flags.sections_lost ?? 0
            }
        }

        $Retention = 0
        if ($S.PSObject.Properties['context_rot'] -and $S.context_rot) { $Retention = $S.context_rot.cumulative_retention ?? 0 }

        # ── Calibration log metrics ──
        $CruxAddressed = 0; $RepetitionRate2 = 0; $ClaimsForgotten = 0
        $ProcessRewardMean = 0; $ConcessionCascades = 0; $SitCruxAlignment = 0
        $AgentCompositeAvg = 0; $SynthesisFields = 0

        if ($S.PSObject.Properties['calibration_log'] -and $S.calibration_log) {
            $CL = $S.calibration_log
            if ($CL.PSObject.Properties['crux_addressed_ratio'])     { $CruxAddressed     = [Math]::Round(($CL.crux_addressed_ratio ?? 0) * 100, 1) }
            if ($CL.PSObject.Properties['repetition_rate'])          { $RepetitionRate2    = [Math]::Round(($CL.repetition_rate ?? 0) * 100, 1) }
            if ($CL.PSObject.Properties['claims_forgotten_rate'])    { $ClaimsForgotten    = [Math]::Round(($CL.claims_forgotten_rate ?? 0) * 100, 1) }
            if ($CL.PSObject.Properties['process_reward_mean'])      { $ProcessRewardMean  = [Math]::Round($CL.process_reward_mean ?? 0, 3) }
            if ($CL.PSObject.Properties['concession_cascades'])      { $ConcessionCascades = $CL.concession_cascades ?? 0 }
            if ($CL.PSObject.Properties['situation_crux_alignment']) { $SitCruxAlignment   = [Math]::Round(($CL.situation_crux_alignment ?? 0) * 100, 1) }

            if ($CL.PSObject.Properties['agent_utilities'] -and $CL.agent_utilities) {
                $Composites = [System.Collections.Generic.List[double]]::new()
                foreach ($Prop in $CL.agent_utilities.PSObject.Properties) {
                    if ($null -ne $Prop.Value -and $Prop.Value.PSObject.Properties['composite']) {
                        $Composites.Add([double]$Prop.Value.composite)
                    }
                }
                if ($Composites.Count -gt 0) {
                    $AgentCompositeAvg = [Math]::Round(($Composites | Measure-Object -Average).Average, 3)
                }
            }
        }

        # Synthesis completeness: count non-empty arrays in concluding entry
        $ConcludingEntry = @($S.transcript | Where-Object { $_.PSObject.Properties['type'] -and $_.type -eq 'concluding' }) | Select-Object -First 1
        if ($null -ne $ConcludingEntry -and $ConcludingEntry.PSObject.Properties['metadata'] -and
            $ConcludingEntry.metadata.PSObject.Properties['synthesis'] -and $ConcludingEntry.metadata.synthesis) {
            $Syn = $ConcludingEntry.metadata.synthesis
            $ExpectedKeys = @('areas_of_agreement','areas_of_disagreement','cruxes','unresolved_questions',
                              'taxonomy_coverage','argument_map','preferences','policy_implications')
            foreach ($K in $ExpectedKeys) {
                if ($Syn.PSObject.Properties[$K] -and $Syn.$K -and @($Syn.$K).Count -gt 0) {
                    $SynthesisFields++
                }
            }
        }

        return [ordered]@{
            an_nodes             = $AnNodes
            an_edges             = $AnEdges
            claim_coverage       = $ClaimCoverage
            accept_rate          = $AcceptRate
            unique_nodes         = $UniqueNodes
            tax_utilization      = $TaxUtilization
            neutral_score        = $NeutralScore
            total_ai_time_s      = $TotalAiTime
            chars_truncated      = $CharsTruncated
            sections_lost        = $SectionsLost
            cumulative_retention = $Retention
            crux_addressed       = $CruxAddressed
            repetition_rate      = $RepetitionRate2
            claims_forgotten     = $ClaimsForgotten
            process_reward_mean  = $ProcessRewardMean
            concession_cascades  = $ConcessionCascades
            sit_crux_alignment   = $SitCruxAlignment
            synthesis_fields     = $SynthesisFields
            agent_composite_avg  = $AgentCompositeAvg
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
        an_nodes             = 'AN nodes'
        an_edges             = 'AN edges'
        claim_coverage       = 'Claim coverage %'
        accept_rate          = 'Extraction accept %'
        unique_nodes         = 'Unique taxonomy nodes'
        tax_utilization      = 'Taxonomy utilization %'
        neutral_score        = 'Neutral eval score'
        total_ai_time_s      = 'Total AI time (s)'
        chars_truncated      = 'Chars truncated'
        sections_lost        = 'Sections lost'
        cumulative_retention = 'Context retention'
        crux_addressed       = 'Crux addressed %'
        repetition_rate      = 'Repetition rate %'
        claims_forgotten     = 'Claims forgotten %'
        process_reward_mean  = 'Process reward'
        concession_cascades  = 'Concession cascades'
        sit_crux_alignment   = 'Sit-crux alignment %'
        synthesis_fields     = 'Synthesis fields (/8)'
        agent_composite_avg  = 'Avg agent composite'
    }

    $Header = "  A/B COMPARISON: $LabelA vs $LabelB"
    $Sep = '  ' + ('-' * 55)
    Write-Host "`n$Header" -ForegroundColor White
    Write-Host $Sep -ForegroundColor Gray
    Write-Host ('  {0,-25} {1,8} {2,8} {3,8}' -f 'Metric', $LabelA, $LabelB, 'Delta') -ForegroundColor Cyan

    foreach ($Key in $MetricsA.Keys) {
        $VA = $MetricsA[$Key]
        $VB = $MetricsB[$Key]
        $Delta = [Math]::Round($VB - $VA, 3)
        $DeltaStr = if ($Delta -gt 0) { "+$Delta" } elseif ($Delta -eq 0) { '=' } else { "$Delta" }
        $Color = if ($Key -in @('total_ai_time_s','chars_truncated','sections_lost','repetition_rate','claims_forgotten','concession_cascades')) {
            if ($Delta -le 0) { 'Green' } elseif ($Delta -gt 0) { 'Yellow' } else { 'Gray' }
        } else {
            if ($Delta -gt 0) { 'Green' } elseif ($Delta -lt 0) { 'Yellow' } else { 'Gray' }
        }
        Write-Host ('  {0,-25} {1,8} {2,8} ' -f ($Labels[$Key] ?? $Key), $VA, $VB) -ForegroundColor Gray -NoNewline
        Write-Host ('{0,8}' -f $DeltaStr) -ForegroundColor $Color
    }
    Write-Host $Sep -ForegroundColor Gray
}
