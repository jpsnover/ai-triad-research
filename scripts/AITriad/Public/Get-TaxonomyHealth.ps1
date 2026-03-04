function Get-TaxonomyHealth {
    <#
    .SYNOPSIS
        Displays a diagnostic report on taxonomy coverage and usage across all summaries.
    .DESCRIPTION
        Scans every summary JSON against the taxonomy to surface:
        - Orphan nodes (zero citations)
        - Most/least cited nodes
        - Unmapped concept frequency
        - Stance variance (nodes cited with both aligned and opposed stances)
        - Coverage balance across POVs and categories
        - Cross-cutting reference health

        No AI calls are made — this is a purely offline diagnostic.
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .PARAMETER OutputFile
        Optional path to write the full health data as JSON.
    .PARAMETER Detailed
        Show per-node and per-document breakdowns.
    .PARAMETER PassThru
        Return the health data hashtable for piping to other commands.
    .EXAMPLE
        Get-TaxonomyHealth
    .EXAMPLE
        Get-TaxonomyHealth -Detailed -OutputFile health.json
    .EXAMPLE
        $h = Get-TaxonomyHealth -PassThru
        Invoke-TaxonomyProposal -HealthData $h
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot   = $script:RepoRoot,
        [string]$OutputFile  = '',
        [switch]$Detailed,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Compute health data ────────────────────────────────────────────────────
    Write-Step "Computing taxonomy health data"
    $Health = Get-TaxonomyHealthData -RepoRoot $RepoRoot
    Write-OK "Scanned $($Health.SummaryCount) summaries against taxonomy v$($Health.TaxonomyVersion)"

    # ── 1. Summary Statistics ──────────────────────────────────────────────────
    $Stats = $Health.SummaryStats

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  TAXONOMY HEALTH REPORT" -ForegroundColor White
    Write-Host "  Taxonomy v$($Health.TaxonomyVersion)  |  $($Health.SummaryCount) summaries  |  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    Write-Host "`n  SUMMARY STATISTICS" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray
    Write-Info "Total key points     : $($Stats.TotalKeyPoints)"
    Write-Info "Avg key points/doc   : $($Stats.AvgKeyPoints)"
    Write-Info "Total factual claims : $($Stats.TotalClaims)"
    Write-Info "Total unmapped       : $($Stats.TotalUnmapped)"
    if ($Stats.MaxKeyPointsDoc) {
        Write-Info "Most points          : $($Stats.MaxKeyPointsDoc.KeyPoints) ($($Stats.MaxKeyPointsDoc.DocId))"
    }
    if ($Stats.MinKeyPointsDoc) {
        Write-Info "Fewest points        : $($Stats.MinKeyPointsDoc.KeyPoints) ($($Stats.MinKeyPointsDoc.DocId))"
    }

    # ── 2. Coverage Balance ────────────────────────────────────────────────────
    Write-Host "`n  COVERAGE BALANCE (nodes per POV x category)" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    $Categories = @('Goals/Values', 'Data/Facts', 'Methods')
    $PovKeys    = @('accelerationist', 'safetyist', 'skeptic')

    # Header row
    $Header = '  {0,-16}' -f ''
    foreach ($Cat in $Categories) {
        $Header += '{0,14}' -f $Cat
    }
    Write-Host $Header -ForegroundColor Gray

    # Data rows
    $AllCounts = [System.Collections.Generic.List[int]]::new()
    foreach ($Pov in $PovKeys) {
        $Row = '  {0,-16}' -f $Pov
        foreach ($Cat in $Categories) {
            $Count = $Health.CoverageBalance[$Pov][$Cat]
            $AllCounts.Add($Count)
            $Row += '{0,14}' -f $Count
        }
        Write-Host $Row -ForegroundColor White
    }

    # Check for imbalances (ratio > 2x between min and max in same category)
    foreach ($Cat in $Categories) {
        $Counts = @($PovKeys | ForEach-Object { $Health.CoverageBalance[$_][$Cat] })
        $Min = ($Counts | Measure-Object -Minimum).Minimum
        $Max = ($Counts | Measure-Object -Maximum).Maximum
        if ($Min -gt 0 -and $Max / $Min -gt 2) {
            Write-Warn "$Cat : imbalance detected (range $Min-$Max, ratio $([math]::Round($Max/$Min,1))x)"
        }
    }

    # ── 3. Most-Cited Nodes ────────────────────────────────────────────────────
    Write-Host "`n  MOST-CITED NODES (top 10)" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    foreach ($Node in $Health.MostCited) {
        $Tag = "[$($Node.Id)] ($($Node.POV))"
        Write-Host "   $($Node.Citations.ToString().PadLeft(3)) citations  $Tag" -ForegroundColor Green
        Write-Host "                    $($Node.Label)" -ForegroundColor Gray
    }

    if ($Health.MostCited.Count -eq 0) {
        Write-Info "(no citations found)"
    }

    # ── 4. Orphan Nodes ───────────────────────────────────────────────────────
    Write-Host "`n  ORPHAN NODES (zero citations)" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    $PovOrphans = $Health.OrphanNodes | Where-Object { $_.POV -ne 'cross-cutting' }
    if ($PovOrphans.Count -gt 0) {
        foreach ($Node in ($PovOrphans | Sort-Object POV, Id)) {
            Write-Host "   [$($Node.Id)] ($($Node.POV)) $($Node.Label)" -ForegroundColor Yellow
        }
        Write-Warn "$($PovOrphans.Count) POV node(s) have zero citations"
    } else {
        Write-OK "All POV nodes have at least one citation"
    }

    # ── 5. High Stance Variance ───────────────────────────────────────────────
    Write-Host "`n  HIGH STANCE VARIANCE (both aligned-family AND opposed-family)" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    if ($Health.HighVarianceNodes.Count -gt 0) {
        foreach ($HV in $Health.HighVarianceNodes) {
            Write-Host "   [$($HV.Id)] ($($HV.POV)) $($HV.Label)" -ForegroundColor Magenta
            $DistStr = ($HV.Distribution.GetEnumerator() | Sort-Object Name |
                ForEach-Object { "$($_.Key):$($_.Value)" }) -join '  '
            Write-Host "     Stances ($($HV.TotalStances) total): $DistStr" -ForegroundColor DarkGray
        }
    } else {
        Write-OK "No nodes with high stance variance"
    }

    # ── 6. Unmapped Concept Frequency ─────────────────────────────────────────
    $DisplayLimit = if ($Detailed) { $Health.UnmappedConcepts.Count } else { 20 }

    Write-Host "`n  UNMAPPED CONCEPTS (top $DisplayLimit by frequency)" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    $Shown = 0
    foreach ($UC in $Health.UnmappedConcepts) {
        if ($Shown -ge $DisplayLimit) { break }
        $FreqStr = $UC.Frequency.ToString().PadLeft(2)
        $PovTag  = if ($UC.SuggestedPov) { "[$($UC.SuggestedPov)]" } else { '' }
        $Color   = if ($UC.Frequency -ge 3) { 'Red' } else { 'Yellow' }
        Write-Host "   ${FreqStr}x  $PovTag $($UC.Concept)" -ForegroundColor $Color
        $Shown++
    }

    if ($Health.StrongCandidates.Count -gt 0) {
        Write-Warn "$($Health.StrongCandidates.Count) concept(s) at frequency >= 3 — strong candidates for new nodes"
    }

    if ($Health.UnmappedConcepts.Count -eq 0) {
        Write-OK "No unmapped concepts found"
    }

    # ── 7. Cross-Cutting Reference Health ─────────────────────────────────────
    $CC = $Health.CrossCuttingHealth

    Write-Host "`n  CROSS-CUTTING REFERENCE HEALTH" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    Write-Info "Total cc nodes  : $($CC.TotalNodes)"
    Write-Info "Referenced      : $($CC.ReferencedCount)"
    Write-Info "Orphaned        : $($CC.OrphanedCount)"

    if ($CC.OrphanedCount -gt 0) {
        foreach ($OrphanCC in ($CC.Orphaned | Sort-Object Id)) {
            Write-Host "   [$($OrphanCC.Id)] $($OrphanCC.Label)" -ForegroundColor Yellow
        }
    }

    # ── 8. Per-Document Breakdown (Detailed only) ──────────────────────────────
    if ($Detailed) {
        Write-Host "`n  PER-DOCUMENT BREAKDOWN" -ForegroundColor White
        Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

        $PerDoc = $Stats.PerDoc | Sort-Object { $_.KeyPoints } -Descending
        foreach ($Doc in $PerDoc) {
            $TitleStr = if ($Doc.Title) { $Doc.Title } else { $Doc.DocId }
            Write-Host "   $($Doc.KeyPoints.ToString().PadLeft(3)) pts  $($Doc.FactualClaims.ToString().PadLeft(2)) claims  $($Doc.UnmappedCount.ToString().PadLeft(2)) unmapped  $TitleStr" -ForegroundColor Gray
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan

    # ── Optional JSON export ───────────────────────────────────────────────────
    if ($OutputFile) {
        # Convert to serializable structure
        $ExportData = @{
            taxonomy_version    = $Health.TaxonomyVersion
            summary_count       = $Health.SummaryCount
            generated_at        = $Health.GeneratedAt
            node_citations      = @($Health.NodeCitations | ForEach-Object {
                @{ id = $_.Id; pov = $_.POV; category = $_.Category; label = $_.Label; citations = $_.Citations; doc_ids = $_.DocIds }
            })
            orphan_nodes        = @($Health.OrphanNodes | ForEach-Object { $_.Id })
            most_cited          = @($Health.MostCited | ForEach-Object {
                @{ id = $_.Id; label = $_.Label; citations = $_.Citations }
            })
            unmapped_concepts   = @($Health.UnmappedConcepts | ForEach-Object {
                @{ concept = $_.Concept; frequency = $_.Frequency; suggested_pov = $_.SuggestedPov; suggested_category = $_.SuggestedCategory; contributing_docs = $_.ContributingDocs }
            })
            strong_candidates   = @($Health.StrongCandidates | ForEach-Object { $_.Concept })
            high_variance_nodes = @($Health.HighVarianceNodes | ForEach-Object {
                @{ id = $_.Id; pov = $_.POV; label = $_.Label; distribution = $_.Distribution }
            })
            coverage_balance    = $Health.CoverageBalance
            cross_cutting_health = @{
                total      = $CC.TotalNodes
                referenced = $CC.ReferencedCount
                orphaned   = @($CC.Orphaned | ForEach-Object { $_.Id })
            }
            summary_stats       = @{
                total_docs       = $Stats.TotalDocs
                total_key_points = $Stats.TotalKeyPoints
                avg_key_points   = $Stats.AvgKeyPoints
                total_claims     = $Stats.TotalClaims
                total_unmapped   = $Stats.TotalUnmapped
            }
        }

        $JsonOutput = $ExportData | ConvertTo-Json -Depth 20
        Set-Content -Path $OutputFile -Value $JsonOutput -Encoding UTF8
        Write-OK "Health data exported to: $OutputFile"
    }

    # ── PassThru ───────────────────────────────────────────────────────────────
    if ($PassThru) {
        return $Health
    }
}
