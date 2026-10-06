# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyHealthData {
    <#
    .SYNOPSIS
        Computes taxonomy health metrics by scanning all summaries against the taxonomy.
    .DESCRIPTION
        Builds a comprehensive health report by:
        1. Indexing every taxonomy node with a citation counter
        2. Scanning all summary JSONs to count node citations, track stances,
           and aggregate unmapped concepts
        3. Deriving orphan nodes, most/least cited, stance variance,
           coverage balance, and cross-cutting reference health

        t/3910: decomposed from one 156-complexity function into this orchestrator (which
        just sequences the steps above, each delegated to a Private/ helper) plus ~20
        single-purpose helpers, all individually under the complexity threshold. Pure
        refactor -- same params, same returned hashtable shape, same warnings.
    .PARAMETER GraphMode
        When set, also computes graph-structural health metrics from edges.json.
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to $script:RepoRoot.
    #>
    [CmdletBinding()]
    param(
        [switch]$GraphMode,
        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $PovNames = @('accelerationist', 'safetyist', 'skeptic', 'situations')

    $NodeIndex = New-TaxonomyNodeIndex
    $TaxonomyVersion = Get-TaxonomyVersionString

    $Scan = Read-TaxonomySummaryCorpus -SummariesDir (Get-SummariesDir) -SourcesDir (Get-SourcesDir) -NodeIndex $NodeIndex

    $CitationMetrics = Get-NodeCitationMetrics -NodeIndex $NodeIndex

    # @() on every assignment below: a helper returning ZERO items becomes $null at the call
    # site (the t/3948-class hazard's zero-element sibling, confirmed empirically) -- several
    # of these feed a Mandatory array parameter downstream, which would then fail to bind.
    $UnmappedSorted = @(ConvertTo-SortedUnmappedConcepts -UnmappedAgg $Scan.UnmappedAgg)
    $UnmappedSorted = @(Merge-SimilarUnmappedConcepts -UnmappedConcepts $UnmappedSorted)
    $ResolveResult  = Resolve-UnmappedConceptsAgainstNodes -UnmappedConcepts $UnmappedSorted
    $UnmappedSorted = @($ResolveResult.Remaining)
    $NearestNodeMap = $ResolveResult.NearestNodeMap

    $StrongCandidates = @($UnmappedSorted | Where-Object { $_.Frequency -ge 3 })

    $StanceResult = Measure-NodeStanceVariance -NodeIndex $NodeIndex
    $CoverageBalance = Measure-PovCategoryCoverage -AllNodes $CitationMetrics.AllNodes
    $CrossCuttingHealth = Get-CrossCuttingReferenceHealth -AllNodes $CitationMetrics.AllNodes
    $DensitySignals = @(Get-TaxonomyDensitySignals -NodeIndex $NodeIndex -CoverageBalance $CoverageBalance -UnmappedConcepts $UnmappedSorted)
    $SummaryStatsResult = Get-SummaryLevelStats -SummaryStats $Scan.SummaryStats

    $GraphHealth = if ($GraphMode) { Get-TaxonomyGraphHealth -PovNames $PovNames } else { $null }

    return @{
        TaxonomyVersion    = $TaxonomyVersion
        SummaryCount       = $Scan.SummaryStats.Count
        GeneratedAt        = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
        NodeCitations      = $CitationMetrics.AllNodes
        OrphanNodes        = $CitationMetrics.OrphanNodes
        MostCited          = $CitationMetrics.MostCited
        LeastCited         = $CitationMetrics.LeastCited
        UnmappedConcepts   = $UnmappedSorted
        StrongCandidates   = $StrongCandidates
        StanceVariance     = $StanceResult.StanceVariance
        HighVarianceNodes  = $StanceResult.HighVarianceNodes
        CoverageBalance    = $CoverageBalance
        CrossCuttingHealth = $CrossCuttingHealth
        SummaryStats       = $SummaryStatsResult
        GraphHealth        = $GraphHealth
        DensitySignals     = $DensitySignals
        NearestNodeMap     = if ($NearestNodeMap) { $NearestNodeMap } else { @{} }
    }
}
