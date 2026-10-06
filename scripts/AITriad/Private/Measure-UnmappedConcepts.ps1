# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-UnmappedConcepts {
    <#
    .SYNOPSIS
        Metric 7 of Measure-TaxonomyBaseline (t/3910 decomposition; no behavior
        change): unmapped-concept resolution rate across summaries.
    .PARAMETER Summaries
        Doc id -> summary lookup.
    .OUTPUTS
        [ordered hashtable] the unmapped_concepts report section.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Summaries
    )

    Set-StrictMode -Version Latest

    $TotalUnmapped = 0; $ResolvedUnmapped = 0
    foreach ($Sum in $Summaries.Values) {
        if (-not $Sum.unmapped_concepts) { continue }
        foreach ($UC in $Sum.unmapped_concepts) {
            $TotalUnmapped++
            if ($UC.PSObject.Properties['resolved_node_id'] -and $UC.resolved_node_id) { $ResolvedUnmapped++ }
        }
    }

    return [ordered]@{
        total_unmapped_concepts = $TotalUnmapped
        resolved                = $ResolvedUnmapped
        unresolved              = $TotalUnmapped - $ResolvedUnmapped
        resolved_pct            = if ($TotalUnmapped -gt 0) { [Math]::Round($ResolvedUnmapped / $TotalUnmapped * 100, 1) } else { 0 }
    }
}
