# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-CrossPovConnectivity {
    <#
    .SYNOPSIS
        Share of approved edges that cross a POV boundary (t/3910 extraction from
        Get-TaxonomyHealthData's GraphMode metrics).
    .OUTPUTS
        [hashtable] [ordered]{ CrossPovEdges; TotalEdges; Percentage }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ApprovedEdges,
        [Parameter(Mandatory)][hashtable]$NodePovLookup
    )

    Set-StrictMode -Version Latest

    $CrossPovEdgeCount = 0
    $TotalEdgeCount    = $ApprovedEdges.Count
    foreach ($Edge in $ApprovedEdges) {
        $SPov = $NodePovLookup[$Edge.source]
        $TPov = $NodePovLookup[$Edge.target]
        if ($SPov -and $TPov -and $SPov -ne $TPov) { $CrossPovEdgeCount++ }
    }

    if ($TotalEdgeCount -gt 0) {
        $CrossPovPct = [Math]::Round(($CrossPovEdgeCount / $TotalEdgeCount) * 100, 1)
    } else {
        $CrossPovPct = 0.0
    }

    return [ordered]@{
        CrossPovEdges = $CrossPovEdgeCount
        TotalEdges    = $TotalEdgeCount
        Percentage    = $CrossPovPct
    }
}
