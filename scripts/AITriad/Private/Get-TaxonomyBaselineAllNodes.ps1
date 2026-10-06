# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyBaselineAllNodes {
    <#
    .SYNOPSIS
        Loads every taxonomy node into a flat id -> node lookup (t/3910 decomposition
        of Measure-TaxonomyBaseline's taxonomy-load step; no behavior change).
    .PARAMETER TaxDir
        The taxonomy directory to scan.
    .OUTPUTS
        [hashtable] node id -> node object.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [string]$TaxDir
    )

    Set-StrictMode -Version Latest

    $AllNodes = @{}
    $Excluded = 'embeddings.json', 'edges.json', 'policy_actions.json', 'Temp.json', '_archived_edges.json'
    foreach ($File in (Get-ChildItem $TaxDir -Filter '*.json' | Where-Object { $_.Name -notin $Excluded })) {
        $Data = Get-Content -Raw $File.FullName | ConvertFrom-Json
        foreach ($Node in $Data.nodes) {
            $AllNodes[$Node.id] = $Node
        }
    }
    return $AllNodes
}
