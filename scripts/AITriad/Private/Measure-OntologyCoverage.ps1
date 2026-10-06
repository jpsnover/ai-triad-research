# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-OntologyCoverage {
    <#
    .SYNOPSIS
        Metric 8 of Measure-TaxonomyBaseline (t/3910 decomposition; no behavior
        change): assembles the ontology_coverage report section from the three
        focused coverage scans (node attributes, claim temporal scope, debates).
    .PARAMETER AllNodes
        Node id -> node lookup.
    .PARAMETER Summaries
        Doc id -> summary lookup.
    .PARAMETER DebatesDir
        Directory of debate JSON files.
    .PARAMETER FallacyTotal
        Total fallacy-flag count (from Measure-FallacyFlagging's total_flags) --
        the denominator for fallacy_tier_coverage_pct.
    .PARAMETER GenusDifferentiaPct
        From Measure-DescriptionQuality's genus_differentia_pct -- ontology_coverage
        republishes this value verbatim, same as the original.
    .OUTPUTS
        [PSCustomObject] { Metrics (the ordered report section); ClaimsTotal (not
        persisted in the report -- the caller's console writer needs the raw
        denominator for the temporal_scope line that total_claims alone doesn't
        carry in _counts) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$AllNodes,

        [Parameter(Mandatory)]
        [hashtable]$Summaries,

        [Parameter(Mandatory)]
        [string]$DebatesDir,

        [Parameter(Mandatory)]
        [int]$FallacyTotal,

        [Parameter(Mandatory)]
        [double]$GenusDifferentiaPct
    )

    Set-StrictMode -Version Latest

    $NodeAttrs = Measure-NodeAttributeCoverage -AllNodes $AllNodes
    $Temporal = Measure-ClaimTemporalCoverage -Summaries $Summaries
    $Debates = Measure-DebateCoverage -DebatesDir $DebatesDir

    $Metrics = [ordered]@{
        node_scope_coverage_pct          = [Math]::Round($NodeAttrs.NodeScopeCount / [Math]::Max(1, $AllNodes.Count) * 100, 1)
        genus_differentia_pct            = $GenusDifferentiaPct
        bdi_layer_coverage_pct           = if ($Debates.TotalDisagreements -gt 0) { [Math]::Round($Debates.DisagreementsWithBdi / $Debates.TotalDisagreements * 100, 1) } else { 0 }
        argument_map_coverage_pct        = if ($Debates.TotalDebates -gt 0) { [Math]::Round($Debates.DebatesWithArgMap / $Debates.TotalDebates * 100, 1) } else { 0 }
        parent_relationship_coverage_pct = [Math]::Round($NodeAttrs.ParentRelCount / [Math]::Max(1, $AllNodes.Count) * 100, 1)
        fallacy_tier_coverage_pct        = if ($FallacyTotal -gt 0) { [Math]::Round($NodeAttrs.FallacyWithTier / $FallacyTotal * 100, 1) } else { 0 }
        temporal_scope_coverage_pct      = if ($Temporal.TotalClaims -gt 0) { [Math]::Round($Temporal.ClaimsWithTemporal / $Temporal.TotalClaims * 100, 1) } else { 0 }
        _counts                          = [ordered]@{
            nodes_with_scope       = $NodeAttrs.NodeScopeCount
            nodes_with_parent      = $NodeAttrs.ParentRelCount
            fallacies_with_tier    = $NodeAttrs.FallacyWithTier
            claims_with_temporal   = $Temporal.ClaimsWithTemporal
            debates_total          = $Debates.TotalDebates
            debates_with_argmap    = $Debates.DebatesWithArgMap
            disagreements_total    = $Debates.TotalDisagreements
            disagreements_with_bdi = $Debates.DisagreementsWithBdi
        }
    }

    return [PSCustomObject]@{
        Metrics     = $Metrics
        ClaimsTotal = $Temporal.TotalClaims
    }
}
