#!/usr/bin/env pwsh
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Triages unmapped concepts against taxonomy embeddings.
    Classifies each as novel, near-match, or noise.
.DESCRIPTION
    Collects all unique unmapped concepts from summaries, computes embeddings,
    and compares against all taxonomy node embeddings at multiple thresholds.

    Output: ai-triad-data/calibration/unmapped-triage.json

    Classification:
      - near_match (similarity >= 0.50): should be mapped to existing node
      - review (similarity 0.40-0.50): needs human judgment
      - novel (similarity < 0.40): candidate for new taxonomy node
      - noise: too short, too vague, or extraction artifact

    Part of the calibration plan (t/246).
.PARAMETER WhatIf
    Show counts without writing output file.
#>
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Load module ──────────────────────────────────────────
$repoRoot = Split-Path -Parent $PSScriptRoot
Import-Module "$repoRoot/scripts/AITriad/AITriad.psm1" -Force

# Resolve data root from .aitriad.json
$configFile = Join-Path $repoRoot '.aitriad.json'
$config = Get-Content $configFile -Raw | ConvertFrom-Json
$dataRoot = Join-Path $repoRoot $config.data_root
if ($env:AI_TRIAD_DATA_ROOT) { $dataRoot = $env:AI_TRIAD_DATA_ROOT }

$summDir = Join-Path $dataRoot 'summaries'
$embFile = Join-Path $dataRoot 'taxonomy/Origin/embeddings.json'
$outDir = Join-Path $dataRoot 'calibration'

Write-Host "`n=== Unmapped Concept Triage ===" -ForegroundColor Cyan

# ── Step 1: Collect all unique unmapped concepts ──────────
Write-Host "`nStep 1: Collecting unmapped concepts from summaries..."
$allConcepts = [System.Collections.Generic.List[hashtable]]::new()
$seenTexts = [System.Collections.Generic.HashSet[string]]::new()

$summFiles = Get-ChildItem "$summDir/*.json" -ErrorAction SilentlyContinue
$docsWithUnmapped = 0

foreach ($f in $summFiles) {
    try {
        $data = Get-Content $f.FullName -Raw | ConvertFrom-Json
        if (-not $data.unmapped_concepts -or $data.unmapped_concepts.Count -eq 0) { continue }
        $docsWithUnmapped++
        foreach ($uc in $data.unmapped_concepts) {
            $text = if ($uc.concept) { $uc.concept } elseif ($uc -is [string]) { $uc } else { continue }
            # Deduplicate by exact text
            if ($seenTexts.Add($text.Trim())) {
                $allConcepts.Add(@{
                    concept       = $text.Trim()
                    label         = $uc.suggested_label ?? ''
                    description   = $uc.suggested_description ?? ''
                    pov           = $uc.suggested_pov ?? ''
                    category      = $uc.suggested_category ?? ''
                    source_doc    = $f.BaseName
                })
            }
        }
    }
    catch { Write-Warning "Failed to parse $($f.Name): $_" }
}

Write-Host "  Documents with unmapped: $docsWithUnmapped / $($summFiles.Count)"
Write-Host "  Unique unmapped concepts: $($allConcepts.Count)"

# ── Step 2: Filter noise ─────────────────────────────────
Write-Host "`nStep 2: Filtering noise..."
$noise = [System.Collections.Generic.List[hashtable]]::new()
$viable = [System.Collections.Generic.List[hashtable]]::new()

foreach ($c in $allConcepts) {
    $text = $c.concept
    $words = ($text -split '\s+').Count
    # Noise: too short (<5 words), too vague, or extraction artifacts
    if ($words -lt 5) {
        $c.classification = 'noise'
        $c.noise_reason = 'too_short'
        $noise.Add($c)
    }
    elseif ($text -match '^\s*(the|this|that|it|we|they)\s' -and $words -lt 10) {
        $c.classification = 'noise'
        $c.noise_reason = 'vague_reference'
        $noise.Add($c)
    }
    else {
        $viable.Add($c)
    }
}

Write-Host "  Noise filtered: $($noise.Count)"
Write-Host "  Viable concepts: $($viable.Count)"

if ($viable.Count -eq 0) {
    Write-Host "No viable concepts to triage." -ForegroundColor Yellow
    return
}

# ── Step 3: Load taxonomy embeddings ──────────────────────
Write-Host "`nStep 3: Loading taxonomy embeddings..."
$embData = Get-Content $embFile -Raw | ConvertFrom-Json -AsHashtable
$taxNodes = $embData.nodes
Write-Host "  Taxonomy nodes with embeddings: $($taxNodes.Count)"

# Build label lookup for matching
$taxDir = Join-Path $dataRoot 'taxonomy/Origin'
$nodeLabels = @{}
foreach ($povFile in @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json')) {
    $path = Join-Path $taxDir $povFile
    if (Test-Path $path) {
        $povData = Get-Content $path -Raw | ConvertFrom-Json
        foreach ($n in $povData.nodes) {
            $nodeLabels[$n.id] = $n.label
        }
    }
}

# ── Step 4: Compute embeddings for unmapped concepts ──────
Write-Host "`nStep 4: Computing embeddings for $($viable.Count) concepts..."
Write-Host "  (using local all-MiniLM-L6-v2 via embed_taxonomy.py batch-encode)"

$embedScript = Join-Path $repoRoot 'scripts/embed_taxonomy.py'
$pythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }

$conceptEmbeddings = @{}
$batchSize = 100
for ($i = 0; $i -lt $viable.Count; $i += $batchSize) {
    $end = [Math]::Min($i + $batchSize - 1, $viable.Count - 1)
    $batch = $viable[$i..$end]
    $items = for ($j = 0; $j -lt $batch.Count; $j++) {
        $text = $batch[$j].concept
        if ($text.Length -gt 2000) { $text = $text.Substring(0, 2000) }
        [ordered]@{ id = ($i + $j).ToString(); text = $text }
    }
    $inputJson = @($items) | ConvertTo-Json -Depth 3 -Compress

    try {
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $output = $inputJson | & $pythonCmd $embedScript batch-encode 2>$null } finally { $ErrorActionPreference = $prevEAP }
        if ($LASTEXITCODE -eq 0 -and $output) {
            $parsed = $output | ConvertFrom-Json -AsHashtable
            foreach ($key in $parsed.Keys) {
                $idx = [int]$key
                if ($idx -ge $i -and $idx -le $end) {
                    $conceptEmbeddings[$viable[$idx].concept] = [double[]]@($parsed[$key])
                }
            }
        }
    }
    catch {
        Write-Warning "Embedding batch starting at $i failed: $_"
    }

    $pct = [Math]::Min(100, [Math]::Round(($i + $batchSize) / $viable.Count * 100))
    Write-Host "  Progress: $pct% ($($conceptEmbeddings.Count) embedded)" -NoNewline
    Write-Host "`r" -NoNewline
}
Write-Host "  Embedded: $($conceptEmbeddings.Count) / $($viable.Count)             "

# ── Step 5: Compare against taxonomy ──────────────────────
Write-Host "`nStep 5: Computing similarity against $($taxNodes.Count) taxonomy nodes..."

function Get-CosineSimilarity([double[]]$a, [double[]]$b) {
    $dot = 0.0; $na = 0.0; $nb = 0.0
    for ($k = 0; $k -lt $a.Length; $k++) {
        $dot += $a[$k] * $b[$k]
        $na += $a[$k] * $a[$k]
        $nb += $b[$k] * $b[$k]
    }
    $denom = [Math]::Sqrt($na) * [Math]::Sqrt($nb)
    if ($denom -eq 0) { return 0 }
    return $dot / $denom
}

$nearMatch = [System.Collections.Generic.List[hashtable]]::new()
$review = [System.Collections.Generic.List[hashtable]]::new()
$novel = [System.Collections.Generic.List[hashtable]]::new()
$noEmbed = [System.Collections.Generic.List[hashtable]]::new()

$taxVectors = @{}
foreach ($nodeId in $taxNodes.Keys) {
    $entry = $taxNodes[$nodeId]
    $vec = if ($entry -is [hashtable]) { $entry.vector } else { $entry.PSObject.Properties['vector']?.Value }
    if ($vec) { $taxVectors[$nodeId] = [double[]]$vec }
}

$processed = 0
foreach ($c in $viable) {
    $conceptVec = $conceptEmbeddings[$c.concept]
    if (-not $conceptVec) {
        $c.classification = 'no_embedding'
        $noEmbed.Add($c)
        continue
    }

    $vec = [double[]]$conceptVec

    # Find best matching taxonomy node
    $bestSim = -1.0
    $bestNode = ''

    foreach ($nodeId in $taxVectors.Keys) {
        $sim = Get-CosineSimilarity $vec $taxVectors[$nodeId]
        if ($sim -gt $bestSim) {
            $bestSim = $sim
            $bestNode = $nodeId
        }
    }

    $c.nearest_node_id = $bestNode
    $c.nearest_node_label = $nodeLabels[$bestNode] ?? $bestNode
    $c.similarity = [Math]::Round($bestSim, 4)

    if ($bestSim -ge 0.50) {
        $c.classification = 'near_match'
        $nearMatch.Add($c)
    }
    elseif ($bestSim -ge 0.40) {
        $c.classification = 'review'
        $review.Add($c)
    }
    else {
        $c.classification = 'novel'
        $novel.Add($c)
    }

    $processed++
    if ($processed % 100 -eq 0) {
        Write-Host "  Processed: $processed / $($viable.Count)" -NoNewline
        Write-Host "`r" -NoNewline
    }
}
Write-Host "  Done: $processed concepts classified                    "

# ── Step 6: Report ────────────────────────────────────────
Write-Host "`n=== Triage Results ===" -ForegroundColor Green
Write-Host "  Near-match (>= 0.50): $($nearMatch.Count)  — should map to existing nodes"
Write-Host "  Review (0.40-0.50):    $($review.Count)  — needs human judgment"
Write-Host "  Novel (< 0.40):        $($novel.Count)  — candidates for new nodes"
Write-Host "  Noise:                 $($noise.Count)  — filtered out"
Write-Host "  No embedding:          $($noEmbed.Count)  — embedding failed"
Write-Host ""

# Show top novel concepts by POV
$novelByPov = $novel | Group-Object -Property { $_.pov } | Sort-Object Count -Descending
Write-Host "  Novel by POV:"
foreach ($g in $novelByPov) {
    Write-Host "    $($g.Name): $($g.Count)"
}

# Show similarity distribution
$allSims = @(($nearMatch + $review + $novel) | ForEach-Object { $_.similarity })
if ($allSims.Count -gt 0) {
    $avgSim = ($allSims | Measure-Object -Average).Average
    $p25 = ($allSims | Sort-Object)[[Math]::Floor($allSims.Count * 0.25)]
    $p50 = ($allSims | Sort-Object)[[Math]::Floor($allSims.Count * 0.50)]
    $p75 = ($allSims | Sort-Object)[[Math]::Floor($allSims.Count * 0.75)]
    Write-Host ""
    Write-Host "  Similarity distribution:"
    Write-Host "    Mean: $([Math]::Round($avgSim, 3))"
    Write-Host "    P25:  $([Math]::Round($p25, 3))"
    Write-Host "    P50:  $([Math]::Round($p50, 3))"
    Write-Host "    P75:  $([Math]::Round($p75, 3))"
}

# ── Step 7: Write output ─────────────────────────────────
if (-not $WhatIfPreference) {
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

    $output = @{
        timestamp       = (Get-Date -Format 'o')
        total_documents = $summFiles.Count
        total_unmapped  = $allConcepts.Count
        thresholds      = @{ near_match = 0.50; review = 0.40 }
        counts          = @{
            near_match  = $nearMatch.Count
            review      = $review.Count
            novel       = $novel.Count
            noise       = $noise.Count
            no_embedding = $noEmbed.Count
        }
        similarity_stats = @{
            mean = [Math]::Round($avgSim, 4)
            p25  = [Math]::Round($p25, 4)
            p50  = [Math]::Round($p50, 4)
            p75  = [Math]::Round($p75, 4)
        }
        near_matches    = $nearMatch | Sort-Object { $_.similarity } -Descending
        review_zone     = $review | Sort-Object { $_.similarity } -Descending
        novel_concepts  = $novel | Sort-Object { $_.pov }, { $_.category }
        noise_filtered  = $noise
    }

    $outPath = Join-Path $outDir 'unmapped-triage.json'
    $output | ConvertTo-Json -Depth 5 | Set-Content $outPath -Encoding utf8
    Write-Host "`nOutput written to: $outPath" -ForegroundColor Green
} else {
    Write-Host "`n[WhatIf] Would write triage results to $outDir/unmapped-triage.json"
}

Write-Host ""
