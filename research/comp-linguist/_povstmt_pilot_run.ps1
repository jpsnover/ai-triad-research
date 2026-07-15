# t/1299 pilot: generate per-POV debate-register statements for 20 stratified situations.
# Staging-first (writes ONLY the sidecar staging file in research-artifacts; never touches situations.json).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module ./scripts/AITriad/AITriad.psm1 -Force *> $null

$sitPath  = 'C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\situations.json'
$outDir   = 'C:\Users\jsnov\repos\ai-triad-data\research-artifacts\comp-linguist\situation-statements'
$outPath  = Join-Path $outDir 'situation_statements.json'
$debates  = 'C:\Users\jsnov\repos\ai-triad-data\debates'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$doc = Get-Content $sitPath -Raw | ConvertFrom-Json
$eligible = @($doc.nodes | Where-Object {
    $desc = if ($_.PSObject.Properties['description']) { [string]$_.description } else { '' }
    if ($desc.Trim().ToUpper().StartsWith('[DEPRECATED]')) { return $false }
    $it = if ($_.PSObject.Properties['interpretations']) { $_.interpretations } else { $null }
    if ($null -eq $it) { return $false }
    foreach ($pov in 'accelerationist','safetyist','skeptic') {
        if (-not $it.PSObject.Properties[$pov]) { return $false }
        $p = $it.$pov
        if ($p -isnot [System.Management.Automation.PSCustomObject]) { return $false }
        if (-not $p.PSObject.Properties['belief'] -or [string]::IsNullOrWhiteSpace([string]$p.belief)) { return $false }
    }
    return $true
})
Write-Host "eligible decomposed situations: $(@($eligible).Count)" -ForegroundColor Cyan

# Stratify: 10 crux-linked ("hot", fault-line-adjacent per aggregated-cruxes.json) + 10 never-crux-linked ("tail")
$cruxPath = 'C:\Users\jsnov\repos\ai-triad-data\taxonomy\Origin\aggregated-cruxes.json'
$cruxDoc  = Get-Content $cruxPath -Raw | ConvertFrom-Json
$referenced = New-Object System.Collections.Generic.HashSet[string]
foreach ($c in @($cruxDoc.cruxes)) {
    $ids = if ($c.PSObject.Properties['linked_node_ids']) { $c.linked_node_ids } else { @() }
    foreach ($id in @($ids)) {
        if ([string]$id -like 'sit-*' -or [string]$id -like 'cc-*') { [void]$referenced.Add([string]$id) }
    }
}
Write-Host "crux-linked situations: $($referenced.Count)" -ForegroundColor Cyan
if ($referenced.Count -eq 0) { throw 'no crux-linked situations found — refusing to stratify against an empty hot set' }

# Resume: skip situations already staged ok
$already = New-Object System.Collections.Generic.HashSet[string]
if (Test-Path $outPath) {
    $prev = Get-Content $outPath -Raw | ConvertFrom-Json
    foreach ($p in $prev.PSObject.Properties) {
        if ($p.Name -ne '_provenance' -and $p.Value.PSObject.Properties['ok'] -and $p.Value.ok) { [void]$already.Add($p.Name) }
    }
}
Write-Host "already staged ok (will keep + skip): $($already.Count)" -ForegroundColor Cyan

$rng = [System.Random]::new(1299)
$priorHot  = @($already | Where-Object { $referenced.Contains([string]$_) }).Count
$priorTail = $already.Count - $priorHot
$hotNeeded  = [Math]::Max(0, 10 - $priorHot)
$tailNeeded = [Math]::Max(0, 10 - $priorTail)
$hot  = @($eligible | Where-Object { $referenced.Contains([string]$_.id) -and -not $already.Contains([string]$_.id) } | Sort-Object { $rng.Next() } | Select-Object -First $hotNeeded)
$tail = @($eligible | Where-Object { -not $referenced.Contains([string]$_.id) -and -not $already.Contains([string]$_.id) } | Sort-Object { $rng.Next() } | Select-Object -First $tailNeeded)
$pilot = @($hot) + @($tail)
Write-Host "prior kept: $priorHot hot + $priorTail tail | generating: $(@($hot).Count) hot + $(@($tail).Count) tail" -ForegroundColor Cyan

function Format-Interp($n) {
    $lines = foreach ($pov in 'accelerationist','safetyist','skeptic') {
        $p = $n.interpretations.$pov
        "$pov`: belief: $($p.belief) | desire: $($p.desire) | intention: $($p.intention)"
    }
    return ($lines -join "`n")
}
function Test-ValidStatements($obj) {
    foreach ($pov in 'accelerationist','safetyist','skeptic') {
        if (-not $obj.PSObject.Properties[$pov]) { return $false }
        $p = $obj.$pov
        foreach ($f in 'belief_statement','desire_statement','intention_statement') {
            if (-not $p.PSObject.Properties[$f] -or [string]::IsNullOrWhiteSpace([string]$p.$f)) { return $false }
            if (@(([string]$p.$f) -split '\s+').Count -gt 60) { return $false }  # 40-word target, 60 tolerance
        }
    }
    return $true
}

$staging = [ordered]@{
    _provenance = [ordered]@{
        ticket = 't/1299'; usage_id = 'enrichment.situation-pov-statements'
        generated_at = (Get-Date).ToString('o'); seed = 1299
        strata = 'hot=crux-linked(10), tail=never-crux-linked(10)'
    }
}
# carry forward prior ok entries (resume), relabeling stratum by the crux-linked criterion
if (Test-Path $outPath) {
    $prev = Get-Content $outPath -Raw | ConvertFrom-Json
    foreach ($p in $prev.PSObject.Properties) {
        if ($p.Name -ne '_provenance' -and $p.Value.PSObject.Properties['ok'] -and $p.Value.ok) {
            $entry = $p.Value
            $newStratum = if ($referenced.Contains($p.Name)) { 'hot' } else { 'tail' }
            $entry | Add-Member -NotePropertyName stratum -NotePropertyValue $newStratum -Force
            $staging[$p.Name] = $entry
        }
    }
}
$ok = 0; $fail = 0; $i = 0
foreach ($n in $pilot) {
    $i++
    $id = [string]$n.id
    $values = @{
        situation_id = $id
        label = [string]$n.label
        description = if ($n.PSObject.Properties['description']) { [string]$n.description } else { '' }
        bdi_interpretations = Format-Interp $n
    }
    try {
        $res = Invoke-AIByUsage -UsageId 'enrichment.situation-pov-statements' -Values $values
        if (-not $res.PSObject.Properties['Text']) { throw 'no Text (call failed)' }
        $txt = [string]$res.Text -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
        $parsed = $txt | ConvertFrom-Json
        if (Test-ValidStatements $parsed) {
            $staging[$id] = [ordered]@{ ok = $true; stratum = $(if ($referenced.Contains($id)) {'hot'} else {'tail'}); statements = $parsed }
            $ok++
        } else {
            $staging[$id] = [ordered]@{ ok = $false; error = 'schema/length validation failed' }; $fail++
        }
    } catch {
        $staging[$id] = [ordered]@{ ok = $false; error = $_.Exception.Message }; $fail++
    }
    Write-Host "  [$i/$(@($pilot).Count)] $id ok=$ok fail=$fail" -ForegroundColor DarkGray
    if ($i % 5 -eq 0) { $staging | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding utf8NoBOM }
}
$staging | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding utf8NoBOM
Write-Host "`n=== pilot complete: ok=$ok fail=$fail -> $outPath ===" -ForegroundColor Green
