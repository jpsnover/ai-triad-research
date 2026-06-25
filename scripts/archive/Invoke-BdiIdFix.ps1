# Fix 5 taxonomy nodes with invalid BDI category IDs (t/120).
# Reuses Invoke-IdMigration.ps1's recursive replacement engine.

[CmdletBinding()]
param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
Import-Module (Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1') -Force -WarningAction SilentlyContinue

# Resolve data root from .aitriad.json (same logic as the module)
$ConfigPath = Join-Path $RepoRoot '.aitriad.json'
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$DataRoot = (Join-Path $RepoRoot $Config.data_root | Resolve-Path).Path
$TaxDir = Join-Path $DataRoot $Config.taxonomy_dir

Write-Host "`n== BDI ID Fix (t/120) ==" -ForegroundColor Cyan
Write-Host "  Mode: $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })

# ── Step 1: Determine next available IDs ──────────────────────────────────
function Get-NextId {
    param([string]$Prefix, [string]$PovName)
    $Max = 0
    foreach ($N in (Get-Tax -POV $PovName)) {
        if ($N.Id -like "$Prefix-*") {
            $Num = $N.Id -replace "^.*-(\d+)$", '$1'
            if ($Num -match '^\d+$' -and [int]$Num -gt $Max) { $Max = [int]$Num }
        }
    }
    return "$Prefix-$("{0:D3}" -f ($Max + 1))"
}

$IdMap = [ordered]@{}
$IdMap['saf-methods-001'] = Get-NextId 'saf-intentions' 'safetyist'
$IdMap['saf-methods-002'] = Get-NextId 'saf-intentions' 'safetyist'  # will be max+2 after first
# Recalculate: since we're computing sequentially, manually increment
$SafIntNext = 167  # from earlier check
$IdMap['saf-methods-001'] = "saf-intentions-$("{0:D3}" -f $SafIntNext)"
$IdMap['saf-methods-002'] = "saf-intentions-$("{0:D3}" -f ($SafIntNext + 1))"
$IdMap['saf-goals-001']   = "saf-desires-026"
$IdMap['skp-data-001']    = "skp-beliefs-184"
$IdMap['skp-data-002']    = "skp-beliefs-185"

# Verify no collisions with existing IDs
$AllNodes = Get-Tax
foreach ($NewId in $IdMap.Values) {
    $Existing = $AllNodes | Where-Object { $_.Id -eq $NewId }
    if ($Existing) {
        Write-Error "COLLISION: $NewId already exists ($($Existing.Label))"
        return
    }
}
Write-Host "  Collision check: PASS" -ForegroundColor Green

Write-Host "`n  ID Map:" -ForegroundColor Yellow
foreach ($Kv in $IdMap.GetEnumerator()) {
    Write-Host "    $($Kv.Key) → $($Kv.Value)" -ForegroundColor White
}

# ── Step 2: Build regex for word-boundary replacement ─────────────────────
$SortedOldIds = @($IdMap.Keys | Sort-Object { $_.Length } -Descending)
$RegexPattern = '\b(' + (($SortedOldIds | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')\b'
$CompiledRegex = [regex]::new($RegexPattern, [System.Text.RegularExpressions.RegexOptions]::Compiled)

# ── Step 3: Collect all JSON files to process ─────────────────────────────
$FilesToProcess = [System.Collections.Generic.List[System.IO.FileInfo]]::new()

# Taxonomy dir
foreach ($F in (Get-ChildItem $TaxDir -Filter '*.json' -File)) {
    if ($F.Name -in '_archived_edges.json') { continue }
    $FilesToProcess.Add($F)
}
# Summaries, sources, conflicts, debates, harvests
foreach ($SubDir in @('summaries', 'sources', 'conflicts', 'debates', 'harvests')) {
    $Dir = Join-Path $DataRoot $SubDir
    if (Test-Path $Dir) {
        foreach ($F in (Get-ChildItem $Dir -Filter '*.json' -File -Recurse)) {
            $FilesToProcess.Add($F)
        }
    }
}
# Calibration
$CalibDir = Join-Path $DataRoot 'calibration'
if (Test-Path $CalibDir) {
    foreach ($F in (Get-ChildItem $CalibDir -Filter '*.json' -File)) {
        $FilesToProcess.Add($F)
    }
}

Write-Host "`n  Files to scan: $($FilesToProcess.Count)" -ForegroundColor Gray

# ── Step 4: Process files ─────────────────────────────────────────────────
$TotalReplacements = 0
$FilesChanged = 0

foreach ($File in $FilesToProcess) {
    $Raw = Get-Content $File.FullName -Raw -Encoding UTF8

    # Quick check: does this file contain any old IDs?
    if ($Raw -notmatch $RegexPattern) { continue }

    $IsEmbeddings = $File.Name -eq 'embeddings.json'

    if ($IsEmbeddings) {
        # Re-key embeddings: parse, rename keys, serialize
        $Data = $Raw | ConvertFrom-Json
        $ReKeyed = 0
        foreach ($OldId in $IdMap.Keys) {
            if ($Data.nodes.PSObject.Properties[$OldId]) {
                $Vec = $Data.nodes.$OldId
                $Data.nodes.PSObject.Properties.Remove($OldId)
                $Data.nodes | Add-Member -NotePropertyName $IdMap[$OldId] -NotePropertyValue $Vec -Force
                $ReKeyed++
            }
        }
        # Also replace in metadata strings (but not vectors)
        foreach ($Prop in $Data.nodes.PSObject.Properties) {
            $NodeObj = $Prop.Value
            foreach ($MetaProp in @($NodeObj.PSObject.Properties)) {
                if ($MetaProp.Name -eq 'vector') { continue }
                if ($MetaProp.Value -is [string] -and $IdMap.Contains($MetaProp.Value)) {
                    $MetaProp.Value = $IdMap[$MetaProp.Value]
                    $ReKeyed++
                }
            }
        }
        if ($ReKeyed -gt 0) {
            $TotalReplacements += $ReKeyed
            $FilesChanged++
            if (-not $DryRun) {
                $Data | ConvertTo-Json -Depth 30 | Set-Content $File.FullName -Encoding UTF8
            }
            Write-Host "    $($File.Name): $ReKeyed re-keyed" -ForegroundColor Green
        }
    } else {
        # Text replacement with word boundaries
        $NewRaw = $CompiledRegex.Replace($Raw, { param($M) $IdMap[$M.Value] })
        $MatchCount = $CompiledRegex.Matches($Raw).Count
        if ($MatchCount -gt 0) {
            $TotalReplacements += $MatchCount
            $FilesChanged++
            if (-not $DryRun) {
                [System.IO.File]::WriteAllText($File.FullName, $NewRaw, [System.Text.UTF8Encoding]::new($false))
            }
            $RelPath = $File.FullName.Substring($DataRoot.Length + 1)
            Write-Host "    $RelPath : $MatchCount replacements" -ForegroundColor Green
        }
    }
}

# ── Step 5: Post-validation ───────────────────────────────────────────────
if (-not $DryRun) {
    Write-Host "`n  Validating..." -ForegroundColor Yellow

    # Reload and check the 5 nodes exist with new IDs
    Import-Module (Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    $Errors = 0
    foreach ($NewId in $IdMap.Values) {
        $N = Get-Tax -Id $NewId
        if (-not $N) { Write-Host "    MISSING: $NewId" -ForegroundColor Red; $Errors++ }
    }
    # Check no old IDs remain
    foreach ($OldId in $IdMap.Keys) {
        $N = Get-Tax -Id $OldId
        if ($N) { Write-Host "    STILL EXISTS: $OldId" -ForegroundColor Red; $Errors++ }
    }
    if ($Errors -eq 0) { Write-Host "    All 5 nodes renamed successfully" -ForegroundColor Green }

    # Grep gate: no old IDs in any file
    $StillPresent = 0
    foreach ($File in $FilesToProcess) {
        $Raw = Get-Content $File.FullName -Raw -Encoding UTF8
        if ($Raw -match $RegexPattern) { $StillPresent++; Write-Host "    OLD ID REMAINS: $($File.Name)" -ForegroundColor Red }
    }
    if ($StillPresent -eq 0) { Write-Host "    Grep gate: PASS (zero old IDs)" -ForegroundColor Green }
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host "`n== SUMMARY ==" -ForegroundColor Cyan
Write-Host "  Nodes renamed   : $($IdMap.Count)"
Write-Host "  Files changed   : $FilesChanged"
Write-Host "  Replacements    : $TotalReplacements"
if ($DryRun) { Write-Host "  (DRY RUN — no files written)" -ForegroundColor Yellow }
