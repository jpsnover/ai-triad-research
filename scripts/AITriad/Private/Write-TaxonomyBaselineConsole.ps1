# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-TaxonomyBaselineConsole {
    <#
    .SYNOPSIS
        Renders Measure-TaxonomyBaseline's console summary (t/3910 decomposition;
        no behavior change -- same Write-Host lines, same ForegroundColor).
    .PARAMETER Report
        The assembled report object (node_mapping/density/edges/conflicts/
        fallacies/descriptions/unmapped_concepts/ontology_coverage sections).
    .PARAMETER NodeCount
        Total taxonomy node count (the denominator several lines display against).
    .PARAMETER ClaimsTotal
        Total factual claims examined -- not persisted in the report's
        ontology_coverage._counts, so the caller passes it through separately.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Report,

        [Parameter(Mandatory)]
        [int]$NodeCount,

        [Parameter(Mandatory)]
        [int]$ClaimsTotal
    )

    Set-StrictMode -Version Latest

    $M = $Report.node_mapping
    Write-Host "`n── Node Mapping ──" -ForegroundColor Cyan
    Write-Host "  Key points: $($M.total_key_points) total, $($M.null_mapped) unmapped ($($M.null_mapped_pct)%)"
    Write-Host "  Invalid node refs: $($M.invalid_node_refs)"
    Write-Host "  Category inconsistencies: $($M.category_inconsistencies) nodes assigned different categories across summaries"
    Write-Host "  Unreferenced nodes: $($M.unreferenced_node_count)/$NodeCount ($($M.unreferenced_node_pct)%)"

    $D = $Report.density
    Write-Host "`n── Density ──" -ForegroundColor Cyan
    Write-Host "  Median KP per 1K words: $($D.median_kp_per_1k)"
    Write-Host "  P10-P90 range: $($D.p10_kp_per_1k) - $($D.p90_kp_per_1k)"
    Write-Host "  Zero-KP camp entries: $($D.zero_kp_camp_entries)"

    $E = $Report.edges
    Write-Host "`n── Edges ──" -ForegroundColor Cyan
    Write-Host "  Total: $($E.total_edges)"
    Write-Host "  Canonical types: $($E.canonical_type_count), Non-canonical: $($E.non_canonical_type_count)"
    Write-Host "  Orphans: $($E.orphan_edges), Self-edges: $($E.self_edges)"
    Write-Host "  Desires SUPPORTS Beliefs (domain violation): $($E.goals_supports_data)"

    $C = $Report.conflicts
    Write-Host "`n── Conflicts ──" -ForegroundColor Cyan
    Write-Host "  Total: $($C.total_conflicts), Single-instance: $($C.single_instance) ($($C.single_instance_pct)%)"

    $F = $Report.fallacies
    Write-Host "`n── Fallacies ──" -ForegroundColor Cyan
    Write-Host "  Nodes flagged: $($F.nodes_with_fallacies)/$NodeCount ($($F.flagging_rate_pct)%)"
    Write-Host "  Total flags: $($F.total_flags) (likely: $($F.confidence_likely), possible: $($F.confidence_possible), borderline: $($F.confidence_borderline))"
    Write-Host "  Avg per flagged node: $($F.avg_per_flagged_node)"

    $Desc = $Report.descriptions
    Write-Host "`n── Descriptions ──" -ForegroundColor Cyan
    Write-Host "  Median length: $($Desc.median_desc_length) chars"
    Write-Host "  Short (<50): $($Desc.short_descriptions), Stubs: $($Desc.stub_descriptions)"
    Write-Host "  Already genus-differentia: $($Desc.genus_differentia_pattern) ($($Desc.genus_differentia_pct)%)"

    $U = $Report.unmapped_concepts
    Write-Host "`n── Unmapped Concepts ──" -ForegroundColor Cyan
    Write-Host "  Total: $($U.total_unmapped_concepts), Resolved: $($U.resolved) ($($U.resolved_pct)%)"

    $O = $Report.ontology_coverage
    Write-Host "`n── Ontology Coverage ──" -ForegroundColor Cyan
    Write-Host "  node_scope:           $($O.node_scope_coverage_pct)% ($($O._counts.nodes_with_scope)/$NodeCount)"
    Write-Host "  genus-differentia:    $($O.genus_differentia_pct)%"
    Write-Host "  bdi_layer:            $($O.bdi_layer_coverage_pct)% ($($O._counts.disagreements_with_bdi)/$($O._counts.disagreements_total) disagreements)"
    Write-Host "  argument_map:         $($O.argument_map_coverage_pct)% ($($O._counts.debates_with_argmap)/$($O._counts.debates_total) debates)"
    Write-Host "  parent_relationship:  $($O.parent_relationship_coverage_pct)% ($($O._counts.nodes_with_parent)/$NodeCount)"
    Write-Host "  fallacy_tier:         $($O.fallacy_tier_coverage_pct)% ($($O._counts.fallacies_with_tier)/$($F.total_flags) fallacies)"
    Write-Host "  temporal_scope:       $($O.temporal_scope_coverage_pct)% ($($O._counts.claims_with_temporal)/$ClaimsTotal claims)"

    Write-Host ""
}
