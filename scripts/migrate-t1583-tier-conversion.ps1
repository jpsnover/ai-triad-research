# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
<#
.SYNOPSIS
    Migrate 25 org records: decimal pov_alignment.<camp>.score → 5-point tier
    enum, add behavioral_notes:null, per t/1583 (design in t/1556 / CL doc
    org-pov-mapping-design.md §R3).
.DESCRIPTION
    One-shot migration script. Defaults to dry-run; pass -Write to apply.
    Halts with a diff report if the resulting tier distribution does not
    match the expected 7/10/17/24/17 total per t/1583 AC #2.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$Path = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/organizations.json',

    [Parameter()]
    [switch]$Write
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Expected = @{
    opposes         = 7
    leans_against   = 10
    mixed_or_silent = 17
    leans_toward    = 24
    champions       = 17
}

function _ScoreToTier {
    param([double]$Score)
    if ($Score -le -0.50)  { return 'opposes' }
    if ($Score -le -0.15)  { return 'leans_against' }
    if ($Score -lt  0.15)  { return 'mixed_or_silent' }
    if ($Score -le  0.55)  { return 'leans_toward' }
    return 'champions'
}

$store = Get-Content $Path -Raw | ConvertFrom-Json
$orgs  = @($store.organizations)
$camps = @('accelerationist', 'safetyist', 'skeptic')

$counts = @{ opposes=0; leans_against=0; mixed_or_silent=0; leans_toward=0; champions=0 }
$perOrgChanges = [System.Collections.Generic.List[PSObject]]::new()

foreach ($org in $orgs) {
    if (-not $org.PSObject.Properties['pov_alignment']) { continue }
    $pa = $org.pov_alignment
    $orgChange = [ordered]@{ OrgId = [string]$org.id; Name = [string]$org.name }
    foreach ($camp in $camps) {
        if (-not $pa.PSObject.Properties[$camp]) {
            Write-Warning "$($org.id): missing camp '$camp' — skipped"
            continue
        }
        $c = $pa.$camp
        $score = if ($c.PSObject.Properties['score']) { [double]$c.score } else { $null }
        if ($null -eq $score) {
            Write-Warning "$($org.id).${camp}: no score, skipping"
            continue
        }
        $tier = _ScoreToTier -Score $score
        $counts[$tier]++
        $orgChange[$camp] = "$score → $tier"

        # Mutate in place: build a new camp object with the target shape.
        # Preserve rationale (already lowercase), add behavioral_notes:null,
        # drop score. Also drop assessed_at IF it wanders inside the camp map
        # (per ticket — never in current data, but future-proof).
        $rationale = if ($c.PSObject.Properties['rationale']) { [string]$c.rationale } else { '' }
        $newCamp = [PSCustomObject]@{
            tier              = $tier
            rationale         = $rationale
            behavioral_notes  = $null
        }
        # Replace the camp entry on pa.
        $pa.$camp = $newCamp
    }
    $perOrgChanges.Add([PSCustomObject]$orgChange)
}

# ── Distribution report ──────────────────────────────────────────────────
Write-Host ''
Write-Host '== Tier distribution ==' -ForegroundColor Cyan
$mismatch = $false
foreach ($k in 'opposes','leans_against','mixed_or_silent','leans_toward','champions') {
    $got = $counts[$k]
    $exp = $Expected[$k]
    $mark = if ($got -eq $exp) { '✓' } else { '✗'; $mismatch = $true }
    "  {0,-16} : {1,3}  (expected {2,3})  {3}" -f $k, $got, $exp, $mark
}
$total = ($counts.Values | Measure-Object -Sum).Sum
$expectedTotal = ($Expected.Values | Measure-Object -Sum).Sum
"  {0,-16} : {1,3}  (expected {2,3})" -f 'TOTAL', $total, $expectedTotal

if ($mismatch) {
    Write-Error 'Distribution mismatch — HALTING without write. See per-camp assignments above.'
    return
}

if (-not $Write) {
    Write-Host ''
    Write-Host 'Dry-run OK. Rerun with -Write to persist.' -ForegroundColor Yellow
    return [PSCustomObject]@{
        Counts = $counts
        PerOrgChanges = @($perOrgChanges)
        Wrote = $false
    }
}

# ── Write ────────────────────────────────────────────────────────────────
$json = $store | ConvertTo-Json -Depth 12
Set-Content -Path $Path -Value $json -Encoding utf8NoBOM
Write-Host ''
Write-Host "Wrote $Path" -ForegroundColor Green

[PSCustomObject]@{
    Counts = $counts
    PerOrgChanges = @($perOrgChanges)
    Wrote = $true
}
