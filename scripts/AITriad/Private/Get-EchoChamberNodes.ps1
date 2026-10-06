# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EchoChamberNodes {
    <#
    .SYNOPSIS
        Nodes with >= 3 SUPPORTS edges and zero cross-POV CONTRADICTS edges (t/3910
        extraction from Get-TaxonomyHealthData's GraphMode metrics), ranked by supports
        count descending.
    .OUTPUTS
        [string[]] node ids.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ApprovedEdges,
        [Parameter(Mandatory)][hashtable]$NodePovLookup
    )

    Set-StrictMode -Version Latest

    $NodeCrossPovContradicts = @{}
    $NodeSupportsCount      = @{}
    foreach ($Edge in $ApprovedEdges) {
        $SPov = $NodePovLookup[$Edge.source]
        $TPov = $NodePovLookup[$Edge.target]
        if ($Edge.type -eq 'SUPPORTS') {
            if (-not $NodeSupportsCount.ContainsKey($Edge.source)) { $NodeSupportsCount[$Edge.source] = 0 }
            $NodeSupportsCount[$Edge.source]++
        }
        if ($Edge.type -eq 'CONTRADICTS' -and $SPov -ne $TPov) {
            if (-not $NodeCrossPovContradicts.ContainsKey($Edge.source)) { $NodeCrossPovContradicts[$Edge.source] = 0 }
            if (-not $NodeCrossPovContradicts.ContainsKey($Edge.target)) { $NodeCrossPovContradicts[$Edge.target] = 0 }
            $NodeCrossPovContradicts[$Edge.source]++
            $NodeCrossPovContradicts[$Edge.target]++
        }
    }

    return @($NodeSupportsCount.Keys | Where-Object {
        $NodeSupportsCount[$_] -ge 3 -and
        (-not $NodeCrossPovContradicts.ContainsKey($_) -or $NodeCrossPovContradicts[$_] -eq 0)
    } | Sort-Object { $NodeSupportsCount[$_] } -Descending)
}
