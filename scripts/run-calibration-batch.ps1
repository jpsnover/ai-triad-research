#!/usr/bin/env pwsh
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Runs a batch of calibration debates with controlled variation.
.DESCRIPTION
    Executes the Phase 3 calibration matrix: topics x debater orders x pacings.
    Each debate runs via the CLI with adaptive staging enabled, producing
    calibration data points for the parameter optimizer.

    Uses the project default model (gemini-3.1-flash-lite-preview) to calibrate
    parameters at the floor — stronger models degrade gracefully upward.
.PARAMETER SmokeTest
    Run only 2 debates (one moderate, one thorough) to verify the pipeline.
.PARAMETER DryRun
    Show the matrix without running any debates.
.PARAMETER Model
    Override the model (default: gemini-3.1-flash-lite-preview).
.PARAMETER OutputDir
    Debate output directory (default: ../ai-triad-data/debates).
.EXAMPLE
    ./scripts/run-calibration-batch.ps1 -SmokeTest
.EXAMPLE
    ./scripts/run-calibration-batch.ps1 -DryRun
.EXAMPLE
    ./scripts/run-calibration-batch.ps1
#>
[CmdletBinding()]
param(
    [switch]$SmokeTest,
    [switch]$DryRun,
    [string]$Model = 'gemini-3.1-flash-lite-preview',
    [string]$OutputDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) {
    $config = Get-Content (Join-Path $repoRoot '.aitriad.json') -Raw | ConvertFrom-Json
    $OutputDir = Join-Path $repoRoot $config.data_root 'debates'
}

# ── Calibration matrix ──────────────────────────────────────

$Topics = @(
    @{ name = 'redteam';   topic = 'Should frontier AI labs be required to run red-team evaluations before deployment?' }
    @{ name = 'governance'; topic = 'How should democratic nations govern AI development?' }
    @{ name = 'precaution'; topic = 'Is the precautionary principle appropriate for AI regulation?' }
    @{ name = 'labor';      topic = 'What labor market policies are needed for the AI transition?' }
    @{ name = 'explain';    topic = 'Should AI systems be required to explain their reasoning to affected individuals?' }
)

$Orders = @(
    @{ name = 'psc'; povers = @('prometheus', 'sentinel', 'cassandra') }
    @{ name = 'cps'; povers = @('cassandra', 'prometheus', 'sentinel') }
)

$Pacings = @('moderate', 'thorough')

# ── Build run list ──────────────────────────────────────────

$Runs = [System.Collections.Generic.List[hashtable]]::new()

if ($SmokeTest) {
    # 2 debates: one moderate, one thorough — different topics
    $Runs.Add(@{
        topic   = $Topics[0].topic
        name    = "smoke-$($Topics[0].name)-moderate-psc"
        pacing  = 'moderate'
        povers  = $Orders[0].povers
    })
    $Runs.Add(@{
        topic   = $Topics[1].topic
        name    = "smoke-$($Topics[1].name)-thorough-cps"
        pacing  = 'thorough'
        povers  = $Orders[1].povers
    })
} else {
    foreach ($t in $Topics) {
        foreach ($o in $Orders) {
            foreach ($p in $Pacings) {
                $Runs.Add(@{
                    topic   = $t.topic
                    name    = "cal-$($t.name)-$p-$($o.name)"
                    pacing  = $p
                    povers  = $o.povers
                })
            }
        }
    }
}

# ── Display plan ────────────────────────────────────────────

Write-Host "`n=== Calibration Debate Batch ===" -ForegroundColor Cyan
Write-Host "  Model:      $Model"
Write-Host "  Output:     $OutputDir"
Write-Host "  Debates:    $($Runs.Count)"
Write-Host "  Adaptive:   yes"
Write-Host "  Mode:       $(if ($SmokeTest) { 'SMOKE TEST (2 debates)' } elseif ($DryRun) { 'DRY RUN' } else { 'FULL MATRIX' })"
Write-Host ""

for ($i = 0; $i -lt $Runs.Count; $i++) {
    $r = $Runs[$i]
    $orderLabel = ($r.povers | ForEach-Object { $_.Substring(0,1).ToUpper() }) -join ''
    Write-Host "  $($i+1)/$($Runs.Count): $($r.name)  [$($r.pacing), $orderLabel]" -ForegroundColor $(if ($DryRun) { 'DarkGray' } else { 'White' })
    Write-Host "          $($r.topic.Substring(0, [Math]::Min(70, $r.topic.Length)))..." -ForegroundColor DarkGray
}

if ($DryRun) {
    Write-Host "`n  [DRY RUN] No debates executed.`n" -ForegroundColor Yellow
    return
}

Write-Host ""

# ── Run debates ─────────────────────────────────────────────

$succeeded = 0
$failed = 0
$results = @()

for ($i = 0; $i -lt $Runs.Count; $i++) {
    $r = $Runs[$i]
    $num = $i + 1

    Write-Host "[$num/$($Runs.Count)] $($r.name)" -ForegroundColor Cyan -NoNewline
    Write-Host " — $($r.pacing), $(($r.povers | ForEach-Object { $_.Substring(0,3) }) -join '/')" -ForegroundColor Gray

    $configObj = @{
        topic               = $r.topic
        name                = $r.name
        activePovers        = $r.povers
        model               = $Model
        useAdaptiveStaging  = $true
        pacing              = $r.pacing
        allowEarlyTermination = $true
        audience            = 'policymakers'
        outputDir           = $OutputDir
        slug                = $r.name
    }

    $configJson = $configObj | ConvertTo-Json -Depth 3 -Compress
    $startTime = Get-Date

    try {
        $output = $configJson | npx tsx "$repoRoot/lib/debate/cli.ts" --stdin 2>&1
        $elapsed = (Get-Date) - $startTime
        $exitCode = $LASTEXITCODE

        if ($exitCode -eq 0) {
            Write-Host "  OK ($([int]$elapsed.TotalSeconds)s)" -ForegroundColor Green
            $succeeded++
            $results += @{ Name = $r.name; Success = $true; Seconds = [int]$elapsed.TotalSeconds }
        } else {
            Write-Host "  FAILED (exit $exitCode, $([int]$elapsed.TotalSeconds)s)" -ForegroundColor Red
            # Show last 5 lines of output for debugging
            $lines = @($output | ForEach-Object { $_.ToString() })
            $tail = $lines | Select-Object -Last 5
            foreach ($line in $tail) {
                Write-Host "    $line" -ForegroundColor DarkRed
            }
            $failed++
            $results += @{ Name = $r.name; Success = $false; Seconds = [int]$elapsed.TotalSeconds; Error = ($tail -join '; ') }
        }
    }
    catch {
        $elapsed = (Get-Date) - $startTime
        Write-Host "  ERROR: $_" -ForegroundColor Red
        $failed++
        $results += @{ Name = $r.name; Success = $false; Seconds = [int]$elapsed.TotalSeconds; Error = $_.ToString() }
    }

    # Brief pause between debates to avoid rate limiting
    if ($i -lt $Runs.Count - 1) {
        Start-Sleep -Seconds 5
    }
}

# ── Summary ─────────────────────────────────────────────────

Write-Host "`n$('=' * 60)" -ForegroundColor Cyan
Write-Host "  CALIBRATION BATCH COMPLETE" -ForegroundColor White
Write-Host "$('=' * 60)" -ForegroundColor Cyan
Write-Host "  Succeeded: $succeeded / $($Runs.Count)" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Yellow' })
if ($failed -gt 0) {
    Write-Host "  Failed:    $failed" -ForegroundColor Red
}
$totalSecs = ($results | Measure-Object -Property Seconds -Sum).Sum
Write-Host "  Total time: $([int]($totalSecs / 60))m $($totalSecs % 60)s"
Write-Host ""

# Check calibration log
$calibLog = Join-Path (Split-Path $OutputDir -Parent) 'calibration/calibration-log.json'
if (Test-Path $calibLog) {
    $entries = (Get-Content $calibLog -Raw | ConvertFrom-Json).Count
    Write-Host "  Calibration log: $entries entries" -ForegroundColor Green
} else {
    Write-Host "  Calibration log: not found (check wiring)" -ForegroundColor Yellow
}

if ($failed -gt 0) {
    Write-Host "`n  FAILED DEBATES:" -ForegroundColor Red
    foreach ($r in ($results | Where-Object { -not $_.Success })) {
        Write-Host "    $($r.Name): $($r.Error)" -ForegroundColor Red
    }
    Write-Host "`n  Re-run failed debates:" -ForegroundColor Yellow
    foreach ($r in ($results | Where-Object { -not $_.Success })) {
        Write-Host "    # $($r.Name)" -ForegroundColor DarkYellow
    }
}

Write-Host ""
