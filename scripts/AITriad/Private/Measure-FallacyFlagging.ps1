# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-FallacyFlagging {
    <#
    .SYNOPSIS
        Metric 5 of Measure-TaxonomyBaseline (t/3910 decomposition; no behavior
        change): per-node fallacy flagging rate, confidence tiers, and top types.
    .PARAMETER AllNodes
        Node id -> node lookup.
    .OUTPUTS
        [ordered hashtable] the fallacies report section.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$AllNodes
    )

    Set-StrictMode -Version Latest

    $FallacyTotal = 0; $FallacyLikely = 0; $FallacyPossible = 0; $FallacyBorderline = 0
    $NodesWithFallacies = 0; $NodesWithoutFallacies = 0
    $FallacyTypeCounts = @{}

    foreach ($Node in $AllNodes.Values) {
        if ($Node.PSObject.Properties['graph_attributes']) { $GA = $Node.graph_attributes } else { $GA = $null }
        $HasFallacies = $GA -and $GA.PSObject.Properties['possible_fallacies'] -and $GA.possible_fallacies
        if (-not $HasFallacies) {
            $NodesWithoutFallacies++
            continue
        }
        $Fallacies = @($GA.possible_fallacies)
        if ($Fallacies.Count -eq 0) {
            $NodesWithoutFallacies++
            continue
        }
        $NodesWithFallacies++
        foreach ($F in $Fallacies) {
            $FallacyTotal++
            switch ($F.confidence) {
                'likely'     { $FallacyLikely++ }
                'possible'   { $FallacyPossible++ }
                'borderline' { $FallacyBorderline++ }
            }
            $Key = $F.fallacy
            if (-not $FallacyTypeCounts.ContainsKey($Key)) { $FallacyTypeCounts[$Key] = 0 }
            $FallacyTypeCounts[$Key]++
        }
    }

    return [ordered]@{
        nodes_with_fallacies    = $NodesWithFallacies
        nodes_without_fallacies = $NodesWithoutFallacies
        flagging_rate_pct       = if ($AllNodes.Count -gt 0) { [Math]::Round($NodesWithFallacies / $AllNodes.Count * 100, 1) } else { 0 }
        total_flags             = $FallacyTotal
        avg_per_flagged_node    = if ($NodesWithFallacies -gt 0) { [Math]::Round($FallacyTotal / $NodesWithFallacies, 1) } else { 0 }
        confidence_likely       = $FallacyLikely
        confidence_possible     = $FallacyPossible
        confidence_borderline   = $FallacyBorderline
        top_fallacy_types       = @($FallacyTypeCounts.GetEnumerator() |
            Sort-Object Value -Descending |
            Select-Object -First 15 |
            ForEach-Object { [ordered]@{ type = $_.Key; count = $_.Value } })
    }
}
