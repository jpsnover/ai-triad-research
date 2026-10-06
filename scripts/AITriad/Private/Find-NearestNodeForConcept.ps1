# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-NearestNodeForConcept {
    <#
    .SYNOPSIS
        Finds the best-matching node (by cosine similarity on description embeddings) for
        one unmapped-concept vector, plus the top-3 matches for prompt enrichment (t/3910
        extraction from Get-TaxonomyHealthData).
    .PARAMETER ConceptVector
        The concept's embedding.
    .PARAMETER NodeEmbeddings
        Node id -> double[] vector (equal-length vectors to ConceptVector are compared;
        length-mismatched entries are skipped).
    .OUTPUTS
        [pscustomobject] { BestSimilarity (double, -1.0 if no comparable node);
        BestNodeId (string or $null); Top3 (array of { NodeId; Similarity }) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][double[]]$ConceptVector,
        [Parameter(Mandatory)][hashtable]$NodeEmbeddings
    )

    Set-StrictMode -Version Latest

    $bestSim = -1.0
    $bestNodeId = $null
    $topMatches = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($NodeId in $NodeEmbeddings.Keys) {
        $nodeVec = $NodeEmbeddings[$NodeId]
        if ($nodeVec.Count -ne $ConceptVector.Count) { continue }

        $sim = Get-CosineSimilarity -A $ConceptVector -B $nodeVec
        if ($sim -gt $bestSim) {
            $bestSim = $sim
            $bestNodeId = $NodeId
        }
        $topMatches.Add([PSCustomObject]@{ NodeId = $NodeId; Similarity = [Math]::Round($sim, 4) })
    }

    $top3 = @($topMatches | Sort-Object Similarity -Descending | Select-Object -First 3)

    return [PSCustomObject]@{ BestSimilarity = $bestSim; BestNodeId = $bestNodeId; Top3 = $top3 }
}
