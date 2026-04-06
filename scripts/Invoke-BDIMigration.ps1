# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Migrates AI Triad data files from old category/BDI terminology to standard BDI names.
.DESCRIPTION
    Phase 2 of the BDI terminology migration. Transforms category values
    (Data/Facts → Beliefs, Goals/Values → Desires, Methods/Arguments → Intentions)
    and bdi_layer values (value → desire, conceptual → intention) across all data files.

    Features:
    - DryRun mode reports changes without writing
    - Atomic writes via .tmp + Move-Item
    - Pre-flight backup in _bdi_migration_backup/
    - Migration manifest with before/after checksums
    - Idempotent — safe to re-run
    - Deterministic file ordering (sorted by path)
    - Post-migration validation
.PARAMETER DataRoot
    Path to the data root directory. If omitted, resolved via Resolve-DataPath.
.PARAMETER DryRun
    Report what would change without writing any files.
.EXAMPLE
    ./Invoke-BDIMigration.ps1 -DryRun
.EXAMPLE
    ./Invoke-BDIMigration.ps1 -Verbose
.EXAMPLE
    ./Invoke-BDIMigration.ps1 -DataRoot '../ai-triad-data'
#>
[CmdletBinding()]
param(
    [string]$DataRoot,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Import module for helpers ─────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModulePath = Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1'

try {
    Import-Module $ModulePath -Force -ErrorAction Stop
}
catch {
    Write-Error "Failed to load AITriad module from $ModulePath — $($_.Exception.Message)"
    return
}

# Dot-source private helpers not exported by the module
. (Join-Path (Join-Path (Join-Path $ScriptDir 'AITriad') 'Private') 'New-ActionableError.ps1')
. (Join-Path (Join-Path (Join-Path $ScriptDir 'AITriad') 'Private') 'Resolve-DataPath.ps1')

# ── Resolve data root ────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
    try {
        $DataRoot = Get-DataRoot
    }
    catch {
        New-ActionableError -Goal 'resolve data root for BDI migration' `
            -Problem "Could not resolve data root: $($_.Exception.Message)" `
            -Location 'Invoke-BDIMigration.ps1' `
            -NextSteps @(
                'Pass -DataRoot explicitly: ./Invoke-BDIMigration.ps1 -DataRoot ../ai-triad-data',
                'Set $env:AI_TRIAD_DATA_ROOT',
                'Ensure .aitriad.json exists in the repo root'
            ) -Throw
    }
}

if (-not (Test-Path $DataRoot)) {
    New-ActionableError -Goal 'locate data root for BDI migration' `
        -Problem "Data root not found: $DataRoot" `
        -Location 'Invoke-BDIMigration.ps1' `
        -NextSteps @(
            "Verify the path exists: Test-Path '$DataRoot'",
            'Pass the correct -DataRoot parameter'
        ) -Throw
}

$DataRoot = (Resolve-Path $DataRoot).Path
Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  BDI TERMINOLOGY MIGRATION" -ForegroundColor White
Write-Host "  Data root : $DataRoot" -ForegroundColor Gray
Write-Host "  Mode      : $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# ── Migration mappings ────────────────────────────────────────────────────────
$CategoryMap = @{
    'Data/Facts'         = 'Beliefs'
    'Goals/Values'       = 'Desires'
    'Methods/Arguments'  = 'Intentions'
}

$BdiLayerMap = @{
    'value'      = 'desire'
    'conceptual' = 'intention'
}

$OldCategories = @('Data/Facts', 'Goals/Values', 'Methods/Arguments')
$NewCategories = @('Beliefs', 'Desires', 'Intentions')

# Genus-differentia description regex — lenient match
# Matches: "A Goals/Values within", "A Data/Facts node", "A Methods/Arguments concept", etc.
$GenusRegex = 'A\s+(Goals/Values|Data/Facts|Methods/Arguments)\s+(within|node|concept)'

# ── Collect files to process ──────────────────────────────────────────────────
Write-Host "  Collecting files..." -ForegroundColor Yellow

$FileSets = [ordered]@{}

# 1. Taxonomy nodes — all POV files plus edges.json (rationale fields may reference categories)
$TaxDir = Join-Path (Join-Path $DataRoot 'taxonomy') 'Origin'
if (Test-Path $TaxDir) {
    $TaxFiles = @(Get-ChildItem -Path $TaxDir -Filter '*.json' -File |
        Where-Object { $_.Name -in @('accelerationist.json', 'safetyist.json', 'skeptic.json',
                                      'cross-cutting.json', 'edges.json') } |
        Sort-Object FullName)
    if ($TaxFiles.Count -gt 0) { $FileSets['taxonomy'] = $TaxFiles }
}

# 2. Summaries
$SumDir = Join-Path $DataRoot 'summaries'
if (Test-Path $SumDir) {
    $SumFiles = @(Get-ChildItem -Path $SumDir -Filter '*.json' -File | Sort-Object FullName)
    if ($SumFiles.Count -gt 0) { $FileSets['summaries'] = $SumFiles }
}

# 2b. Sources (analysis.json, debate outputs, etc.)
$SrcDir = Join-Path $DataRoot 'sources'
if (Test-Path $SrcDir) {
    $SrcFiles = @(Get-ChildItem -Path $SrcDir -Filter '*.json' -Recurse -File | Sort-Object FullName)
    if ($SrcFiles.Count -gt 0) { $FileSets['sources'] = $SrcFiles }
}

# 3. Conflicts
$ConDir = Join-Path $DataRoot 'conflicts'
if (Test-Path $ConDir) {
    $ConFiles = @(Get-ChildItem -Path $ConDir -Filter '*.json' -File | Sort-Object FullName)
    if ($ConFiles.Count -gt 0) { $FileSets['conflicts'] = $ConFiles }
}

# 4. Debates
$DebDir = Join-Path $DataRoot 'debates'
if (Test-Path $DebDir) {
    $DebFiles = @(Get-ChildItem -Path $DebDir -Filter '*.json' -File | Sort-Object FullName)
    if ($DebFiles.Count -gt 0) { $FileSets['debates'] = $DebFiles }
}

# 5. Harvests
$HarDir = Join-Path $DataRoot 'harvests'
if (Test-Path $HarDir) {
    $HarFiles = @(Get-ChildItem -Path $HarDir -Filter '*.json' -File | Sort-Object FullName)
    if ($HarFiles.Count -gt 0) { $FileSets['harvests'] = $HarFiles }
}

# 6. Proposals
$ProDir = Join-Path (Join-Path $DataRoot 'taxonomy') 'proposals'
if (Test-Path $ProDir) {
    $ProFiles = @(Get-ChildItem -Path $ProDir -Filter '*.json' -File | Sort-Object FullName)
    if ($ProFiles.Count -gt 0) { $FileSets['proposals'] = $ProFiles }
}

$TotalFiles = ($FileSets.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
Write-Host "  Found $TotalFiles files across $($FileSets.Count) directories`n" -ForegroundColor Gray

if ($TotalFiles -eq 0) {
    Write-Host "  No files to process. Exiting." -ForegroundColor Yellow
    return
}

# ── Backup (unless DryRun) ────────────────────────────────────────────────────
$BackupDir = Join-Path $DataRoot '_bdi_migration_backup'

if (-not $DryRun) {
    Write-Host "  Creating backup in _bdi_migration_backup/..." -ForegroundColor Yellow
    if (-not (Test-Path $BackupDir)) {
        $null = New-Item -Path $BackupDir -ItemType Directory -Force
    }

    foreach ($SetName in $FileSets.Keys) {
        foreach ($File in $FileSets[$SetName]) {
            $RelPath = $File.FullName.Substring($DataRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
            $BackupPath = Join-Path $BackupDir $RelPath
            $BackupParent = Split-Path -Parent $BackupPath
            if (-not (Test-Path $BackupParent)) {
                $null = New-Item -Path $BackupParent -ItemType Directory -Force
            }
            if (-not (Test-Path $BackupPath)) {
                Copy-Item -Path $File.FullName -Destination $BackupPath
            }
        }
    }
    Write-Host "  Backup complete`n" -ForegroundColor Green
}

# ── Helper: compute SHA256 checksum ───────────────────────────────────────────
function Get-FileChecksum {
    param([string]$Path)
    $Hash = Get-FileHash -Path $Path -Algorithm SHA256
    return $Hash.Hash
}

# ── Helper: replace category values in a parsed JSON object (recursive) ───────
function Update-CategoryValues {
    param(
        [object]$Obj,
        [hashtable]$Map,
        [ref]$Count
    )

    if ($null -eq $Obj) { return }

    if ($Obj -is [System.Management.Automation.PSCustomObject]) {
        foreach ($Prop in @($Obj.PSObject.Properties)) {
            if ($Prop.Name -eq 'category' -and $Prop.Value -is [string] -and $Map.ContainsKey($Prop.Value)) {
                $Prop.Value = $Map[$Prop.Value]
                $Count.Value++
            }
            elseif ($Prop.Name -eq 'suggestedCategory' -and $Prop.Value -is [string] -and $Map.ContainsKey($Prop.Value)) {
                $Prop.Value = $Map[$Prop.Value]
                $Count.Value++
            }
            elseif ($Prop.Name -eq 'suggested_category' -and $Prop.Value -is [string] -and $Map.ContainsKey($Prop.Value)) {
                $Prop.Value = $Map[$Prop.Value]
                $Count.Value++
            }
            elseif ($Prop.Name -eq 'bdi_layer' -and $Prop.Value -is [string] -and $BdiLayerMap.ContainsKey($Prop.Value)) {
                $Prop.Value = $BdiLayerMap[$Prop.Value]
                $Count.Value++
            }
            elseif ($Prop.Value -is [string]) {
                # Replace old category/bdi_layer names in any string value (free-text fields)
                $Changed = $false
                $NewVal = $Prop.Value
                foreach ($Old in $Map.Keys) {
                    if ($NewVal.Contains($Old)) {
                        $NewVal = $NewVal -replace [regex]::Escape($Old), $Map[$Old]
                        $Changed = $true
                    }
                }
                foreach ($Old in $BdiLayerMap.Keys) {
                    # Only replace bdi_layer values in exact-match contexts to avoid false positives
                    $BdiPattern = """$Old"""
                    if ($NewVal.Contains($BdiPattern)) {
                        $NewVal = $NewVal -replace [regex]::Escape($BdiPattern), """$($BdiLayerMap[$Old])"""
                        $Changed = $true
                    }
                }
                if ($Changed) {
                    $Prop.Value = $NewVal
                    $Count.Value++
                }
            }
            elseif ($Prop.Value -is [System.Management.Automation.PSCustomObject] -or $Prop.Value -is [System.Collections.IEnumerable]) {
                Update-CategoryValues -Obj $Prop.Value -Map $Map -Count $Count
            }
        }
    }
    elseif ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        foreach ($Item in $Obj) {
            Update-CategoryValues -Obj $Item -Map $Map -Count $Count
        }
    }
}

# ── Helper: update genus-differentia descriptions in taxonomy nodes ────────────
function Update-GenusDescriptions {
    param(
        [object[]]$Nodes,
        [ref]$Count,
        [ref]$NonMatching
    )

    foreach ($Node in $Nodes) {
        if (-not $Node.PSObject.Properties['description'] -or -not $Node.description) { continue }
        if (-not $Node.PSObject.Properties['category']) { continue }

        $Desc = $Node.description

        # Check if it matches genus-differentia pattern
        if ($Desc -match $GenusRegex) {
            $OldCat = $Matches[1]
            if ($CategoryMap.ContainsKey($OldCat)) {
                $NewCat = $CategoryMap[$OldCat]
                # Replace in the description text
                $NewDesc = $Desc -replace [regex]::Escape($OldCat), $NewCat
                if ($NewDesc -ne $Desc) {
                    $Node.description = $NewDesc
                    $Count.Value++
                }
            }
        }
        else {
            # Check if description contains old category names at all (non-genus pattern)
            $HasOldCat = $false
            foreach ($OldCat in $OldCategories) {
                if ($Desc -match [regex]::Escape($OldCat)) {
                    $HasOldCat = $true
                    # Still replace it
                    $Node.description = $Desc -replace [regex]::Escape($OldCat), $CategoryMap[$OldCat]
                    $Desc = $Node.description
                    $Count.Value++
                }
            }
            if (-not $HasOldCat) {
                # Description doesn't match genus-differentia and has no old categories
                # Log as non-matching for manual review (only if node has an old-style category that was migrated)
                $NonMatching.Value += "$($Node.id): $($Desc.Substring(0, [Math]::Min(80, $Desc.Length)))..."
            }
        }
    }
}

# ── Process files ─────────────────────────────────────────────────────────────
$Manifest = [System.Collections.Generic.List[PSObject]]::new()
$TotalReplacements = 0
$NonMatchingDescs = @()
$NonMatchingRef = [ref]$NonMatchingDescs
$FilesChanged = 0
$FilesSkipped = 0

foreach ($SetName in $FileSets.Keys) {
    Write-Host "  Processing $SetName..." -ForegroundColor Yellow

    foreach ($File in $FileSets[$SetName]) {
        $RelPath = $File.FullName.Substring($DataRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
        $BeforeChecksum = Get-FileChecksum -Path $File.FullName

        try {
            $RawJson = Get-Content -Raw -Path $File.FullName -Encoding UTF8
            $Data = $RawJson | ConvertFrom-Json
        }
        catch {
            Write-Warning "  Skipping $RelPath — JSON parse failed: $($_.Exception.Message)"
            $Manifest.Add([PSCustomObject][ordered]@{
                file            = $RelPath
                status          = 'error'
                error           = "JSON parse failed: $($_.Exception.Message)"
                before_checksum = $BeforeChecksum
                after_checksum  = $null
                replacements    = 0
            })
            continue
        }

        $ReplCount = [ref]0

        # Category + bdi_layer replacements (recursive)
        Update-CategoryValues -Obj $Data -Map $CategoryMap -Count $ReplCount

        # Genus-differentia description updates (taxonomy files only)
        if ($SetName -eq 'taxonomy' -and $Data.PSObject.Properties['nodes']) {
            Update-GenusDescriptions -Nodes $Data.nodes -Count $ReplCount -NonMatching $NonMatchingRef
            $NonMatchingDescs = $NonMatchingRef.Value
        }

        if ($ReplCount.Value -eq 0) {
            $FilesSkipped++
            $Manifest.Add([PSCustomObject][ordered]@{
                file            = $RelPath
                status          = 'unchanged'
                error           = $null
                before_checksum = $BeforeChecksum
                after_checksum  = $BeforeChecksum
                replacements    = 0
            })
            continue
        }

        $TotalReplacements += $ReplCount.Value
        $FilesChanged++

        # Serialize with consistent formatting
        $NewJson = $Data | ConvertTo-Json -Depth 30

        if ($DryRun) {
            Write-Verbose "  [DRY RUN] $RelPath — $($ReplCount.Value) replacements"
            $Manifest.Add([PSCustomObject][ordered]@{
                file            = $RelPath
                status          = 'would_change'
                error           = $null
                before_checksum = $BeforeChecksum
                after_checksum  = '(dry run)'
                replacements    = $ReplCount.Value
            })
        }
        else {
            # Atomic write: .tmp then move
            $TmpPath = "$($File.FullName).tmp"
            try {
                Set-Content -Path $TmpPath -Value $NewJson -Encoding UTF8 -NoNewline
                Move-Item -Path $TmpPath -Destination $File.FullName -Force
                $AfterChecksum = Get-FileChecksum -Path $File.FullName

                $Manifest.Add([PSCustomObject][ordered]@{
                    file            = $RelPath
                    status          = 'migrated'
                    error           = $null
                    before_checksum = $BeforeChecksum
                    after_checksum  = $AfterChecksum
                    replacements    = $ReplCount.Value
                })
            }
            catch {
                # Clean up .tmp on failure
                if (Test-Path $TmpPath) { Remove-Item -Path $TmpPath -Force -ErrorAction SilentlyContinue }
                Write-Warning "  Failed to write $RelPath — $($_.Exception.Message)"
                $Manifest.Add([PSCustomObject][ordered]@{
                    file            = $RelPath
                    status          = 'error'
                    error           = $_.Exception.Message
                    before_checksum = $BeforeChecksum
                    after_checksum  = $null
                    replacements    = $ReplCount.Value
                })
            }
        }
    }
}

# ── Post-migration validation ─────────────────────────────────────────────────
Write-Host "`n  Running post-migration validation..." -ForegroundColor Yellow

$ValidationErrors = [System.Collections.Generic.List[string]]::new()

if (-not $DryRun) {
    # Validate taxonomy files
    if ($FileSets.Contains('taxonomy')) {
        foreach ($File in $FileSets['taxonomy']) {
            try {
                $Data = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
                # Only validate nodes array for POV/CC files (edges.json has no nodes)
                if ($Data.PSObject.Properties['nodes']) {
                    foreach ($Node in $Data.nodes) {
                        if ($Node.PSObject.Properties['category'] -and $Node.category) {
                            if ($Node.category -in $OldCategories) {
                                $ValidationErrors.Add("$($File.Name):$($Node.id) — category still has old value '$($Node.category)'")
                            }
                            elseif ($Node.category -notin $NewCategories) {
                                $ValidationErrors.Add("$($File.Name):$($Node.id) — category has unexpected value '$($Node.category)'")
                            }
                        }
                    }
                }
            }
            catch {
                $ValidationErrors.Add("$($File.Name) — failed to re-read for validation: $($_.Exception.Message)")
            }
        }
    }

    # Validate debate files for bdi_layer
    if ($FileSets.Contains('debates')) {
        foreach ($File in $FileSets['debates']) {
            try {
                $Raw = Get-Content -Raw -Path $File.FullName
                if ($Raw -match '"bdi_layer"\s*:\s*"(value|conceptual)"') {
                    $ValidationErrors.Add("$($File.Name) — still contains old bdi_layer value '$($Matches[1])'")
                }
            }
            catch {
                $ValidationErrors.Add("$($File.Name) — failed to re-read for validation: $($_.Exception.Message)")
            }
        }
    }

    # Broad grep for any remaining old values across all migrated files
    foreach ($SetName in $FileSets.Keys) {
        foreach ($File in $FileSets[$SetName]) {
            try {
                $Raw = Get-Content -Raw -Path $File.FullName
                foreach ($OldCat in $OldCategories) {
                    if ($Raw -match [regex]::Escape($OldCat)) {
                        $ValidationErrors.Add("$($File.Name) — still contains '$OldCat'")
                    }
                }
            }
            catch { }
        }
    }
}

# ── Write manifest ────────────────────────────────────────────────────────────
$ManifestData = [ordered]@{
    migration       = 'BDI terminology migration'
    executed_at     = (Get-Date).ToString('o')
    mode            = if ($DryRun) { 'dry_run' } else { 'live' }
    data_root       = $DataRoot
    total_files     = $TotalFiles
    files_changed   = $FilesChanged
    files_skipped   = $FilesSkipped
    total_replacements = $TotalReplacements
    validation_errors  = @($ValidationErrors)
    non_matching_descriptions = @($NonMatchingDescs)
    files           = @($Manifest)
}

$ManifestPath = Join-Path $DataRoot '_bdi_migration_manifest.json'
$ManifestJson = $ManifestData | ConvertTo-Json -Depth 10

if ($DryRun) {
    Write-Host "  [DRY RUN] Manifest would be written to: $ManifestPath" -ForegroundColor Yellow
}
else {
    try {
        Set-Content -Path $ManifestPath -Value $ManifestJson -Encoding UTF8
        Write-Host "  Manifest written: $ManifestPath" -ForegroundColor Green
    }
    catch {
        Write-Warning "  Failed to write manifest: $($_.Exception.Message)"
    }
}

# ── Report ────────────────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  MIGRATION $(if ($DryRun) { 'PREVIEW' } else { 'COMPLETE' })" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Files scanned   : $TotalFiles" -ForegroundColor Gray
Write-Host "  Files changed   : $FilesChanged" -ForegroundColor $(if ($FilesChanged -gt 0) { 'Green' } else { 'Gray' })
Write-Host "  Files unchanged : $FilesSkipped" -ForegroundColor Gray
Write-Host "  Replacements    : $TotalReplacements" -ForegroundColor $(if ($TotalReplacements -gt 0) { 'Green' } else { 'Gray' })

$ErrorFiles = @($Manifest | Where-Object { $_.status -eq 'error' })
if ($ErrorFiles.Count -gt 0) {
    Write-Host "  Errors          : $($ErrorFiles.Count)" -ForegroundColor Red
    foreach ($Err in $ErrorFiles) {
        Write-Host "    $($Err.file): $($Err.error)" -ForegroundColor Red
    }
}

if ($NonMatchingDescs.Count -gt 0) {
    Write-Host "`n  Non-matching descriptions (manual review needed):" -ForegroundColor Yellow
    foreach ($Desc in $NonMatchingDescs) {
        Write-Host "    $Desc" -ForegroundColor DarkYellow
    }
}

if ($ValidationErrors.Count -gt 0) {
    Write-Host "`n  VALIDATION ERRORS:" -ForegroundColor Red
    foreach ($VErr in $ValidationErrors) {
        Write-Host "    $VErr" -ForegroundColor Red
    }
}
elseif (-not $DryRun) {
    Write-Host "`n  Validation: PASSED — zero old values remain" -ForegroundColor Green
}

Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# Return summary for pipeline use
return [PSCustomObject][ordered]@{
    Mode              = if ($DryRun) { 'dry_run' } else { 'live' }
    TotalFiles        = $TotalFiles
    FilesChanged      = $FilesChanged
    FilesSkipped      = $FilesSkipped
    TotalReplacements = $TotalReplacements
    ValidationErrors  = @($ValidationErrors)
    ManifestPath      = $ManifestPath
    NonMatchingDescs  = @($NonMatchingDescs)
}
