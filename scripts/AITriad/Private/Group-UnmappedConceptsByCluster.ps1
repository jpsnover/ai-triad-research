# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Group-UnmappedConceptsByCluster {
    <#
    .SYNOPSIS
        Single-linkage clustering of unmapped-concept embeddings by cosine similarity (t/3910
        extraction from Get-TaxonomyHealthData's semantic-dedup pass).
    .PARAMETER Embeddings
        Hashtable keyed by string index ("0","1",...) -> double[] vector, as returned by
        Get-TextEmbedding for the concept texts (index-aligned with the caller's list).
    .PARAMETER Count
        The number of concepts (and therefore embedding indices 0..Count-1) to cluster.
    .PARAMETER Threshold
        Cosine similarity at or above which two concepts merge into the same cluster.
    .OUTPUTS
        [hashtable] index -> cluster-representative index (0-based int keys).
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][hashtable]$Embeddings,
        [Parameter(Mandatory)][int]$Count,
        [Parameter(Mandatory)][double]$Threshold
    )

    Set-StrictMode -Version Latest

    $clusterId = @{}
    for ($i = 0; $i -lt $Count; $i++) { $clusterId[$i] = $i }

    for ($i = 0; $i -lt $Count; $i++) {
        $vecI = $Embeddings["$i"]
        if (-not $vecI) { continue }
        for ($j = $i + 1; $j -lt $Count; $j++) {
            $vecJ = $Embeddings["$j"]
            if (-not $vecJ) { continue }
            if ($clusterId[$i] -eq $clusterId[$j]) { continue }

            $sim = Get-CosineSimilarity -A ([double[]]$vecI) -B ([double[]]$vecJ)
            if ($sim -ge $Threshold) {
                $oldCluster = $clusterId[$j]
                $newCluster = $clusterId[$i]
                for ($m = 0; $m -lt $Count; $m++) {
                    if ($clusterId[$m] -eq $oldCluster) { $clusterId[$m] = $newCluster }
                }
            }
        }
    }

    return $clusterId
}
