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

    # ── 1. Build node index from $script:TaxonomyData ─────────────────────────
    $NodeIndex = @{}    # keyed by node id
    $PovNames  = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')

    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $NodeIndex[$Node.id] = @{
                POV              = $PovKey
                Category         = if ($PovKey -eq 'cross-cutting') { 'Cross-Cutting' }
                                   elseif ($Node.PSObject.Properties['category']) { $Node.category }
                                   else { '' }
                Label            = $Node.label
                Description      = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
                Citations        = 0
                DocIds           = [System.Collections.Generic.List[string]]::new()
                Stances          = [System.Collections.Generic.List[string]]::new()
            }
        }
    }

    # ── 2. Read TAXONOMY_VERSION ───────────────────────────────────────────────
    $VersionFile = Get-VersionFile
    $TaxonomyVersion = if (Test-Path $VersionFile) {
        (Get-Content $VersionFile -Raw).Trim()
    } else { 'unknown' }

    # ── 3. Scan every summaries/*.json ─────────────────────────────────────────
    $SummariesDir = Get-SummariesDir
    $SourcesDir   = Get-SourcesDir

    if (-not (Test-Path $SummariesDir)) {
        throw "Summaries directory not found: $SummariesDir"
    }

    $SummaryFiles = Get-ChildItem -Path $SummariesDir -Filter '*.json' -File
    $UnmappedAgg  = @{}   # lowercased concept → aggregation object
    $SummaryStats = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($File in $SummaryFiles) {
        try {
            $Summary = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json -Depth 20
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
                $ConceptText = if ($Concept.PSObject.Properties['concept']) { $Concept.concept } else { "$Concept" }
                $NormKey = ($ConceptText -replace '\s+', ' ').Trim().ToLower()
                if (-not $NormKey) { continue }
                $SugPov = if ($Concept.PSObject.Properties['suggested_pov'])      { $Concept.suggested_pov }      else { $null }
                $SugCat = if ($Concept.PSObject.Properties['suggested_category']) { $Concept.suggested_category } else { $null }
                if (-not $UnmappedAgg.ContainsKey($NormKey)) {
                    $UnmappedAgg[$NormKey] = @{
                        Concept           = $ConceptText
                        NormalizedKey     = $NormKey
                        Frequency         = 0
                        SuggestedPov      = $SugPov
                        SuggestedCategory = $SugCat
                        ContributingDocs  = [System.Collections.Generic.List[string]]::new()
                        Reasons           = [System.Collections.Generic.List[string]]::new()
                    }
                }
                $UnmappedAgg[$NormKey].Frequency++
                if ($DocId -notin $UnmappedAgg[$NormKey].ContributingDocs) {
                    $UnmappedAgg[$NormKey].ContributingDocs.Add($DocId)
                }
                $ReasonText = if ($Concept.PSObject.Properties['reason']) { $Concept.reason } else { $null }
                if ($ReasonText -and $ReasonText -notin $UnmappedAgg[$NormKey].Reasons) {
                    $UnmappedAgg[$NormKey].Reasons.Add($ReasonText)
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
                $Meta  = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json -Depth 20
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
    $Categories = @('Beliefs', 'Desires', 'Intentions')
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

    # ── 5. Graph health metrics (when -GraphMode) ──────────────────────────────
    $GraphHealth = $null
    if ($GraphMode) {
        $TaxDir   = Get-TaxonomyDir
        $EdgesPath = Join-Path $TaxDir 'edges.json'

        if (-not (Test-Path $EdgesPath)) {
            Write-Warning "Get-TaxonomyHealthData: edges.json not found — GraphMode metrics unavailable"
        }
        else {
            $EdgesData    = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json -Depth 20
            $ApprovedEdges = @($EdgesData.edges | Where-Object { $_.status -eq 'approved' })

            # Build POV lookup for each node
            $NodePovLookup = @{}
            foreach ($PovKey in $PovNames) {
                $Entry = $script:TaxonomyData[$PovKey]
                if (-not $Entry) { continue }
                foreach ($Node in $Entry.nodes) {
                    $NodePovLookup[$Node.id] = $PovKey
                }
            }

            # ── Echo chamber score per POV ──
            # Ratio of SUPPORTS to CONTRADICTS edges within the same POV
            $EchoChamberScores = @{}
            foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
                $SamePovSupports    = 0
                $SamePovContradicts = 0
                foreach ($Edge in $ApprovedEdges) {
                    $SPov = $NodePovLookup[$Edge.source]
                    $TPov = $NodePovLookup[$Edge.target]
                    if ($SPov -eq $PovKey -and $TPov -eq $PovKey) {
                        if ($Edge.type -eq 'SUPPORTS')    { $SamePovSupports++ }
                        if ($Edge.type -eq 'CONTRADICTS') { $SamePovContradicts++ }
                    }
                }
                $EchoChamberScores[$PovKey] = [ordered]@{
                    SamePovSupports    = $SamePovSupports
                    SamePovContradicts = $SamePovContradicts
                    Ratio              = if ($SamePovContradicts -gt 0) {
                        [Math]::Round($SamePovSupports / $SamePovContradicts, 2)
                    } else {
                        if ($SamePovSupports -gt 0) { [double]::PositiveInfinity } else { 0.0 }
                    }
                }
            }

            # ── Cross-POV connectivity ──
            $CrossPovEdgeCount = 0
            $TotalEdgeCount    = $ApprovedEdges.Count
            foreach ($Edge in $ApprovedEdges) {
                $SPov = $NodePovLookup[$Edge.source]
                $TPov = $NodePovLookup[$Edge.target]
                if ($SPov -and $TPov -and $SPov -ne $TPov) {
                    $CrossPovEdgeCount++
                }
            }
            $CrossPovPct = if ($TotalEdgeCount -gt 0) {
                [Math]::Round(($CrossPovEdgeCount / $TotalEdgeCount) * 100, 1)
            } else { 0.0 }

            # ── Edge orphans (nodes with 0 edges) ──
            $EdgedNodes = [System.Collections.Generic.HashSet[string]]::new()
            foreach ($Edge in $ApprovedEdges) {
                [void]$EdgedNodes.Add($Edge.source)
                [void]$EdgedNodes.Add($Edge.target)
            }
            $EdgeOrphans = @($NodePovLookup.Keys | Where-Object { -not $EdgedNodes.Contains($_) } | Sort-Object)

            # ── Hub concentration (Gini coefficient of degree distribution) ──
            $DegreeMap = @{}
            foreach ($NId in $NodePovLookup.Keys) { $DegreeMap[$NId] = 0 }
            foreach ($Edge in $ApprovedEdges) {
                if ($DegreeMap.ContainsKey($Edge.source)) { $DegreeMap[$Edge.source]++ }
                if ($DegreeMap.ContainsKey($Edge.target)) { $DegreeMap[$Edge.target]++ }
            }
            $Degrees = @($DegreeMap.Values | Sort-Object)
            $N = $Degrees.Count
            $GiniCoeff = 0.0
            if ($N -gt 0) {
                $SumDiff = 0.0
                $SumAll  = 0.0
                for ($i = 0; $i -lt $N; $i++) {
                    $SumAll += $Degrees[$i]
                    for ($j = 0; $j -lt $N; $j++) {
                        $SumDiff += [Math]::Abs($Degrees[$i] - $Degrees[$j])
                    }
                }
                if ($SumAll -gt 0) {
                    $GiniCoeff = [Math]::Round($SumDiff / (2 * $N * $SumAll), 4)
                }
            }

            # ── Missing edge type pairs ──
            # Cross-POV node pairs with SUPPORTS but no CONTRADICTS
            $CrossPovSupports    = [System.Collections.Generic.HashSet[string]]::new()
            $CrossPovContradicts = [System.Collections.Generic.HashSet[string]]::new()
            foreach ($Edge in $ApprovedEdges) {
                $SPov = $NodePovLookup[$Edge.source]
                $TPov = $NodePovLookup[$Edge.target]
                if ($SPov -and $TPov -and $SPov -ne $TPov) {
                    $PairKey = if ($Edge.source -lt $Edge.target) { "$($Edge.source)|$($Edge.target)" } else { "$($Edge.target)|$($Edge.source)" }
                    if ($Edge.type -eq 'SUPPORTS')    { [void]$CrossPovSupports.Add($PairKey) }
                    if ($Edge.type -eq 'CONTRADICTS') { [void]$CrossPovContradicts.Add($PairKey) }
                }
            }
            $MissingContradicts = @($CrossPovSupports | Where-Object { -not $CrossPovContradicts.Contains($_) })

            # ── Echo chamber nodes (many SUPPORTS, 0 cross-POV CONTRADICTS) ──
            $NodeCrossPovContradicts = @{}
            $NodeSupportsCount      = @{}
            foreach ($Edge in $ApprovedEdges) {
                $SPov = $NodePovLookup[$Edge.source]
                $TPov = $NodePovLookup[$Edge.target]
                if ($Edge.type -eq 'SUPPORTS') {
                    if (-not $NodeSupportsCount.ContainsKey($Edge.source)) { $NodeSupportsCount[$Edge.source] = 0 }
                    $NodeSupportsCount[$Edge.source]++
                }
                if ($Edge.type -eq 'CONTRADICTS' -and $SPov -ne $TPov) {
                    if (-not $NodeCrossPovContradicts.ContainsKey($Edge.source)) { $NodeCrossPovContradicts[$Edge.source] = 0 }
                    if (-not $NodeCrossPovContradicts.ContainsKey($Edge.target)) { $NodeCrossPovContradicts[$Edge.target] = 0 }
                    $NodeCrossPovContradicts[$Edge.source]++
                    $NodeCrossPovContradicts[$Edge.target]++
                }
            }
            $EchoChamberNodes = @($NodeSupportsCount.Keys | Where-Object {
                $NodeSupportsCount[$_] -ge 3 -and
                (-not $NodeCrossPovContradicts.ContainsKey($_) -or $NodeCrossPovContradicts[$_] -eq 0)
            } | Sort-Object { $NodeSupportsCount[$_] } -Descending)

            $GraphHealth = [ordered]@{
                EchoChamberScores    = $EchoChamberScores
                CrossPovConnectivity = [ordered]@{
                    CrossPovEdges = $CrossPovEdgeCount
                    TotalEdges    = $TotalEdgeCount
                    Percentage    = $CrossPovPct
                }
                EdgeOrphans          = $EdgeOrphans
                EdgeOrphanCount      = $EdgeOrphans.Count
                HubConcentration     = [ordered]@{
                    GiniCoefficient = $GiniCoeff
                    MaxDegree       = if ($Degrees.Count -gt 0) { $Degrees[-1] } else { 0 }
                    MedianDegree    = if ($Degrees.Count -gt 0) { $Degrees[[Math]::Floor($Degrees.Count / 2)] } else { 0 }
                }
                MissingEdgeTypePairs = [ordered]@{
                    SupportsNoContradicts = $MissingContradicts
                    Count                 = $MissingContradicts.Count
                }
                EchoChamberNodes     = $EchoChamberNodes
                EchoChamberNodeCount = $EchoChamberNodes.Count
            }
        }
    }

    # ── 6. Return hashtable ────────────────────────────────────────────────────
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
        GraphHealth       = $GraphHealth
    }
}
