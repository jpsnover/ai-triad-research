# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyGraphHealth {
    <#
    .SYNOPSIS
        Graph-structural health metrics from edges.json (t/3910 extraction from
        Get-TaxonomyHealthData's -GraphMode path).
    .DESCRIPTION
        Returns $null (and WARNs) when edges.json is absent -- GraphMode metrics are
        unavailable, never thrown. Otherwise builds a node->POV lookup from
        $script:TaxonomyData and assembles echo-chamber scores, cross-POV connectivity,
        edge orphans, hub concentration, missing cross-POV CONTRADICTS pairs, and
        echo-chamber nodes from the approved edges.
    .PARAMETER PovNames
        The 4 POV keys to scan for the node->POV lookup (including 'situations').
    .OUTPUTS
        [System.Collections.Specialized.OrderedDictionary] or $null.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)][string[]]$PovNames
    )

    Set-StrictMode -Version Latest

    $TaxDir    = Get-TaxonomyDir
    $EdgesPath = Join-Path $TaxDir 'edges.json'

    if (-not (Test-Path $EdgesPath)) {
        Write-Warning "Get-TaxonomyHealthData: edges.json not found — GraphMode metrics unavailable"
        return $null
    }

    $EdgesData     = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
    $ApprovedEdges = @($EdgesData.edges | Where-Object { $_.status -eq 'approved' })

    $NodePovLookup = @{}
    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) { $NodePovLookup[$Node.id] = $PovKey }
    }

    # @() on the array-returning helpers: a zero-result return becomes $null at the call site
    # (same hazard as Get-TaxonomyDensitySignals), and .Count on $null throws under StrictMode.
    $EchoChamberScores   = Get-EchoChamberScores -ApprovedEdges $ApprovedEdges -NodePovLookup $NodePovLookup
    $CrossPovConnectivity = Get-CrossPovConnectivity -ApprovedEdges $ApprovedEdges -NodePovLookup $NodePovLookup
    $EdgeOrphans         = @(Get-EdgeOrphans -ApprovedEdges $ApprovedEdges -NodePovLookup $NodePovLookup)
    $HubConcentration    = Get-HubConcentration -ApprovedEdges $ApprovedEdges -NodePovLookup $NodePovLookup
    $MissingEdgeTypePairs = Get-MissingEdgeTypePairs -ApprovedEdges $ApprovedEdges -NodePovLookup $NodePovLookup
    $EchoChamberNodes    = @(Get-EchoChamberNodes -ApprovedEdges $ApprovedEdges -NodePovLookup $NodePovLookup)

    return [ordered]@{
        EchoChamberScores    = $EchoChamberScores
        CrossPovConnectivity = $CrossPovConnectivity
        EdgeOrphans          = $EdgeOrphans
        EdgeOrphanCount      = $EdgeOrphans.Count
        HubConcentration     = $HubConcentration
        MissingEdgeTypePairs = $MissingEdgeTypePairs
        EchoChamberNodes     = $EchoChamberNodes
        EchoChamberNodeCount = $EchoChamberNodes.Count
    }
}
