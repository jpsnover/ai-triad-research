# t/1507: generate canonical question_form for all aggregated cruxes.
# Staging-first: writes ONLY _cruxq_staging.json in CL scope; aggregated-cruxes.json untouched until CL review + merge.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module ./scripts/AITriad/AITriad.psm1 -Force *> $null

$cruxPath  = 'C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\aggregated-cruxes.json'
$stagePath = 'C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\_cruxq_staging.json'

$doc = Get-Content $cruxPath -Raw | ConvertFrom-Json
$cruxes = @($doc.cruxes)
if (@($cruxes).Count -eq 0) { throw 'no cruxes loaded — refusing to run against empty input' }
Write-Host "cruxes: $(@($cruxes).Count)" -ForegroundColor Cyan

# Resume: skip already-ok staged entries
$staging = [ordered]@{}
if (Test-Path $stagePath) {
    $prev = Get-Content $stagePath -Raw | ConvertFrom-Json
    foreach ($p in $prev.PSObject.Properties) {
        if ($p.Value.PSObject.Properties['ok'] -and $p.Value.ok) { $staging[$p.Name] = $p.Value }
    }
    Write-Host "resuming: $($staging.Count) already ok" -ForegroundColor Cyan
}

function Test-ValidQuestion([string]$q, [string]$stmt) {
    if ([string]::IsNullOrWhiteSpace($q)) { return $false }
    $q = $q.Trim()
    if (-not $q.EndsWith('?')) { return $false }
    if (@($q -split '\s+').Count -gt 45) { return $false }   # 35-word target, 45 tolerance
    if (($q -split '\?').Count -gt 2) { return $false }      # single question
    return $true
}

$ok = 0; $fail = 0; $i = 0
foreach ($c in $cruxes) {
    $i++
    $id = [string]$c.id
    if ($staging.Contains($id)) { continue }
    $stmt = [string]$c.statement
    if ([string]::IsNullOrWhiteSpace($stmt)) {
        $staging[$id] = [ordered]@{ ok = $false; error = 'empty statement' }; $fail++; continue
    }
    try {
        $res = Invoke-AIByUsage -UsageId 'enrichment.crux-question-form' -Values @{
            type = [string]$c.type; statement = $stmt
        }
        if (-not $res.PSObject.Properties['Text']) { throw 'no Text (call failed)' }
        $txt = [string]$res.Text -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
        $parsed = $txt | ConvertFrom-Json
        $q = if ($parsed.PSObject.Properties['question']) { [string]$parsed.question } else { '' }
        if (Test-ValidQuestion $q $stmt) {
            $staging[$id] = [ordered]@{ ok = $true; question_form = $q.Trim() }; $ok++
        } else {
            $staging[$id] = [ordered]@{ ok = $false; error = 'validation failed'; raw = $q }; $fail++
        }
    } catch {
        $staging[$id] = [ordered]@{ ok = $false; error = $_.Exception.Message }; $fail++
    }
    if ($i % 25 -eq 0) {
        Write-Host "  [$i/$(@($cruxes).Count)] ok=$ok fail=$fail" -ForegroundColor DarkGray
        $staging | ConvertTo-Json -Depth 4 | Set-Content -Path $stagePath -Encoding utf8NoBOM
    }
}
$staging | ConvertTo-Json -Depth 4 | Set-Content -Path $stagePath -Encoding utf8NoBOM
$totalOk = @($staging.GetEnumerator() | Where-Object { $_.Value.ok }).Count
Write-Host "`n=== crux question-form staging complete: this-run ok=$ok fail=$fail | total ok: $totalOk / $(@($cruxes).Count) ===" -ForegroundColor Green
