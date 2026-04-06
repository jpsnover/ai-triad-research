#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Migrates situation node interpretations from plain strings to BDI-decomposed objects.
    Uses AI to decompose each interpretation into belief, desire, intention, and summary.
.PARAMETER BatchSize
    Number of nodes to process per AI call (default 5 — batching reduces API calls).
.PARAMETER DryRun
    Show what would change without writing.
.PARAMETER StartIndex
    Resume from this node index (0-based) if a previous run was interrupted.
#>
[CmdletBinding()]
param(
    [int]$BatchSize = 5,
    [switch]$DryRun,
    [int]$StartIndex = 0,
    [string]$Model = 'gemini-3.1-flash-lite-preview'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path (Join-Path $PSScriptRoot 'AITriad') 'AITriad.psm1') -Force
# AIEnrich is dot-sourced by AITriad — but Invoke-AIApi may not be exported.
# Import AIEnrich directly to ensure Invoke-AIApi is available.
Import-Module (Join-Path $PSScriptRoot 'AIEnrich.psm1') -Force

# Resolve data path
$dataRoot = (Get-Content (Join-Path (Join-Path $PSScriptRoot '..') '.aitriad.json') -Raw | ConvertFrom-Json).data_root
$dataRoot = Join-Path (Join-Path $PSScriptRoot '..') $dataRoot
$sitFile = Join-Path (Join-Path (Join-Path $dataRoot 'taxonomy') 'Origin') 'situations.json'

if (-not (Test-Path $sitFile)) {
    throw "Situations file not found: $sitFile"
}

$sitData = Get-Content $sitFile -Raw | ConvertFrom-Json
$nodes = $sitData.nodes
$total = $nodes.Count

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  INTERPRETATION MIGRATION — $total situation nodes" -ForegroundColor Cyan
Write-Host "  Model: $Model  |  Batch size: $BatchSize" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  [DRY RUN]" -ForegroundColor Yellow }
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan

$prompt = @'
You are decomposing situation node interpretations into BDI (Belief-Desire-Intention) components.

For each interpretation paragraph, extract:
- belief: The empirical claim(s) — what this POV asserts as factually true. One sentence. Test: "Could this be proven true or false?"
- desire: The normative commitment(s) — what this POV argues should happen. One sentence. Test: "Is this about what ought to happen?"
- intention: The strategic reasoning — how this POV argues the issue should be approached. One sentence. Test: "Is this about how to achieve a goal?"
- summary: A 1-sentence summary capturing all three components.

RULES:
- Each field must be exactly ONE sentence (concise, direct).
- Use the POV's own voice — don't neutralize the language.
- If a paragraph doesn't clearly contain one component (e.g., no explicit empirical claim), write the closest approximation from the paragraph's implicit reasoning.
- Do NOT add information not in the original paragraph.
- The summary should be shorter than any individual component — it's a headline, not a restatement.

Return ONLY valid JSON (no markdown, no code fences).
'@

$migrated = 0
$failed = 0
$apiCalls = 0

for ($batch = $StartIndex; $batch -lt $total; $batch += $BatchSize) {
    $end = [Math]::Min($batch + $BatchSize, $total)
    $batchNodes = $nodes[$batch..($end - 1)]

    Write-Host ""
    Write-Host "  Batch $([Math]::Floor($batch / $BatchSize) + 1): nodes $batch-$($end - 1) of $total" -ForegroundColor Cyan

    # Build batch input
    $inputItems = @()
    foreach ($n in $batchNodes) {
        # Skip already-migrated nodes
        if ($n.interpretations.accelerationist -is [PSCustomObject] -and
            $n.interpretations.accelerationist.PSObject.Properties['belief']) {
            Write-Host "    [$($n.id)] Already migrated — skipping" -ForegroundColor Yellow
            continue
        }

        $inputItems += @{
            id = $n.id
            label = $n.label
            accelerationist = $n.interpretations.accelerationist
            safetyist = $n.interpretations.safetyist
            skeptic = $n.interpretations.skeptic
        }
    }

    if ($inputItems.Count -eq 0) {
        Write-Host "    All nodes in batch already migrated" -ForegroundColor Yellow
        continue
    }

    $batchPrompt = @"
$prompt

INPUT (decompose each interpretation for each node):
$($inputItems | ConvertTo-Json -Depth 3 -Compress)

OUTPUT FORMAT:
[
  {
    "id": "sit-001",
    "accelerationist": {"belief": "...", "desire": "...", "intention": "...", "summary": "..."},
    "safetyist": {"belief": "...", "desire": "...", "intention": "...", "summary": "..."},
    "skeptic": {"belief": "...", "desire": "...", "intention": "...", "summary": "..."}
  }
]
"@

    if ($DryRun) {
        Write-Host "    Would process $($inputItems.Count) nodes" -ForegroundColor Yellow
        $migrated += $inputItems.Count
        continue
    }

    try {
        $apiCalls++
        $result = Invoke-AIApi -Prompt $batchPrompt -Model $Model -Temperature 0.1 -JsonMode -MaxTokens 16384 -TimeoutSec 120
        $rawText = $result.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
        $parsed = $rawText | ConvertFrom-Json

        foreach ($item in $parsed) {
            $nodeIdx = $null
            for ($i = 0; $i -lt $nodes.Count; $i++) {
                if ($nodes[$i].id -eq $item.id) { $nodeIdx = $i; break }
            }
            if ($null -eq $nodeIdx) {
                Write-Warning "    Node $($item.id) not found in taxonomy — skipping"
                continue
            }

            # Replace string interpretations with BDI objects
            $nodes[$nodeIdx].interpretations = [PSCustomObject]@{
                accelerationist = [PSCustomObject]@{
                    belief    = $item.accelerationist.belief
                    desire    = $item.accelerationist.desire
                    intention = $item.accelerationist.intention
                    summary   = $item.accelerationist.summary
                }
                safetyist = [PSCustomObject]@{
                    belief    = $item.safetyist.belief
                    desire    = $item.safetyist.desire
                    intention = $item.safetyist.intention
                    summary   = $item.safetyist.summary
                }
                skeptic = [PSCustomObject]@{
                    belief    = $item.skeptic.belief
                    desire    = $item.skeptic.desire
                    intention = $item.skeptic.intention
                    summary   = $item.skeptic.summary
                }
            }

            $migrated++
            Write-Host "    [$($item.id)] $($nodes[$nodeIdx].label) — migrated" -ForegroundColor Green
        }
    }
    catch {
        $failed++
        Write-Warning "    Batch failed: $_"
        # Continue to next batch rather than aborting
        continue
    }
}

# Write back
if (-not $DryRun -and $migrated -gt 0) {
    Write-Host ""
    Write-Host "  Writing $migrated migrated nodes to $sitFile..." -ForegroundColor Cyan
    $sitData.last_modified = (Get-Date -Format 'yyyy-MM-dd')
    $sitData | ConvertTo-Json -Depth 10 | Set-Content -Path $sitFile -NoNewline
    Write-Host "  Done." -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  COMPLETE: $migrated migrated, $failed failed, $apiCalls API calls" -ForegroundColor Green
if ($DryRun) { Write-Host "  [DRY RUN] No files modified." -ForegroundColor Yellow }
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
