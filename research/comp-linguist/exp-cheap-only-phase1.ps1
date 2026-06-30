# Cheap-only run for exp-brief-cite-flash Phase 1.
# The expensive run already completed and is saved; we only need the cheap arm,
# then compare against the saved expensive session.
# Run: pwsh -File research/comp-linguist/exp-cheap-only-phase1.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module "$PSScriptRoot\..\..\scripts\AITriad\AITriad.psm1" -Force

# Keep-awake guard (interim sleep mitigation, t/1135 era)
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[void][Win32.Power]::SetThreadExecutionState(([uint32]'0x80000000') -bor ([uint32]'0x00000001') -bor ([uint32]'0x00000040'))

# Same topic + config as the expensive run (must match for a valid comparison)
$Topic = "Under what AI deployment conditions does strict liability outperform a negligence standard, and through what pathways does each regime reshape the incentives of developers, deployers, insurers, and harmed third parties — given the tension between deterring foreseeable harm and chilling beneficial innovation?"
$ExpSlug = "exp-brief-cite-flash"
$ProgressFile = Join-Path $PSScriptRoot "$ExpSlug-cheaponly-progress.json"

# Saved expensive session (recovered 2026-06-30)
$ExpensivePath = "C:\Users\jsnov\repos\ai-triad-data\debates\debate-0826455a-7a71-4d2d-90b2-b4ca597f1c3b.json"

Write-Host "[1/1] Running CHEAP (brief+cite=gemini-3.1-flash-lite, rest=claude-opus-4-8)..." -ForegroundColor Yellow
$ResultCheap = Invoke-AITDebate `
    -Topic               $Topic `
    -Model               'claude-opus-4' `
    -ConfrontationRounds 1 `
    -ArgumentationRounds 2 `
    -ConcludingRounds    1 `
    -ProgressFile        $ProgressFile `
    -ProgressBatchName   $ExpSlug `
    -Name                "$ExpSlug-cheap-phase1" `
    -ProgressDebateName  "$ExpSlug-cheap-phase1" `
    -StageModels         @{ brief = 'gemini-3.1-flash-lite'; cite = 'gemini-3.1-flash-lite' }

if (-not $ResultCheap -or -not $ResultCheap.SessionPath) {
    Write-Host "FAILED: Cheap debate did not produce a session path." -ForegroundColor Red
    exit 1
}
Write-Host "Cheap debate complete: $($ResultCheap.SessionPath)" -ForegroundColor Green

Write-Host ""
Write-Host "=== Quality Comparison (expensive vs cheap) ===" -ForegroundColor Cyan
Write-Host "Expensive: $ExpensivePath" -ForegroundColor Gray
Write-Host "Cheap:     $($ResultCheap.SessionPath)" -ForegroundColor Gray
Write-Host ""
try {
    Compare-DebateQuality -Baseline $ExpensivePath -Treatment $ResultCheap.SessionPath
} catch {
    Write-Host "Compare-DebateQuality error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Falling back to per-run Measure..." -ForegroundColor Yellow
    Write-Host "--- EXPENSIVE ---"; Measure-DebateQuality -Path $ExpensivePath -PassThruMetrics | Format-List OverallRating,Tier,TotalRounds
    Write-Host "--- CHEAP ---";     Measure-DebateQuality -Path $ResultCheap.SessionPath -PassThruMetrics | Format-List OverallRating,Tier,TotalRounds
}

Write-Host ""
Write-Host "=== Cheap-only run complete ===" -ForegroundColor Green
