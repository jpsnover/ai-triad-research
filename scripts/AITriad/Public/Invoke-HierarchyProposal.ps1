# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-HierarchyProposal {
    <#
    .SYNOPSIS
        Proposes parent-child hierarchy for flat taxonomy nodes using embeddings, edges, and AI.
    .DESCRIPTION
        Processes each POV/category bucket: clusters nodes via embeddings, enriches clusters
        with edge and graph-attribute evidence, then sends each bucket to an AI model to
        propose parent nodes and child assignments. Outputs a proposal JSON file for human review.
    .EXAMPLE
        Invoke-HierarchyProposal
        Invoke-HierarchyProposal -POV accelerationist -Category 'Intentions'
        Invoke-HierarchyProposal -DryRun
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')]
        [string]$POV = '',

        [ValidateScript({ Test-CategoryParameter $_ })]
        [string]$Category = '',

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ Get-AIModelCompletion @args })]
        [string]$Model = 'gemini-2.5-flash',

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [ValidateRange(0.20, 0.80)]
        [double]$MinSimilarity = 0.40,

        [string]$OutputDir = '',

        [switch]$DryRun,
        [switch]$Force
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Resolve paths ────────────────────────────────────────────────────────
    $TaxDir = Get-TaxonomyDir

    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        $OutputDir = Join-Path (Get-DataRoot) 'taxonomy' 'hierarchy-proposals'
    }
    if (-not (Test-Path $OutputDir)) {
        $null = New-Item -Path $OutputDir -ItemType Directory -Force
    }

    # ── Resolve API key ──────────────────────────────────────────────────────
    $Backend = if ($Model -match '^gemini') { 'gemini' }
               elseif ($Model -match '^claude') { 'claude' }
               elseif ($Model -match '^groq')   { 'groq' }
               else { 'gemini' }

    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
    if (-not $ResolvedKey) {
        Write-Fail "No API key found for backend '$Backend'. Set the appropriate environment variable."
        return
    }

    # ── Load taxonomy files ──────────────────────────────────────────────────
    Write-Step 'Loading taxonomy data'

    $PovFileMap = @{
        accelerationist = 'accelerationist.json'
        safetyist       = 'safetyist.json'
        skeptic         = 'skeptic.json'
        'cross-cutting' = 'cross-cutting.json'
    }

    $AllTaxData = @{}
    foreach ($PovKey in $PovFileMap.Keys) {
        $FilePath = Join-Path $TaxDir $PovFileMap[$PovKey]
        if (Test-Path $FilePath) {
            $AllTaxData[$PovKey] = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
            Write-OK "$PovKey`: $($AllTaxData[$PovKey].nodes.Count) nodes"
        }
    }

    # ── Load embeddings ──────────────────────────────────────────────────────
    Write-Step 'Loading embeddings'
    $Embeddings = @{}
    $EmbeddingsPath = Join-Path $TaxDir 'embeddings.json'
    if (Test-Path $EmbeddingsPath) {
        try {
            $EmbJson = Get-Content -Raw -Path $EmbeddingsPath | ConvertFrom-Json -Depth 20
            foreach ($Prop in $EmbJson.nodes.PSObject.Properties) {
                $Embeddings[$Prop.Name] = [double[]]@($Prop.Value.vector)
            }
            Write-OK "Loaded embeddings for $($Embeddings.Count) nodes"
        }
        catch {
            Write-Warn "Could not load embeddings: $($_.Exception.Message)"
        }
    }
    else {
        Write-Warn 'embeddings.json not found — clustering will be skipped'
    }

    # ── Load edges ───────────────────────────────────────────────────────────
    Write-Step 'Loading edges'
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $AllEdges  = @()
    if (Test-Path $EdgesPath) {
        try {
            $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json -Depth 20
            $AllEdges  = @($EdgesData.edges | Where-Object { $_.status -eq 'approved' })
            Write-OK "Loaded $($AllEdges.Count) approved edges"
        }
        catch {
            Write-Warn "Could not load edges: $($_.Exception.Message)"
        }
    }

    # ── Build processing buckets ─────────────────────────────────────────────
    Write-Step 'Building processing buckets'

    $Buckets = [System.Collections.Generic.List[PSObject]]::new()

    $PovList = if ($POV) { @($POV) } else { @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting') }

    foreach ($PovKey in $PovList) {
        if (-not $AllTaxData.ContainsKey($PovKey)) { continue }
        $Nodes = @($AllTaxData[$PovKey].nodes)

        if ($PovKey -eq 'cross-cutting') {
            # Cross-cutting has no categories — one bucket
            if (-not $Category) {
                $Buckets.Add([PSCustomObject]@{
                    POV      = $PovKey
                    Category = $null
                    Nodes    = $Nodes
                })
            }
        }
        else {
            $Categories = if ($Category) { @($Category) } else { @('Beliefs', 'Desires', 'Intentions') }
            foreach ($Cat in $Categories) {
                $CatNodes = @($Nodes | Where-Object { $_.category -eq $Cat })
                if ($CatNodes.Count -ge 2) {
                    $Buckets.Add([PSCustomObject]@{
                        POV      = $PovKey
                        Category = $Cat
                        Nodes    = $CatNodes
                    })
                }
            }
        }
    }

    Write-OK "$($Buckets.Count) buckets to process"
    foreach ($B in $Buckets) {
        $CatLabel = if ($B.Category) { $B.Category } else { '(all)' }
        Write-Info "$($B.POV) / $CatLabel`: $($B.Nodes.Count) nodes"
    }

    # ── Load prompts ─────────────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'hierarchy-proposal'
    $SchemaPrompt = Get-Prompt -Name 'hierarchy-proposal-schema'

    # ── Process each bucket ──────────────────────────────────────────────────
    $AllProposals = [System.Collections.Generic.List[PSObject]]::new()
    $BucketNum    = 0

    foreach ($Bucket in $Buckets) {
        $BucketNum++
        $CatLabel = if ($Bucket.Category) { $Bucket.Category } else { '(all)' }
        Write-Step "Bucket $BucketNum/$($Buckets.Count): $($Bucket.POV) / $CatLabel ($($Bucket.Nodes.Count) nodes)"

        # ── Phase 1.1: Cluster ───────────────────────────────────────────────
        $NodeIds = @($Bucket.Nodes | ForEach-Object { $_.id })
        $HasEmbeddings = ($NodeIds | Where-Object { $Embeddings.ContainsKey($_) }).Count

        $Clusters = @()
        if ($HasEmbeddings -ge 2) {
            # Scale MaxClusters by bucket size
            $MaxClusters = if ($Bucket.Nodes.Count -lt 10) { 2 }
                           elseif ($Bucket.Nodes.Count -lt 20) { 4 }
                           elseif ($Bucket.Nodes.Count -lt 40) { 6 }
                           else { 8 }

            $Clusters = Get-EmbeddingClusters `
                -NodeIds       $NodeIds `
                -Embeddings    $Embeddings `
                -MaxClusters   $MaxClusters `
                -MinSimilarity $MinSimilarity

            Write-OK "Clustering produced $($Clusters.Count) clusters"
        }
        else {
            Write-Warn "Only $HasEmbeddings nodes have embeddings — skipping clustering"
            # Fallback: each node is its own cluster
            $Clusters = @($NodeIds | ForEach-Object { ,@($_) })
        }

        # ── Phase 1.2: Enrich with edge evidence ────────────────────────────
        $ClusterData = [System.Collections.Generic.List[PSObject]]::new()

        foreach ($ClusterIds in $Clusters) {
            $IdSet = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@($ClusterIds),
                [System.StringComparer]::OrdinalIgnoreCase
            )

            # Count intra-cluster edges by type
            $IntraEdges = @{}
            foreach ($E in $AllEdges) {
                if ($IdSet.Contains($E.source) -and $IdSet.Contains($E.target)) {
                    $Type = $E.type
                    if (-not $IntraEdges.ContainsKey($Type)) { $IntraEdges[$Type] = 0 }
                    $IntraEdges[$Type]++
                }
            }

            # Cohesion score: (supportive edges) / (possible pairs)
            $SupportiveCount = ($IntraEdges['SUPPORTS'] ?? 0) +
                               ($IntraEdges['ASSUMES'] ?? 0) +
                               ($IntraEdges['SUPPORTED_BY'] ?? 0)
            $PossiblePairs   = $ClusterIds.Count * ($ClusterIds.Count - 1)
            $Cohesion        = if ($PossiblePairs -gt 0) {
                [Math]::Round($SupportiveCount / $PossiblePairs, 2)
            } else { 0.0 }

            # ── Phase 1.3: Enrich with graph attribute patterns ──────────────
            $SharedEpistemicType   = $null
            $SharedRhetorical      = @()
            $AttributeCoherence    = 0.0

            $ClusterNodes = @($Bucket.Nodes | Where-Object { $IdSet.Contains($_.id) })
            $NodesWithGA  = @($ClusterNodes | Where-Object {
                $_.PSObject.Properties['graph_attributes'] -and $null -ne $_.graph_attributes
            })

            if ($NodesWithGA.Count -ge 2) {
                # Check shared epistemic_type
                $EpTypes = @($NodesWithGA | ForEach-Object {
                    if ($_.graph_attributes.PSObject.Properties['epistemic_type']) {
                        $_.graph_attributes.epistemic_type
                    }
                } | Where-Object { $_ })
                $TypeGroups = $EpTypes | Group-Object | Sort-Object Count -Descending
                if ($TypeGroups.Count -gt 0 -and $TypeGroups[0].Count -ge ($NodesWithGA.Count * 0.5)) {
                    $SharedEpistemicType = $TypeGroups[0].Name
                }

                # Check shared rhetorical strategies
                $AllStrategies = @($NodesWithGA | ForEach-Object {
                    if ($_.graph_attributes.PSObject.Properties['rhetorical_strategy']) {
                        $S = $_.graph_attributes.rhetorical_strategy
                        if ($S) { $S -split ',\s*' }
                    }
                } | Where-Object { $_ })
                $StratGroups = $AllStrategies | Group-Object | Sort-Object Count -Descending
                $SharedRhetorical = @($StratGroups |
                    Where-Object { $_.Count -ge ($NodesWithGA.Count * 0.4) } |
                    ForEach-Object { $_.Name })

                # Attribute coherence: fraction of attributes that match the dominant pattern
                $Matches = 0
                $Total   = 0
                foreach ($N in $NodesWithGA) {
                    $Total++
                    if ($SharedEpistemicType -and
                        $N.graph_attributes.PSObject.Properties['epistemic_type'] -and
                        $N.graph_attributes.epistemic_type -eq $SharedEpistemicType) {
                        $Matches++
                    }
                }
                $AttributeCoherence = if ($Total -gt 0) {
                    [Math]::Round($Matches / $Total, 2)
                } else { 0.0 }
            }

            $ClusterData.Add([PSCustomObject]@{
                cluster_id              = $ClusterData.Count
                node_ids                = @($ClusterIds)
                size                    = $ClusterIds.Count
                intra_edges             = $IntraEdges
                cohesion_score          = $Cohesion
                shared_epistemic_type   = $SharedEpistemicType
                shared_rhetorical       = $SharedRhetorical
                attribute_coherence     = $AttributeCoherence
            })
        }

        # ── Build AI prompt ──────────────────────────────────────────────────
        # Node context: id, label, description, graph_attributes summary
        $NodeContext = foreach ($Node in $Bucket.Nodes) {
            $Entry = [ordered]@{
                id          = $Node.id
                label       = $Node.label
                description = $Node.description
            }
            if ($Node.PSObject.Properties['graph_attributes'] -and $null -ne $Node.graph_attributes) {
                $GA = $Node.graph_attributes
                foreach ($AttrName in @('epistemic_type', 'rhetorical_strategy',
                                        'intellectual_lineage', 'audience', 'emotional_register')) {
                    if ($GA.PSObject.Properties[$AttrName] -and $null -ne $GA.$AttrName) {
                        $Entry[$AttrName] = $GA.$AttrName
                    }
                }
            }
            if ($Bucket.POV -eq 'cross-cutting' -and
                $Node.PSObject.Properties['interpretations']) {
                $Entry['interpretations'] = $Node.interpretations
            }
            $Entry
        }

        $ClusterContext = foreach ($C in $ClusterData) {
            [ordered]@{
                cluster_id            = $C.cluster_id
                node_ids              = $C.node_ids
                size                  = $C.size
                cohesion_score        = $C.cohesion_score
                intra_edges           = $C.intra_edges
                shared_epistemic_type = $C.shared_epistemic_type
                attribute_coherence   = $C.attribute_coherence
            }
        }

        $NodeJson    = $NodeContext    | ConvertTo-Json -Depth 10 -Compress:$false
        $ClusterJson = $ClusterContext | ConvertTo-Json -Depth 10 -Compress:$false

        $CatLine = if ($Bucket.Category) { "Category: $($Bucket.Category)" } else { 'Category: (none — cross-cutting)' }

        $UserPrompt = @"
POV: $($Bucket.POV)
$CatLine
Node count: $($Bucket.Nodes.Count)

--- NODES ---
$NodeJson

--- PRE-COMPUTED CLUSTERS ---
$ClusterJson

$SchemaPrompt
"@

        $FullPrompt = "$SystemPrompt`n`n$UserPrompt"

        if ($DryRun) {
            Write-Info 'DryRun — showing prompt for first bucket only'
            Write-Host ''
            Write-Host ($FullPrompt.Substring(0, [Math]::Min(3000, $FullPrompt.Length)))
            Write-Host "`n... (truncated, total $($FullPrompt.Length) chars)"
            if ($BucketNum -eq 1) { return }
            continue
        }

        # ── Call AI ──────────────────────────────────────────────────────────
        Write-Info "Calling $Model ..."
        $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $Result = Invoke-AIApi `
                -Prompt      $FullPrompt `
                -Model       $Model `
                -ApiKey      $ResolvedKey `
                -Temperature $Temperature `
                -MaxTokens   16384 `
                -JsonMode `
                -TimeoutSec  180
        }
        catch {
            Write-Fail "API call failed for $($Bucket.POV)/$CatLabel`: $_"
            continue
        }
        $Stopwatch.Stop()
        Write-OK "Response in $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"

        # ── Parse response ───────────────────────────────────────────────────
        $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
        $Proposal = $null
        try {
            $Proposal = $ResponseText | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warn 'JSON parse failed, attempting repair...'
            $Repaired = Repair-TruncatedJson -Text $ResponseText
            try {
                $Proposal = $Repaired | ConvertFrom-Json -Depth 20
            }
            catch {
                Write-Fail "Could not parse response for $($Bucket.POV)/$CatLabel"
                continue
            }
        }

        # ── Validate proposal ────────────────────────────────────────────────
        $AssignedIds  = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        $ParentCount  = 0
        $ChildCount   = 0
        $OutlierCount = 0

        if ($Proposal.PSObject.Properties['parents']) {
            foreach ($Parent in @($Proposal.parents)) {
                $ParentCount++

                # Track promoted nodes
                if ($Parent.promoted_from) {
                    [void]$AssignedIds.Add($Parent.promoted_from)
                }

                foreach ($Child in @($Parent.children)) {
                    if ($AssignedIds.Contains($Child.node_id)) {
                        Write-Warn "Duplicate assignment: $($Child.node_id)"
                    }
                    [void]$AssignedIds.Add($Child.node_id)
                    $ChildCount++
                }
            }
        }

        if ($Proposal.PSObject.Properties['outliers']) {
            foreach ($Outlier in @($Proposal.outliers)) {
                [void]$AssignedIds.Add($Outlier.node_id)
                $OutlierCount++
            }
        }

        # Check coverage
        $Missing = @($NodeIds | Where-Object { -not $AssignedIds.Contains($_) })
        if ($Missing.Count -gt 0) {
            Write-Warn "$($Missing.Count) nodes not assigned: $($Missing[0..([Math]::Min(4, $Missing.Count - 1))] -join ', ')"
        }

        Write-OK "Proposed $ParentCount parents, $ChildCount children, $OutlierCount outliers"

        # Attach metadata
        $Proposal | Add-Member -NotePropertyName '_metadata' -NotePropertyValue ([ordered]@{
            generated_at  = (Get-Date).ToString('o')
            model         = $Model
            temperature   = $Temperature
            min_similarity = $MinSimilarity
            node_count    = $Bucket.Nodes.Count
            cluster_count = $ClusterData.Count
            missing_nodes = $Missing
        }) -Force

        $AllProposals.Add($Proposal)
    }

    # ── Write output ─────────────────────────────────────────────────────────
    if ($AllProposals.Count -eq 0) {
        Write-Warn 'No proposals generated'
        return
    }

    $Timestamp  = (Get-Date).ToString('yyyy-MM-dd-HHmmss')
    $OutputFile = Join-Path $OutputDir "hierarchy-proposal-$Timestamp.json"

    $OutputObj = [ordered]@{
        generated_at = (Get-Date).ToString('o')
        model        = $Model
        buckets      = $AllProposals.ToArray()
    }

    $Json = $OutputObj | ConvertTo-Json -Depth 30
    if ($PSCmdlet.ShouldProcess($OutputFile, 'Write hierarchy proposal')) {
        Set-Content -Path $OutputFile -Value $Json -Encoding UTF8
        Write-Step 'Done'
        Write-OK "Proposal saved to $OutputFile"
    }

    # ── Generate review Markdown ─────────────────────────────────────────────
    $ReviewFile = Join-Path $OutputDir "hierarchy-review-$Timestamp.md"
    $Md = [System.Text.StringBuilder]::new()
    [void]$Md.AppendLine("# Hierarchy Proposal Review — $Timestamp")
    [void]$Md.AppendLine('')
    [void]$Md.AppendLine("**Model:** $Model | **Generated:** $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
    [void]$Md.AppendLine('')

    foreach ($Proposal in $AllProposals) {
        $PovLabel = $Proposal.pov
        $CatLabel = if ($Proposal.PSObject.Properties['category'] -and $Proposal.category) {
            $Proposal.category
        } else { '(cross-cutting)' }

        [void]$Md.AppendLine("---")
        [void]$Md.AppendLine('')
        [void]$Md.AppendLine("## $PovLabel / $CatLabel")
        [void]$Md.AppendLine('')

        if ($Proposal.PSObject.Properties['parents']) {
            $ParentIdx = 0
            foreach ($Parent in @($Proposal.parents)) {
                $ParentIdx++
                $ParentLabel = if ($Parent.promoted_from) {
                    $PromotedNode = $null
                    foreach ($PovKey in $PovFileMap.Keys) {
                        if ($AllTaxData.ContainsKey($PovKey)) {
                            $PromotedNode = $AllTaxData[$PovKey].nodes |
                                Where-Object { $_.id -eq $Parent.promoted_from } |
                                Select-Object -First 1
                            if ($PromotedNode) { break }
                        }
                    }
                    if ($PromotedNode) { "$($PromotedNode.label) ($($Parent.promoted_from))" }
                    else { $Parent.promoted_from }
                }
                else { $Parent.label }

                $StatusTag = if ($Parent.promoted_from) { 'PROMOTED' } else { 'NEW' }

                [void]$Md.AppendLine("### Parent $ParentIdx`: $ParentLabel [$StatusTag]")
                [void]$Md.AppendLine('')
                if ($Parent.description) {
                    [void]$Md.AppendLine("> $($Parent.description)")
                    [void]$Md.AppendLine('')
                }

                [void]$Md.AppendLine('| Child ID | Label | Relationship | Rationale |')
                [void]$Md.AppendLine('|----------|-------|-------------|-----------|')
                foreach ($Child in @($Parent.children)) {
                    # Look up child label
                    $ChildLabel = $Child.node_id
                    foreach ($PovKey in $PovFileMap.Keys) {
                        if ($AllTaxData.ContainsKey($PovKey)) {
                            $Found = $AllTaxData[$PovKey].nodes |
                                Where-Object { $_.id -eq $Child.node_id } |
                                Select-Object -First 1
                            if ($Found) { $ChildLabel = $Found.label; break }
                        }
                    }
                    $Rationale = ($Child.rationale -replace '\|', '/') -replace '\n', ' '
                    [void]$Md.AppendLine("| $($Child.node_id) | $ChildLabel | $($Child.relationship) | $Rationale |")
                }
                [void]$Md.AppendLine('')
                [void]$Md.AppendLine('**Verdict:** [ ] Accept  [ ] Modify  [ ] Reject')
                [void]$Md.AppendLine('')
            }
        }

        if ($Proposal.PSObject.Properties['outliers'] -and $Proposal.outliers.Count -gt 0) {
            [void]$Md.AppendLine('### Outliers (no parent assigned)')
            [void]$Md.AppendLine('')
            [void]$Md.AppendLine('| Node ID | Label | Reason |')
            [void]$Md.AppendLine('|---------|-------|--------|')
            foreach ($Outlier in @($Proposal.outliers)) {
                $OLabel = $Outlier.node_id
                foreach ($PovKey in $PovFileMap.Keys) {
                    if ($AllTaxData.ContainsKey($PovKey)) {
                        $Found = $AllTaxData[$PovKey].nodes |
                            Where-Object { $_.id -eq $Outlier.node_id } |
                            Select-Object -First 1
                        if ($Found) { $OLabel = $Found.label; break }
                    }
                }
                $Reason = ($Outlier.reason -replace '\|', '/') -replace '\n', ' '
                [void]$Md.AppendLine("| $($Outlier.node_id) | $OLabel | $Reason |")
            }
            [void]$Md.AppendLine('')
        }

        if ($Proposal._metadata.missing_nodes.Count -gt 0) {
            [void]$Md.AppendLine("**Warning:** $($Proposal._metadata.missing_nodes.Count) nodes not assigned by AI: ``$($Proposal._metadata.missing_nodes -join '``, ``')``")
            [void]$Md.AppendLine('')
        }
    }

    if ($PSCmdlet.ShouldProcess($ReviewFile, 'Write review Markdown')) {
        Set-Content -Path $ReviewFile -Value $Md.ToString() -Encoding UTF8
        Write-OK "Review document saved to $ReviewFile"
    }

    return [PSCustomObject]@{
        ProposalFile = $OutputFile
        ReviewFile   = $ReviewFile
        BucketCount  = $AllProposals.Count
        TotalParents = ($AllProposals | ForEach-Object {
            if ($_.PSObject.Properties['parents']) { $_.parents.Count } else { 0 }
        } | Measure-Object -Sum).Sum
    }
}
