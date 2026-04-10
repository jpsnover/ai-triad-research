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
    $PovNames  = @('accelerationist', 'safetyist', 'skeptic', 'situations')

    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            if ($PovKey -eq 'situations') { $NodeCategory = 'Situations' }
            elseif ($Node.PSObject.Properties['category']) { $NodeCategory = $Node.category }
            else { $NodeCategory = '' }
            if ($Node.PSObject.Properties['description']) { $NodeDescription = $Node.description } else { $NodeDescription = '' }
            $NodeIndex[$Node.id] = @{
                POV              = $PovKey
                Category         = $NodeCategory
                Label            = $Node.label
                Description      = $NodeDescription
                Citations        = 0
                DocIds           = [System.Collections.Generic.List[string]]::new()
                Stances          = [System.Collections.Generic.List[string]]::new()
            }
        }
    }

    # ── 2. Read TAXONOMY_VERSION ───────────────────────────────────────────────
    $VersionFile = Get-VersionFile
    if (Test-Path $VersionFile) {
        $TaxonomyVersion = (Get-Content $VersionFile -Raw).Trim()
    } else { $TaxonomyVersion = 'unknown' }

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
                if ($Concept.PSObject.Properties['concept']) { $ConceptText = $Concept.concept } else { $ConceptText = "$Concept" }
                $NormKey = ($ConceptText -replace '\s+', ' ').Trim().ToLower()
                if (-not $NormKey) { continue }
                if ($Concept.PSObject.Properties['suggested_pov'])      { $SugPov = $Concept.suggested_pov }      else { $SugPov = $null }
                if ($Concept.PSObject.Properties['suggested_category']) { $SugCat = $Concept.suggested_category } else { $SugCat = $null }
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
                if ($Concept.PSObject.Properties['reason']) { $ReasonText = $Concept.reason } else { $ReasonText = $null }
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
        $MetaPath = Join-Path (Join-Path $SourcesDir $DocId) 'metadata.json'
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
    $MostCited   = @($AllNodes | Where-Object { $_.POV -ne 'situations' } |
                      Sort-Object Citations -Descending | Select-Object -First 10)
    $LeastCited  = @($AllNodes | Where-Object { $_.POV -ne 'situations' -and $_.Citations -gt 0 } |
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

    # ── Semantic deduplication of unmapped concepts (t/181) ──────────
    # Clusters semantically similar unmapped concepts using embedding cosine similarity.
    # Merges clusters: representative gets summed frequency + unioned contributing docs.
    $SIM_THRESHOLD = 0.75  # Cosine similarity threshold for clustering

    if ($UnmappedSorted.Count -gt 1) {
        $embeddings = Get-TextEmbedding -Texts @($UnmappedSorted.Concept)
        if ($null -ne $embeddings) {
            # Cosine similarity function
            function Get-CosineSim([double[]]$a, [double[]]$b) {
                $dot = 0.0; $na = 0.0; $nb = 0.0
                for ($k = 0; $k -lt $a.Length; $k++) {
                    $dot += $a[$k] * $b[$k]
                    $na += $a[$k] * $a[$k]
                    $nb += $b[$k] * $b[$k]
                }
                $denom = [Math]::Sqrt($na) * [Math]::Sqrt($nb)
                if ($denom -eq 0) { return 0 }
                return $dot / $denom
            }

            # Single-linkage clustering
            $clusterId = @{}  # index → cluster representative index
            for ($i = 0; $i -lt $UnmappedSorted.Count; $i++) { $clusterId[$i] = $i }

            $vecKeys = @($embeddings.Keys | Sort-Object { [int]$_ })
            for ($i = 0; $i -lt $UnmappedSorted.Count; $i++) {
                $vecI = $embeddings["$i"]
                if (-not $vecI) { continue }
                for ($j = $i + 1; $j -lt $UnmappedSorted.Count; $j++) {
                    $vecJ = $embeddings["$j"]
                    if (-not $vecJ) { continue }
                    if ($clusterId[$i] -eq $clusterId[$j]) { continue }  # already same cluster

                    $sim = Get-CosineSim ([double[]]$vecI) ([double[]]$vecJ)
                    if ($sim -ge $SIM_THRESHOLD) {
                        # Merge: assign j's cluster to i's cluster representative
                        $oldCluster = $clusterId[$j]
                        $newCluster = $clusterId[$i]
                        for ($m = 0; $m -lt $UnmappedSorted.Count; $m++) {
                            if ($clusterId[$m] -eq $oldCluster) { $clusterId[$m] = $newCluster }
                        }
                    }
                }
            }

            # Group by cluster and merge
            $clusters = @{}
            for ($i = 0; $i -lt $UnmappedSorted.Count; $i++) {
                $rep = $clusterId[$i]
                if (-not $clusters.ContainsKey($rep)) { $clusters[$rep] = @() }
                $clusters[$rep] += $i
            }

            $mergedCount = 0
            $dedupedList = [System.Collections.Generic.List[PSObject]]::new()
            foreach ($entry in $clusters.GetEnumerator()) {
                $indices = $entry.Value
                if ($indices.Count -eq 1) {
                    $dedupedList.Add($UnmappedSorted[$indices[0]])
                    continue
                }

                # Pick representative: highest frequency, then longest description
                $members = @($indices | ForEach-Object { $UnmappedSorted[$_] })
                $rep = $members | Sort-Object { $_.Frequency } -Descending |
                                  Sort-Object { $_.Concept.Length } -Descending |
                                  Select-Object -First 1

                # Merge metadata from all members
                $allDocs = [System.Collections.Generic.HashSet[string]]::new()
                $allReasons = [System.Collections.Generic.List[string]]::new()
                $totalFreq = 0
                foreach ($m in $members) {
                    $totalFreq += $m.Frequency
                    foreach ($d in $m.ContributingDocs) { [void]$allDocs.Add($d) }
                    foreach ($r in $m.Reasons) {
                        if ($r -and $r -notin $allReasons) { $allReasons.Add($r) }
                    }
                }

                $merged = [PSCustomObject]@{
                    Concept           = $rep.Concept
                    NormalizedKey     = $rep.NormalizedKey
                    Frequency         = $totalFreq
                    SuggestedPov      = $rep.SuggestedPov
                    SuggestedCategory = $rep.SuggestedCategory
                    ContributingDocs  = @($allDocs)
                    Reasons           = @($allReasons)
                    ClusterSize       = $indices.Count
                }
                $dedupedList.Add($merged)
                $mergedCount += ($indices.Count - 1)
            }

            $UnmappedSorted = @($dedupedList | Sort-Object { $_.Frequency } -Descending)
            Write-Verbose "Semantic dedup: merged $mergedCount duplicates, $($UnmappedSorted.Count) unique concepts remain"
        }
    }

    # ── Auto-resolve unmapped concepts that duplicate existing nodes ────
    # Compares each unmapped concept description against cached node embeddings
    # (which are computed from node descriptions). Concepts above threshold are
    # resolved to the matching node and removed from the unmapped list.
    $NODE_SIM_THRESHOLD = 0.80
    $NearestNodeMap = @{}

    if ($UnmappedSorted.Count -gt 0) {
        # Load cached node embeddings (description-based, from embeddings.json)
        $EmbPath = Join-Path (Get-TaxonomyDir) 'embeddings.json'
        $NodeEmbeddings = $null
        if (Test-Path $EmbPath) {
            try {
                $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
                $NodeEmbeddings = @{}
                foreach ($Prop in $EmbData.nodes.PSObject.Properties) {
                    $NodeEmbeddings[$Prop.Name] = [double[]]@($Prop.Value.vector)
                }
            }
            catch {
                Write-Verbose "Get-TaxonomyHealthData: failed to load embeddings.json — skipping node similarity check"
            }
        }

        if ($null -ne $NodeEmbeddings -and $NodeEmbeddings.Count -gt 0) {
            # Embed unmapped concept texts (use concept label as the text)
            $conceptEmbeddings = Get-TextEmbedding -Texts @($UnmappedSorted.Concept)
            if ($null -ne $conceptEmbeddings) {
                $autoResolved = 0
                $afterNodeFilter = [System.Collections.Generic.List[PSObject]]::new()
                # Track nearest-node matches for concepts that survive filtering
                $NearestNodeMap = @{}

                for ($i = 0; $i -lt $UnmappedSorted.Count; $i++) {
                    $conceptVec = $conceptEmbeddings["$i"]
                    if (-not $conceptVec) {
                        $afterNodeFilter.Add($UnmappedSorted[$i])
                        continue
                    }

                    # Find best matching node by cosine similarity on descriptions
                    $bestSim = -1.0
                    $bestNodeId = $null
                    $topMatches = [System.Collections.Generic.List[PSObject]]::new()

                    foreach ($NodeId in $NodeEmbeddings.Keys) {
                        $nodeVec = $NodeEmbeddings[$NodeId]
                        if ($nodeVec.Count -ne $conceptVec.Count) { continue }

                        $dot = 0.0; $na = 0.0; $nb = 0.0
                        for ($k = 0; $k -lt $conceptVec.Count; $k++) {
                            $dot += $conceptVec[$k] * $nodeVec[$k]
                            $na  += $conceptVec[$k] * $conceptVec[$k]
                            $nb  += $nodeVec[$k] * $nodeVec[$k]
                        }
                        $denom = [Math]::Sqrt($na) * [Math]::Sqrt($nb)
                        if ($denom -gt 0) { $sim = $dot / $denom } else { $sim = 0.0 }

                        if ($sim -gt $bestSim) {
                            $bestSim = $sim
                            $bestNodeId = $NodeId
                        }

                        # Track top-3 for prompt enrichment
                        $topMatches.Add([PSCustomObject]@{ NodeId = $NodeId; Similarity = [Math]::Round($sim, 4) })
                    }

                    $top3 = @($topMatches | Sort-Object Similarity -Descending | Select-Object -First 3)
                    $NearestNodeMap[$UnmappedSorted[$i].NormalizedKey] = $top3

                    if ($bestSim -ge $NODE_SIM_THRESHOLD -and $bestNodeId) {
                        $autoResolved++
                        Write-Verbose ("Auto-resolved unmapped concept '{0}' -> {1} (sim={2:N3})" -f $UnmappedSorted[$i].Concept, $bestNodeId, $bestSim)
                    }
                    else {
                        $afterNodeFilter.Add($UnmappedSorted[$i])
                    }
                }

                $UnmappedSorted = @($afterNodeFilter | Sort-Object { $_.Frequency } -Descending)
                if ($autoResolved -gt 0) {
                    Write-Verbose "Node similarity filter: auto-resolved $autoResolved unmapped concepts (threshold=$NODE_SIM_THRESHOLD), $($UnmappedSorted.Count) remain"
                }
            }
        }
    }

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
    $CcNodes = @($AllNodes | Where-Object { $_.POV -eq 'situations' })
    $CcReferenced = @($CcNodes | Where-Object { $_.Citations -gt 0 })
    $CcOrphaned   = @($CcNodes | Where-Object { $_.Citations -eq 0 })

    $CrossCuttingHealth = @{
        TotalNodes     = $CcNodes.Count
        Referenced     = $CcReferenced
        ReferencedCount = $CcReferenced.Count
        Orphaned       = $CcOrphaned
        OrphanedCount  = $CcOrphaned.Count
    }

    # ── TaxoAdapt mapping density signals (POV-normalized) ─────────────────────
    $DensitySignals = [System.Collections.Generic.List[PSObject]]::new()

    # Build parent→children map from raw taxonomy data
    $ChildrenMap = @{}  # parent_id → list of child IDs
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            if ($Node.PSObject.Properties['parent_id'] -and $Node.parent_id) {
                if (-not $ChildrenMap.ContainsKey($Node.parent_id)) {
                    $ChildrenMap[$Node.parent_id] = [System.Collections.Generic.List[string]]::new()
                }
                $ChildrenMap[$Node.parent_id].Add($Node.id)
            }
        }
    }

    # Signal 1: Leaf node density — parents with too many direct children → depth expansion
    $DepthExpandThreshold = 8
    foreach ($ParentId in $ChildrenMap.Keys) {
        $ChildCount = $ChildrenMap[$ParentId].Count
        if ($ChildCount -ge $DepthExpandThreshold -and $NodeIndex.ContainsKey($ParentId)) {
            $ParentInfo = $NodeIndex[$ParentId]
            $DensitySignals.Add([PSCustomObject][ordered]@{
                signal     = 'depth_expand'
                node_id    = $ParentId
                pov        = $ParentInfo.POV
                category   = $ParentInfo.Category
                label      = $ParentInfo.Label
                metric     = $ChildCount
                detail     = "$ParentId has $ChildCount direct children (threshold: $DepthExpandThreshold)"
            })
        }
    }

    # Signal 2: Unmapped concept rate per POV×category branch → width expansion
    # Counts how many unmapped concepts were suggested for each POV×category
    $UnmappedByBranch = @{}
    foreach ($UC in $UnmappedSorted) {
        $Key = "$($UC.SuggestedPov)|$($UC.SuggestedCategory)"
        if (-not $UnmappedByBranch.ContainsKey($Key)) { $UnmappedByBranch[$Key] = 0 }
        $UnmappedByBranch[$Key] += $UC.Frequency
    }

    $WidthExpandThreshold = 5  # total frequency of unmapped concepts in a branch
    foreach ($Branch in $UnmappedByBranch.GetEnumerator()) {
        if ($Branch.Value -ge $WidthExpandThreshold) {
            $Parts = $Branch.Key -split '\|'
            $BranchPov = $Parts[0]; $BranchCat = $Parts[1]
            $DensitySignals.Add([PSCustomObject][ordered]@{
                signal     = 'width_expand'
                node_id    = $null
                pov        = $BranchPov
                category   = $BranchCat
                label      = "$BranchPov/$BranchCat"
                metric     = $Branch.Value
                detail     = "$BranchPov/$BranchCat has $($Branch.Value) unmapped concept frequency (threshold: $WidthExpandThreshold)"
            })
        }
    }

    # Signal 3: POV-normalized coverage imbalance
    # Compare each POV×category against the MEAN across POVs (not absolute counts)
    $PovKeys = @('accelerationist', 'safetyist', 'skeptic')
    foreach ($Cat in $Categories) {
        $Counts = @($PovKeys | ForEach-Object { $CoverageBalance[$_][$Cat] })
        $Mean = ($Counts | Measure-Object -Average).Average
        if ($Mean -eq 0) { continue }

        foreach ($Pov in $PovKeys) {
            $Count = $CoverageBalance[$Pov][$Cat]
            $Ratio = $Count / $Mean
            # Flag if a POV is below 60% of the mean (under-represented) or above 160% (over-represented)
            if ($Ratio -lt 0.6) {
                $DensitySignals.Add([PSCustomObject][ordered]@{
                    signal     = 'pov_imbalance_under'
                    node_id    = $null
                    pov        = $Pov
                    category   = $Cat
                    label      = "$Pov/$Cat"
                    metric     = [Math]::Round($Ratio, 2)
                    detail     = "$Pov has $Count nodes in $Cat vs mean $([Math]::Round($Mean, 1)) ($([Math]::Round($Ratio * 100))% of mean)"
                })
            }
            elseif ($Ratio -gt 1.6) {
                $DensitySignals.Add([PSCustomObject][ordered]@{
                    signal     = 'pov_imbalance_over'
                    node_id    = $null
                    pov        = $Pov
                    category   = $Cat
                    label      = "$Pov/$Cat"
                    metric     = [Math]::Round($Ratio, 2)
                    detail     = "$Pov has $Count nodes in $Cat vs mean $([Math]::Round($Mean, 1)) ($([Math]::Round($Ratio * 100))% of mean) — expansion here would INCREASE imbalance"
                })
            }
        }
    }

    # Summary-level statistics
    $TotalKeyPoints  = ($SummaryStats | Measure-Object -Property KeyPoints -Sum).Sum
    $TotalClaims     = ($SummaryStats | Measure-Object -Property FactualClaims -Sum).Sum
    $TotalUnmapped   = ($SummaryStats | Measure-Object -Property UnmappedCount -Sum).Sum
    if ($SummaryStats.Count -gt 0) {
        $AvgKeyPoints = [math]::Round($TotalKeyPoints / $SummaryStats.Count, 1)
    } else { $AvgKeyPoints = 0 }

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
            $EdgesData    = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
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
                if ($SamePovContradicts -gt 0) {
                    $EchoRatio = [Math]::Round($SamePovSupports / $SamePovContradicts, 2)
                } else {
                    if ($SamePovSupports -gt 0) { $EchoRatio = [double]::PositiveInfinity } else { $EchoRatio = 0.0 }
                }
                $EchoChamberScores[$PovKey] = [ordered]@{
                    SamePovSupports    = $SamePovSupports
                    SamePovContradicts = $SamePovContradicts
                    Ratio              = $EchoRatio
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
            if ($TotalEdgeCount -gt 0) {
                $CrossPovPct = [Math]::Round(($CrossPovEdgeCount / $TotalEdgeCount) * 100, 1)
            } else { $CrossPovPct = 0.0 }

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
                    if ($Edge.source -lt $Edge.target) { $PairKey = "$($Edge.source)|$($Edge.target)" } else { $PairKey = "$($Edge.target)|$($Edge.source)" }
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

            if ($Degrees.Count -gt 0) { $MaxDeg = $Degrees[-1] } else { $MaxDeg = 0 }
            if ($Degrees.Count -gt 0) { $MedDeg = $Degrees[[Math]::Floor($Degrees.Count / 2)] } else { $MedDeg = 0 }
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
                    MaxDegree       = $MaxDeg
                    MedianDegree    = $MedDeg
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
        DensitySignals    = $DensitySignals.ToArray()
        NearestNodeMap    = if ($NearestNodeMap) { $NearestNodeMap } else { @{} }
    }
}
