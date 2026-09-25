# t/3673 BDI backfill → STAGING only (does NOT touch situations.json).
# Reuses UsageID 'enrichment.situation-bdi-decomposition' (no fork). Targets the FROZEN 7 ids.
# Modeled on the proven t/1306 backfill (_bdi_backfill_run.ps1).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module ./scripts/AITriad/AITriad.psm1 -Force *> $null

$sitPath   = 'C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\situations.json'
$frozenPath = 'C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\analyses\t3673\frozen-ids.json'
$stagePath = 'C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\analyses\t3673\staging.json'

$frozen = (Get-Content $frozenPath -Raw | ConvertFrom-Json).ids
$frozenSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($frozen))
Write-Host "frozen target ids: $($frozen -join ', ')" -ForegroundColor Cyan

$doc = Get-Content $sitPath -Raw | ConvertFrom-Json
$targets = @($doc.nodes | Where-Object { $_.PSObject.Properties['id'] -and $frozenSet.Contains([string]$_.id) })
Write-Host "matched nodes: $(@($targets).Count) (expected $($frozen.Count))" -ForegroundColor Cyan
if (@($targets).Count -ne $frozen.Count) { throw "Frozen/matched count mismatch — aborting." }

function Get-ExistingInterp($n) {
    $interp = if ($n.PSObject.Properties['interpretations']) { $n.interpretations } else { $null }
    if ($null -eq $interp) { return '(none)' }
    $parts = foreach ($pov in 'accelerationist','safetyist','skeptic') {
        $v = if ($interp.PSObject.Properties[$pov]) { $interp.$pov } else { $null }
        if ($v -is [string] -and -not [string]::IsNullOrWhiteSpace($v)) { "${pov}: $v" }
        elseif ($v -and $v.PSObject.Properties['summary'] -and -not [string]::IsNullOrWhiteSpace([string]$v.summary)) { "${pov}: $($v.summary)" }
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

$staging = [ordered]@{}
$ok = 0; $fail = 0; $i = 0
foreach ($n in $targets) {
    $i++
    $values = @{
        situation_id             = [string]$n.id
        label                    = [string]$n.label
        description              = if ($n.PSObject.Properties['description']) { [string]$n.description } else { '' }
        existing_interpretations = Get-ExistingInterp $n
    }
    $entry = [ordered]@{ id = [string]$n.id; label = [string]$n.label; ok = $false }
    try {
        $res = Invoke-AIByUsage -UsageId 'enrichment.situation-bdi-decomposition' -Values $values -FallbackModels 'gemini-3.5-flash-lite'
        $txt = [string]$res.Text
        $txt = $txt -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
        $parsed = $txt | ConvertFrom-Json
        if (Test-Valid $parsed) {
            $entry.ok = $true
            $entry.interpretations = $parsed
            $ok++
            Write-Host "  [$i/$($frozen.Count)] $($n.id) OK" -ForegroundColor DarkGray
        } else {
            $entry.error = 'schema validation failed'
            $fail++
            Write-Host "  [$i/$($frozen.Count)] $($n.id) FAIL schema" -ForegroundColor Yellow
        }
    } catch {
        $entry.error = $_.Exception.Message
        $fail++
        Write-Host "  [$i/$($frozen.Count)] $($n.id) FAIL $($_.Exception.Message)" -ForegroundColor Yellow
    }
    $staging[[string]$n.id] = $entry
}
$staging | ConvertTo-Json -Depth 8 | Set-Content -Path $stagePath -Encoding utf8NoBOM
Write-Host "`n=== staging complete: ok=$ok fail=$fail -> $stagePath ===" -ForegroundColor Green
