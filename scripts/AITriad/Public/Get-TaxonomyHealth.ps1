# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

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
    .PARAMETER GraphMode
        Include graph-structural health metrics (echo chambers, cross-POV connectivity, etc.).
    .PARAMETER PassThru
        Return the health data hashtable for piping to other commands.
    .EXAMPLE
        Get-TaxonomyHealth
    .EXAMPLE
        Get-TaxonomyHealth -GraphMode
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
        [switch]$GraphMode,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Compute health data ────────────────────────────────────────────────────
    Write-Step "Computing taxonomy health data"
    $HealthParams = @{ RepoRoot = $RepoRoot }
    if ($GraphMode) { $HealthParams['GraphMode'] = $true }
    $Health = Get-TaxonomyHealthData @HealthParams
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

    $Categories = @('Beliefs', 'Desires', 'Intentions')
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

    $PovOrphans = $Health.OrphanNodes | Where-Object { $_.POV -ne 'situations' }
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
    if ($Detailed) { $DisplayLimit = $Health.UnmappedConcepts.Count } else { $DisplayLimit = 20 }

    Write-Host "`n  UNMAPPED CONCEPTS (top $DisplayLimit by frequency)" -ForegroundColor White
    Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

    $Shown = 0
    foreach ($UC in $Health.UnmappedConcepts) {
        if ($Shown -ge $DisplayLimit) { break }
        $FreqStr = $UC.Frequency.ToString().PadLeft(2)
        if ($UC.SuggestedPov) { $PovTag = "[$($UC.SuggestedPov)]" } else { $PovTag = '' }
        if ($UC.Frequency -ge 3) { $Color = 'Red' } else { $Color = 'Yellow' }
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

    # ── 8. Graph Health (GraphMode only) ────────────────────────────────────────
    if ($GraphMode -and $Health.GraphHealth) {
        $GH = $Health.GraphHealth

        # Build label lookup for display
        $NodeLabelMap = @{}
        foreach ($NC in $Health.NodeCitations) { $NodeLabelMap[$NC.Id] = $NC.Label }

        Write-Host "`n  GRAPH STRUCTURAL HEALTH" -ForegroundColor White
        Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

        # Echo chamber scores
        Write-Host "`n  Echo Chamber Scores (intra-POV SUPPORTS:CONTRADICTS):" -ForegroundColor Cyan
        foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
            $EC = $GH.EchoChamberScores[$PovKey]
            if ($EC.Ratio -eq [double]::PositiveInfinity) { $RatioStr = 'Inf (no contradicts)' } else { $RatioStr = "$($EC.Ratio):1" }
            if ($EC.Ratio -ge 10 -or $EC.Ratio -eq [double]::PositiveInfinity) { $Color = 'Red' }
            elseif ($EC.Ratio -ge 5) { $Color = 'Yellow' }
            else { $Color = 'Green' }
            Write-Host "    $($PovKey.PadRight(18)) $($EC.SamePovSupports) supports / $($EC.SamePovContradicts) contradicts = $RatioStr" -ForegroundColor $Color
        }

        # Cross-POV connectivity
        Write-Host "`n  Cross-POV Connectivity:" -ForegroundColor Cyan
        $CPov = $GH.CrossPovConnectivity
        if ($CPov.Percentage -ge 50) { $ConnColor = 'Green' } elseif ($CPov.Percentage -ge 30) { $ConnColor = 'Yellow' } else { $ConnColor = 'Red' }
        Write-Info "$($CPov.CrossPovEdges) / $($CPov.TotalEdges) edges cross POV boundaries ($($CPov.Percentage)%)"

        # Edge orphans
        if ($GH.EdgeOrphanCount -gt 0) {
            Write-Host "`n  Edge Orphans ($($GH.EdgeOrphanCount) nodes with zero edges):" -ForegroundColor Yellow
            foreach ($OId in $GH.EdgeOrphans | Select-Object -First 10) {
                if ($NodeLabelMap.ContainsKey($OId)) { $OLabel = $NodeLabelMap[$OId] } else { $OLabel = $OId }
                Write-Host "    $OId — $OLabel" -ForegroundColor DarkGray
            }
            if ($GH.EdgeOrphanCount -gt 10) {
                Write-Host "    ... and $($GH.EdgeOrphanCount - 10) more" -ForegroundColor DarkGray
            }
        }
        else {
            Write-OK "No edge orphans — all nodes have at least one edge"
        }

        # Hub concentration
        $HC = $GH.HubConcentration
        if ($HC.GiniCoefficient -ge 0.5) { $GiniColor = 'Yellow' } else { $GiniColor = 'Green' }
        Write-Host "`n  Hub Concentration:" -ForegroundColor Cyan
        Write-Host "    Gini coefficient : $($HC.GiniCoefficient)" -ForegroundColor $GiniColor
        Write-Info "Max degree: $($HC.MaxDegree)  |  Median degree: $($HC.MedianDegree)"

        # Missing edge type pairs
        if ($GH.MissingEdgeTypePairs.Count -gt 0) {
            Write-Host "`n  Missing Edge Types ($($GH.MissingEdgeTypePairs.Count) cross-POV pairs with SUPPORTS but no CONTRADICTS):" -ForegroundColor Yellow
            foreach ($Pair in $GH.MissingEdgeTypePairs.SupportsNoContradicts | Select-Object -First 10) {
                Write-Host "    $Pair" -ForegroundColor DarkGray
            }
            if ($GH.MissingEdgeTypePairs.Count -gt 10) {
                Write-Host "    ... and $($GH.MissingEdgeTypePairs.Count - 10) more" -ForegroundColor DarkGray
            }
        }

        # Echo chamber nodes
        if ($GH.EchoChamberNodeCount -gt 0) {
            Write-Host "`n  Echo Chamber Nodes ($($GH.EchoChamberNodeCount) with 3+ SUPPORTS, 0 cross-POV CONTRADICTS):" -ForegroundColor Yellow
            foreach ($ECId in $GH.EchoChamberNodes | Select-Object -First 10) {
                if ($NodeLabelMap.ContainsKey($ECId)) { $ECLabel = $NodeLabelMap[$ECId] } else { $ECLabel = $ECId }
                Write-Host "    $ECId — $ECLabel" -ForegroundColor DarkGray
            }
            if ($GH.EchoChamberNodeCount -gt 10) {
                Write-Host "    ... and $($GH.EchoChamberNodeCount - 10) more" -ForegroundColor DarkGray
            }
        }
        else {
            Write-OK "No echo chamber nodes detected"
        }
    }

    # ── 9. TaxoAdapt Density Signals ────────────────────────────────────────────
    if ($Health.DensitySignals -and $Health.DensitySignals.Count -gt 0) {
        Write-Host "`n  TAXOADAPT DENSITY SIGNALS ($($Health.DensitySignals.Count) signals)" -ForegroundColor White
        Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

        $DepthExpand = @($Health.DensitySignals | Where-Object { $_.signal -eq 'depth_expand' })
        $WidthExpand = @($Health.DensitySignals | Where-Object { $_.signal -eq 'width_expand' })
        $Imbalances  = @($Health.DensitySignals | Where-Object { $_.signal -match 'pov_imbalance' })

        if ($DepthExpand.Count -gt 0) {
            Write-Host "  Depth expansion candidates ($($DepthExpand.Count)):" -ForegroundColor Yellow
            foreach ($S in $DepthExpand) {
                Write-Host "    $($S.node_id) ($($S.pov)/$($S.category)): $($S.metric) children" -ForegroundColor Yellow
            }
        }

        if ($WidthExpand.Count -gt 0) {
            Write-Host "  Width expansion candidates ($($WidthExpand.Count)):" -ForegroundColor Yellow
            foreach ($S in $WidthExpand) {
                Write-Host "    $($S.label): $($S.metric) unmapped concept frequency" -ForegroundColor Yellow
            }
        }

        if ($Imbalances.Count -gt 0) {
            Write-Host "  POV imbalances (normalized, $($Imbalances.Count)):" -ForegroundColor Yellow
            foreach ($S in $Imbalances) {
                if ($S.signal -eq 'pov_imbalance_under') { $Color = 'Red' } else { $Color = 'Yellow' }
                Write-Host "    $($S.detail)" -ForegroundColor $Color
            }
        }

        if ($DepthExpand.Count -eq 0 -and $WidthExpand.Count -eq 0 -and $Imbalances.Count -eq 0) {
            Write-OK 'No density signals detected'
        }
    }

    # ── 10. QBAF Strength Distribution (if analysis exists) ────────────────────
    $QbafDir = Join-Path (Get-DataRoot) 'qbaf-conflicts'
    if (Test-Path $QbafDir) {
        $QbafFiles = @(Get-ChildItem -Path $QbafDir -Filter '*.json' -File | Sort-Object LastWriteTime -Descending)
        if ($QbafFiles.Count -gt 0) {
            Write-Host "`n  QBAF STRENGTH DISTRIBUTION" -ForegroundColor White
            Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

            # Load most recent analysis
            $Latest = Get-Content -Raw -Path $QbafFiles[0].FullName | ConvertFrom-Json

            if ($Latest.PSObject.Properties['claims'] -and $Latest.claims) {
                $Strengths = @($Latest.claims | ForEach-Object { $_.computed_strength })
                $Sorted = $Strengths | Sort-Object

                $Median = $Sorted[[int]($Sorted.Count / 2)]
                $Weak = @($Strengths | Where-Object { $_ -lt 0.3 }).Count
                $Strong = @($Strengths | Where-Object { $_ -gt 0.7 }).Count

                Write-Info "Latest analysis: $($QbafFiles[0].Name)"
                Write-Info "Claims analyzed: $($Strengths.Count)"
                Write-Info "Median strength: $([Math]::Round($Median, 2))"
                Write-Info "Weak (<0.3):     $Weak"
                Write-Info "Strong (>0.7):   $Strong"

                if ($Latest.PSObject.Properties['qbaf_converged']) {
                    Write-Info "QBAF converged:  $($Latest.qbaf_converged) ($($Latest.qbaf_iterations) iterations)"
                }

                # Map strengths back to taxonomy nodes
                $NodeStrengths = @{}
                foreach ($Claim in $Latest.claims) {
                    if ($Claim.PSObject.Properties['linked_nodes']) {
                        foreach ($NodeId in @($Claim.linked_nodes)) {
                            if (-not $NodeStrengths.ContainsKey($NodeId)) {
                                $NodeStrengths[$NodeId] = [System.Collections.Generic.List[double]]::new()
                            }
                            $NodeStrengths[$NodeId].Add($Claim.computed_strength)
                        }
                    }
                }

                # Flag weakly-supported nodes
                $WeakNodes = @($NodeStrengths.GetEnumerator() | Where-Object {
                    ($_.Value | Measure-Object -Average).Average -lt 0.3
                } | Sort-Object { ($_.Value | Measure-Object -Average).Average })

                if ($WeakNodes.Count -gt 0) {
                    Write-Warn "$($WeakNodes.Count) taxonomy node(s) have weak QBAF support (avg strength < 0.3):"
                    foreach ($WN in ($WeakNodes | Select-Object -First 10)) {
                        $AvgStr = [Math]::Round(($WN.Value | Measure-Object -Average).Average, 2)
                        Write-Host "    $($WN.Key): avg strength $AvgStr ($($WN.Value.Count) claims)" -ForegroundColor Yellow
                    }
                }
                else {
                    Write-OK 'No weakly-supported nodes detected'
                }
            }
        }
    }

    # ── 10. Per-Document Breakdown (Detailed only) ─────────────────────────────
    if ($Detailed) {
        Write-Host "`n  PER-DOCUMENT BREAKDOWN" -ForegroundColor White
        Write-Host "  $('─' * 40)" -ForegroundColor DarkGray

        $PerDoc = $Stats.PerDoc | Sort-Object { $_.KeyPoints } -Descending
        foreach ($Doc in $PerDoc) {
            if ($Doc.Title) { $TitleStr = $Doc.Title } else { $TitleStr = $Doc.DocId }
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

        if ($Health.GraphHealth) {
            $ExportData['graph_health'] = $Health.GraphHealth
        }

        try {
            $JsonOutput = $ExportData | ConvertTo-Json -Depth 20
            Set-Content -Path $OutputFile -Value $JsonOutput -Encoding UTF8
            Write-OK "Health data exported to: $OutputFile"
        }
        catch {
            Write-Warn "Failed to write $OutputFile — $($_.Exception.Message)"
        }
    }

    # ── PassThru ───────────────────────────────────────────────────────────────
    if ($PassThru) {
        return $Health
    }
}
