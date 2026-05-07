#!/usr/bin/env pwsh
# Backfill relevance_score and primary fields on older debate taxonomy_refs (t/398)
#
# Usage:
#   ./scripts/Invoke-BackfillTaxonomyRefScores.ps1           # apply
#   ./scripts/Invoke-BackfillTaxonomyRefScores.ps1 -WhatIf   # preview

param([switch]$WhatIf)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'AITriad/AITriad.psm1') -Force

$cfg = Get-Content (Join-Path $PSScriptRoot '../.aitriad.json') -Raw | ConvertFrom-Json
$dataRoot = Join-Path $PSScriptRoot '..' $cfg.data_root | Resolve-Path
$debatesDir = Join-Path $dataRoot 'debates'
$taxDir = Join-Path $dataRoot 'taxonomy/Origin'

# ── Load embeddings ──────────────────────────────────────────────────────────
Write-Host 'Loading embeddings...' -ForegroundColor Cyan
$embFile = Join-Path $taxDir 'embeddings.json'
if (-not (Test-Path $embFile)) {
    Write-Error "embeddings.json not found at $embFile — run Update-TaxEmbeddings first"
    return
}
$embData = Get-Content -Raw $embFile | ConvertFrom-Json
$nodeVecs = @{}
foreach ($prop in $embData.nodes.PSObject.Properties) {
    $nodeVecs[$prop.Name] = [double[]]@($prop.Value.vector)
}
Write-Host "  $($nodeVecs.Count) node embeddings loaded"

# ── Load node metadata for BDI category lookup ───────────────────────────────
$nodeCategoryMap = @{}
foreach ($f in @('accelerationist.json','safetyist.json','skeptic.json','situations.json')) {
    $fp = Join-Path $taxDir $f
    if (-not (Test-Path $fp)) { continue }
    $data = (Get-Content $fp -Raw | ConvertFrom-Json).nodes
    foreach ($n in $data) {
        $cat = if ($n.PSObject.Properties['category'] -and $n.category) { $n.category } else { 'Other' }
        $nodeCategoryMap[$n.id] = $cat
    }
}
Write-Host "  $($nodeCategoryMap.Count) nodes with category metadata"

# ── Helper: cosine similarity ─────────────────────────────────────────────────
function Get-CosineSim([double[]]$A, [double[]]$B) {
    if ($A.Count -ne $B.Count -or $A.Count -eq 0) { return 0.0 }
    $dot = 0.0; $na = 0.0; $nb = 0.0
    for ($i = 0; $i -lt $A.Count; $i++) {
        $dot += $A[$i] * $B[$i]; $na += $A[$i] * $A[$i]; $nb += $B[$i] * $B[$i]
    }
    $denom = [Math]::Sqrt($na) * [Math]::Sqrt($nb)
    if ($denom -gt 0) { return [Math]::Round($dot / $denom, 4) } else { return 0.0 }
}

# ── Process debates ──────────────────────────────────────────────────────────
$debateFiles = Get-ChildItem $debatesDir -Filter 'debate-*.json' -Recurse |
    Where-Object { $_.Name -notmatch 'diagnostics|harvest|transcript' }

Write-Host "Processing $($debateFiles.Count) debate files..." -ForegroundColor Cyan

# ── Pre-compute all topic embeddings in one batch ─────────────────────────────
Write-Host 'Collecting debate topics for batch embedding...' -ForegroundColor Cyan
$mod = Get-Module AITriad
$debateTopics = @{}  # file path → topic text
$debateSessions = @{}  # file path → parsed session

foreach ($file in $debateFiles) {
    try { $session = Get-Content $file.FullName -Raw | ConvertFrom-Json } catch { continue }

    $topicText = ''
    if ($session.PSObject.Properties['topic']) {
        if ($session.topic -is [string]) { $topicText = $session.topic }
        elseif ($session.topic.PSObject.Properties['final'] -and $session.topic.final) { $topicText = $session.topic.final }
        elseif ($session.topic.PSObject.Properties['original']) { $topicText = $session.topic.original }
    }
    if ([string]::IsNullOrWhiteSpace($topicText)) { continue }
    if (-not $session.transcript) { continue }

    # Check if any refs need scoring
    $needsPatching = $false
    foreach ($entry in @($session.transcript)) {
        if (-not $entry.PSObject.Properties['taxonomy_refs']) { continue }
        foreach ($ref in @($entry.taxonomy_refs)) {
            if (-not $ref.PSObject.Properties['relevance_score'] -or $null -eq $ref.relevance_score) {
                $needsPatching = $true; break
            }
        }
        if ($needsPatching) { break }
    }
    if (-not $needsPatching) { continue }

    $debateTopics[$file.FullName] = $topicText
    $debateSessions[$file.FullName] = $session
}

Write-Host "  $($debateTopics.Count) debates need scoring"

if ($debateTopics.Count -eq 0) {
    Write-Host 'Nothing to backfill!' -ForegroundColor Green
    return
}

# Batch-embed all topics at once (single model load)
$topicTexts = @($debateTopics.Values)
$topicIds = @($debateTopics.Keys | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_) })
Write-Host "  Batch-encoding $($topicTexts.Count) topic embeddings..." -ForegroundColor Gray
$topicEmbeddings = & $mod { param($T, $I) Get-TextEmbedding -Texts $T -Ids $I } $topicTexts $topicIds
if (-not $topicEmbeddings) {
    Write-Error 'Failed to compute topic embeddings — check Python/sentence-transformers'
    return
}
Write-Host "  Got $($topicEmbeddings.Count) topic embeddings" -ForegroundColor Green

# ── Score taxonomy_refs per debate ────────────────────────────────────────────
$patchedSessions = 0
$totalRefsScored = 0
$missingEmbeddings = 0

foreach ($filePath in $debateSessions.Keys) {
    $session = $debateSessions[$filePath]
    $fileBase = [System.IO.Path]::GetFileNameWithoutExtension($filePath)
    if (-not $topicEmbeddings.ContainsKey($fileBase)) { continue }
    $topicVec = $topicEmbeddings[$fileBase]

    # Score all taxonomy_refs
    $sessionRefsScored = 0
    $sessionMissing = 0

    foreach ($entry in @($session.transcript)) {
        if (-not $entry.PSObject.Properties['taxonomy_refs']) { continue }
        $refs = @($entry.taxonomy_refs)
        if ($refs.Count -eq 0) { continue }

        # Score each ref
        foreach ($ref in $refs) {
            if ($ref.PSObject.Properties['relevance_score'] -and $null -ne $ref.relevance_score) { continue }

            $nodeId = $ref.node_id
            if ($nodeVecs.ContainsKey($nodeId)) {
                $score = Get-CosineSim $topicVec $nodeVecs[$nodeId]
                $ref | Add-Member -NotePropertyName 'relevance_score' -NotePropertyValue $score -Force
                $sessionRefsScored++
            } else {
                $ref | Add-Member -NotePropertyName 'relevance_score' -NotePropertyValue $null -Force
                $sessionMissing++
            }
        }

        # Classify primary: top 5 per BDI category
        $byCategory = @{}
        foreach ($ref in $refs) {
            $cat = if ($nodeCategoryMap.ContainsKey($ref.node_id)) { $nodeCategoryMap[$ref.node_id] } else { 'Other' }
            if (-not $byCategory.ContainsKey($cat)) { $byCategory[$cat] = [System.Collections.Generic.List[object]]::new() }
            $byCategory[$cat].Add($ref)
        }

        foreach ($cat in $byCategory.Keys) {
            $catRefs = @($byCategory[$cat] | Where-Object { $null -ne $_.relevance_score } |
                Sort-Object relevance_score -Descending)
            for ($j = 0; $j -lt $catRefs.Count; $j++) {
                $isPrimary = $j -lt 5
                if ($catRefs[$j].PSObject.Properties['primary']) {
                    $catRefs[$j].primary = $isPrimary
                } else {
                    $catRefs[$j] | Add-Member -NotePropertyName 'primary' -NotePropertyValue $isPrimary -Force
                }
            }
        }
    }

    if ($sessionRefsScored -gt 0 -or $sessionMissing -gt 0) {
        $totalRefsScored += $sessionRefsScored
        $missingEmbeddings += $sessionMissing
        $patchedSessions++

        if (-not $WhatIf) {
            $session | ConvertTo-Json -Depth 30 | Set-Content -Path $filePath -Encoding UTF8
        }
    }

    if ($patchedSessions % 20 -eq 0 -and $patchedSessions -gt 0) {
        Write-Host "  [$patchedSessions sessions, $totalRefsScored refs scored...]" -ForegroundColor Gray
    }
}

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "  Sessions patched: $patchedSessions"
Write-Host "  Refs scored: $totalRefsScored"
Write-Host "  Missing embeddings: $missingEmbeddings"
if ($WhatIf) { Write-Host "  (WhatIf — no files written)" -ForegroundColor Yellow }
