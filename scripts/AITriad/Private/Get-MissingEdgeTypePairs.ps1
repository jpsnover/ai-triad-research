# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-MissingEdgeTypePairs {
    <#
    .SYNOPSIS
        Cross-POV node pairs that have a SUPPORTS edge but no CONTRADICTS edge (t/3910
        extraction from Get-TaxonomyHealthData's GraphMode metrics). Pair keys are
        order-independent ("source|target" with the lexicographically smaller id first).
    .OUTPUTS
        [hashtable] [ordered]{ SupportsNoContradicts (string[]); Count }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ApprovedEdges,
        [Parameter(Mandatory)][hashtable]$NodePovLookup
    )

    Set-StrictMode -Version Latest

    $CrossPovSupports    = [System.Collections.Generic.HashSet[string]]::new()
    $CrossPovContradicts = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Edge in $ApprovedEdges) {
        $SPov = $NodePovLookup[$Edge.source]
        $TPov = $NodePovLookup[$Edge.target]
        if (-not ($SPov -and $TPov -and $SPov -ne $TPov)) { continue }

        if ($Edge.source -lt $Edge.target) { $PairKey = "$($Edge.source)|$($Edge.target)" } else { $PairKey = "$($Edge.target)|$($Edge.source)" }
        if ($Edge.type -eq 'SUPPORTS')    { [void]$CrossPovSupports.Add($PairKey) }
        if ($Edge.type -eq 'CONTRADICTS') { [void]$CrossPovContradicts.Add($PairKey) }
    }

    $MissingContradicts = @($CrossPovSupports | Where-Object { -not $CrossPovContradicts.Contains($_) })

    return [ordered]@{
        SupportsNoContradicts = $MissingContradicts
        Count                 = $MissingContradicts.Count
    }
}
