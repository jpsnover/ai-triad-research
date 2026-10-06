# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyBaselineEdges {
    <#
    .SYNOPSIS
        Loads edges.json's edges array, or an empty array if the file is absent
        (t/3910 decomposition of Measure-TaxonomyBaseline's edge-load step; no
        behavior change).
    .PARAMETER TaxDir
        The taxonomy directory containing edges.json.
    .OUTPUTS
        [object[]] the edges array.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)]
        [string]$TaxDir
    )

    Set-StrictMode -Version Latest

    $EdgesPath = Join-Path $TaxDir 'edges.json'
    if (-not (Test-Path $EdgesPath)) { return @() }
    $EdgesData = Get-Content -Raw $EdgesPath | ConvertFrom-Json
    return @($EdgesData.edges)
}
