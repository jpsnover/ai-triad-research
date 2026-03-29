# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-TaxonomyBaseline {
    <#
    .SYNOPSIS
        Measures quality baselines for the taxonomy, summaries, edges, and conflicts.
    .DESCRIPTION
        Produces a structured report of data quality metrics that can be compared
        before and after prompt or schema changes. Covers:
          - Node mapping rates and consistency across summaries
          - Density distribution (points per camp scaled by document size)
          - Edge type distribution and potential misclassification indicators
          - Conflict quality (temporal ambiguity, single-instance conflicts)
          - Fallacy flagging rates
          - Description quality signals (length, structure)

        Run this before any BFO-related prompt changes to establish a baseline,
        then re-run after changes to measure impact.
    .PARAMETER OutputPath
        Optional path to write the JSON report. If omitted, prints to console.
    .PARAMETER SampleDocIds
        Optional array of doc IDs to focus analysis on. If omitted, analyzes all.
    .EXAMPLE
        Measure-TaxonomyBaseline
    .EXAMPLE
        Measure-TaxonomyBaseline -OutputPath ./baseline-2026-03-28.json
    #>
    [CmdletBinding()]
    param(
        [string]$OutputPath,
        [string[]]$SampleDocIds
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SummariesDir = Get-SummariesDir
    $SourcesDir   = Get-SourcesDir
    $TaxDir       = Get-TaxonomyDir
    $ConflictsDir = Get-ConflictsDir

    Write-Host "`n=== Taxonomy Baseline Measurement ===" -ForegroundColor Cyan
    Write-Host "  Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

    # ── Load taxonomy ──────────────────────────────────────────────────────
    $AllNodes = @{}
    foreach ($File in (Get-ChildItem $TaxDir -Filter '*.json' | Where-Object { $_.Name -notin 'embeddings.json','edges.json','policy_actions.json','Temp.json','_archived_edges.json' })) {
        $Data = Get-Content -Raw $File.FullName | ConvertFrom-Json -Depth 20
        foreach ($Node in $Data.nodes) {
            $AllNodes[$Node.id] = $Node
        }
    }
    Write-Host "  Taxonomy: $($AllNodes.Count) nodes" -ForegroundColor Gray

    # ── Load summaries ─────────────────────────────────────────────────────
    $SummaryFiles = Get-ChildItem $SummariesDir -Filter '*.json' -ErrorAction SilentlyContinue
    if ($SampleDocIds) {
        $SummaryFiles = $SummaryFiles | Where-Object { $_.BaseName -in $SampleDocIds }
    }
    $Summaries = @{}
    foreach ($F in $SummaryFiles) {
        try {
            $Summaries[$F.BaseName] = Get-Content -Raw $F.FullName | ConvertFrom-Json -Depth 20
        } catch { Write-Warning "Bad JSON: $($F.Name)" }
    }
    Write-Host "  Summaries: $($Summaries.Count)" -ForegroundColor Gray

    # ── Load edges ─────────────────────────────────────────────────────────
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $Edges = @()
    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw $EdgesPath | ConvertFrom-Json -Depth 20
        $Edges = $EdgesData.edges
    }
    Write-Host "  Edges: $($Edges.Count)" -ForegroundColor Gray

    # ── Load conflicts ─────────────────────────────────────────────────────
    $Conflicts = @()
    if (Test-Path $ConflictsDir) {
        foreach ($F in (Get-ChildItem $ConflictsDir -Filter '*.json' -ErrorAction SilentlyContinue)) {
            try { $Conflicts += Get-Content -Raw $F.FullName | ConvertFrom-Json -Depth 20 } catch {}
        }
    }
    Write-Host "  Conflicts: $($Conflicts.Count)" -ForegroundColor Gray

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 1: Node Mapping Quality
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "`n  Analyzing node mapping quality..." -ForegroundColor Yellow

    $TotalKP = 0; $NullMapped = 0; $InvalidNodeRef = 0
    $NodeRefCounts = @{}  # nodeId -> count of times referenced across all summaries
    $CategoryPerNode = @{}  # nodeId -> set of categories assigned
    $Camps = @('accelerationist','safetyist','skeptic')

    foreach ($Sum in $Summaries.Values) {
        foreach ($Camp in $Camps) {
            $CampData = $Sum.pov_summaries.$Camp
            if (-not $CampData -or -not $CampData.key_points) { continue }
            foreach ($KP in $CampData.key_points) {
                $TotalKP++
                $NodeId = $KP.taxonomy_node_id
                if ($null -eq $NodeId -or $NodeId -eq '') {
                    $NullMapped++
                } else {
                    if (-not $AllNodes.ContainsKey($NodeId)) {
                        $InvalidNodeRef++
                    }
                    if (-not $NodeRefCounts.ContainsKey($NodeId)) { $NodeRefCounts[$NodeId] = 0 }
                    $NodeRefCounts[$NodeId]++
                    # Track category consistency
                    if ($KP.category) {
                        if (-not $CategoryPerNode.ContainsKey($NodeId)) {
                            $CategoryPerNode[$NodeId] = [System.Collections.Generic.HashSet[string]]::new()
                        }
                        [void]$CategoryPerNode[$NodeId].Add($KP.category)
                    }
                }
            }
        }
    }

    $CategoryInconsistencies = @($CategoryPerNode.GetEnumerator() | Where-Object { $_.Value.Count -gt 1 })
    $UnreferencedNodes = @($AllNodes.Keys | Where-Object { -not $NodeRefCounts.ContainsKey($_) })

    $MappingMetrics = [ordered]@{
        total_key_points          = $TotalKP
        null_mapped               = $NullMapped
        null_mapped_pct           = if ($TotalKP -gt 0) { [Math]::Round($NullMapped / $TotalKP * 100, 1) } else { 0 }
        invalid_node_refs         = $InvalidNodeRef
        category_inconsistencies  = $CategoryInconsistencies.Count
        category_inconsistent_ids = @($CategoryInconsistencies | ForEach-Object { $_.Key })
        unreferenced_node_count   = $UnreferencedNodes.Count
        unreferenced_node_pct     = [Math]::Round($UnreferencedNodes.Count / $AllNodes.Count * 100, 1)
    }

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 2: Density Distribution (scaled by document size)
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "  Analyzing density distribution..." -ForegroundColor Yellow

    $DensityRecords = [System.Collections.Generic.List[object]]::new()

    foreach ($DocId in $Summaries.Keys) {
        $Sum = $Summaries[$DocId]
        $SnapPath = Join-Path $SourcesDir $DocId 'snapshot.md'
        $WordCount = 0
        if (Test-Path $SnapPath) {
            $Text = Get-Content -Raw $SnapPath
            $WordCount = ($Text -split '\s+').Count
        }

        foreach ($Camp in $Camps) {
            $CampData = $Sum.pov_summaries.$Camp
            $KPCount = if ($CampData -and $CampData.key_points) { @($CampData.key_points).Count } else { 0 }
            $DensityRecords.Add([PSCustomObject]@{
                DocId     = $DocId
                Camp      = $Camp
                WordCount = $WordCount
                KPCount   = $KPCount
                KPPer1K   = if ($WordCount -gt 0) { [Math]::Round($KPCount / ($WordCount / 1000), 2) } else { 0 }
            })
        }
    }

    $AllKPPer1K = @($DensityRecords | Where-Object { $_.WordCount -gt 0 } | ForEach-Object { $_.KPPer1K })
    $SortedKP = $AllKPPer1K | Sort-Object

    $DensityMetrics = [ordered]@{
        doc_count            = $Summaries.Count
        median_kp_per_1k     = if ($SortedKP.Count -gt 0) { $SortedKP[[int]($SortedKP.Count / 2)] } else { 0 }
        p10_kp_per_1k        = if ($SortedKP.Count -gt 9) { $SortedKP[[int]($SortedKP.Count * 0.1)] } else { 0 }
        p90_kp_per_1k        = if ($SortedKP.Count -gt 9) { $SortedKP[[int]($SortedKP.Count * 0.9)] } else { 0 }
        zero_kp_camp_entries = @($DensityRecords | Where-Object { $_.KPCount -eq 0 }).Count
        # Outlier docs: very low density
        low_density_docs     = @($DensityRecords |
            Where-Object { $_.WordCount -gt 2000 -and $_.KPPer1K -lt 1.0 } |
            Sort-Object KPPer1K |
            Select-Object -First 10 DocId, Camp, WordCount, KPCount, KPPer1K)
        # Outlier docs: very high density (possible padding)
        high_density_docs    = @($DensityRecords |
            Where-Object { $_.WordCount -gt 500 -and $_.KPPer1K -gt 15 } |
            Sort-Object KPPer1K -Descending |
            Select-Object -First 10 DocId, Camp, WordCount, KPCount, KPPer1K)
    }

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 3: Edge Quality
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "  Analyzing edge quality..." -ForegroundColor Yellow

    $TypeCounts = @{}
    $OrphanEdges = 0
    $SelfEdges = 0
    $GoalSupportsData = 0  # Domain violation: Goals/Values SUPPORTS Data/Facts

    foreach ($E in $Edges) {
        $Type = $E.type
        if (-not $TypeCounts.ContainsKey($Type)) { $TypeCounts[$Type] = 0 }
        $TypeCounts[$Type]++

        if ($E.source -eq $E.target) { $SelfEdges++ }

        # Policy nodes (pol-*) are in the policy registry, not in $AllNodes — skip orphan check for them
        $SrcIsPolicy = $E.source -match '^pol-'
        $TgtIsPolicy = $E.target -match '^pol-'
        $SrcNode = if ($SrcIsPolicy) { $true } else { $AllNodes[$E.source] }
        $TgtNode = if ($TgtIsPolicy) { $true } else { $AllNodes[$E.target] }
        if (-not $SrcNode -or -not $TgtNode) {
            $OrphanEdges++
            continue
        }

        # Check domain violation: Goals/Values SUPPORTS Data/Facts (skip policy nodes)
        if ($SrcIsPolicy -or $TgtIsPolicy) { continue }
        $SrcCat = if ($SrcNode.PSObject.Properties['category']) { $SrcNode.category } else { $null }
        $TgtCat = if ($TgtNode.PSObject.Properties['category']) { $TgtNode.category } else { $null }
        if ($Type -eq 'SUPPORTS' -and $SrcCat -eq 'Goals/Values' -and $TgtCat -eq 'Data/Facts') {
            $GoalSupportsData++
        }
    }

    $CanonicalTypes = @('SUPPORTS','CONTRADICTS','ASSUMES','WEAKENS','RESPONDS_TO','TENSION_WITH','INTERPRETS')
    $NonCanonical = @($TypeCounts.GetEnumerator() | Where-Object { $_.Key -notin $CanonicalTypes })

    $EdgeMetrics = [ordered]@{
        total_edges               = $Edges.Count
        type_distribution         = [ordered]@{}
        canonical_type_count      = ($CanonicalTypes | ForEach-Object { $TypeCounts[$_] } | Measure-Object -Sum).Sum
        non_canonical_type_count  = ($NonCanonical | ForEach-Object { $_.Value } | Measure-Object -Sum).Sum
        non_canonical_types       = @($NonCanonical | Sort-Object Value -Descending | ForEach-Object { [ordered]@{ type = $_.Key; count = $_.Value } })
        orphan_edges              = $OrphanEdges
        self_edges                = $SelfEdges
        goals_supports_data       = $GoalSupportsData
    }
    foreach ($T in ($TypeCounts.GetEnumerator() | Sort-Object Value -Descending)) {
        $EdgeMetrics.type_distribution[$T.Key] = $T.Value
    }

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 4: Conflict Quality
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "  Analyzing conflict quality..." -ForegroundColor Yellow

    $SingleInstance = @($Conflicts | Where-Object { @($_.instances).Count -le 1 }).Count
    $MultiInstance  = @($Conflicts | Where-Object { @($_.instances).Count -gt 1 }).Count

    $ConflictMetrics = [ordered]@{
        total_conflicts         = $Conflicts.Count
        single_instance         = $SingleInstance
        single_instance_pct     = if ($Conflicts.Count -gt 0) { [Math]::Round($SingleInstance / $Conflicts.Count * 100, 1) } else { 0 }
        multi_instance          = $MultiInstance
        status_open             = @($Conflicts | Where-Object { $_.status -eq 'open' }).Count
        status_resolved         = @($Conflicts | Where-Object { $_.status -eq 'resolved' }).Count
    }

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 5: Fallacy Flagging Rates
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "  Analyzing fallacy flagging..." -ForegroundColor Yellow

    $FallacyTotal = 0; $FallacyLikely = 0; $FallacyPossible = 0; $FallacyBorderline = 0
    $NodesWithFallacies = 0; $NodesWithoutFallacies = 0
    $FallacyTypeCounts = @{}

    foreach ($Node in $AllNodes.Values) {
        $GA = $Node.graph_attributes
        $HasFallacies = $GA -and $GA.PSObject.Properties['possible_fallacies'] -and $GA.possible_fallacies
        if ($HasFallacies) {
            $Fallacies = @($GA.possible_fallacies)
            if ($Fallacies.Count -gt 0) {
                $NodesWithFallacies++
                foreach ($F in $Fallacies) {
                    $FallacyTotal++
                    switch ($F.confidence) {
                        'likely'     { $FallacyLikely++ }
                        'possible'   { $FallacyPossible++ }
                        'borderline' { $FallacyBorderline++ }
                    }
                    $Key = $F.fallacy
                    if (-not $FallacyTypeCounts.ContainsKey($Key)) { $FallacyTypeCounts[$Key] = 0 }
                    $FallacyTypeCounts[$Key]++
                }
            } else {
                $NodesWithoutFallacies++
            }
        } else {
            $NodesWithoutFallacies++
        }
    }

    $FallacyMetrics = [ordered]@{
        nodes_with_fallacies    = $NodesWithFallacies
        nodes_without_fallacies = $NodesWithoutFallacies
        flagging_rate_pct       = if ($AllNodes.Count -gt 0) { [Math]::Round($NodesWithFallacies / $AllNodes.Count * 100, 1) } else { 0 }
        total_flags             = $FallacyTotal
        avg_per_flagged_node    = if ($NodesWithFallacies -gt 0) { [Math]::Round($FallacyTotal / $NodesWithFallacies, 1) } else { 0 }
        confidence_likely       = $FallacyLikely
        confidence_possible     = $FallacyPossible
        confidence_borderline   = $FallacyBorderline
        top_fallacy_types       = @($FallacyTypeCounts.GetEnumerator() |
            Sort-Object Value -Descending |
            Select-Object -First 15 |
            ForEach-Object { [ordered]@{ type = $_.Key; count = $_.Value } })
    }

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 6: Description Quality Signals
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "  Analyzing description quality..." -ForegroundColor Yellow

    $DescLengths = @()
    $GenusPattern = 0  # Starts with "A [category] within [POV]"
    $ShortDescs = 0    # < 50 chars
    $StubDescs = 0     # Description == label (placeholder)

    foreach ($Node in $AllNodes.Values) {
        $Desc = $Node.description
        if (-not $Desc) { $StubDescs++; continue }
        $DescLengths += $Desc.Length
        if ($Desc.Length -lt 50) { $ShortDescs++ }
        if ($Desc -eq $Node.label) { $StubDescs++ }
        if ($Desc -match '^A\s+(Goals/Values|Data/Facts|Methods/Arguments)\s+within\s+(accelerationist|safetyist|skeptic)\s+discourse\s+that\s+' -or
            $Desc -match '^A\s+cross-cutting\s+concept\s+that\s+') {
            $GenusPattern++
        }
    }

    $SortedDesc = $DescLengths | Sort-Object

    $DescriptionMetrics = [ordered]@{
        total_nodes                 = $AllNodes.Count
        median_desc_length          = if ($SortedDesc.Count -gt 0) { $SortedDesc[[int]($SortedDesc.Count / 2)] } else { 0 }
        p10_desc_length             = if ($SortedDesc.Count -gt 9) { $SortedDesc[[int]($SortedDesc.Count * 0.1)] } else { 0 }
        p90_desc_length             = if ($SortedDesc.Count -gt 9) { $SortedDesc[[int]($SortedDesc.Count * 0.9)] } else { 0 }
        short_descriptions          = $ShortDescs
        stub_descriptions           = $StubDescs
        genus_differentia_pattern   = $GenusPattern
        genus_differentia_pct       = [Math]::Round($GenusPattern / [Math]::Max(1, $AllNodes.Count) * 100, 1)
    }

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 7: Unmapped Concepts Across Summaries
    # ══════════════════════════════════════════════════════════════════════
    Write-Host "  Analyzing unmapped concepts..." -ForegroundColor Yellow

    $TotalUnmapped = 0; $ResolvedUnmapped = 0
    foreach ($Sum in $Summaries.Values) {
        if ($Sum.unmapped_concepts) {
            foreach ($UC in $Sum.unmapped_concepts) {
                $TotalUnmapped++
                if ($UC.PSObject.Properties['resolved_node_id'] -and $UC.resolved_node_id) { $ResolvedUnmapped++ }
            }
        }
    }

    $UnmappedMetrics = [ordered]@{
        total_unmapped_concepts = $TotalUnmapped
        resolved                = $ResolvedUnmapped
        unresolved              = $TotalUnmapped - $ResolvedUnmapped
        resolved_pct            = if ($TotalUnmapped -gt 0) { [Math]::Round($ResolvedUnmapped / $TotalUnmapped * 100, 1) } else { 0 }
    }

    # ══════════════════════════════════════════════════════════════════════
    # ASSEMBLE REPORT
    # ══════════════════════════════════════════════════════════════════════

    $Report = [ordered]@{
        metadata = [ordered]@{
            generated_at     = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
            taxonomy_version = if (Test-Path (Join-Path (Split-Path $TaxDir) 'TAXONOMY_VERSION')) {
                (Get-Content (Join-Path (Split-Path $TaxDir) 'TAXONOMY_VERSION') -Raw).Trim()
            } else { 'unknown' }
            node_count       = $AllNodes.Count
            summary_count    = $Summaries.Count
            edge_count       = $Edges.Count
            conflict_count   = $Conflicts.Count
            sample_doc_ids   = if ($SampleDocIds) { $SampleDocIds } else { 'all' }
        }
        node_mapping       = $MappingMetrics
        density            = $DensityMetrics
        edges              = $EdgeMetrics
        conflicts          = $ConflictMetrics
        fallacies          = $FallacyMetrics
        descriptions       = $DescriptionMetrics
        unmapped_concepts  = $UnmappedMetrics
    }

    # ── Output ─────────────────────────────────────────────────────────────
    $Json = $Report | ConvertTo-Json -Depth 10

    if ($OutputPath) {
        Set-Content -Path $OutputPath -Value $Json -Encoding UTF8
        Write-Host "`n  Report saved: $OutputPath" -ForegroundColor Green
    }

    # ── Console Summary ────────────────────────────────────────────────────
    Write-Host "`n── Node Mapping ──" -ForegroundColor Cyan
    Write-Host "  Key points: $TotalKP total, $NullMapped unmapped ($($MappingMetrics.null_mapped_pct)%)"
    Write-Host "  Invalid node refs: $InvalidNodeRef"
    Write-Host "  Category inconsistencies: $($CategoryInconsistencies.Count) nodes assigned different categories across summaries"
    Write-Host "  Unreferenced nodes: $($UnreferencedNodes.Count)/$($AllNodes.Count) ($($MappingMetrics.unreferenced_node_pct)%)"

    Write-Host "`n── Density ──" -ForegroundColor Cyan
    Write-Host "  Median KP per 1K words: $($DensityMetrics.median_kp_per_1k)"
    Write-Host "  P10-P90 range: $($DensityMetrics.p10_kp_per_1k) - $($DensityMetrics.p90_kp_per_1k)"
    Write-Host "  Zero-KP camp entries: $($DensityMetrics.zero_kp_camp_entries)"

    Write-Host "`n── Edges ──" -ForegroundColor Cyan
    Write-Host "  Total: $($Edges.Count)"
    Write-Host "  Canonical types: $($EdgeMetrics.canonical_type_count), Non-canonical: $($EdgeMetrics.non_canonical_type_count)"
    Write-Host "  Orphans: $OrphanEdges, Self-edges: $SelfEdges"
    Write-Host "  Goals/Values SUPPORTS Data/Facts (domain violation): $GoalSupportsData"

    Write-Host "`n── Conflicts ──" -ForegroundColor Cyan
    Write-Host "  Total: $($Conflicts.Count), Single-instance: $SingleInstance ($($ConflictMetrics.single_instance_pct)%)"

    Write-Host "`n── Fallacies ──" -ForegroundColor Cyan
    Write-Host "  Nodes flagged: $NodesWithFallacies/$($AllNodes.Count) ($($FallacyMetrics.flagging_rate_pct)%)"
    Write-Host "  Total flags: $FallacyTotal (likely: $FallacyLikely, possible: $FallacyPossible, borderline: $FallacyBorderline)"
    Write-Host "  Avg per flagged node: $($FallacyMetrics.avg_per_flagged_node)"

    Write-Host "`n── Descriptions ──" -ForegroundColor Cyan
    Write-Host "  Median length: $($DescriptionMetrics.median_desc_length) chars"
    Write-Host "  Short (<50): $ShortDescs, Stubs: $StubDescs"
    Write-Host "  Already genus-differentia: $GenusPattern ($($DescriptionMetrics.genus_differentia_pct)%)"

    Write-Host "`n── Unmapped Concepts ──" -ForegroundColor Cyan
    Write-Host "  Total: $TotalUnmapped, Resolved: $ResolvedUnmapped ($($UnmappedMetrics.resolved_pct)%)"

    Write-Host "" # final newline

    # Return the report object for pipeline use
    return [PSCustomObject]$Report
}
