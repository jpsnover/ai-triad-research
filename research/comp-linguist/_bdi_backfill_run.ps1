# t/1306 bulk backfill → STAGING (does NOT touch situations.json). CL reviews staging, then merges.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module ./scripts/AITriad/AITriad.psm1 -Force *> $null

$sitPath  = 'C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\situations.json'
$stagePath = 'C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\_bdi_backfill_staging.json'
$doc = Get-Content $sitPath -Raw | ConvertFrom-Json
$nodes = $doc.nodes

function Get-Class($n) {
    $desc = if ($n.PSObject.Properties['description']) { [string]$n.description } else { '' }
    if ($desc.TrimStart().StartsWith('[DEPRECATED]')) { return 'deprecated' }
    $interp = if ($n.PSObject.Properties['interpretations']) { $n.interpretations } else { $null }
    if ($null -eq $interp) { return 'empty' }
    $acc = if ($interp.PSObject.Properties['accelerationist']) { $interp.accelerationist } else { $null }
    if ($null -eq $acc) { return 'empty' }
    if ($acc -is [string]) { if ([string]::IsNullOrWhiteSpace($acc)) { return 'empty' } else { return 'flat' } }
    if ($acc.PSObject.Properties['belief']) { return 'bdi' }
    return 'flat'
}
function Get-ExistingInterp($n) {
    $interp = if ($n.PSObject.Properties['interpretations']) { $n.interpretations } else { $null }
    if ($null -eq $interp) { return '(none)' }
    $parts = foreach ($pov in 'accelerationist','safetyist','skeptic') {
        $v = if ($interp.PSObject.Properties[$pov]) { $interp.$pov } else { $null }
        if ($v -is [string] -and -not [string]::IsNullOrWhiteSpace($v)) { "${pov}: $v" }
    }
    if (@($parts).Count -eq 0) { return '(none)' } else { return ($parts -join "`n") }
}
function Test-Valid($obj) {
    foreach ($pov in 'accelerationist','safetyist','skeptic') {
        if (-not $obj.PSObject.Properties[$pov]) { return $false }
        $p = $obj.$pov
        foreach ($f in 'belief','desire','intention') {
            if (-not $p.PSObject.Properties[$f] -or [string]::IsNullOrWhiteSpace([string]$p.$f)) { return $false }
        }
    }
    return $true
}

$targets = @($nodes | Where-Object { $c = Get-Class $_; $c -eq 'flat' -or $c -eq 'empty' })
Write-Host "targets (non-deprecated flat+empty): $(@($targets).Count)" -ForegroundColor Cyan

$staging = [ordered]@{}
$ok = 0; $fail = 0; $i = 0
foreach ($n in $targets) {
    $i++
    $cls = Get-Class $n
    $values = @{
        situation_id = [string]$n.id
        label = [string]$n.label
        description = if ($n.PSObject.Properties['description']) { [string]$n.description } else { '' }
        existing_interpretations = Get-ExistingInterp $n
    }
    $entry = [ordered]@{ id = [string]$n.id; label = [string]$n.label; class = $cls; ok = $false }
    try {
        $res = Invoke-AIByUsage -UsageId 'enrichment.situation-bdi-decomposition' -Values $values
        $txt = [string]$res.Text
        $txt = $txt -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
        $parsed = $txt | ConvertFrom-Json
        if (Test-Valid $parsed) {
            $entry.ok = $true
            $entry.interpretations = $parsed
            $ok++
        } else {
            $entry.error = 'schema validation failed'
            $fail++
        }
    } catch {
        $entry.error = $_.Exception.Message
        $fail++
    }
    $staging[[string]$n.id] = $entry
    if ($i % 10 -eq 0) {
        Write-Host "  [$i/$(@($targets).Count)] ok=$ok fail=$fail" -ForegroundColor DarkGray
        $staging | ConvertTo-Json -Depth 8 | Set-Content -Path $stagePath -Encoding utf8NoBOM
    }
}
$staging | ConvertTo-Json -Depth 8 | Set-Content -Path $stagePath -Encoding utf8NoBOM
Write-Host "`n=== backfill staging complete: ok=$ok fail=$fail → $stagePath ===" -ForegroundColor Green
