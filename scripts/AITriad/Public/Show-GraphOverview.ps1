# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-GraphOverview {
    <#
    .SYNOPSIS
        Displays a structural overview of the taxonomy graph.
    .DESCRIPTION
        Computes and displays graph statistics: node/edge counts by POV,
        edge type distribution, connected components, density, and
        orphan/hub nodes. Works directly from JSON files (no Neo4j required).
    .PARAMETER StatusFilter
        Only count edges with this approval status. Default: approved.
        Use 'all' to include all edges.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Show-GraphOverview
    .EXAMPLE
        Show-GraphOverview -StatusFilter all
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('proposed', 'approved', 'rejected', 'all')]
        [string]$StatusFilter = 'approved',

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir

    # ── Load nodes ──
    $AllNodes = @{}
    $NodePovMap = @{}
    $PovCounts = [ordered]@{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        try {
            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warn "Failed to load $PovKey.json — $($_.Exception.Message)"
            continue
        }
        $PovCounts[$PovKey] = $FileData.nodes.Count
        foreach ($Node in $FileData.nodes) {
            $AllNodes[$Node.id] = $Node
            $NodePovMap[$Node.id] = $PovKey
        }
    }

    # ── Load edges ──
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $Edges = @()
    if (Test-Path $EdgesPath) {
        try {
            $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warn "Failed to load edges.json — $($_.Exception.Message)"
            $EdgesData = [PSCustomObject]@{ edges = @() }
        }
        if ($StatusFilter -eq 'all') {
            $Edges = @($EdgesData.edges)
        } else {
            $Edges = @($EdgesData.edges | Where-Object { $_.status -eq $StatusFilter })
        }
    }

    # ── Compute statistics ──
    $NodeCount = $AllNodes.Count
    $EdgeCount = $Edges.Count
    $MaxPossibleEdges = $NodeCount * ($NodeCount - 1)
    $Density = if ($MaxPossibleEdges -gt 0) { [Math]::Round($EdgeCount / $MaxPossibleEdges, 4) } else { 0 }

    # Edge type distribution
    $TypeCounts = [ordered]@{}
    foreach ($Edge in $Edges) {
        $T = $Edge.type
        if (-not $TypeCounts.Contains($T)) { $TypeCounts[$T] = 0 }
        $TypeCounts[$T]++
    }

    # Status distribution (always from all edges)
    $StatusCounts = [ordered]@{}
    if (Test-Path $EdgesPath) {
        foreach ($Edge in $EdgesData.edges) {
            $S = $Edge.status
            if (-not $StatusCounts.Contains($S)) { $StatusCounts[$S] = 0 }
            $StatusCounts[$S]++
        }
    }

    # Cross-POV edges
    $CrossPovCount = 0
    $SamePovCount = 0
    foreach ($Edge in $Edges) {
        $SourcePov = $NodePovMap[$Edge.source]
        $TargetPov = $NodePovMap[$Edge.target]
        if ($SourcePov -and $TargetPov) {
            if ($SourcePov -eq $TargetPov) { $SamePovCount++ }
            else { $CrossPovCount++ }
        }
    }

    # Degree distribution
    $InDegree  = @{}
    $OutDegree = @{}
    foreach ($Edge in $Edges) {
        if (-not $OutDegree.Contains($Edge.source)) { $OutDegree[$Edge.source] = 0 }
        if (-not $InDegree.Contains($Edge.target))  { $InDegree[$Edge.target]  = 0 }
        $OutDegree[$Edge.source]++
        $InDegree[$Edge.target]++
    }

    # Orphans (no edges at all)
    $Orphans = @(foreach ($NId in $AllNodes.Keys) {
        $In  = if ($InDegree.Contains($NId))  { $InDegree[$NId] }  else { 0 }
        $Out = if ($OutDegree.Contains($NId)) { $OutDegree[$NId] } else { 0 }
        if ($In -eq 0 -and $Out -eq 0) { $NId }
    })

    # Hubs (top 5 by total degree)
    $TotalDegree = @{}
    foreach ($NId in $AllNodes.Keys) {
        $In  = if ($InDegree.Contains($NId))  { $InDegree[$NId] }  else { 0 }
        $Out = if ($OutDegree.Contains($NId)) { $OutDegree[$NId] } else { 0 }
        $TotalDegree[$NId] = $In + $Out
    }
    $Hubs = $TotalDegree.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 5

    # Confidence distribution
    $ConfBuckets = [ordered]@{ '0.5-0.6' = 0; '0.6-0.7' = 0; '0.7-0.8' = 0; '0.8-0.9' = 0; '0.9-1.0' = 0 }
    foreach ($Edge in $Edges) {
        $C = [double]$Edge.confidence
        if     ($C -lt 0.6) { $ConfBuckets['0.5-0.6']++ }
        elseif ($C -lt 0.7) { $ConfBuckets['0.6-0.7']++ }
        elseif ($C -lt 0.8) { $ConfBuckets['0.7-0.8']++ }
        elseif ($C -lt 0.9) { $ConfBuckets['0.8-0.9']++ }
        else                { $ConfBuckets['0.9-1.0']++ }
    }

    # ── Display ──
    Write-Host ''
    Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host '  Graph Overview' -ForegroundColor White
    Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host ''

    Write-Host '  Nodes:' -ForegroundColor Cyan
    foreach ($PovKey in $PovCounts.Keys) {
        $PovColor = switch ($PovKey) {
            'accelerationist' { 'Blue' }
            'safetyist'       { 'Green' }
            'skeptic'         { 'Yellow' }
            'cross-cutting'   { 'Magenta' }
        }
        Write-Host "    $($PovKey.PadRight(18)) $($PovCounts[$PovKey])" -ForegroundColor $PovColor
    }
    Write-Host "    $('Total'.PadRight(18)) $NodeCount" -ForegroundColor White
    Write-Host ''

    Write-Host "  Edges ($StatusFilter):" -ForegroundColor Cyan
    Write-Host "    Total:             $EdgeCount" -ForegroundColor White
    Write-Host "    Cross-POV:         $CrossPovCount" -ForegroundColor White
    Write-Host "    Same-POV:          $SamePovCount" -ForegroundColor White
    Write-Host "    Density:           $Density" -ForegroundColor White
    Write-Host ''

    Write-Host '  Edge Types:' -ForegroundColor Cyan
    foreach ($T in $TypeCounts.Keys) {
        Write-Host "    $($T.PadRight(18)) $($TypeCounts[$T])" -ForegroundColor White
    }
    Write-Host ''

    Write-Host '  Status (all edges):' -ForegroundColor Cyan
    foreach ($S in $StatusCounts.Keys) {
        $SColor = switch ($S) { 'approved' { 'Green' } 'rejected' { 'Red' } default { 'Yellow' } }
        Write-Host "    $($S.PadRight(18)) $($StatusCounts[$S])" -ForegroundColor $SColor
    }
    Write-Host ''

    Write-Host '  Confidence Distribution:' -ForegroundColor Cyan
    foreach ($Bucket in $ConfBuckets.Keys) {
        $Bar = '*' * [Math]::Min($ConfBuckets[$Bucket], 50)
        Write-Host "    $($Bucket.PadRight(10)) $($ConfBuckets[$Bucket].ToString().PadLeft(4)) $Bar" -ForegroundColor White
    }
    Write-Host ''

    Write-Host '  Hub Nodes (top 5 by degree):' -ForegroundColor Cyan
    foreach ($Hub in $Hubs) {
        $NId = $Hub.Key
        $Label = $AllNodes[$NId].label
        $Pov = $NodePovMap[$NId]
        Write-Host "    $($NId.PadRight(20)) degree=$($Hub.Value)  [$Pov] $Label" -ForegroundColor White
    }
    Write-Host ''

    if ($Orphans.Count -gt 0) {
        Write-Host "  Orphan Nodes ($($Orphans.Count) with no edges):" -ForegroundColor Yellow
        foreach ($OId in @($Orphans) | Select-Object -First 10) {
            Write-Host "    $OId — $($AllNodes[$OId].label)" -ForegroundColor DarkGray
        }
        if ($Orphans.Count -gt 10) {
            Write-Host "    ... and $($Orphans.Count - 10) more" -ForegroundColor DarkGray
        }
    } else {
        Write-Host '  No orphan nodes — all nodes have at least one edge.' -ForegroundColor Green
    }

    Write-Host ''
    Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host ''
}
