# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Lightweight per-stage timing trace for the summarization pipeline.
#
# Records call count + cumulative wall time per named stage into a module-scoped
# accumulator. Recording is cheap (a hashtable update) and always on; the report
# is only printed when enabled via -TimingTrace (Invoke-BatchSummary) or the
# AITRIAD_TIMING environment variable.
#
# NOTE: aggregation is per-runspace. Under -MaxConcurrent > 1 each parallel
# worker has its own accumulator, so meaningful traces require a single-doc,
# sequential run (-MaxConcurrent 1, the default).

function Reset-StageTiming {
    [CmdletBinding()]
    param()
    $script:StageTiming = [ordered]@{}
}

function Add-StageTiming {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][double]$Milliseconds
    )
    if (-not (Test-Path variable:script:StageTiming) -or $null -eq $script:StageTiming) {
        $script:StageTiming = [ordered]@{}
    }
    if (-not $script:StageTiming.Contains($Name)) {
        $script:StageTiming[$Name] = @{ Count = 0; TotalMs = 0.0 }
    }
    $script:StageTiming[$Name].Count++
    $script:StageTiming[$Name].TotalMs += $Milliseconds
}

# Times a scriptblock, records the elapsed wall time under $Name, and returns the
# scriptblock's output. Invoked with & so the block can read caller-scope vars.
function Invoke-TimedStage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$ScriptBlock
    )
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $ScriptBlock
    }
    finally {
        $Sw.Stop()
        Add-StageTiming -Name $Name -Milliseconds $Sw.Elapsed.TotalMilliseconds
    }
}

function Write-StageTimingReport {
    [CmdletBinding()]
    param()
    if (-not (Test-Path variable:script:StageTiming) -or -not $script:StageTiming -or $script:StageTiming.Count -eq 0) {
        Write-Host '  (no timing data collected — run a single doc with -MaxConcurrent 1)' -ForegroundColor Yellow
        return
    }

    Write-Host ''
    Write-Host '  ── Timing trace ─────────────────────────────────────────────' -ForegroundColor Cyan
    Write-Host ('  {0,-30} {1,6} {2,10} {3,10}' -f 'Stage', 'Calls', 'Total(s)', 'Avg(ms)') -ForegroundColor Gray
    $GrandMs = 0.0
    foreach ($Key in $script:StageTiming.Keys) {
        $Entry = $script:StageTiming[$Key]
        $GrandMs += $Entry.TotalMs
        if ($Entry.Count -gt 0) { $Avg = $Entry.TotalMs / $Entry.Count } else { $Avg = 0 }
        Write-Host ('  {0,-30} {1,6} {2,10:N1} {3,10:N0}' -f $Key, $Entry.Count, ($Entry.TotalMs / 1000), $Avg)
    }
    Write-Host ('  {0,-30} {1,6} {2,10:N1}' -f 'TOTAL (instrumented)', '', ($GrandMs / 1000)) -ForegroundColor Green
    Write-Host '  ─────────────────────────────────────────────────────────────' -ForegroundColor Cyan
}
