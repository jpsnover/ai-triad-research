# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EdgeOrphans {
    <#
    .SYNOPSIS
        Node ids with zero approved edges (t/3910 extraction from Get-TaxonomyHealthData's
        GraphMode metrics), sorted.
    .OUTPUTS
        [string[]]
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ApprovedEdges,
        [Parameter(Mandatory)][hashtable]$NodePovLookup
    )

    Set-StrictMode -Version Latest

    $EdgedNodes = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Edge in $ApprovedEdges) {
        [void]$EdgedNodes.Add($Edge.source)
        [void]$EdgedNodes.Add($Edge.target)
    }

    return @($NodePovLookup.Keys | Where-Object { -not $EdgedNodes.Contains($_) } | Sort-Object)
}
