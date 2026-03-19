# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Agglomerative clustering of node embeddings using average-linkage cosine similarity.
# Dot-sourced by AITriad.psm1 — do NOT export.

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

    # Filter to nodes that have embeddings
    $Ids = @($NodeIds | Where-Object { $Embeddings.ContainsKey($_) })
    if ($Ids.Count -eq 0) { return @() }

    # Cosine similarity between two vectors
    $CosineSim = {
        param([double[]]$A, [double[]]$B)
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
