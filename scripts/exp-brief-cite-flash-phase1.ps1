# Phase 1 — brief+cite flash-lite experiment (single topic, infrastructure validation)
# Run: pwsh -File scripts/exp-brief-cite-flash-phase1.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module "$PSScriptRoot\AITriad\AITriad.psm1" -Force

# ── Keep-awake guard ────────────────────────────────────────────────────────
# Interim mitigation for t/1135: the prior run was lost when the host slept
# mid-finalization. SetThreadExecutionState keeps the system awake for the
# duration of this process so a long debate isn't suspended before persisting.
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED = [uint32]'0x00000001'
$ES_AWAYMODE_REQUIRED = [uint32]'0x00000040'
[void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_AWAYMODE_REQUIRED)

$Topic = "Under what AI deployment conditions does strict liability outperform a negligence standard, and through what pathways does each regime reshape the incentives of developers, deployers, insurers, and harmed third parties — given the tension between deterring foreseeable harm and chilling beneficial innovation?"
$ExpSlug = "exp-brief-cite-flash"
$ProgressFile = Join-Path $PSScriptRoot "$ExpSlug-progress.json"

$CommonParams = @{
    Topic               = $Topic
    Model               = 'claude-opus-4'        # PS model id; TS CLI maps this to claude-opus-4-8
    ConfrontationRounds = 1
    ArgumentationRounds = 2
    ConcludingRounds    = 1
    ProgressFile        = $ProgressFile
    ProgressBatchName   = $ExpSlug
}

Write-Host ""
Write-Host "=== Phase 1: brief+cite flash-lite experiment ===" -ForegroundColor Cyan
Write-Host "Topic: $Topic" -ForegroundColor Gray
Write-Host "Rounds: Confrontation=1, Argumentation=2, Concluding=1" -ForegroundColor Gray
Write-Host "Progress: $ProgressFile" -ForegroundColor Gray
Write-Host ""

# ── Run 1: Expensive (all Opus) ────────────────────────────────────────────
Write-Host "[1/2] Running EXPENSIVE (all claude-opus-4-8)..." -ForegroundColor Yellow
$ResultExpensive = Invoke-AITDebate @CommonParams `
    -Name "$ExpSlug-expensive-phase1" `
    -ProgressDebateName "$ExpSlug-expensive-phase1"

if (-not $ResultExpensive -or -not $ResultExpensive.SessionPath) {
    Write-Host "FAILED: Expensive debate did not produce a session path." -ForegroundColor Red
    exit 1
}
Write-Host "Expensive debate complete: $($ResultExpensive.SessionPath)" -ForegroundColor Green

# ── Run 2: Cheap (brief+cite = flash-lite, rest = Opus) ───────────────────
Write-Host ""
Write-Host "[2/2] Running CHEAP (brief+cite=gemini-3.1-flash-lite, rest=claude-opus-4-8)..." -ForegroundColor Yellow
$ResultCheap = Invoke-AITDebate @CommonParams `
    -Name "$ExpSlug-cheap-phase1" `
    -ProgressDebateName "$ExpSlug-cheap-phase1" `
    -StageModels @{
        brief = 'gemini-3.1-flash-lite'
        cite  = 'gemini-3.1-flash-lite'
    }

if (-not $ResultCheap -or -not $ResultCheap.SessionPath) {
    Write-Host "FAILED: Cheap debate did not produce a session path." -ForegroundColor Red
    exit 1
}
Write-Host "Cheap debate complete: $($ResultCheap.SessionPath)" -ForegroundColor Green

# ── Quality analysis ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Quality Analysis ===" -ForegroundColor Cyan

Write-Host ""
Write-Host "--- EXPENSIVE ---" -ForegroundColor Yellow
$QualityExpensive = Measure-DebateQuality -Path $ResultExpensive.SessionPath -PassThruMetrics
$QualityExpensive | Format-List OverallRating, Tier, CruxAddressedRatio, TaxonomyMappedRatio,
    SituationCruxAlignment, TopicAlignmentRate, RepetitionRate, ClaimsForgotten, DraftRepairRate

Write-Host ""
Write-Host "--- CHEAP ---" -ForegroundColor Yellow
$QualityCheap = Measure-DebateQuality -Path $ResultCheap.SessionPath -PassThruMetrics
$QualityCheap | Format-List OverallRating, Tier, CruxAddressedRatio, TaxonomyMappedRatio,
    SituationCruxAlignment, TopicAlignmentRate, RepetitionRate, ClaimsForgotten, DraftRepairRate

Write-Host ""
Write-Host "=== Side-by-side Comparison ===" -ForegroundColor Cyan
Compare-DebateQuality -Baseline $ResultExpensive.SessionPath -Treatment $ResultCheap.SessionPath

Write-Host ""
Write-Host "=== Phase 1 complete ===" -ForegroundColor Green
Write-Host "Expensive: $($ResultExpensive.SessionPath)" -ForegroundColor Gray
Write-Host "Cheap:     $($ResultCheap.SessionPath)" -ForegroundColor Gray
