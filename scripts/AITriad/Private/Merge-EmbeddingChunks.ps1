# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Mean-pools chunk-level embedding vectors back into one vector per
    original input ID, then L2-normalizes (t/1404).
.DESCRIPTION
    Get-TextEmbedding / Invoke-BatchEmbeddings send chunk-level payloads
    with structured IDs ("origId::chunkN") to embed_taxonomy.py's
    batch-encode. This helper groups the returned vectors back by
    origId, averages each dimension across the chunks that came back,
    and re-normalizes so cosine similarity remains a dot product.

    Chunk vectors from batch-encode arrive already L2-normalized
    (embed_taxonomy.py passes normalize_embeddings=True). The mean of
    unit vectors is not itself a unit vector, so the final re-normalize
    step is required for the returned vectors to remain directly
    comparable with the cached taxonomy embeddings.

    Missing chunk vectors are skipped rather than throwing — Python may
    drop individual items on partial failure and the caller-facing
    contract is "give me a best-effort vector."
.PARAMETER Ids
    Original input IDs in caller-emit order.
.PARAMETER ChunkGroups
    Hashtable mapping origId -> expected chunk count.
.PARAMETER ChunkVectors
    Hashtable mapping "origId::chunkN" -> [double[]] vector (as
    returned by embed_taxonomy.py batch-encode + ConvertFrom-Json).
#>
function Merge-EmbeddingChunks {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][string[]]$Ids,
        [Parameter(Mandatory)][hashtable]$ChunkGroups,
        [Parameter(Mandatory)][hashtable]$ChunkVectors
    )

    Set-StrictMode -Version Latest
    $Result = @{}

    foreach ($OrigId in $Ids) {
        $Count = if ($ChunkGroups.ContainsKey($OrigId)) { [int]$ChunkGroups[$OrigId] } else { 0 }
        if ($Count -eq 0) {
            $Result[$OrigId] = [double[]]@()
            continue
        }

        $Sum = $null
        $ValidCount = 0
        for ($k = 0; $k -lt $Count; $k++) {
            $ChunkKey = "${OrigId}::$k"
            if (-not $ChunkVectors.ContainsKey($ChunkKey)) { continue }
            $Vec = [double[]]@($ChunkVectors[$ChunkKey])
            if ($Vec.Count -eq 0) { continue }
            if ($null -eq $Sum) { $Sum = [double[]]::new($Vec.Count) }
            for ($d = 0; $d -lt $Vec.Count; $d++) { $Sum[$d] += $Vec[$d] }
            $ValidCount++
        }

        if ($ValidCount -eq 0 -or $null -eq $Sum) {
            $Result[$OrigId] = [double[]]@()
            continue
        }

        # Mean across surviving chunks
        for ($d = 0; $d -lt $Sum.Count; $d++) { $Sum[$d] /= $ValidCount }

        # L2-normalize so cosine similarity is a dot product (matches cached
        # taxonomy embeddings, which are also L2-normalized by embed_taxonomy.py).
        $NormSq = 0.0
        for ($d = 0; $d -lt $Sum.Count; $d++) { $NormSq += $Sum[$d] * $Sum[$d] }
        $Norm = [Math]::Sqrt($NormSq)
        if ($Norm -gt 0) {
            for ($d = 0; $d -lt $Sum.Count; $d++) { $Sum[$d] /= $Norm }
        }
        $Result[$OrigId] = [double[]]$Sum
    }

    return $Result
}
