# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-SituationCandidates {
    <#
    .SYNOPSIS
        Discovers candidate situation concepts by clustering similar nodes across POVs.
    .DESCRIPTION
        Computes cross-POV pairwise cosine similarity from taxonomy embeddings, filters to
        pairs above threshold, classifies each pair using an NLI cross-encoder
        (entailment/neutral/contradiction) to distinguish genuine shared concepts from
        opposing positions on the same topic, merges overlapping pairs into groups, boosts
        scores for pairs with TENSION_WITH/CONTRADICTS edges or shared attributes, then
        optionally calls an LLM to propose situation node labels and interpretations.

        The NLI classification uses cross-encoder/nli-deberta-v3-small (local, no API
        required) and tags each candidate pair so the downstream LLM prompt can distinguish
        agreement clusters from tension clusters.
    .PARAMETER TopN
        Number of top candidates to return (1-30, default 10).
    .PARAMETER MinSimilarity
        Cosine similarity threshold (0.50-0.95, default 0.60).
    .PARAMETER OutputFile
        Optional path to write results as JSON: { generated_at, min_similarity, pairs_checked, pairs_above,
        candidates }. Each candidate has cluster_id, members ([{ id, pov, label }], sorted by id),
        avg_similarity, max_boosted, povs_represented and proposed_label, plus nli_relationship and
        nli_counts when NLI ran. A contested cluster whose NLI labels split its members into two
        consistent camps also has sides: [[sideA members], [sideB members]], two arrays of members, each
        sorted by id, ordered by their first id. AI fields (proposed_description, interpretations,
        confidence, rationale) are present when the model labelled the cluster.

        Pairs whose two nodes are both listed in one situation node's linked_nodes are skipped: that
        situation already interprets them. Output is deterministic: ties on score break by member id.
    .PARAMETER NoAI
        Skip LLM labeling; return raw clusters only.
    .PARAMETER NoNLI
        Skip NLI cross-encoder verification (faster, but no contradiction detection).
    .PARAMETER ShowSharedOnly
        Only show shared-concept clusters (entailment/neutral). Mutually exclusive with -ShowDebatesOnly.
    .PARAMETER ShowDebatesOnly
        Only show debate clusters (contradiction). Mutually exclusive with -ShowSharedOnly.
    .PARAMETER Model
        AI model override.
    .PARAMETER ApiKey
        AI API key override.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Find-SituationCandidates -NoAI
    .EXAMPLE
        Find-SituationCandidates -MinSimilarity 0.80 -OutputFile situations.json
    .EXAMPLE
        Find-SituationCandidates -NoNLI
    .EXAMPLE
        Find-SituationCandidates -ShowSharedOnly -TopN 10
    .EXAMPLE
        Find-SituationCandidates -ShowDebatesOnly -TopN 10
    .LINK
        Show-AITriadHelp
    .LINK
        Invoke-CcToSitMigration
    .LINK
        Invoke-SchemaMigration
    #>
    [CmdletBinding()]
    param(
        [ValidateRange(1, 30)]
        [int]$TopN = 10,

        [ValidateRange(0.50, 0.95)]
        [double]$MinSimilarity = 0.60,

        [Alias('OutputPath')]
        [string]$OutputFile,

        [switch]$NoAI,

        [switch]$NoNLI,

        [switch]$ShowSharedOnly,

        [switch]$ShowDebatesOnly,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model,

        [string]$ApiKey,

        [string]$RepoRoot = $script:RepoRoot
    )


    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if ($ShowSharedOnly -and $ShowDebatesOnly) {
        throw (New-ActionableError -PassThru `
            -Goal 'Find situation candidates' `
            -Problem '-ShowSharedOnly and -ShowDebatesOnly are mutually exclusive.' `
            -Location 'Find-SituationCandidates' `
            -NextSteps @('Pass at most one of -ShowSharedOnly or -ShowDebatesOnly', 'Pass neither to get shared and debate clusters together'))
    }

    $Model = Resolve-FscModel -Model $Model

    # Steps live in Private/FindSituationCandidatesSteps.ps1 (t/3910).
    Write-Step 'Building node index'
    $NodeIndex = Get-FscNodeIndex
    Write-OK "Indexed $($NodeIndex.Count) nodes"

    Write-Step 'Loading embeddings'
    $Embeddings = Get-FscEmbeddingIndex
    Write-OK "Loaded $($Embeddings.Count) embeddings"

    Write-Step 'Loading edges'
    $EdgePairs = Get-FscApprovedEdgeMap -TaxDir (Get-TaxonomyDir)
    Write-OK "Loaded edge data for boost scoring"
    $CcLinkedPairs = Get-FscSituationLinkedPairSet -NodeIndex $NodeIndex

    Write-Step 'Computing cross-POV pairwise cosine similarities'
    $Found = Find-FscSimilarPairSet -NodeIndex $NodeIndex -Embeddings $Embeddings -EdgePairs $EdgePairs -CcLinkedPairs $CcLinkedPairs -MinSimilarity $MinSimilarity
    $SimilarPairs = $Found.Pairs
    Write-OK "Checked $($Found.PairCount) cross-POV pairs, found $($SimilarPairs.Count) above threshold"

    if (-not $NoNLI -and $SimilarPairs.Count -gt 0) {
        Add-FscNliLabel -SimilarPairs $SimilarPairs -NodeIndex $NodeIndex -RepoRoot $RepoRoot
    }

    Write-Step 'Merging overlapping pairs into clusters'
    $AllScoredGroups = Get-FscScoredClusterList -SimilarPairs $SimilarPairs -NodeIndex $NodeIndex
    $ScoredGroups = Select-FscTopCluster -AllScoredGroups $AllScoredGroups -TopN $TopN -ShowSharedOnly:$ShowSharedOnly -ShowDebatesOnly:$ShowDebatesOnly

    $AILabels = $null
    if (-not $NoAI -and $ScoredGroups.Count -gt 0) {
        $AILabels = Get-FscAiLabelSet -ScoredGroups $ScoredGroups -NodeIndex $NodeIndex -Model $Model -ApiKey $ApiKey
    }

    $ResultCandidates = @(for ($i = 0; $i -lt $ScoredGroups.Count; $i++) {
        ConvertTo-FscCandidateEntry -G $ScoredGroups[$i] -Index $i -SimilarPairs $SimilarPairs -AILabels $AILabels -NodeIndex $NodeIndex
    })

    $Result = [ordered]@{
        generated_at    = (Get-Date -Format 'o')
        min_similarity  = $MinSimilarity
        pairs_checked   = $Found.PairCount
        pairs_above     = $SimilarPairs.Count
        candidates      = $ResultCandidates
    }

    Write-FscConsoleReport -ResultCandidates $ResultCandidates -MinSimilarity $MinSimilarity

    if ($OutputFile) {
        Export-FscResult -Result $Result -OutputFile $OutputFile
    }

    return $Result
}
