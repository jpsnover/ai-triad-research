# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Steps of Find-SituationCandidates (t/3910 complexity refactor; t/4074 fixes). Collections cross function
# boundaries wrapped in a [pscustomobject] or with the unary comma, so a List or HashSet is never unrolled
# into its items on the way out.
#
# Determinism (t/4074): every walk over a hashtable's keys is sorted, cluster members are sorted by id, and
# score ties break by first member id, so the same inputs give the same output in every process.

# ── Inputs ────────────────────────────────────────────────────────────────────

function Resolve-FscModel {
    param([string]$Model)
    if ($Model) { return $Model }
    if ($env:AI_MODEL) { return $env:AI_MODEL }
    (Get-AITierModel -Tier basic)   # parenthesised form is what ModelTierMigration.Tests pins (t/4081)
}

function Get-FscNodeIndex {
    $NodeIndex = @{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $NodeIndex[$Node.id] = @{
                Label       = $Node.label
                Description = $null
                POV         = $PovKey
                GraphAttrs  = $null
            }
            if ($Node.PSObject.Properties['description']) { $NodeIndex[$Node.id].Description = $Node.description } else { $NodeIndex[$Node.id].Description = '' }
            if ($Node.PSObject.Properties['graph_attributes']) { $NodeIndex[$Node.id].GraphAttrs = $Node.graph_attributes } else { $NodeIndex[$Node.id].GraphAttrs = $null }
        }
    }
    $NodeIndex
}

function Get-FscEmbeddingIndex {
    $EmbeddingsFile = Join-Path (Get-TaxonomyDir) 'embeddings.json'
    $Embeddings     = @{}

    if (-not (Test-Path $EmbeddingsFile)) {
        Write-Fail 'embeddings.json not found — cannot compute similarities'
        throw (New-ActionableError -PassThru `
            -Goal 'Find situation candidates' `
            -Problem 'embeddings.json required for situation candidate discovery' `
            -Location "Get-FscEmbeddingIndex ($EmbeddingsFile)" `
            -NextSteps @('Generate node embeddings (embed_taxonomy.py), then re-run', 'Nothing was written'))
    }

    $EmbData = Get-Content -Raw -Path $EmbeddingsFile | ConvertFrom-Json
    if ($EmbData.PSObject.Properties['nodes']) { $EmbNodes = $EmbData.nodes } else { $EmbNodes = $EmbData }
    foreach ($Prop in $EmbNodes.PSObject.Properties) {
        $Val = $Prop.Value
        if ($Val -is [array]) {
            $Embeddings[$Prop.Name] = [double[]]$Val
        }
        elseif ($Val.PSObject.Properties['vector']) {
            $Embeddings[$Prop.Name] = [double[]]$Val.vector
        }
    }
    $Embeddings
}

# "nodeA|nodeB" (sorted) → list of edge types, approved edges only.
function Get-FscApprovedEdgeMap {
    param([string]$TaxDir)
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $EdgePairs = @{}
    if (-not (Test-Path $EdgesPath)) { return $EdgePairs }

    $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
    foreach ($Edge in $EdgesData.edges) {
        if ($Edge.PSObject.Properties['status']) { $EdgeStatus = $Edge.status } else { $EdgeStatus = '' }
        if ($EdgeStatus -ne 'approved') { continue }
        $PairKey = Get-FscPairKey -A $Edge.source -B $Edge.target
        if (-not $EdgePairs.ContainsKey($PairKey)) {
            $EdgePairs[$PairKey] = [System.Collections.Generic.List[string]]::new()
        }
        $EdgePairs[$PairKey].Add($Edge.type)
    }
    $EdgePairs
}

function Get-FscPairKey {
    param($A, $B)
    if ($A -lt $B) { "$A|$B" } else { "$B|$A" }
}

# POV-node pairs that a situation node already interprets: both nodes appear in the same situation's
# linked_nodes. Such a pair needs no new situation, so the similarity scan skips it.
# t/4074: this used to collect edge keys touching a situations node; the scan compares only POV nodes,
# so no key ever matched and the filter never fired. Approved edges are not the right signal either:
# situations reach POV nodes through SUPPORTS/TENSION_WITH/... edges that would mark ~40k pairs, while
# linked_nodes (mirrored by the POV nodes' situation_refs) is the explicit "interprets these" record.
function Get-FscSituationLinkedPairSet {
    param([hashtable]$NodeIndex)
    $CcLinkedPairs = [System.Collections.Generic.HashSet[string]]::new()
    $Entry = $script:TaxonomyData['situations']
    if (-not $Entry) { return , $CcLinkedPairs }
    foreach ($Sit in @($Entry.nodes)) {
        if (-not $Sit.PSObject.Properties['linked_nodes'] -or -not $Sit.linked_nodes) { continue }
        $Ids = @(@($Sit.linked_nodes) | Where-Object {
                $_ -is [string] -and $NodeIndex.ContainsKey($_) -and $NodeIndex[$_].POV -ne 'situations'
            } | Sort-Object -Unique)
        for ($i = 0; $i -lt $Ids.Count; $i++) {
            for ($j = $i + 1; $j -lt $Ids.Count; $j++) {
                [void]$CcLinkedPairs.Add((Get-FscPairKey -A $Ids[$i] -B $Ids[$j]))
            }
        }
    }
    , $CcLinkedPairs
}

# ── Similarity ────────────────────────────────────────────────────────────────

function Get-FscCosineSimilarity {
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

function Test-FscSharedAttribute {
    param($AttrsA, $AttrsB)
    if ($null -eq $AttrsA -or $null -eq $AttrsB) { return $false }
    foreach ($AttrName in @('assumes', 'intellectual_lineage')) {
        if ($AttrsA.PSObject.Properties[$AttrName]) { $RawA = $AttrsA.$AttrName } else { $RawA = $null }
        if ($AttrsB.PSObject.Properties[$AttrName]) { $RawB = $AttrsB.$AttrName } else { $RawB = $null }
        if ($null -eq $RawA -or $null -eq $RawB) { continue }
        $ListA = [string[]]@($RawA)
        $ListB = [string[]]@($RawB)
        if ($ListA.Length -gt 0 -and $ListB.Length -gt 0) {
            foreach ($V in $ListA) {
                if ($V -in $ListB) { return $true }
            }
        }
    }
    $false
}

# +0.05 for an approved TENSION_WITH/CONTRADICTS edge, +0.03 for a shared assumes/lineage value.
function Get-FscBoostedSimilarity {
    param([double]$Sim, [string]$PairKey, $AttrsA, $AttrsB, [hashtable]$EdgePairs)
    $BoostedSim = $Sim
    if ($EdgePairs.ContainsKey($PairKey)) {
        $Types = $EdgePairs[$PairKey]
        if ($Types -contains 'TENSION_WITH' -or $Types -contains 'CONTRADICTS') {
            $BoostedSim += 0.05
        }
    }
    if (Test-FscSharedAttribute -AttrsA $AttrsA -AttrsB $AttrsB) { $BoostedSim += 0.03 }
    $BoostedSim
}

# Cross-POV pairs above the threshold. Returns { Pairs = List[PSObject]; PairCount }.
function Find-FscSimilarPairSet {
    param([hashtable]$NodeIndex, [hashtable]$Embeddings, [hashtable]$EdgePairs, $CcLinkedPairs, [double]$MinSimilarity)

    # Sorted, so each pair's (IdA, IdB) orientation, and the NLI text_a/text_b order, is fixed.
    $PovNodeIds = @($NodeIndex.Keys | Where-Object {
        $NodeIndex[$_].POV -ne 'situations' -and $Embeddings.ContainsKey($_)
    } | Sort-Object)

    $SimilarPairs = [System.Collections.Generic.List[PSObject]]::new()
    $PairCount = 0

    for ($i = 0; $i -lt $PovNodeIds.Count; $i++) {
        for ($j = $i + 1; $j -lt $PovNodeIds.Count; $j++) {
            $IdA = $PovNodeIds[$i]
            $IdB = $PovNodeIds[$j]

            # Only cross-POV pairs
            if ($NodeIndex[$IdA].POV -eq $NodeIndex[$IdB].POV) { continue }

            $PairCount++
            $Sim = Get-FscCosineSimilarity -A $Embeddings[$IdA] -B $Embeddings[$IdB]
            if ($Sim -lt $MinSimilarity) { continue }

            # Check if already linked via cc-node
            $PairKey = Get-FscPairKey -A $IdA -B $IdB
            if ($CcLinkedPairs.Contains($PairKey)) { continue }

            $BoostedSim = Get-FscBoostedSimilarity -Sim $Sim -PairKey $PairKey -AttrsA $NodeIndex[$IdA].GraphAttrs -AttrsB $NodeIndex[$IdB].GraphAttrs -EdgePairs $EdgePairs

            $SimilarPairs.Add([PSCustomObject]@{
                IdA        = $IdA
                IdB        = $IdB
                Similarity = [Math]::Round($Sim, 4)
                Boosted    = [Math]::Round($BoostedSim, 4)
            })
        }
    }
    [pscustomobject]@{ Pairs = $SimilarPairs; PairCount = $PairCount }
}

# ── NLI ───────────────────────────────────────────────────────────────────────

function Get-FscNliInput {
    param($SimilarPairs, [hashtable]$NodeIndex)
    # Frame each node as a POV-attributed proposition so the NLI model
    # can distinguish agreement from opposition on the same topic.
    @($SimilarPairs | ForEach-Object {
        $InfoA = $NodeIndex[$_.IdA]
        $InfoB = $NodeIndex[$_.IdB]
        if ([string]::IsNullOrWhiteSpace($InfoA.Description)) { $DescA = $InfoA.Label } else { $DescA = $InfoA.Description }
        if ([string]::IsNullOrWhiteSpace($InfoB.Description)) { $DescB = $InfoB.Label } else { $DescB = $InfoB.Description }
        @{
            text_a = "The $($InfoA.POV) position is: $($InfoA.Label) — $DescA"
            text_b = "The $($InfoB.POV) position is: $($InfoB.Label) — $DescB"
        }
    })
}

# Tags each pair with NliLabel/NliEntailment/NliContradiction in place; WARNs and continues on failure.
function Add-FscNliLabel {
    param($SimilarPairs, [hashtable]$NodeIndex, [string]$RepoRoot)
    Write-Step 'Running NLI cross-encoder classification'

    $EmbedScript = Join-Path (Join-Path $RepoRoot 'scripts') 'embed_taxonomy.py'
    $NliInput = Get-FscNliInput -SimilarPairs $SimilarPairs -NodeIndex $NodeIndex

    $NliJson = $NliInput | ConvertTo-Json -Depth 5 -Compress
    try {
        $NliResult = $NliJson | python3 $EmbedScript nli-classify 2>$null
        $NliParsed = @($NliResult | ConvertFrom-Json)
        if ($NliParsed.Count -ne $SimilarPairs.Count) {
            # Results map to pairs by position; a short list leaves the trailing pairs unlabelled, and they
            # are then treated as unverified (neutral), not as agreement (t/2747).
            Write-Warn "NLI returned $($NliParsed.Count) result(s) for $($SimilarPairs.Count) pair(s) — the unlabelled pairs are treated as unverified"
        }

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

# ── Clustering ────────────────────────────────────────────────────────────────

function Find-FscRoot {
    param([hashtable]$Parent, [string]$X)
    while ($Parent.ContainsKey($X) -and $Parent[$X] -ne $X) {
        $Parent[$X] = $Parent[$Parent[$X]]  # path compression
        $X = $Parent[$X]
    }
    return $X
}

# Union-find over the given pairs; returns an ordered map of group → List[string] of members. Members
# are added in sorted id order and groups are keyed by their smallest member, so both are deterministic.
function Get-FscUnionGroupMap {
    param($Pairs)
    $Parent = @{}
    foreach ($Pair in $Pairs) {
        if (-not $Parent.ContainsKey($Pair.IdA)) { $Parent[$Pair.IdA] = $Pair.IdA }
        if (-not $Parent.ContainsKey($Pair.IdB)) { $Parent[$Pair.IdB] = $Pair.IdB }
    }
    foreach ($Pair in $Pairs) {
        $RootA = Find-FscRoot -Parent $Parent -X $Pair.IdA
        $RootB = Find-FscRoot -Parent $Parent -X $Pair.IdB
        if ($RootA -ne $RootB) { $Parent[$RootA] = $RootB }
    }
    $ByRoot = @{}
    $Groups = [ordered]@{}
    foreach ($NodeId in @($Parent.Keys | Sort-Object)) {
        $Root = Find-FscRoot -Parent $Parent -X $NodeId
        if (-not $ByRoot.ContainsKey($Root)) {
            # The first (smallest) member seen names the group.
            $ByRoot[$Root] = [System.Collections.Generic.List[string]]::new()
            $Groups[$NodeId] = $ByRoot[$Root]
        }
        $ByRoot[$Root].Add($NodeId)
    }
    $Groups
}

function Get-FscPovsRepresented {
    param($Members, [hashtable]$NodeIndex)
    @($Members | ForEach-Object { $NodeIndex[$_].POV } | Select-Object -Unique)
}

# On a tie in counts, the label earlier in this list wins: a split vote is not claimed as agreement
# (fail closed, t/2747). In practice the only possible tie is entailment vs neutral, since contradiction
# pairs never reach an agreement cluster when NLI ran.
$script:FscNliTiePrecedence = @('neutral', 'contradiction', 'entailment')

function Get-FscDominantNli {
    param([hashtable]$NliCounts, [string]$DomLabel)
    if ($DomLabel) { return $DomLabel }
    $NliTotal = $NliCounts.Values | Measure-Object -Sum | Select-Object -ExpandProperty Sum
    if ($NliTotal -gt 0) {
        return ($NliCounts.GetEnumerator() |
            Sort-Object @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { [array]::IndexOf($script:FscNliTiePrecedence, [string]$_.Key) } } |
            Select-Object -First 1).Key
    }
    $null
}

# Scores a merged cluster from the pairs whose both ends are members.
function Get-FscGroupScore {
    param($Members, $Pairs, $DomLabel, [hashtable]$NodeIndex)
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

    [PSCustomObject]@{
        Members         = @($Members)
        MaxBoosted      = $MaxBoosted
        AvgSimilarity   = $AvgSim
        PovsRepresented = @(Get-FscPovsRepresented -Members $Members -NodeIndex $NodeIndex)
        NliCounts       = $NliCounts
        DominantNli     = (Get-FscDominantNli -NliCounts $NliCounts -DomLabel $DomLabel)
    }
}

# A single pair as a standalone cluster labelled $NliLabel; $null when it spans fewer than 2 POVs.
function ConvertTo-FscPairCluster {
    param($Pair, [string]$NliLabel, [hashtable]$NodeIndex)
    $Members = @($Pair.IdA, $Pair.IdB)
    $PovsRepresented = @(Get-FscPovsRepresented -Members $Members -NodeIndex $NodeIndex)
    if ($PovsRepresented.Count -lt 2) { return $null }
    $NliCounts = @{ entailment = 0; neutral = 0; contradiction = 0 }
    $NliCounts[$NliLabel]++
    [PSCustomObject]@{
        Members         = $Members
        MaxBoosted      = $Pair.Boosted
        AvgSimilarity   = $Pair.Similarity
        PovsRepresented = $PovsRepresented
        NliCounts       = $NliCounts
        DominantNli     = $NliLabel
    }
}

# Only pairs with similarity >= this merge, to prevent runaway chaining. Pairs between
# MinSimilarity and this value still appear as standalone candidates.
$script:FscMergeThreshold = 0.70
# Merged debate clusters larger than this fall back to their constituent pairs.
$script:FscMaxDebateSize = 10

# Agreement/neutral pairs: merged clusters (union-find) plus loose pairs as standalone clusters.
function Add-FscAgreementCluster {
    param($AgreementPairs, [hashtable]$NodeIndex, $AllScoredGroups)
    $MergePairs = @($AgreementPairs | Where-Object { $_.Similarity -ge $script:FscMergeThreshold })
    $LoosePairs = @($AgreementPairs | Where-Object { $_.Similarity -lt $script:FscMergeThreshold })

    # Intended asymmetry (t/4074 item 4): under -NoNLI a merged cluster has no NLI counts, so it carries no
    # nli_relationship (nothing was verified). A loose pair is labelled 'neutral' by the fail-closed default
    # below. Both mean "unverified"; neither claims agreement.
    $Groups = Get-FscUnionGroupMap -Pairs $MergePairs
    foreach ($G in $Groups.Values) {
        $Scored = Get-FscGroupScore -Members $G -Pairs $AgreementPairs -DomLabel $null -NodeIndex $NodeIndex
        if ($Scored.PovsRepresented.Count -ge 2) { $AllScoredGroups.Add($Scored) }
    }

    foreach ($Pair in $LoosePairs) {
        # Fail CLOSED: an unlabeled / NLI-failed pair is unverified, not agreement.
        # Defaulting to 'entailment' here asserted shared-concept agreement we never
        # confirmed (fail-open, t/2747); resolve to 'neutral' instead.
        $Cluster = ConvertTo-FscPairCluster -Pair $Pair -NliLabel (Resolve-NliLabelOrDefault -Pair $Pair) -NodeIndex $NodeIndex
        if ($Cluster) { $AllScoredGroups.Add($Cluster) }
    }
}

# Contradiction pairs: merged debate clusters (oversized ones fall back to their pairs) plus loose pairs.
function Add-FscDebateCluster {
    param($ContradictionPairs, [hashtable]$NodeIndex, $AllScoredGroups)
    $DebateMerge = @($ContradictionPairs | Where-Object { $_.Similarity -ge $script:FscMergeThreshold })
    $DebateLoose = @($ContradictionPairs | Where-Object { $_.Similarity -lt $script:FscMergeThreshold })

    $OversizedPairs = [System.Collections.Generic.List[PSObject]]::new()
    $DebateGroups = Get-FscUnionGroupMap -Pairs $DebateMerge
    foreach ($DG in $DebateGroups.Values) {
        $Members = @($DG)
        $PovsRepresented = @(Get-FscPovsRepresented -Members $Members -NodeIndex $NodeIndex)
        if ($PovsRepresented.Count -lt 2) { continue }
        if ($Members.Count -le $script:FscMaxDebateSize) {
            $AllScoredGroups.Add((Get-FscGroupScore -Members $Members -Pairs $ContradictionPairs -DomLabel 'contradiction' -NodeIndex $NodeIndex))
            continue
        }
        # Oversized — emit constituent pairs individually
        foreach ($Pair in $DebateMerge) {
            if ($Pair.IdA -in $Members -and $Pair.IdB -in $Members) { $OversizedPairs.Add($Pair) }
        }
    }

    foreach ($Pair in @($OversizedPairs) + @($DebateLoose)) {
        $Cluster = ConvertTo-FscPairCluster -Pair $Pair -NliLabel 'contradiction' -NodeIndex $NodeIndex
        if ($Cluster) { $AllScoredGroups.Add($Cluster) }
    }
}

# Builds every scored cluster: agreement first, then debate (contradiction pairs stay separate).
function Get-FscScoredClusterList {
    param($SimilarPairs, [hashtable]$NodeIndex)
    # A pair is a contradiction only when its own NLI label says so. Checking each pair's label (rather than
    # whether pair 0 has one) keeps a partial NLI result from throwing on an unlabelled pair (t/4074).
    $AgreementPairs     = [System.Collections.Generic.List[PSObject]]::new()
    $ContradictionPairs = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Pair in $SimilarPairs) {
        $IsContradiction = $Pair.PSObject.Properties['NliLabel'] -and $Pair.NliLabel -eq 'contradiction'
        if ($IsContradiction) { $ContradictionPairs.Add($Pair) } else { $AgreementPairs.Add($Pair) }
    }

    $AllScoredGroups = [System.Collections.Generic.List[PSObject]]::new()
    Add-FscAgreementCluster -AgreementPairs $AgreementPairs -NodeIndex $NodeIndex -AllScoredGroups $AllScoredGroups
    Add-FscDebateCluster -ContradictionPairs $ContradictionPairs -NodeIndex $NodeIndex -AllScoredGroups $AllScoredGroups
    , $AllScoredGroups
}

# Shared/debate slot counts. Default: half each, the sparse side's surplus going to the other.
function Get-FscSlotAllocation {
    param([int]$TopN, [int]$SharedCount, [int]$DebateCount, [switch]$ShowSharedOnly, [switch]$ShowDebatesOnly)
    if ($ShowSharedOnly) { return [pscustomobject]@{ Shared = $TopN; Debate = 0 } }
    if ($ShowDebatesOnly) { return [pscustomobject]@{ Shared = 0; Debate = $TopN } }

    $SharedSlots = [Math]::Ceiling($TopN / 2)
    $DebateSlots = $TopN - $SharedSlots
    if ($SharedCount -lt $SharedSlots) {
        $DebateSlots += ($SharedSlots - $SharedCount)
        $SharedSlots = $SharedCount
    }
    elseif ($DebateCount -lt $DebateSlots) {
        $SharedSlots += ($DebateSlots - $DebateCount)
        $DebateSlots = $DebateCount
    }
    [pscustomobject]@{ Shared = $SharedSlots; Debate = $DebateSlots }
}

# Top clusters, shared concepts first then debates, each by score.
function Select-FscTopCluster {
    param($AllScoredGroups, [int]$TopN, [switch]$ShowSharedOnly, [switch]$ShowDebatesOnly)
    # Score descending, then first member id: equal scores always number and cut the same way.
    $ByScore = @(@{ Expression = { $_.MaxBoosted }; Descending = $true }, @{ Expression = { [string]$_.Members[0] } })
    $SharedAll = @($AllScoredGroups | Where-Object { $_.DominantNli -ne 'contradiction' } | Sort-Object $ByScore)
    $DebateAll = @($AllScoredGroups | Where-Object { $_.DominantNli -eq 'contradiction' } | Sort-Object $ByScore)

    $Slots = Get-FscSlotAllocation -TopN $TopN -SharedCount $SharedAll.Count -DebateCount $DebateAll.Count -ShowSharedOnly:$ShowSharedOnly -ShowDebatesOnly:$ShowDebatesOnly
    $PickedShared = @($SharedAll | Select-Object -First $Slots.Shared)
    $PickedDebate = @($DebateAll | Select-Object -First $Slots.Debate)

    Write-OK "Formed $($SharedAll.Count) agreement groups + $($DebateAll.Count) debate groups; selected $($PickedShared.Count) shared + $($PickedDebate.Count) debate (top $TopN)"
    , (@($PickedShared) + @($PickedDebate))
}

# ── AI labelling ──────────────────────────────────────────────────────────────

$script:FscBackendPrefixes = @(
    @{ Pattern = '^gemini'; Backend = 'gemini' }
    @{ Pattern = '^claude'; Backend = 'claude' }
    @{ Pattern = '^groq';   Backend = 'groq' }
    @{ Pattern = '^openai'; Backend = 'openai' }
)

function Get-FscBackend {
    param([string]$Model)
    foreach ($Entry in $script:FscBackendPrefixes) {
        if ($Model -match $Entry.Pattern) { return $Entry.Backend }
    }
    'gemini'
}

function Format-FscClusterText {
    param($ScoredGroups, [hashtable]$NodeIndex)
    $ClusterText = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $ScoredGroups.Count; $i++) {
        $G = $ScoredGroups[$i]
        if ($G.DominantNli) { $NliTag = ", nli_relationship: $($G.DominantNli)" } else { $NliTag = '' }
        if ($G.DominantNli) {
            $C = $G.NliCounts
            $NliDetail = ", nli_breakdown: entailment=$($C.entailment) neutral=$($C.neutral) contradiction=$($C.contradiction)"
        } else { $NliDetail = '' }
        [void]$ClusterText.AppendLine("--- cluster-$i (avg similarity: $($G.AvgSimilarity), POVs: $($G.PovsRepresented -join ', ')$NliTag$NliDetail) ---")
        foreach ($MId in $G.Members) {
            $NInfo = $NodeIndex[$MId]
            [void]$ClusterText.AppendLine("  - $MId [$($NInfo.POV)]: $($NInfo.Label) — $($NInfo.Description)")
        }
        [void]$ClusterText.AppendLine()
    }
    $ClusterText.ToString()
}

# Asks the model for situation proposals. Returns its candidates, or $null (with a WARN) on any failure.
function Get-FscAiLabelSet {
    param($ScoredGroups, [hashtable]$NodeIndex, [string]$Model, [string]$ApiKey)
    Write-Step 'Generating situation proposals with AI'
    try {
        $Backend = Get-FscBackend -Model $Model
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            Write-Warn "No API key found for $Backend — falling back to -NoAI mode"
            return $null
        }

        $ClusterText = Format-FscClusterText -ScoredGroups $ScoredGroups -NodeIndex $NodeIndex
        $PromptBody = Get-Prompt -Name 'situation-candidates' -Replacements @{ CLUSTERS = $ClusterText }
        $SchemaBody = Get-Prompt -Name 'situation-candidates-schema'
        $FullPrompt = "$PromptBody`n`n$SchemaBody"

        $AIResult = Invoke-AIApi `
            -Prompt     $FullPrompt `
            -Model      $Model `
            -ApiKey     $ResolvedKey `
            -Temperature 0.2 `
            -MaxTokens  8192 `
            -JsonMode `
            -MaxRetries 3 `
            -RetryDelays @(5, 15, 45)

        if (-not ($AIResult -and $AIResult.Text)) {
            Write-Warn "AI returned no result"
            return $null
        }
        $ResponseText = $AIResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
        $AILabels = ($ResponseText | ConvertFrom-Json).candidates
        Write-OK "AI proposed $($AILabels.Count) situation concepts ($($AIResult.Backend))"
        , $AILabels
    }
    catch {
        Write-Warn "AI labeling failed: $_"
        $null
    }
}

# ── Result ────────────────────────────────────────────────────────────────────

# BFS 2-colouring of a contested cluster from its NLI pair labels: { Color; Conflict }.
function Get-FscBipartiteColoring {
    param($Members, $SimilarPairs)
    $Color = @{}
    $Adj   = @{}
    foreach ($M in $Members) { $Adj[$M] = [System.Collections.Generic.List[PSObject]]::new() }

    # Gather all NLI-labeled pairs within this group
    foreach ($Pair in $SimilarPairs) {
        if ($Pair.IdA -in $Members -and $Pair.IdB -in $Members -and
            $Pair.PSObject.Properties['NliLabel'] -and $Pair.NliLabel) {
            $Same = $Pair.NliLabel -ne 'contradiction'
            $Adj[$Pair.IdA].Add([PSCustomObject]@{ Neighbor = $Pair.IdB; Same = $Same })
            $Adj[$Pair.IdB].Add([PSCustomObject]@{ Neighbor = $Pair.IdA; Same = $Same })
        }
    }

    $Conflict = $false
    foreach ($StartId in $Members) {
        if ($Color.ContainsKey($StartId)) { continue }
        $Color[$StartId] = 0
        if (-not (Resolve-FscComponentColor -StartId $StartId -Adj $Adj -Color $Color)) { $Conflict = $true }
    }
    [pscustomobject]@{ Color = $Color; Conflict = $Conflict }
}

# Colours one connected component outward from $StartId. Returns $false on a colouring conflict.
function Resolve-FscComponentColor {
    param([string]$StartId, [hashtable]$Adj, [hashtable]$Color)
    $Ok = $true
    $Queue = [System.Collections.Generic.Queue[string]]::new()
    $Queue.Enqueue($StartId)
    while ($Queue.Count -gt 0) {
        $Curr = $Queue.Dequeue()
        $CC   = $Color[$Curr]
        foreach ($Edge in $Adj[$Curr]) {
            if ($Edge.Same) { $Expected = $CC } else { $Expected = 1 - $CC }
            if ($Color.ContainsKey($Edge.Neighbor)) {
                if ($Color[$Edge.Neighbor] -ne $Expected) { $Ok = $false }
            }
            else {
                $Color[$Edge.Neighbor] = $Expected
                $Queue.Enqueue($Edge.Neighbor)
            }
        }
    }
    $Ok
}

# Adds "sides" to a contested cluster's entry when its NLI labels 2-colour without conflict:
# [[sideA members], [sideB members]], each side sorted by id and the sides ordered by their first id.
# t/4074: built as @( @(A) @(B) ) this flattened into one member list, so readers couldn't tell where a
# side ended and the console only split 1-vs-1 clusters. A List of arrays keeps the two sides apart.
function Add-FscContestedSide {
    param($Entry, $G, $SimilarPairs, [hashtable]$NodeIndex)
    $Coloring = Get-FscBipartiteColoring -Members $G.Members -SimilarPairs $SimilarPairs
    if ($Coloring.Conflict) { return }
    $Color = $Coloring.Color
    $SideA = @($G.Members | Where-Object { $Color[$_] -eq 0 } | Sort-Object)
    $SideB = @($G.Members | Where-Object { $Color[$_] -eq 1 } | Sort-Object)
    if ($SideA.Count -eq 0 -or $SideB.Count -eq 0) { return }
    if ($SideB[0] -lt $SideA[0]) { $SideA, $SideB = $SideB, $SideA }
    $Sides = [System.Collections.Generic.List[object]]::new()
    foreach ($Side in @(, $SideA) + @(, $SideB)) {
        $Sides.Add(@($Side | ForEach-Object { [ordered]@{ id = $_; pov = $NodeIndex[$_].POV; label = $NodeIndex[$_].Label } }))
    }
    $Entry['sides'] = $Sides.ToArray()
}

function Add-FscAiLabelField {
    param($Entry, $AILabels, [string]$ClusterId)
    if (-not $AILabels) { return }
    $Label = $AILabels | Where-Object { $_.cluster_id -eq $ClusterId } | Select-Object -First 1
    if (-not $Label) { return }
    $Entry['proposed_label']       = $Label.label
    $Entry['proposed_description'] = $Label.description
    $Entry['interpretations']      = $Label.interpretations
    $Entry['confidence']           = $Label.confidence
    $Entry['rationale']            = $Label.rationale
}

function ConvertTo-FscCandidateEntry {
    param($G, [int]$Index, $SimilarPairs, $AILabels, [hashtable]$NodeIndex)
    $Entry = [ordered]@{
        cluster_id       = "cluster-$Index"
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
        # Bipartite partition for contested clusters
        if ($G.DominantNli -eq 'contradiction' -and $G.Members.Count -ge 2) {
            Add-FscContestedSide -Entry $Entry -G $G -SimilarPairs $SimilarPairs -NodeIndex $NodeIndex
        }
    }

    Add-FscAiLabelField -Entry $Entry -AILabels $AILabels -ClusterId "cluster-$Index"
    if (-not $Entry.Contains('proposed_label')) {
        # NoAI fallback: use member labels
        $Entry['proposed_label'] = ($G.Members | ForEach-Object { $NodeIndex[$_].Label }) -join ' / '
    }
    [PSCustomObject]$Entry
}

# ── Console and export ────────────────────────────────────────────────────────

$script:FscNliDisplay = @{
    entailment    = @{ Name = 'shared';    Color = 'Green' }
    contradiction = @{ Name = 'contested'; Color = 'Red' }
    neutral       = @{ Name = 'unclear';   Color = 'Yellow' }
}
$script:FscPovColors = @{ accelerationist = 'Blue'; safetyist = 'Green'; skeptic = 'Yellow' }

function Write-FscMemberLine {
    param($Members)
    foreach ($M in $Members) {
        $PovColor = if ($M.pov -and $script:FscPovColors.ContainsKey([string]$M.pov)) { $script:FscPovColors[[string]$M.pov] } else { 'Gray' }
        Write-Host "      [$($M.pov)]" -NoNewline -ForegroundColor $PovColor
        Write-Host " $($M.id) — $($M.label)" -ForegroundColor DarkGray
    }
}

# The console display entry for a candidate's NLI relationship, or $null when it has none. A merged
# cluster under -NoNLI (or after an NLI failure) has no nli_relationship: t/4074, reading it unguarded
# threw under StrictMode before -OutputFile was written.
function Get-FscNliDisplay {
    param($C)
    if (-not $C.PSObject.Properties['nli_relationship']) { return $null }
    $Relationship = [string]$C.nli_relationship
    if ($Relationship -and $script:FscNliDisplay.ContainsKey($Relationship)) { return $script:FscNliDisplay[$Relationship] }
    $null
}

function Write-FscCandidate {
    param($C)
    if ($C.PSObject.Properties['proposed_label']) { $Label = $C.proposed_label } else { $Label = $C.cluster_id }
    Write-Host "`n  $($C.cluster_id): $Label" -ForegroundColor White
    $Display = Get-FscNliDisplay -C $C
    if ($Display) { $NliStr = " | $($Display.Name)" } else { $NliStr = '' }
    Write-Host "    Similarity: $($C.avg_similarity) | POVs: $($C.povs_represented -join ', ')$NliStr" -ForegroundColor Gray
    if ($Display) {
        Write-Host "    [$($Display.Name)]" -ForegroundColor $Display.Color -NoNewline
        $NC = $C.nli_counts
        Write-Host " (shared=$($NC.entailment) unclear=$($NC.neutral) contested=$($NC.contradiction))" -ForegroundColor DarkGray
    }

    if ($C.PSObject.Properties['sides'] -and $C.sides -and $C.sides.Count -eq 2) {
        # Render with "vs." separator
        Write-FscMemberLine -Members $C.sides[0]
        Write-Host "        vs." -ForegroundColor DarkYellow
        Write-FscMemberLine -Members $C.sides[1]
    }
    else {
        Write-FscMemberLine -Members $C.members
    }

    if ($C.PSObject.Properties['proposed_description'] -and $C.proposed_description) {
        Write-Host "    Description: $($C.proposed_description)" -ForegroundColor Cyan
    }
    if ($C.PSObject.Properties['confidence'] -and $C.confidence) {
        $ConfPct = [Math]::Round($C.confidence * 100)
        Write-Host "    Confidence: $ConfPct%" -ForegroundColor $(if ($ConfPct -ge 80) { 'Green' } elseif ($ConfPct -ge 60) { 'Yellow' } else { 'Red' })
    }
}

function Write-FscConsoleReport {
    param($ResultCandidates, [double]$MinSimilarity)
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  CROSS-CUTTING CANDIDATES — $($ResultCandidates.Count) found (threshold: $MinSimilarity)" -ForegroundColor White
    Write-Host "$('═' * 72)" -ForegroundColor Cyan
    foreach ($C in $ResultCandidates) { Write-FscCandidate -C $C }
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
}

function Export-FscResult {
    param($Result, [string]$OutputFile)
    try {
        $Json = $Result | ConvertTo-Json -Depth 20
        Write-Utf8NoBom -Path $OutputFile -Value $Json
        Write-OK "Exported to $OutputFile"
    }
    catch {
        Write-Warn "Failed to write $OutputFile — $($_.Exception.Message)"
    }
}
