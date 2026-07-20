# t/1306 resume: retry ONLY the staged entries that failed (transient network outage). Updates staging in place.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module ./scripts/AITriad/AITriad.psm1 -Force *> $null

$sitPath   = 'C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\situations.json'
$stagePath = 'C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\_bdi_backfill_staging.json'
$doc = Get-Content $sitPath -Raw | ConvertFrom-Json
$byId = @{}; foreach ($n in $doc.nodes) { $byId[[string]$n.id] = $n }
$staging = Get-Content $stagePath -Raw | ConvertFrom-Json

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

$failIds = @($staging.PSObject.Properties | Where-Object { -not $_.Value.ok } | ForEach-Object { $_.Name })
Write-Host "retrying $(@($failIds).Count) failed situations" -ForegroundColor Cyan
$ok = 0; $fail = 0; $i = 0
foreach ($id in $failIds) {
    $i++
    $n = $byId[$id]
    $values = @{
        situation_id = $id
        label = [string]$n.label
        description = if ($n.PSObject.Properties['description']) { [string]$n.description } else { '' }
        existing_interpretations = Get-ExistingInterp $n
    }
    try {
        $res = Invoke-AIByUsage -UsageId 'enrichment.situation-bdi-decomposition' -Values $values
        if (-not $res.PSObject.Properties['Text']) { throw 'no Text (call failed)' }
        $txt = [string]$res.Text -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
        $parsed = $txt | ConvertFrom-Json
        if (Test-Valid $parsed) {
            $staging.$id.ok = $true
            $staging.$id | Add-Member -NotePropertyName interpretations -NotePropertyValue $parsed -Force
            if ($staging.$id.PSObject.Properties['error']) { $staging.$id.PSObject.Properties.Remove('error') }
            $ok++
        } else { $staging.$id.error = 'schema validation failed'; $fail++ }
    } catch {
        $staging.$id.error = $_.Exception.Message; $fail++
    }
    if ($i % 10 -eq 0) {
        Write-Host "  [$i/$(@($failIds).Count)] ok=$ok fail=$fail" -ForegroundColor DarkGray
        $staging | ConvertTo-Json -Depth 8 | Set-Content -Path $stagePath -Encoding utf8NoBOM
    }
}
$staging | ConvertTo-Json -Depth 8 | Set-Content -Path $stagePath -Encoding utf8NoBOM
$totalOk = @($staging.PSObject.Properties | Where-Object { $_.Value.ok }).Count
Write-Host "`n=== resume complete: retried ok=$ok fail=$fail | total staged ok now: $totalOk ===" -ForegroundColor Green
