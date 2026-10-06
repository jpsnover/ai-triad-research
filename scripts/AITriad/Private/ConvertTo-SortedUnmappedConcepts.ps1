# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-SortedUnmappedConcepts {
    <#
    .SYNOPSIS
        Flattens the $UnmappedAgg hashtable (from Add-SummaryUnmappedConcepts) to a
        Frequency-descending array of plain objects (t/3910 extraction from
        Get-TaxonomyHealthData).
    .OUTPUTS
        [object[]]
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][hashtable]$UnmappedAgg
    )

    Set-StrictMode -Version Latest

    return @($UnmappedAgg.Values |
        Sort-Object { $_.Frequency } -Descending |
        ForEach-Object {
            [PSCustomObject]@{
                Concept           = $_.Concept
                NormalizedKey     = $_.NormalizedKey
                Frequency         = $_.Frequency
                SuggestedPov      = $_.SuggestedPov
                SuggestedCategory = $_.SuggestedCategory
                ContributingDocs  = $_.ContributingDocs.ToArray()
                Reasons           = $_.Reasons.ToArray()
            }
        })
}
