<#
.SYNOPSIS
    Check A/B experiment kill criteria against a treatment debate file.
.DESCRIPTION
    Extracts calibration metrics and PRM stats from a debate JSON file and
    checks against the cheap-brief-cite-v1 kill criteria (design doc Section 5.3).
    Returns pass/fail per criterion and an overall verdict.
.PARAMETER DebatePath
    Path to the treatment debate JSON file.
.EXAMPLE
    .\check-kill-criteria.ps1 -DebatePath ..\..\..\ai-triad-data\debates\cli-runs\debate-xyz.json
#>
param(
    [Parameter(Mandatory)]
    [string]$DebatePath
)

Set-StrictMode -Version Latest

if (-not (Test-Path $DebatePath)) {
    throw "Debate file not found: $DebatePath"
}

$d = Get-Content $DebatePath -Raw | ConvertFrom-Json

Write-Host "`n=== Kill Criteria Check: $([System.IO.Path]::GetFileName($DebatePath)) ===" -ForegroundColor Cyan
Write-Host "Model: $($d.debate_model) | Phase: $($d.phase) | App: $($d.app_version)"

if ($d.stage_models) {
    Write-Host "Stage models: $(($d.stage_models | ConvertTo-Json -Compress))" -ForegroundColor Yellow
}

$results = @()

# Kill criterion 1: crux_addressed_ratio < 0.10
$car = $d.calibration_log.crux_addressed_ratio
$c1 = @{ Metric = 'crux_addressed_ratio'; Value = $car; Threshold = '< 0.10'; Pass = ($null -eq $car -or $car -ge 0.10) }
$results += [pscustomobject]$c1

# Kill criterion 2: repetition_rate > 0.25
$rr = $d.calibration_log.repetition_rate
$c2 = @{ Metric = 'repetition_rate'; Value = $rr; Threshold = '> 0.25'; Pass = ($null -eq $rr -or $rr -le 0.25) }
$results += [pscustomobject]$c2

# Kill criterion 3: claims_forgotten_rate > 0.55
$cfr = $d.calibration_log.claims_forgotten_rate
$c3 = @{ Metric = 'claims_forgotten_rate'; Value = $cfr; Threshold = '> 0.55'; Pass = ($null -eq $cfr -or $cfr -le 0.55) }
$results += [pscustomobject]$c3

# Kill criterion 4: situation_crux_alignment < 0.5
$sca = $d.calibration_log.situation_crux_alignment
$c4 = @{ Metric = 'situation_crux_alignment'; Value = $sca; Threshold = '< 0.50'; Pass = ($null -eq $sca -or $sca -ge 0.50) }
$results += [pscustomobject]$c4

# PRM stats (informational, not kill criteria)
$prmMean = $null
$prmVar = $null
if ($d.process_rewards -and $d.process_rewards.Count -gt 0) {
    $scores = $d.process_rewards | ForEach-Object { $_.score }
    $prmMean = [math]::Round(($scores | Measure-Object -Average).Average, 4)
    $prmVar = [math]::Round(($scores | ForEach-Object { ($_ - $prmMean) * ($_ - $prmMean) } | Measure-Object -Average).Average, 4)
}

# Draft retry rate (informational)
$turnEntries = @($d.transcript | Where-Object { $_.type -eq 'turn' })
$totalDraftCalls = 0
$draftRetries = 0
foreach ($entry in $turnEntries) {
    if ($entry.stage_diagnostics) {
        foreach ($sd in $entry.stage_diagnostics) {
            if ($sd.stage -eq 'draft') {
                $totalDraftCalls++
                if ($sd.retry_count -and $sd.retry_count -gt 0) { $draftRetries++ }
            }
        }
    }
}

Write-Host "`n--- Kill Criteria ---" -ForegroundColor White
foreach ($r in $results) {
    $status = if ($r.Pass) { 'PASS' } else { 'KILL' }
    $color = if ($r.Pass) { 'Green' } else { 'Red' }
    $valStr = if ($null -eq $r.Value) { 'null' } else { [math]::Round($r.Value, 4) }
    Write-Host "  [$status] $($r.Metric) = $valStr (kill if $($r.Threshold))" -ForegroundColor $color
}

Write-Host "`n--- Informational ---" -ForegroundColor White
Write-Host "  PRM mean: $prmMean | PRM variance: $prmVar"
Write-Host "  PRM acceptable: mean >= 0.65 = $(if ($null -eq $prmMean) {'N/A'} elseif ($prmMean -ge 0.65) {'YES'} else {'NO'})"
Write-Host "  Draft retries: $draftRetries / $totalDraftCalls turns"
Write-Host "  Taxonomy mapped ratio: $($d.calibration_log.taxonomy_mapped_ratio)"

$killedCount = @($results | Where-Object { -not $_.Pass }).Count
if ($killedCount -gt 0) {
    Write-Host "`n*** VERDICT: KILL — $killedCount criterion/criteria failed ***" -ForegroundColor Red
} else {
    Write-Host "`n*** VERDICT: PASS — all kill criteria met ***" -ForegroundColor Green
}

Write-Host ""
