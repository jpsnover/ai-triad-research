# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyDepthExpandSignals {
    <#
    .SYNOPSIS
        TaxoAdapt depth_expand signal: parents with >= 8 direct children (t/3910 extraction
        from Get-TaxonomyHealthData).
    .PARAMETER ChildrenMap
        parent_id -> List[string] of child ids.
    .PARAMETER NodeIndex
        The citation-tracking index (for the parent's POV/Category/Label).
    .OUTPUTS
        [object[]] density-signal objects (signal='depth_expand').
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][hashtable]$ChildrenMap,
        [Parameter(Mandatory)][hashtable]$NodeIndex
    )

    Set-StrictMode -Version Latest

    $DepthExpandThreshold = 8
    $Signals = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($ParentId in $ChildrenMap.Keys) {
        $ChildCount = $ChildrenMap[$ParentId].Count
        if ($ChildCount -lt $DepthExpandThreshold -or -not $NodeIndex.ContainsKey($ParentId)) { continue }

        $ParentInfo = $NodeIndex[$ParentId]
        $Signals.Add([PSCustomObject][ordered]@{
            signal   = 'depth_expand'
            node_id  = $ParentId
            pov      = $ParentInfo.POV
            category = $ParentInfo.Category
            label    = $ParentInfo.Label
            metric   = $ChildCount
            detail   = "$ParentId has $ChildCount direct children (threshold: $DepthExpandThreshold)"
        })
    }

    return $Signals.ToArray()
}
