# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Merge-UnmappedConceptCluster {
    <#
    .SYNOPSIS
        Merges one cluster's member unmapped-concept entries into a single representative
        (t/3910 extraction from Get-TaxonomyHealthData's semantic-dedup pass). A single-member
        cluster passes through unchanged (no ClusterSize set).
    .PARAMETER Members
        The cluster's unmapped-concept objects (each with Concept/NormalizedKey/Frequency/
        SuggestedPov/SuggestedCategory/ContributingDocs/Reasons).
    .OUTPUTS
        [pscustomobject] the single member, or a merged representative with summed Frequency,
        unioned ContributingDocs/Reasons, and ClusterSize = Members.Count.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][object[]]$Members
    )

    Set-StrictMode -Version Latest

    if ($Members.Count -eq 1) { return $Members[0] }

    # Representative: highest frequency, then longest concept text.
    $rep = $Members | Sort-Object { $_.Frequency } -Descending |
                      Sort-Object { $_.Concept.Length } -Descending |
                      Select-Object -First 1

    $allDocs = [System.Collections.Generic.HashSet[string]]::new()
    $allReasons = [System.Collections.Generic.List[string]]::new()
    $totalFreq = 0
    foreach ($m in $Members) {
        $totalFreq += $m.Frequency
        foreach ($d in $m.ContributingDocs) { [void]$allDocs.Add($d) }
        foreach ($r in $m.Reasons) {
            if ($r -and $r -notin $allReasons) { $allReasons.Add($r) }
        }
    }

    return [PSCustomObject]@{
        Concept           = $rep.Concept
        NormalizedKey     = $rep.NormalizedKey
        Frequency         = $totalFreq
        SuggestedPov      = $rep.SuggestedPov
        SuggestedCategory = $rep.SuggestedCategory
        ContributingDocs  = @($allDocs)
        Reasons           = @($allReasons)
        ClusterSize       = $Members.Count
    }
}
