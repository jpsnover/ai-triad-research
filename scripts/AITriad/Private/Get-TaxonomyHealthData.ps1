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
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to $script:RepoRoot.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── 1. Build node index from $script:TaxonomyData ─────────────────────────
    $NodeIndex = @{}    # keyed by node id
    $PovNames  = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')

    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $NodeIndex[$Node.id] = @{
                POV              = $PovKey
                Category         = if ($PovKey -eq 'cross-cutting') { 'Cross-Cutting' } else { $Node.category }
                Label            = $Node.label
                Description      = $Node.description
                Citations        = 0
                DocIds           = [System.Collections.Generic.List[string]]::new()
                Stances          = [System.Collections.Generic.List[string]]::new()
            }
        }
    }

    # ── 2. Read TAXONOMY_VERSION ───────────────────────────────────────────────
    $VersionFile = Join-Path $RepoRoot 'TAXONOMY_VERSION'
    $TaxonomyVersion = if (Test-Path $VersionFile) {
        (Get-Content $VersionFile -Raw).Trim()
    } else { 'unknown' }

    # ── 3. Scan every summaries/*.json ─────────────────────────────────────────
    $SummariesDir = Join-Path $RepoRoot 'summaries'
    $SourcesDir   = Join-Path $RepoRoot 'sources'

    if (-not (Test-Path $SummariesDir)) {
        throw "Summaries directory not found: $SummariesDir"
    }

    $SummaryFiles = Get-ChildItem -Path $SummariesDir -Filter '*.json' -File
    $UnmappedAgg  = @{}   # lowercased concept → aggregation object
    $SummaryStats = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($File in $SummaryFiles) {
        try {
            $Summary = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
        }
        catch {
            Write-Warning "Get-TaxonomyHealthData: failed to parse $($File.Name): $_"
            continue
        }

        $DocId         = $Summary.doc_id
        $DocKeyPoints  = 0
        $DocClaims     = 0
        $DocUnmapped   = 0

        # Scan pov_summaries for key_points
        foreach ($PovName in @('accelerationist', 'safetyist', 'skeptic')) {
            $PovData = $Summary.pov_summaries.$PovName
            if (-not $PovData -or -not $PovData.key_points) { continue }

            foreach ($Point in $PovData.key_points) {
                $DocKeyPoints++
                $NodeId = $Point.taxonomy_node_id
                if (-not $NodeId) { continue }

                if ($NodeIndex.ContainsKey($NodeId)) {
                    $NodeIndex[$NodeId].Citations++
                    if ($DocId -notin $NodeIndex[$NodeId].DocIds) {
                        $NodeIndex[$NodeId].DocIds.Add($DocId)
                    }
                    if ($Point.stance) {
                        $NodeIndex[$NodeId].Stances.Add($Point.stance)
                    }
                }
            }
        }

        # Aggregate unmapped_concepts
        if ($Summary.unmapped_concepts) {
            foreach ($Concept in $Summary.unmapped_concepts) {
                $DocUnmapped++
                $NormKey = ($Concept.concept -replace '\s+', ' ').Trim().ToLower()
                if (-not $UnmappedAgg.ContainsKey($NormKey)) {
                    $UnmappedAgg[$NormKey] = @{
                        Concept           = $Concept.concept
                        NormalizedKey     = $NormKey
                        Frequency         = 0
                        SuggestedPov      = $Concept.suggested_pov
                        SuggestedCategory = $Concept.suggested_category
                        ContributingDocs  = [System.Collections.Generic.List[string]]::new()
                        Reasons           = [System.Collections.Generic.List[string]]::new()
                    }
                }
                $UnmappedAgg[$NormKey].Frequency++
                if ($DocId -notin $UnmappedAgg[$NormKey].ContributingDocs) {
                    $UnmappedAgg[$NormKey].ContributingDocs.Add($DocId)
                }
                if ($Concept.reason -and $Concept.reason -notin $UnmappedAgg[$NormKey].Reasons) {
                    $UnmappedAgg[$NormKey].Reasons.Add($Concept.reason)
                }
            }
        }

        # Count factual claims
        if ($Summary.factual_claims) {
            $DocClaims = @($Summary.factual_claims).Count
        }

        # Load title from metadata if available
        $Title = $null
        $MetaPath = Join-Path $SourcesDir $DocId 'metadata.json'
        if (Test-Path $MetaPath) {
            try {
                $Meta  = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json
                $Title = $Meta.title
            }
            catch { }
        }

        $SummaryStats.Add([PSCustomObject]@{
            DocId         = $DocId
            Title         = $Title
            KeyPoints     = $DocKeyPoints
            FactualClaims = $DocClaims
            UnmappedCount = $DocUnmapped
        })
    }

    # ── 4. Derive metrics ──────────────────────────────────────────────────────

    # Node citations sorted
    $AllNodes = @($NodeIndex.GetEnumerator() | ForEach-Object {
        [PSCustomObject]@{
            Id        = $_.Key
            POV       = $_.Value.POV
            Category  = $_.Value.Category
            Label     = $_.Value.Label
            Citations = $_.Value.Citations
            DocIds    = $_.Value.DocIds.ToArray()
        }
    })

    $OrphanNodes = @($AllNodes | Where-Object { $_.Citations -eq 0 })
    $MostCited   = @($AllNodes | Where-Object { $_.POV -ne 'cross-cutting' } |
                      Sort-Object Citations -Descending | Select-Object -First 10)
    $LeastCited  = @($AllNodes | Where-Object { $_.POV -ne 'cross-cutting' -and $_.Citations -gt 0 } |
                      Sort-Object Citations | Select-Object -First 10)

    # Unmapped concepts sorted by frequency
    $UnmappedSorted = @($UnmappedAgg.Values |
        Sort-Object { $_.Frequency } -Descending |
        ForEach-Object {
            [PSCustomObject]@{
                Concept           = $_.Concept
                NormalizedKey     = $_.NormalizedKey
                Frequency         = $_.Frequency
                SuggestedPov      = $_.SuggestedPov
                SuggestedCategory = $_.SuggestedCategory
                ContributingDocs  = $_.ContributingDocs.ToArray()
                Reasons           = $_.Reasons.ToArray()
            }
        })

    $StrongCandidates = @($UnmappedSorted | Where-Object { $_.Frequency -ge 3 })

    # Stance variance per node
    $AlignedFamily  = @('strongly_aligned', 'aligned')
    $OpposedFamily  = @('strongly_opposed', 'opposed')

    $StanceVariance = @{}
    $HighVarianceNodes = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Entry in $NodeIndex.GetEnumerator()) {
        $Id      = $Entry.Key
        $Stances = $Entry.Value.Stances
        if ($Stances.Count -eq 0) { continue }

        $Distribution = @{}
        foreach ($S in $Stances) {
            if (-not $Distribution.ContainsKey($S)) { $Distribution[$S] = 0 }
            $Distribution[$S]++
        }

        $HasAligned = @($Stances | Where-Object { $_ -in $AlignedFamily }).Count -gt 0
        $HasOpposed = @($Stances | Where-Object { $_ -in $OpposedFamily }).Count -gt 0
        $HighVariance = $HasAligned -and $HasOpposed

        $Info = [PSCustomObject]@{
            Id            = $Id
            POV           = $Entry.Value.POV
            Label         = $Entry.Value.Label
            TotalStances  = $Stances.Count
            Distribution  = $Distribution
            HighVariance  = $HighVariance
        }

        $StanceVariance[$Id] = $Info
        if ($HighVariance) {
            $HighVarianceNodes.Add($Info)
        }
    }

    # Coverage balance — node counts per POV per category
    $Categories = @('Goals/Values', 'Data/Facts', 'Methods')
    $CoverageBalance = @{}

    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        $CoverageBalance[$PovKey] = @{}
        foreach ($Cat in $Categories) {
            $Count = @($AllNodes | Where-Object { $_.POV -eq $PovKey -and $_.Category -eq $Cat }).Count
            $CoverageBalance[$PovKey][$Cat] = $Count
        }
    }

    # Cross-cutting reference health
    $CcNodes = @($AllNodes | Where-Object { $_.POV -eq 'cross-cutting' })
    $CcReferenced = @($CcNodes | Where-Object { $_.Citations -gt 0 })
    $CcOrphaned   = @($CcNodes | Where-Object { $_.Citations -eq 0 })

    $CrossCuttingHealth = @{
        TotalNodes     = $CcNodes.Count
        Referenced     = $CcReferenced
        ReferencedCount = $CcReferenced.Count
        Orphaned       = $CcOrphaned
        OrphanedCount  = $CcOrphaned.Count
    }

    # Summary-level statistics
    $TotalKeyPoints  = ($SummaryStats | Measure-Object -Property KeyPoints -Sum).Sum
    $TotalClaims     = ($SummaryStats | Measure-Object -Property FactualClaims -Sum).Sum
    $TotalUnmapped   = ($SummaryStats | Measure-Object -Property UnmappedCount -Sum).Sum
    $AvgKeyPoints    = if ($SummaryStats.Count -gt 0) {
        [math]::Round($TotalKeyPoints / $SummaryStats.Count, 1)
    } else { 0 }

    $MaxDoc = $SummaryStats | Sort-Object { $_.KeyPoints } -Descending | Select-Object -First 1
    $MinDoc = $SummaryStats | Sort-Object { $_.KeyPoints } | Select-Object -First 1

    $SummaryStatsResult = @{
        TotalDocs        = $SummaryStats.Count
        TotalKeyPoints   = $TotalKeyPoints
        TotalClaims      = $TotalClaims
        TotalUnmapped    = $TotalUnmapped
        AvgKeyPoints     = $AvgKeyPoints
        MaxKeyPointsDoc  = $MaxDoc
        MinKeyPointsDoc  = $MinDoc
        PerDoc           = $SummaryStats.ToArray()
    }

    # ── 5. Return hashtable ────────────────────────────────────────────────────
    return @{
        TaxonomyVersion   = $TaxonomyVersion
        SummaryCount      = $SummaryStats.Count
        GeneratedAt       = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
        NodeCitations     = $AllNodes
        OrphanNodes       = $OrphanNodes
        MostCited         = $MostCited
        LeastCited        = $LeastCited
        UnmappedConcepts  = $UnmappedSorted
        StrongCandidates  = $StrongCandidates
        StanceVariance    = $StanceVariance
        HighVarianceNodes = $HighVarianceNodes.ToArray()
        CoverageBalance   = $CoverageBalance
        CrossCuttingHealth = $CrossCuttingHealth
        SummaryStats      = $SummaryStatsResult
    }
}
