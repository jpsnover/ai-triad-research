#!/usr/bin/env pwsh
# Migrate 3 cross-POV duplicate pairs to situation nodes (t/260)
param([switch]$WhatIf)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'AITriad/AITriad.psm1') -Force

$cfg = Get-Content (Join-Path $PSScriptRoot '../.aitriad.json') -Raw | ConvertFrom-Json
$dataRoot = Join-Path $PSScriptRoot ".." $cfg.data_root | Resolve-Path
$taxDir = Join-Path $dataRoot 'taxonomy/Origin'
$sumDir = Join-Path $dataRoot 'summaries'

$accPath = Join-Path $taxDir 'accelerationist.json'
$safPath = Join-Path $taxDir 'safetyist.json'
$skpPath = Join-Path $taxDir 'skeptic.json'
$sitPath = Join-Path $taxDir 'situations.json'

$acc = Get-Content $accPath -Raw | ConvertFrom-Json
$saf = Get-Content $safPath -Raw | ConvertFrom-Json
$skp = Get-Content $skpPath -Raw | ConvertFrom-Json
$sit = Get-Content $sitPath -Raw | ConvertFrom-Json

function Remove-NodeFromData($Data, $NodeId) {
    $Data.nodes = @($Data.nodes | Where-Object { $_.id -ne $NodeId })
    foreach ($n in $Data.nodes) {
        if ($n.children -and $NodeId -in @($n.children)) {
            $n.children = @($n.children | Where-Object { $_ -ne $NodeId })
        }
    }
}

# === Pair 1: sit-164 ===
Write-Host '=== sit-164: Performance-Gated Safety Investment ===' -ForegroundColor Cyan
Remove-NodeFromData $acc 'acc-intentions-084'
Remove-NodeFromData $skp 'skp-intentions-090'

$sit.nodes = @($sit.nodes) + @([PSCustomObject]@{
    id = 'sit-164'
    label = 'Performance-Gated Safety Investment'
    description = "A situation concept that describes the policy approach of tying AI safety investment levels to demonstrated capability milestones.`nEncompasses: Mandatory safety spending thresholds triggered by performance benchmarks, graduated regulatory requirements based on model capability, and compute-based safety investment ratios.`nExcludes: General AI safety research not tied to specific performance gates, and voluntary corporate safety pledges."
    parent_id = $null
    children = @()
    interpretations = [PSCustomObject]@{
        accelerationist = 'Accelerationists view performance-gated safety as a pragmatic compromise that allows rapid development while providing measurable safety checkpoints that prevent regulatory overreach.'
        safetyist = 'Safetyists support performance gates as a minimum floor for safety investment, arguing thresholds should be conservative and legally binding.'
        skeptic = 'Skeptics question whether performance benchmarks can meaningfully predict real-world harms, worrying that gating mechanisms give a false sense of security.'
    }
})
Write-Host '  Removed acc-intentions-084 + skp-intentions-090'

# === Pair 2: sit-165 ===
Write-Host '=== sit-165: Latent Entropy Divergence as System Metric ===' -ForegroundColor Cyan
Remove-NodeFromData $saf 'saf-intentions-138'
Remove-NodeFromData $skp 'skp-beliefs-097'

$sit.nodes = @($sit.nodes) + @([PSCustomObject]@{
    id = 'sit-165'
    label = 'Latent Entropy Divergence as System Metric'
    description = "A situation concept that describes the use of latent entropy divergence as a quantitative metric for evaluating AI system behavior.`nEncompasses: Measuring distributional shifts in model internal representations, detecting safety-relevant behavioral changes, and monitoring system resilience over time.`nExcludes: Traditional software reliability metrics and simple output-level monitoring."
    parent_id = $null
    children = @()
    interpretations = [PSCustomObject]@{
        accelerationist = 'Accelerationists see entropy metrics as enabling faster iteration with automated monitoring replacing expensive manual safety reviews.'
        safetyist = 'Safetyists frame latent entropy divergence as an early-warning safety metric detecting dangerous capability shifts before they manifest in outputs.'
        skeptic = 'Skeptics question whether latent-space measurements can reliably predict real-world harms given the gap between internal representations and actual behavior.'
    }
})
Write-Host '  Removed saf-intentions-138 + skp-beliefs-097'

# === Pair 3: sit-166 ===
Write-Host '=== sit-166: AI Accountability and Liability Frameworks ===' -ForegroundColor Cyan
Remove-NodeFromData $saf 'saf-intentions-120'
Remove-NodeFromData $skp 'skp-intentions-086'

$sit.nodes = @($sit.nodes) + @([PSCustomObject]@{
    id = 'sit-166'
    label = 'AI Accountability and Liability Frameworks'
    description = "A situation concept that describes the development and implementation of legal and organizational frameworks for assigning responsibility when AI systems cause harm.`nEncompasses: Strict liability for AI developers, negligence standards for deployers, product liability extensions to AI, and institutional accountability mechanisms.`nExcludes: Purely technical safety approaches without legal enforcement, and self-regulatory industry codes without binding obligations."
    parent_id = $null
    children = @()
    interpretations = [PSCustomObject]@{
        accelerationist = 'Accelerationists prefer light-touch liability frameworks with safe harbor provisions that do not chill innovation or make AI development prohibitively risky for startups.'
        safetyist = 'Safetyists advocate for robust liability frameworks as essential enforcement mechanisms without which safety commitments remain voluntary and unenforceable.'
        skeptic = 'Skeptics emphasize that existing liability frameworks are inadequate for AI given opacity of systems, diffuse causation chains, and corporate structures that evade meaningful accountability.'
    }
})
Write-Host '  Removed saf-intentions-120 + skp-intentions-086'

if ($WhatIf) {
    Write-Host "`nWhatIf: Would save 4 taxonomy files and update summary references" -ForegroundColor Yellow
    return
}

# Save taxonomy files
$acc | ConvertTo-Json -Depth 20 | Set-Content $accPath -Encoding UTF8
$saf | ConvertTo-Json -Depth 20 | Set-Content $safPath -Encoding UTF8
$skp | ConvertTo-Json -Depth 20 | Set-Content $skpPath -Encoding UTF8
$sit | ConvertTo-Json -Depth 20 | Set-Content $sitPath -Encoding UTF8
Write-Host "`nTaxonomy files saved" -ForegroundColor Green

# Update references in summaries
$replacements = @{
    'acc-intentions-084' = 'sit-164'
    'skp-intentions-090' = 'sit-164'
    'saf-intentions-138' = 'sit-165'
    'skp-beliefs-097'    = 'sit-165'
    'saf-intentions-120' = 'sit-166'
    'skp-intentions-086' = 'sit-166'
}

$updatedFiles = 0
foreach ($f in (Get-ChildItem $sumDir -Filter '*.json' | Where-Object { $_.Name -notmatch 'debug-raw' })) {
    $content = Get-Content $f.FullName -Raw
    $changed = $false
    foreach ($old in $replacements.Keys) {
        if ($content -match [regex]::Escape($old)) {
            $content = $content -replace [regex]::Escape($old), $replacements[$old]
            $changed = $true
        }
    }
    if ($changed) {
        Set-Content -Path $f.FullName -Value $content -Encoding UTF8
        $updatedFiles++
    }
}
Write-Host "Updated references in $updatedFiles summary files" -ForegroundColor Green

# Update edges
$edgePath = Join-Path $taxDir 'edges.json'
if (Test-Path $edgePath) {
    $edgeContent = Get-Content $edgePath -Raw
    $edgeChanged = $false
    foreach ($old in $replacements.Keys) {
        if ($edgeContent -match [regex]::Escape($old)) {
            $edgeContent = $edgeContent -replace [regex]::Escape($old), $replacements[$old]
            $edgeChanged = $true
        }
    }
    if ($edgeChanged) {
        Set-Content -Path $edgePath -Value $edgeContent -Encoding UTF8
        Write-Host 'Updated references in edges.json' -ForegroundColor Green
    }
}

Write-Host "`nDone. Run Update-TaxEmbeddings to regenerate embeddings." -ForegroundColor Cyan
