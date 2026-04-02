# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Clusters taxonomy nodes by embedding similarity using agglomerative clustering.
.DESCRIPTION
    Performs hierarchical agglomerative clustering on taxonomy node embeddings using
    average-linkage cosine similarity.  Starts with each node as its own cluster,
    then iteratively merges the two most similar clusters until either MaxClusters
    is reached or the best inter-cluster similarity falls below MinSimilarity.

    Used by Get-TopicFrequency and Get-TaxonomyHealth to identify thematic groupings
    and detect coverage gaps across the taxonomy.
.PARAMETER NodeIds
    Array of taxonomy node IDs to cluster.  Nodes without embeddings in the
    Embeddings hashtable are silently excluded.
.PARAMETER Embeddings
    Hashtable mapping node IDs to their embedding vectors (double arrays).
    Loaded from taxonomy/Origin/embeddings.json.
.PARAMETER MaxClusters
    Maximum number of clusters to produce.  Merging stops when this count is
    reached.  Defaults to 10.
.PARAMETER MinSimilarity
    Minimum average-linkage cosine similarity required to merge two clusters.
    Merging stops if the best pair falls below this threshold.  Defaults to 0.55.
.EXAMPLE
    $Embeddings = (Get-Content embeddings.json -Raw | ConvertFrom-Json -AsHashtable)
    $Clusters = Get-EmbeddingClusters -NodeIds @('acc-1','acc-2','acc-3') -Embeddings $Embeddings

    Clusters three accelerationist nodes by semantic similarity.
.EXAMPLE
    Get-EmbeddingClusters -NodeIds $AllIds -Embeddings $Emb -MaxClusters 5 -MinSimilarity 0.7

    Produces at most 5 tightly-grouped clusters (similarity >= 0.7).
#>
function Get-EmbeddingClusters {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$NodeIds,

        [Parameter(Mandatory)]
        [hashtable]$Embeddings,

        [int]$MaxClusters = 10,

        [double]$MinSimilarity = 0.55
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Filter to nodes that have embeddings
    $Ids = @($NodeIds | Where-Object { $Embeddings.ContainsKey($_) })
    if ($Ids.Count -eq 0) { return @() }

    # Cosine similarity between two vectors
    $CosineSim = {
        param([double[]]$A, [double[]]$B)
        if ($A.Length -ne $B.Length) {
            Write-Warning "Vector length mismatch ($($A.Length) vs $($B.Length)) — returning 0.0"
            return 0.0
        }
        $Dot   = 0.0
        $NormA = 0.0
        $NormB = 0.0
        for ($i = 0; $i -lt $A.Length; $i++) {
            $Dot   += $A[$i] * $B[$i]
            $NormA += $A[$i] * $A[$i]
            $NormB += $B[$i] * $B[$i]
        }
        $Denom = [Math]::Sqrt($NormA) * [Math]::Sqrt($NormB)
        if ($Denom -eq 0) { return 0.0 }
        return $Dot / $Denom
    }

    # Precompute pairwise similarities
    $SimCache = @{}
    for ($i = 0; $i -lt $Ids.Count; $i++) {
        for ($j = $i + 1; $j -lt $Ids.Count; $j++) {
            $A = $Ids[$i]; $B = $Ids[$j]
            $Key = if ($A -lt $B) { "$A|$B" } else { "$B|$A" }
            $SimCache[$Key] = & $CosineSim $Embeddings[$A] $Embeddings[$B]
        }
    }

    # Init: each node is its own cluster
    $Clusters = [System.Collections.Generic.List[System.Collections.Generic.List[string]]]::new()
    foreach ($Id in $Ids) {
        $C = [System.Collections.Generic.List[string]]::new()
        $C.Add($Id)
        $Clusters.Add($C)
    }

    # Average-linkage: cluster similarity = mean of all inter-member pairwise similarities
    $ClusterSim = {
        param($C1, $C2, $Cache)
        $Total = 0.0
        $Count = 0
        foreach ($A in $C1) {
            foreach ($B in $C2) {
                $Key = if ($A -lt $B) { "$A|$B" } else { "$B|$A" }
                if ($Cache.ContainsKey($Key)) {
                    $Total += $Cache[$Key]
                }
                $Count++
            }
        }
        if ($Count -eq 0) { return 0.0 }
        return $Total / $Count
    }

    # Merge until we reach max clusters or similarity drops below threshold
    while ($Clusters.Count -gt $MaxClusters) {
        $BestSim = -1.0
        $BestI   = 0
        $BestJ   = 1

        for ($i = 0; $i -lt $Clusters.Count; $i++) {
            for ($j = $i + 1; $j -lt $Clusters.Count; $j++) {
                $S = & $ClusterSim $Clusters[$i] $Clusters[$j] $SimCache
                if ($S -gt $BestSim) {
                    $BestSim = $S
                    $BestI   = $i
                    $BestJ   = $j
                }
            }
        }

        if ($BestSim -lt $MinSimilarity) { break }

        # Merge bestJ into bestI
        foreach ($Id in $Clusters[$BestJ]) {
            $Clusters[$BestI].Add($Id)
        }
        $Clusters.RemoveAt($BestJ)
    }

    # Return as array of string arrays
    return @($Clusters | ForEach-Object { ,@($_.ToArray()) })
}
