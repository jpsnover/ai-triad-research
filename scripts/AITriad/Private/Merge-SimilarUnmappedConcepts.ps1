# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Merge-SimilarUnmappedConcepts {
    <#
    .SYNOPSIS
        Semantic dedup of unmapped concepts (t/181; t/3910 extraction from
        Get-TaxonomyHealthData). Clusters semantically similar concepts (cosine similarity
        >= 0.75 on their embeddings) via single-linkage clustering and merges each cluster:
        the representative gets the summed frequency and unioned contributing docs/reasons.
    .PARAMETER UnmappedConcepts
        Frequency-sorted array of unmapped-concept objects. Fewer than 2 entries is returned
        unchanged (nothing to cluster).
    .OUTPUTS
        [object[]] the deduped list, re-sorted by Frequency descending.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$UnmappedConcepts
    )

    Set-StrictMode -Version Latest

    $SIM_THRESHOLD = 0.75

    if ($UnmappedConcepts.Count -le 1) { return $UnmappedConcepts }

    $embeddings = Get-TextEmbedding -Texts @($UnmappedConcepts.Concept)
    if ($null -eq $embeddings) { return $UnmappedConcepts }

    $clusterId = Group-UnmappedConceptsByCluster -Embeddings $embeddings -Count $UnmappedConcepts.Count -Threshold $SIM_THRESHOLD

    $clusters = @{}
    for ($i = 0; $i -lt $UnmappedConcepts.Count; $i++) {
        $rep = $clusterId[$i]
        if (-not $clusters.ContainsKey($rep)) { $clusters[$rep] = @() }
        $clusters[$rep] += $i
    }

    $mergedCount = 0
    $dedupedList = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($entry in $clusters.GetEnumerator()) {
        $indices = $entry.Value
        $members = @($indices | ForEach-Object { $UnmappedConcepts[$_] })
        $dedupedList.Add((Merge-UnmappedConceptCluster -Members $members))
        $mergedCount += ($indices.Count - 1)
    }

    $Result = @($dedupedList | Sort-Object { $_.Frequency } -Descending)
    Write-Verbose "Semantic dedup: merged $mergedCount duplicates, $($Result.Count) unique concepts remain"
    return $Result
}
