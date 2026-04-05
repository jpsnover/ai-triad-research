#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Compute cosine similarity distribution across taxonomy node embeddings
    for threshold calibration.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psm1') -Force

# Load embeddings
$dataRoot = (Get-Content (Join-Path $PSScriptRoot '..' '.aitriad.json') -Raw | ConvertFrom-Json).data_root
$dataRoot = Join-Path $PSScriptRoot '..' $dataRoot
$embFile = Join-Path $dataRoot 'taxonomy' 'Origin' 'embeddings.json'
$emb = Get-Content $embFile -Raw | ConvertFrom-Json

# Get node embeddings only
$tax = Get-Tax
$nodeIds = @($tax | ForEach-Object { $_.Id })
$nodeEmbs = @{}
foreach ($entry in $emb.nodes.PSObject.Properties) {
    if ($entry.Name -in $nodeIds) {
        $nodeEmbs[$entry.Name] = [double[]]($entry.Value.vector)
    }
}

Write-Host "Loaded $($nodeEmbs.Count) node embeddings (of $($nodeIds.Count) nodes)"

# Cosine similarity
function Get-CosineSim([double[]]$a, [double[]]$b) {
    $dot = 0.0; $na = 0.0; $nb = 0.0
    for ($i = 0; $i -lt $a.Length; $i++) {
        $dot += $a[$i] * $b[$i]
        $na += $a[$i] * $a[$i]
        $nb += $b[$i] * $b[$i]
    }
    $denom = [Math]::Sqrt($na) * [Math]::Sqrt($nb)
    if ($denom -eq 0) { return 0 }
    return $dot / $denom
}

# Build POV/category lookup
$nodeMeta = @{}
foreach ($n in $tax) {
    $nodeMeta[$n.Id] = @{ POV = $n.POV; Category = $n.Category }
}

# Sample pairwise similarities
$ids = @($nodeEmbs.Keys)
$allSims = [System.Collections.Generic.List[double]]::new()
$intraPovSims = [System.Collections.Generic.List[double]]::new()
$crossPovSims = [System.Collections.Generic.List[double]]::new()
$intraBdiSims = [System.Collections.Generic.List[double]]::new()
$crossBdiSims = [System.Collections.Generic.List[double]]::new()

$rng = [System.Random]::new(42)
$sampleSize = 5000

for ($s = 0; $s -lt $sampleSize; $s++) {
    $i = $rng.Next($ids.Count)
    $j = $rng.Next($ids.Count)
    if ($i -eq $j) { continue }

    $sim = Get-CosineSim $nodeEmbs[$ids[$i]] $nodeEmbs[$ids[$j]]
    $allSims.Add($sim)

    $mi = $nodeMeta[$ids[$i]]
    $mj = $nodeMeta[$ids[$j]]
    if ($mi -and $mj) {
        if ($mi.POV -eq $mj.POV) { $intraPovSims.Add($sim) } else { $crossPovSims.Add($sim) }
        if ($mi.Category -and $mj.Category) {
            if ($mi.Category -eq $mj.Category) { $intraBdiSims.Add($sim) } else { $crossBdiSims.Add($sim) }
        }
    }
}

function Show-Stats {
    param([System.Collections.Generic.List[double]]$Vals, [string]$Label)
    $sorted = @($Vals | Sort-Object)
    $n = $sorted.Count
    if ($n -eq 0) { Write-Host "  ${Label}: no data"; return }
    $mean = ($sorted | Measure-Object -Average).Average
    $p25 = $sorted[[int]($n * 0.25)]
    $p50 = $sorted[[int]($n * 0.50)]
    $p75 = $sorted[[int]($n * 0.75)]
    $p90 = $sorted[[int]($n * 0.90)]
    $p95 = $sorted[[int]($n * 0.95)]
    Write-Host ("  {0,-20} n={1,5}  mean={2:F3}  P25={3:F3}  P50={4:F3}  P75={5:F3}  P90={6:F3}  P95={7:F3}" -f $Label, $n, $mean, $p25, $p50, $p75, $p90, $p95)
}

Write-Host ''
Write-Host '== EMBEDDING SIMILARITY DISTRIBUTION =='
Write-Host ''
Show-Stats $allSims 'All pairs'
Show-Stats $intraPovSims 'Intra-POV'
Show-Stats $crossPovSims 'Cross-POV'
Show-Stats $intraBdiSims 'Intra-BDI'
Show-Stats $crossBdiSims 'Cross-BDI'

Write-Host ''
Write-Host '== THRESHOLD ANALYSIS =='
$sorted = @($allSims | Sort-Object)
$n = $sorted.Count
foreach ($t in @(0.2, 0.3, 0.4, 0.5, 0.6, 0.7)) {
    $above = @($sorted | Where-Object { $_ -ge $t }).Count
    $pct = [math]::Round(100 * $above / $n, 1)
    Write-Host ("  Threshold {0:F1}: {1,5} of {2} pairs above ({3}%)" -f $t, $above, $n, $pct)
}
