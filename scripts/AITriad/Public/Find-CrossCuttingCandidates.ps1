# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-CrossCuttingCandidates {
    <#
    .SYNOPSIS
        Discovers candidate cross-cutting concepts by clustering similar nodes across POVs.
    .DESCRIPTION
        Computes cross-POV pairwise cosine similarity from taxonomy embeddings, filters to
        pairs above threshold, classifies each pair using an NLI cross-encoder
        (entailment/neutral/contradiction) to distinguish genuine shared concepts from
        opposing positions on the same topic, merges overlapping pairs into groups, boosts
        scores for pairs with TENSION_WITH/CONTRADICTS edges or shared attributes, then
        optionally calls an LLM to propose cross-cutting node labels and interpretations.

        The NLI classification uses cross-encoder/nli-deberta-v3-small (local, no API
        required) and tags each candidate pair so the downstream LLM prompt can distinguish
        agreement clusters from tension clusters.
    .PARAMETER TopN
        Number of top candidates to return (1-30, default 10).
    .PARAMETER MinSimilarity
        Cosine similarity threshold (0.50-0.95, default 0.60).
    .PARAMETER OutputFile
        Optional path to write results as JSON.
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
        Find-CrossCuttingCandidates -NoAI
    .EXAMPLE
        Find-CrossCuttingCandidates -MinSimilarity 0.80 -OutputFile cc.json
    .EXAMPLE
        Find-CrossCuttingCandidates -NoNLI
    .EXAMPLE
        Find-CrossCuttingCandidates -ShowSharedOnly -TopN 10
    .EXAMPLE
        Find-CrossCuttingCandidates -ShowDebatesOnly -TopN 10
    #>
    [CmdletBinding()]
    param(
        [ValidateRange(1, 30)]
        [int]$TopN = 10,

        [ValidateRange(0.50, 0.95)]
        [double]$MinSimilarity = 0.60,

        [string]$OutputFile,

        [switch]$NoAI,

        [switch]$NoNLI,

        [switch]$ShowSharedOnly,

        [switch]$ShowDebatesOnly,

        [string]$Model,

        [string]$ApiKey,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if ($ShowSharedOnly -and $ShowDebatesOnly) {
        throw '-ShowSharedOnly and -ShowDebatesOnly are mutually exclusive.'
    }

    if (-not $Model) {
        $Model = if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.1-flash-lite-preview' }
    }

    # ── Step 1: Build node index ──────────────────────────────────────────────
    Write-Step 'Building node index'
    $NodeIndex = @{}
    $PovNames  = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')

    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $NodeIndex[$Node.id] = @{
                Label       = $Node.label
                Description = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
                POV         = $PovKey
                GraphAttrs  = if ($Node.PSObject.Properties['graph_attributes']) { $Node.graph_attributes } else { $null }
            }
        }
    }
    Write-OK "Indexed $($NodeIndex.Count) nodes"

    # ── Step 2: Load embeddings ───────────────────────────────────────────────
    Write-Step 'Loading embeddings'
    $EmbeddingsFile = Join-Path (Get-TaxonomyDir) 'embeddings.json'
    $Embeddings     = @{}

    if (-not (Test-Path $EmbeddingsFile)) {
        Write-Fail 'embeddings.json not found — cannot compute similarities'
        throw 'embeddings.json required for cross-cutting candidate discovery'
    }

    $EmbData = Get-Content -Raw -Path $EmbeddingsFile | ConvertFrom-Json
    $EmbNodes = if ($EmbData.PSObject.Properties['nodes']) { $EmbData.nodes } else { $EmbData }
    foreach ($Prop in $EmbNodes.PSObject.Properties) {
        $Val = $Prop.Value
        if ($Val -is [array]) {
            $Embeddings[$Prop.Name] = [double[]]$Val
        }
        elseif ($Val.PSObject.Properties['vector']) {
            $Embeddings[$Prop.Name] = [double[]]$Val.vector
        }
    }
    Write-OK "Loaded $($Embeddings.Count) embeddings"

    # ── Step 3: Load edges for boost scoring ──────────────────────────────────
    Write-Step 'Loading edges'
    $TaxDir    = Get-TaxonomyDir
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $EdgePairs = @{}  # "nodeA|nodeB" → list of edge types

    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
        foreach ($Edge in $EdgesData.edges) {
            $EdgeStatus = if ($Edge.PSObject.Properties['status']) { $Edge.status } else { '' }
            if ($EdgeStatus -ne 'approved') { continue }
            $PairKey = if ($Edge.source -lt $Edge.target) { "$($Edge.source)|$($Edge.target)" } else { "$($Edge.target)|$($Edge.source)" }
            if (-not $EdgePairs.ContainsKey($PairKey)) {
                $EdgePairs[$PairKey] = [System.Collections.Generic.List[string]]::new()
            }
            $EdgePairs[$PairKey].Add($Edge.type)
        }
    }
    Write-OK "Loaded edge data for boost scoring"

    # ── Step 4: Build existing cc-node links ──────────────────────────────────
    # Find pairs already linked via cross-cutting nodes (via INTERPRETS edges or cc refs)
    $CcLinkedPairs = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($PairKey in $EdgePairs.Keys) {
        $Parts = $PairKey -split '\|'
        $Pov0 = if ($NodeIndex.ContainsKey($Parts[0])) { $NodeIndex[$Parts[0]].POV } else { '' }
        $Pov1 = if ($NodeIndex.ContainsKey($Parts[1])) { $NodeIndex[$Parts[1]].POV } else { '' }
        if ($Pov0 -eq 'cross-cutting' -or $Pov1 -eq 'cross-cutting') {
            [void]$CcLinkedPairs.Add($PairKey)
        }
    }

    # ── Step 5: Compute cross-POV pairwise similarities ───────────────────────
    Write-Step 'Computing cross-POV pairwise cosine similarities'

    # Cosine similarity
    $CosineSim = {
        param([double[]]$A, [double[]]$B)
        if ($A.Length -ne $B.Length) { return 0.0 }
        $Dot = 0.0; $NormA = 0.0; $NormB = 0.0
        for ($i = 0; $i -lt $A.Length; $i++) {
            $Dot   += $A[$i] * $B[$i]
            $NormA += $A[$i] * $A[$i]
            $NormB += $B[$i] * $B[$i]
        }
        $Denom = [Math]::Sqrt($NormA) * [Math]::Sqrt($NormB)
        if ($Denom -eq 0) { return 0.0 }
        return $Dot / $Denom
    }

    # Get non-cc node IDs with embeddings
    $PovNodeIds = @($NodeIndex.Keys | Where-Object {
        $NodeIndex[$_].POV -ne 'cross-cutting' -and $Embeddings.ContainsKey($_)
    })

    $SimilarPairs = [System.Collections.Generic.List[PSObject]]::new()
    $PairCount = 0

    for ($i = 0; $i -lt $PovNodeIds.Count; $i++) {
        for ($j = $i + 1; $j -lt $PovNodeIds.Count; $j++) {
            $IdA = $PovNodeIds[$i]
            $IdB = $PovNodeIds[$j]

            # Only cross-POV pairs
            if ($NodeIndex[$IdA].POV -eq $NodeIndex[$IdB].POV) { continue }

            $PairCount++
            $Sim = & $CosineSim $Embeddings[$IdA] $Embeddings[$IdB]
            if ($Sim -lt $MinSimilarity) { continue }

            # Check if already linked via cc-node
            $PairKey = if ($IdA -lt $IdB) { "$IdA|$IdB" } else { "$IdB|$IdA" }
            if ($CcLinkedPairs.Contains($PairKey)) { continue }

            # Boost score
            $BoostedSim = $Sim
            if ($EdgePairs.ContainsKey($PairKey)) {
                $Types = $EdgePairs[$PairKey]
                if ($Types -contains 'TENSION_WITH' -or $Types -contains 'CONTRADICTS') {
                    $BoostedSim += 0.05
                }
            }

            # Boost for shared attributes
            $AttrsA = $NodeIndex[$IdA].GraphAttrs
            $AttrsB = $NodeIndex[$IdB].GraphAttrs
            if ($null -ne $AttrsA -and $null -ne $AttrsB) {
                $SharedAttr = $false
                foreach ($AttrName in @('assumes', 'intellectual_lineage')) {
                    $RawA = if ($AttrsA.PSObject.Properties[$AttrName]) { $AttrsA.$AttrName } else { $null }
                    $RawB = if ($AttrsB.PSObject.Properties[$AttrName]) { $AttrsB.$AttrName } else { $null }
                    if ($null -eq $RawA -or $null -eq $RawB) { continue }
                    $ListA = [string[]]@($RawA)
                    $ListB = [string[]]@($RawB)
                    if ($ListA.Length -gt 0 -and $ListB.Length -gt 0) {
                        foreach ($V in $ListA) {
                            if ($V -in $ListB) { $SharedAttr = $true; break }
                        }
                    }
                    if ($SharedAttr) { break }
                }
                if ($SharedAttr) { $BoostedSim += 0.03 }
            }

            $SimilarPairs.Add([PSCustomObject]@{
                IdA        = $IdA
                IdB        = $IdB
                Similarity = [Math]::Round($Sim, 4)
                Boosted    = [Math]::Round($BoostedSim, 4)
            })
        }
    }

    Write-OK "Checked $PairCount cross-POV pairs, found $($SimilarPairs.Count) above threshold"

    # ── Step 5b: NLI cross-encoder classification ────────────────────────────
    if (-not $NoNLI -and $SimilarPairs.Count -gt 0) {
        Write-Step 'Running NLI cross-encoder classification'

        $EmbedScript = Join-Path $RepoRoot 'scripts' 'embed_taxonomy.py'
        # Frame each node as a POV-attributed proposition so the NLI model
        # can distinguish agreement from opposition on the same topic.
        $NliInput = @($SimilarPairs | ForEach-Object {
            $InfoA = $NodeIndex[$_.IdA]
            $InfoB = $NodeIndex[$_.IdB]
            $DescA = if ([string]::IsNullOrWhiteSpace($InfoA.Description)) { $InfoA.Label } else { $InfoA.Description }
            $DescB = if ([string]::IsNullOrWhiteSpace($InfoB.Description)) { $InfoB.Label } else { $InfoB.Description }
            @{
                text_a = "The $($InfoA.POV) position is: $($InfoA.Label) — $DescA"
                text_b = "The $($InfoB.POV) position is: $($InfoB.Label) — $DescB"
            }
        })

        $NliJson = $NliInput | ConvertTo-Json -Depth 5 -Compress
        try {
            $NliResult = $NliJson | python3 $EmbedScript nli-classify 2>$null
            $NliParsed = $NliResult | ConvertFrom-Json

            for ($i = 0; $i -lt $SimilarPairs.Count; $i++) {
                if ($i -lt $NliParsed.Count) {
                    $SimilarPairs[$i] | Add-Member -NotePropertyName 'NliLabel'         -NotePropertyValue $NliParsed[$i].nli_label         -Force
                    $SimilarPairs[$i] | Add-Member -NotePropertyName 'NliEntailment'    -NotePropertyValue $NliParsed[$i].nli_entailment    -Force
                    $SimilarPairs[$i] | Add-Member -NotePropertyName 'NliContradiction' -NotePropertyValue $NliParsed[$i].nli_contradiction -Force
                }
            }

            $Entailments    = @($SimilarPairs | Where-Object { $_.NliLabel -eq 'entailment' }).Count
            $Contradictions = @($SimilarPairs | Where-Object { $_.NliLabel -eq 'contradiction' }).Count
            $Neutrals       = @($SimilarPairs | Where-Object { $_.NliLabel -eq 'neutral' }).Count
            Write-OK "NLI: $Entailments entailment, $Neutrals neutral, $Contradictions contradiction"
        }
        catch {
            Write-Warn "NLI classification failed: $_ — continuing without NLI labels"
        }
    }

    # ── Step 6: Merge overlapping pairs into groups ───────────────────────────
    # Only entailment/neutral pairs are merged via union-find (shared concepts).
    # Contradiction pairs are kept as separate debate clusters.
    Write-Step 'Merging overlapping pairs into clusters'

    $HasNli = ($SimilarPairs.Count -gt 0 -and
               $SimilarPairs[0].PSObject.Properties['NliLabel'] -and
               $SimilarPairs[0].NliLabel)

    # Partition pairs by NLI label
    $AgreementPairs    = [System.Collections.Generic.List[PSObject]]::new()
    $ContradictionPairs = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Pair in $SimilarPairs) {
        if ($HasNli -and $Pair.NliLabel -eq 'contradiction') {
            $ContradictionPairs.Add($Pair)
        }
        else {
            $AgreementPairs.Add($Pair)
        }
    }

    # Union-find for agreement/neutral pairs only
    $Parent = @{}
    $Find = {
        param([string]$X)
        while ($Parent.ContainsKey($X) -and $Parent[$X] -ne $X) {
            $Parent[$X] = $Parent[$Parent[$X]]  # path compression
            $X = $Parent[$X]
        }
        return $X
    }
    $Union = {
        param([string]$A, [string]$B)
        $RootA = & $Find $A
        $RootB = & $Find $B
        if ($RootA -ne $RootB) { $Parent[$RootA] = $RootB }
    }

    # Only merge pairs with similarity >= 0.70 to prevent runaway chaining.
    # Pairs between MinSimilarity and 0.70 still appear as standalone candidates.
    $MergeThreshold = 0.70
    $MergePairs  = @($AgreementPairs | Where-Object { $_.Similarity -ge $MergeThreshold })
    $LoosePairs  = @($AgreementPairs | Where-Object { $_.Similarity -lt $MergeThreshold })

    foreach ($Pair in $MergePairs) {
        if (-not $Parent.ContainsKey($Pair.IdA)) { $Parent[$Pair.IdA] = $Pair.IdA }
        if (-not $Parent.ContainsKey($Pair.IdB)) { $Parent[$Pair.IdB] = $Pair.IdB }
    }
    foreach ($Pair in $MergePairs) {
        & $Union $Pair.IdA $Pair.IdB
    }

    # Group by root
    $Groups = @{}
    $AllParentKeys = @($Parent.Keys)
    foreach ($NodeId in $AllParentKeys) {
        $Root = & $Find $NodeId
        if (-not $Groups.ContainsKey($Root)) {
            $Groups[$Root] = [System.Collections.Generic.List[string]]::new()
        }
        $Groups[$Root].Add($NodeId)
    }

    # Build scored groups from agreement clusters
    $ScoreGroup = {
        param($Members, $Pairs, $DomLabel)
        $MaxBoosted = 0.0
        $AvgSim     = 0.0
        $SimCount   = 0
        $NliCounts  = @{ entailment = 0; neutral = 0; contradiction = 0 }
        foreach ($Pair in $Pairs) {
            if ($Pair.IdA -in $Members -and $Pair.IdB -in $Members) {
                if ($Pair.Boosted -gt $MaxBoosted) { $MaxBoosted = $Pair.Boosted }
                $AvgSim += $Pair.Similarity
                $SimCount++
                if ($Pair.PSObject.Properties['NliLabel'] -and $Pair.NliLabel) {
                    $NliCounts[$Pair.NliLabel]++
                }
            }
        }
        if ($SimCount -gt 0) { $AvgSim = [Math]::Round($AvgSim / $SimCount, 4) }

        $NliTotal = $NliCounts.Values | Measure-Object -Sum | Select-Object -ExpandProperty Sum
        $DominantNli = if ($DomLabel) { $DomLabel }
                       elseif ($NliTotal -gt 0) {
                           ($NliCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
                       } else { $null }

        $PovsRepresented = @($Members | ForEach-Object { $NodeIndex[$_].POV } | Select-Object -Unique)

        [PSCustomObject]@{
            Members         = @($Members)
            MaxBoosted      = $MaxBoosted
            AvgSimilarity   = $AvgSim
            PovsRepresented = $PovsRepresented
            NliCounts       = $NliCounts
            DominantNli     = $DominantNli
        }
    }

    $AllScoredGroups = [System.Collections.Generic.List[PSObject]]::new()

    # Score merged agreement clusters
    foreach ($G in $Groups.Values) {
        $Scored = & $ScoreGroup $G $AgreementPairs $null
        if ($Scored.PovsRepresented.Count -ge 2) {
            $AllScoredGroups.Add($Scored)
        }
    }

    # Add loose agreement pairs (below merge threshold) as standalone clusters
    foreach ($Pair in $LoosePairs) {
        $Members = @($Pair.IdA, $Pair.IdB)
        $PovsRepresented = @($Members | ForEach-Object { $NodeIndex[$_].POV } | Select-Object -Unique)
        if ($PovsRepresented.Count -lt 2) { continue }
        $NliLabel = if ($Pair.PSObject.Properties['NliLabel'] -and $Pair.NliLabel) { $Pair.NliLabel } else { 'entailment' }
        $NliCounts = @{ entailment = 0; neutral = 0; contradiction = 0 }
        $NliCounts[$NliLabel]++
        $AllScoredGroups.Add([PSCustomObject]@{
            Members         = $Members
            MaxBoosted      = $Pair.Boosted
            AvgSimilarity   = $Pair.Similarity
            PovsRepresented = $PovsRepresented
            NliCounts       = $NliCounts
            DominantNli     = $NliLabel
        })
    }

    # Build debate clusters — merge contradiction pairs sharing a member node
    $DebateParent = @{}
    $DebateFind = {
        param([string]$X)
        while ($DebateParent.ContainsKey($X) -and $DebateParent[$X] -ne $X) {
            $DebateParent[$X] = $DebateParent[$DebateParent[$X]]
            $X = $DebateParent[$X]
        }
        return $X
    }
    $DebateUnion = {
        param([string]$A, [string]$B)
        $RA = & $DebateFind $A; $RB = & $DebateFind $B
        if ($RA -ne $RB) { $DebateParent[$RA] = $RB }
    }

    # Same merge threshold as agreement — only merge high-similarity debate pairs
    $DebateMerge = @($ContradictionPairs | Where-Object { $_.Similarity -ge $MergeThreshold })
    $DebateLoose = @($ContradictionPairs | Where-Object { $_.Similarity -lt $MergeThreshold })

    foreach ($Pair in $DebateMerge) {
        if (-not $DebateParent.ContainsKey($Pair.IdA)) { $DebateParent[$Pair.IdA] = $Pair.IdA }
        if (-not $DebateParent.ContainsKey($Pair.IdB)) { $DebateParent[$Pair.IdB] = $Pair.IdB }
        & $DebateUnion $Pair.IdA $Pair.IdB
    }

    $DebateGroups = @{}
    foreach ($NodeId in @($DebateParent.Keys)) {
        $Root = & $DebateFind $NodeId
        if (-not $DebateGroups.ContainsKey($Root)) {
            $DebateGroups[$Root] = [System.Collections.Generic.List[string]]::new()
        }
        $DebateGroups[$Root].Add($NodeId)
    }

    # Add merged debate groups — discard oversized clusters (>10 nodes) and
    # fall back to their constituent pairs, since mega-clusters aren't useful.
    $MaxDebateSize = 10
    $OversizedPairs = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($DG in $DebateGroups.Values) {
        $Members = @($DG)
        $PovsRepresented = @($Members | ForEach-Object { $NodeIndex[$_].POV } | Select-Object -Unique)
        if ($PovsRepresented.Count -lt 2) { continue }
        if ($Members.Count -le $MaxDebateSize) {
            $Scored = & $ScoreGroup $Members $ContradictionPairs 'contradiction'
            $AllScoredGroups.Add($Scored)
        }
        else {
            # Oversized — emit constituent pairs individually
            foreach ($Pair in $DebateMerge) {
                if ($Pair.IdA -in $Members -and $Pair.IdB -in $Members) {
                    $OversizedPairs.Add($Pair)
                }
            }
        }
    }

    # Add oversized-cluster pairs as standalone debate entries
    foreach ($Pair in $OversizedPairs) {
        $PairMembers = @($Pair.IdA, $Pair.IdB)
        $PovsRepresented = @($PairMembers | ForEach-Object { $NodeIndex[$_].POV } | Select-Object -Unique)
        if ($PovsRepresented.Count -lt 2) { continue }
        $AllScoredGroups.Add([PSCustomObject]@{
            Members         = $PairMembers
            MaxBoosted      = $Pair.Boosted
            AvgSimilarity   = $Pair.Similarity
            PovsRepresented = $PovsRepresented
            NliCounts       = @{ entailment = 0; neutral = 0; contradiction = 1 }
            DominantNli     = 'contradiction'
        })
    }

    # Add loose debate pairs as standalone clusters
    foreach ($Pair in $DebateLoose) {
        $Members = @($Pair.IdA, $Pair.IdB)
        $PovsRepresented = @($Members | ForEach-Object { $NodeIndex[$_].POV } | Select-Object -Unique)
        if ($PovsRepresented.Count -lt 2) { continue }
        $AllScoredGroups.Add([PSCustomObject]@{
            Members         = $Members
            MaxBoosted      = $Pair.Boosted
            AvgSimilarity   = $Pair.Similarity
            PovsRepresented = $PovsRepresented
            NliCounts       = @{ entailment = 0; neutral = 0; contradiction = 1 }
            DominantNli     = 'contradiction'
        })
    }

    # Separate shared-concept and debate groups
    $SharedAll = @($AllScoredGroups | Where-Object { $_.DominantNli -ne 'contradiction' } |
        Sort-Object { $_.MaxBoosted } -Descending)
    $DebateAll = @($AllScoredGroups | Where-Object { $_.DominantNli -eq 'contradiction' } |
        Sort-Object { $_.MaxBoosted } -Descending)

    # Allocate slots based on filter switches
    if ($ShowSharedOnly) {
        $SharedSlots = $TopN
        $DebateSlots = 0
    }
    elseif ($ShowDebatesOnly) {
        $SharedSlots = 0
        $DebateSlots = $TopN
    }
    else {
        # Default: reserve half for each, redistribute if one side is sparse
        $SharedSlots = [Math]::Ceiling($TopN / 2)
        $DebateSlots = $TopN - $SharedSlots

        if ($SharedAll.Count -lt $SharedSlots) {
            $DebateSlots += ($SharedSlots - $SharedAll.Count)
            $SharedSlots = $SharedAll.Count
        }
        elseif ($DebateAll.Count -lt $DebateSlots) {
            $SharedSlots += ($DebateSlots - $DebateAll.Count)
            $DebateSlots = $DebateAll.Count
        }
    }

    $PickedShared = @($SharedAll | Select-Object -First $SharedSlots)
    $PickedDebate = @($DebateAll | Select-Object -First $DebateSlots)

    # Combine: shared concepts first, then debates, each sorted by score
    $ScoredGroups = @($PickedShared) + @($PickedDebate)

    $AgreementCount = $PickedShared.Count
    $DebateCount    = $PickedDebate.Count
    Write-OK "Formed $($SharedAll.Count) agreement groups + $($DebateAll.Count) debate groups; selected $AgreementCount shared + $DebateCount debate (top $TopN)"

    # ── Step 7: Optional AI labeling ──────────────────────────────────────────
    $AILabels = $null
    if (-not $NoAI -and $ScoredGroups.Count -gt 0) {
        Write-Step 'Generating cross-cutting proposals with AI'

        try {
            $Backend = if     ($Model -match '^gemini') { 'gemini' }
                       elseif ($Model -match '^claude') { 'claude' }
                       elseif ($Model -match '^groq')   { 'groq'   }
                       else                             { 'gemini'  }

            $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
            if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
                Write-Warn "No API key found for $Backend — falling back to -NoAI mode"
                $NoAI = $true
            }
            else {
                $ClusterText = [System.Text.StringBuilder]::new()
                for ($i = 0; $i -lt $ScoredGroups.Count; $i++) {
                    $G = $ScoredGroups[$i]
                    $NliTag = if ($G.DominantNli) { ", nli_relationship: $($G.DominantNli)" } else { '' }
                    $NliDetail = if ($G.DominantNli) {
                        $C = $G.NliCounts
                        ", nli_breakdown: entailment=$($C.entailment) neutral=$($C.neutral) contradiction=$($C.contradiction)"
                    } else { '' }
                    [void]$ClusterText.AppendLine("--- cluster-$i (avg similarity: $($G.AvgSimilarity), POVs: $($G.PovsRepresented -join ', ')$NliTag$NliDetail) ---")
                    foreach ($MId in $G.Members) {
                        $NInfo = $NodeIndex[$MId]
                        [void]$ClusterText.AppendLine("  - $MId [$($NInfo.POV)]: $($NInfo.Label) — $($NInfo.Description)")
                    }
                    [void]$ClusterText.AppendLine()
                }

                $PromptBody = Get-Prompt -Name 'cross-cutting-candidates' -Replacements @{ CLUSTERS = $ClusterText.ToString() }
                $SchemaBody = Get-Prompt -Name 'cross-cutting-candidates-schema'
                $FullPrompt = "$PromptBody`n`n$SchemaBody"

                $AIResult = Invoke-AIApi `
                    -Prompt     $FullPrompt `
                    -Model      $Model `
                    -ApiKey     $ResolvedKey `
                    -Temperature 0.2 `
                    -MaxTokens  8192 `
                    -JsonMode `
                    -TimeoutSec 120 `
                    -MaxRetries 3 `
                    -RetryDelays @(5, 15, 45)

                if ($AIResult -and $AIResult.Text) {
                    $ResponseText = $AIResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
                    $AILabels = ($ResponseText | ConvertFrom-Json).candidates
                    Write-OK "AI proposed $($AILabels.Count) cross-cutting concepts ($($AIResult.Backend))"
                }
                else {
                    Write-Warn "AI returned no result"
                }
            }
        }
        catch {
            Write-Warn "AI labeling failed: $_"
        }
    }

    # ── Step 8: Build result ──────────────────────────────────────────────────
    $ResultCandidates = @(for ($i = 0; $i -lt $ScoredGroups.Count; $i++) {
        $G = $ScoredGroups[$i]
        $Entry = [ordered]@{
            cluster_id       = "cluster-$i"
            members          = @($G.Members | ForEach-Object {
                [ordered]@{
                    id    = $_
                    pov   = $NodeIndex[$_].POV
                    label = $NodeIndex[$_].Label
                }
            })
            avg_similarity   = $G.AvgSimilarity
            max_boosted      = $G.MaxBoosted
            povs_represented = $G.PovsRepresented
        }
        if ($G.DominantNli) {
            $Entry['nli_relationship'] = $G.DominantNli
            $Entry['nli_counts']       = [ordered]@{
                entailment    = $G.NliCounts.entailment
                neutral       = $G.NliCounts.neutral
                contradiction = $G.NliCounts.contradiction
            }
        }

        if ($AILabels) {
            $Label = $AILabels | Where-Object { $_.cluster_id -eq "cluster-$i" } | Select-Object -First 1
            if ($Label) {
                $Entry['proposed_label']       = $Label.label
                $Entry['proposed_description'] = $Label.description
                $Entry['interpretations']      = $Label.interpretations
                $Entry['confidence']           = $Label.confidence
                $Entry['rationale']            = $Label.rationale
            }
        }

        if (-not $Entry.Contains('proposed_label')) {
            # NoAI fallback: use member labels
            $Entry['proposed_label'] = ($G.Members | ForEach-Object { $NodeIndex[$_].Label }) -join ' / '
        }

        [PSCustomObject]$Entry
    })

    $Result = [ordered]@{
        generated_at    = (Get-Date -Format 'o')
        min_similarity  = $MinSimilarity
        pairs_checked   = $PairCount
        pairs_above     = $SimilarPairs.Count
        candidates      = $ResultCandidates
    }

    # ── Step 9: Console output ────────────────────────────────────────────────
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  CROSS-CUTTING CANDIDATES — $($ResultCandidates.Count) found (threshold: $MinSimilarity)" -ForegroundColor White
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    foreach ($C in $ResultCandidates) {
        $Label = if ($C.PSObject.Properties['proposed_label']) { $C.proposed_label } else { $C.cluster_id }
        Write-Host "`n  $($C.cluster_id): $Label" -ForegroundColor White
        $NliStr = if ($C.PSObject.Properties['nli_relationship'] -and $C.nli_relationship) {
            $NliColor = switch ($C.nli_relationship) {
                'entailment'    { 'Green' }
                'contradiction' { 'Red' }
                default         { 'Yellow' }
            }
            " | NLI: $($C.nli_relationship)"
        } else { '' }
        Write-Host "    Similarity: $($C.avg_similarity) | POVs: $($C.povs_represented -join ', ')$NliStr" -ForegroundColor Gray
        if ($C.PSObject.Properties['nli_relationship'] -and $C.nli_relationship) {
            $NliColor = switch ($C.nli_relationship) {
                'entailment'    { 'Green' }
                'contradiction' { 'Red' }
                default         { 'Yellow' }
            }
            Write-Host "    [$($C.nli_relationship)]" -ForegroundColor $NliColor -NoNewline
            $NC = $C.nli_counts
            Write-Host " (entail=$($NC.entailment) neutral=$($NC.neutral) contradict=$($NC.contradiction))" -ForegroundColor DarkGray
        }

        foreach ($M in $C.members) {
            $PovColor = switch ($M.pov) {
                'accelerationist' { 'Blue' }
                'safetyist'       { 'Green' }
                'skeptic'         { 'Yellow' }
                default           { 'Gray' }
            }
            Write-Host "      [$($M.pov)]" -NoNewline -ForegroundColor $PovColor
            Write-Host " $($M.id) — $($M.label)" -ForegroundColor DarkGray
        }

        if ($C.PSObject.Properties['proposed_description'] -and $C.proposed_description) {
            Write-Host "    Description: $($C.proposed_description)" -ForegroundColor Cyan
        }
        if ($C.PSObject.Properties['confidence'] -and $C.confidence) {
            $ConfPct = [Math]::Round($C.confidence * 100)
            Write-Host "    Confidence: $ConfPct%" -ForegroundColor $(if ($ConfPct -ge 80) { 'Green' } elseif ($ConfPct -ge 60) { 'Yellow' } else { 'Red' })
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan

    # ── JSON export ───────────────────────────────────────────────────────────
    if ($OutputFile) {
        try {
            $Json = $Result | ConvertTo-Json -Depth 20
            Set-Content -Path $OutputFile -Value $Json -Encoding UTF8
            Write-OK "Exported to $OutputFile"
        }
        catch {
            Write-Warn "Failed to write $OutputFile — $($_.Exception.Message)"
        }
    }

    return $Result
}
