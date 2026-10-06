# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-UnmappedConceptsAgainstNodes {
    <#
    .SYNOPSIS
        Auto-resolves unmapped concepts that duplicate an existing taxonomy node, by
        comparing each concept's embedding against cached node-description embeddings
        (t/3910 extraction from Get-TaxonomyHealthData). A concept whose best match is at or
        above 0.80 similarity is removed from the returned list (considered resolved).
    .PARAMETER UnmappedConcepts
        Frequency-sorted array of unmapped-concept objects.
    .OUTPUTS
        [pscustomobject] { Remaining (object[], Frequency-sorted); NearestNodeMap (hashtable,
        normalized key -> top-3 node matches, for concepts that survive filtering) }. When
        node embeddings are unavailable, Remaining is the input unchanged and NearestNodeMap
        is empty.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$UnmappedConcepts
    )

    Set-StrictMode -Version Latest

    $NODE_SIM_THRESHOLD = 0.80
    $NearestNodeMap = @{}

    if ($UnmappedConcepts.Count -eq 0) {
        return [PSCustomObject]@{ Remaining = $UnmappedConcepts; NearestNodeMap = $NearestNodeMap }
    }

    $NodeEmbeddings = Get-NodeEmbeddingsCache
    if ($null -eq $NodeEmbeddings -or $NodeEmbeddings.Count -eq 0) {
        return [PSCustomObject]@{ Remaining = $UnmappedConcepts; NearestNodeMap = $NearestNodeMap }
    }

    $conceptEmbeddings = Get-TextEmbedding -Texts @($UnmappedConcepts.Concept)
    if ($null -eq $conceptEmbeddings) {
        return [PSCustomObject]@{ Remaining = $UnmappedConcepts; NearestNodeMap = $NearestNodeMap }
    }

    $autoResolved = 0
    $afterNodeFilter = [System.Collections.Generic.List[PSObject]]::new()

    for ($i = 0; $i -lt $UnmappedConcepts.Count; $i++) {
        $conceptVec = $conceptEmbeddings["$i"]
        if (-not $conceptVec) {
            $afterNodeFilter.Add($UnmappedConcepts[$i])
            continue
        }

        $Match = Find-NearestNodeForConcept -ConceptVector $conceptVec -NodeEmbeddings $NodeEmbeddings
        $NearestNodeMap[$UnmappedConcepts[$i].NormalizedKey] = $Match.Top3

        if ($Match.BestSimilarity -ge $NODE_SIM_THRESHOLD -and $Match.BestNodeId) {
            $autoResolved++
            Write-Verbose ("Auto-resolved unmapped concept '{0}' -> {1} (sim={2:N3})" -f $UnmappedConcepts[$i].Concept, $Match.BestNodeId, $Match.BestSimilarity)
        }
        else {
            $afterNodeFilter.Add($UnmappedConcepts[$i])
        }
    }

    $Remaining = @($afterNodeFilter | Sort-Object { $_.Frequency } -Descending)
    if ($autoResolved -gt 0) {
        Write-Verbose "Node similarity filter: auto-resolved $autoResolved unmapped concepts (threshold=$NODE_SIM_THRESHOLD), $($Remaining.Count) remain"
    }

    return [PSCustomObject]@{ Remaining = $Remaining; NearestNodeMap = $NearestNodeMap }
}
