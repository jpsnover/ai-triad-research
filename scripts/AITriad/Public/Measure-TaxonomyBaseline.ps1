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
    .LINK
        Show-AITriadHelp
    .LINK
        Get-Tax
    .LINK
        Get-GraphNode
    .LINK
        Get-TaxonomyHealth
    .LINK
        Compare-Taxonomy
    .LINK
        Test-TaxonomyIntegrity
    .LINK
        Test-OntologyCompliance
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
    $DebatesDir   = Get-DebatesDir
    $Camps        = @('accelerationist', 'safetyist', 'skeptic')

    Write-Host "`n=== Taxonomy Baseline Measurement ===" -ForegroundColor Cyan
    Write-Host "  Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

    $AllNodes = Get-TaxonomyBaselineAllNodes -TaxDir $TaxDir
    Write-Host "  Taxonomy: $($AllNodes.Count) nodes" -ForegroundColor Gray

    $Summaries = Get-TaxonomyBaselineSummaries -SummariesDir $SummariesDir -SampleDocIds $SampleDocIds
    Write-Host "  Summaries: $($Summaries.Count)" -ForegroundColor Gray

    $Edges = Get-TaxonomyBaselineEdges -TaxDir $TaxDir
    Write-Host "  Edges: $($Edges.Count)" -ForegroundColor Gray

    $Conflicts = Get-TaxonomyBaselineConflicts -ConflictsDir $ConflictsDir
    Write-Host "  Conflicts: $($Conflicts.Count)" -ForegroundColor Gray

    Write-Host "`n  Analyzing node mapping quality..." -ForegroundColor Yellow
    $MappingMetrics = Measure-NodeMappingQuality -AllNodes $AllNodes -Summaries $Summaries -Camps $Camps

    Write-Host "  Analyzing density distribution..." -ForegroundColor Yellow
    $DensityMetrics = Measure-DensityDistribution -Summaries $Summaries -Camps $Camps -SourcesDir $SourcesDir

    Write-Host "  Analyzing edge quality..." -ForegroundColor Yellow
    $EdgeMetrics = Measure-EdgeQuality -Edges $Edges -AllNodes $AllNodes

    Write-Host "  Analyzing conflict quality..." -ForegroundColor Yellow
    $ConflictMetrics = Measure-ConflictQuality -Conflicts $Conflicts

    Write-Host "  Analyzing fallacy flagging..." -ForegroundColor Yellow
    $FallacyMetrics = Measure-FallacyFlagging -AllNodes $AllNodes

    Write-Host "  Analyzing description quality..." -ForegroundColor Yellow
    $DescriptionMetrics = Measure-DescriptionQuality -AllNodes $AllNodes

    Write-Host "  Analyzing unmapped concepts..." -ForegroundColor Yellow
    $UnmappedMetrics = Measure-UnmappedConcepts -Summaries $Summaries

    Write-Host "  Analyzing ontology coverage..." -ForegroundColor Yellow
    $OntologyResult = Measure-OntologyCoverage -AllNodes $AllNodes -Summaries $Summaries -DebatesDir $DebatesDir `
        -FallacyTotal $FallacyMetrics.total_flags -GenusDifferentiaPct $DescriptionMetrics.genus_differentia_pct
    $OntologyMetrics = $OntologyResult.Metrics

    # ── Assemble report ─────────────────────────────────────────────────────
    $Report = [PSCustomObject][ordered]@{
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
        node_mapping      = $MappingMetrics
        density           = $DensityMetrics
        edges             = $EdgeMetrics
        conflicts         = $ConflictMetrics
        fallacies         = $FallacyMetrics
        descriptions      = $DescriptionMetrics
        unmapped_concepts = $UnmappedMetrics
        ontology_coverage = $OntologyMetrics
    }

    # ── Output ─────────────────────────────────────────────────────────────
    $Json = $Report | ConvertTo-Json -Depth 10

    if ($OutputPath) {
        Write-Utf8NoBom -Path $OutputPath -Value $Json
        Write-Host "`n  Report saved: $OutputPath" -ForegroundColor Green
    }

    Write-TaxonomyBaselineConsole -Report $Report -NodeCount $AllNodes.Count -ClaimsTotal $OntologyResult.ClaimsTotal

    return $Report
}
