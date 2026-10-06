# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-EdgeQuality {
    <#
    .SYNOPSIS
        Metric 3 of Measure-TaxonomyBaseline (t/3910 decomposition; no behavior
        change): edge-type distribution, orphans (policy nodes exempt), self-edges,
        and the Desires-SUPPORTS-Beliefs domain-violation count.
    .PARAMETER Edges
        The loaded edges array.
    .PARAMETER AllNodes
        Node id -> node lookup.
    .OUTPUTS
        [ordered hashtable] the edges report section.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)]
        [object[]]$Edges,

        [Parameter(Mandatory)]
        [hashtable]$AllNodes
    )

    Set-StrictMode -Version Latest

    $TypeCounts = @{}
    $OrphanEdges = 0
    $SelfEdges = 0
    $GoalSupportsData = 0

    foreach ($E in $Edges) {
        $Type = $E.type
        if (-not $TypeCounts.ContainsKey($Type)) { $TypeCounts[$Type] = 0 }
        $TypeCounts[$Type]++

        if ($E.source -eq $E.target) { $SelfEdges++ }

        # Policy nodes (pol-*) are in the policy registry, not in $AllNodes -- skip orphan check for them
        $SrcIsPolicy = $E.source -match '^pol-'
        $TgtIsPolicy = $E.target -match '^pol-'
        if ($SrcIsPolicy) { $SrcNode = $true } else { $SrcNode = $AllNodes[$E.source] }
        if ($TgtIsPolicy) { $TgtNode = $true } else { $TgtNode = $AllNodes[$E.target] }
        if (-not $SrcNode -or -not $TgtNode) {
            $OrphanEdges++
            continue
        }

        if ($SrcIsPolicy -or $TgtIsPolicy) { continue }
        if ($SrcNode.PSObject.Properties['category']) { $SrcCat = $SrcNode.category } else { $SrcCat = $null }
        if ($TgtNode.PSObject.Properties['category']) { $TgtCat = $TgtNode.category } else { $TgtCat = $null }
        if ($Type -eq 'SUPPORTS' -and $SrcCat -eq 'Desires' -and $TgtCat -eq 'Beliefs') {
            $GoalSupportsData++
        }
    }

    $CanonicalTypes = @('SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS', 'RESPONDS_TO', 'TENSION_WITH', 'INTERPRETS')
    $NonCanonical = @($TypeCounts.GetEnumerator() | Where-Object { $_.Key -notin $CanonicalTypes })

    $EdgeMetrics = [ordered]@{
        total_edges              = $Edges.Count
        type_distribution        = [ordered]@{}
        canonical_type_count     = ($CanonicalTypes | ForEach-Object { $TypeCounts[$_] } | Measure-Object -Sum).Sum
        non_canonical_type_count = ($NonCanonical | ForEach-Object { $_.Value } | Measure-Object -Sum).Sum
        non_canonical_types      = @($NonCanonical | Sort-Object Value -Descending | ForEach-Object { [ordered]@{ type = $_.Key; count = $_.Value } })
        orphan_edges             = $OrphanEdges
        self_edges               = $SelfEdges
        goals_supports_data      = $GoalSupportsData
    }
    foreach ($T in ($TypeCounts.GetEnumerator() | Sort-Object Value -Descending)) {
        $EdgeMetrics.type_distribution[$T.Key] = $T.Value
    }
    return $EdgeMetrics
}
