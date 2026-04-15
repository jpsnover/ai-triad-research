# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Migrates AI Triad data files from "cross-cutting" terminology to "situations".
.DESCRIPTION
    Phase 2 of the Situations migration. Handles:
    - File rename: cross-cutting.json → situations.json (via git mv)
    - JSON key rename: cross_cutting_refs → situation_refs (parsed JSON, NOT regex)
    - POV value changes: "cross-cutting" → "situations" in structured fields
    - Genus-differentia: "A cross-cutting concept that" → "A situation that"
    - NO free-text replacement (deferred to Phase 5)

    CRITICAL: cc- ID prefix is UNCHANGED. This script does NOT modify any cc- patterns.

    Features:
    - DryRun mode reports changes without writing
    - Atomic writes via .tmp + Move-Item
    - Pre-flight backup in _situations_migration_backup/
    - Migration manifest with byte deltas per file
    - Idempotent — safe to re-run
    - Deterministic file ordering (sorted by path)
    - Post-migration validation
.PARAMETER DataRoot
    Path to the data root directory. If omitted, uses -DataRoot parameter.
.PARAMETER DryRun
    Report what would change without writing any files.
.EXAMPLE
    ./Invoke-SituationsMigration.ps1 -DataRoot '../ai-triad-data' -DryRun
.EXAMPLE
    ./Invoke-SituationsMigration.ps1 -DataRoot '../ai-triad-data'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$DataRoot,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Import module + private helpers ───────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

try {
    Import-Module (Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1') -Force -ErrorAction Stop
}
catch {
    Write-Error "Failed to load AITriad module — $($_.Exception.Message)"
    return
}

. (Join-Path (Join-Path (Join-Path $ScriptDir 'AITriad') 'Private') 'New-ActionableError.ps1')

# ── Validate data root ────────────────────────────────────────────────────────
if (-not (Test-Path $DataRoot)) {
    New-ActionableError -Goal 'locate data root for Situations migration' `
        -Problem "Data root not found: $DataRoot" `
        -Location 'Invoke-SituationsMigration.ps1' `
        -NextSteps @(
            "Verify the path exists: Test-Path '$DataRoot'",
            'Pass the correct -DataRoot parameter'
        ) -Throw
}

$DataRoot = (Resolve-Path $DataRoot).Path
Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  SITUATIONS TERMINOLOGY MIGRATION" -ForegroundColor White
Write-Host "  Data root : $DataRoot" -ForegroundColor Gray
Write-Host "  Mode      : $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
Write-Host "  CRITICAL  : cc- ID prefix is UNCHANGED" -ForegroundColor Magenta
Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# ── Genus-differentia regex ───────────────────────────────────────────────────
# Lenient match per FM-7: "A cross-cutting concept/concern/theme/issue that"
$GenusRegex = 'A\s+cross-cutting\s+(concept|concern|theme|issue)\s+that'

# ── Helper: compute SHA256 checksum ───────────────────────────────────────────
function Get-FileChecksum {
    param([string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

# ── Helper: rename JSON key via parsed object (NOT regex) ─────────────────────
function Rename-JsonKey {
    <#
    .SYNOPSIS
        Renames a property on a PSCustomObject from OldName to NewName.
        Returns $true if a rename occurred, $false if not.
    #>
    param(
        [object]$Obj,
        [string]$OldName,
        [string]$NewName
    )

    if ($null -eq $Obj) { return $false }
    if (-not $Obj.PSObject.Properties[$OldName]) { return $false }
    if ($Obj.PSObject.Properties[$NewName]) { return $false }  # Already renamed

    $Value = $Obj.$OldName
    $Obj.PSObject.Properties.Remove($OldName)
    $Obj | Add-Member -NotePropertyName $NewName -NotePropertyValue $Value -Force
    return $true
}

# ── Helper: recursively rename cross_cutting_refs → situation_refs ────────────
function Update-KeyRenames {
    param(
        [object]$Obj,
        [ref]$Count
    )

    if ($null -eq $Obj) { return }

    if ($Obj -is [System.Management.Automation.PSCustomObject]) {
        # Rename the key on this object if present
        if (Rename-JsonKey -Obj $Obj -OldName 'cross_cutting_refs' -NewName 'situation_refs') {
            $Count.Value++
        }

        # Recurse into all properties
        foreach ($Prop in @($Obj.PSObject.Properties)) {
            if ($Prop.Value -is [System.Management.Automation.PSCustomObject] -or
                ($Prop.Value -is [System.Collections.IEnumerable] -and $Prop.Value -isnot [string])) {
                Update-KeyRenames -Obj $Prop.Value -Count $Count
            }
        }
    }
    elseif ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        foreach ($Item in $Obj) {
            Update-KeyRenames -Obj $Item -Count $Count
        }
    }
}

# ── Helper: replace POV values in structured fields ───────────────────────────
function Update-PovValues {
    <#
    .SYNOPSIS
        Replaces "cross-cutting" with "situations" in known structured POV fields.
        Does NOT do free-text replacement (deferred to Phase 5).
    #>
    param(
        [object]$Obj,
        [ref]$Count
    )

    if ($null -eq $Obj) { return }

    # Known POV field names in the data schema (scalar string fields)
    $PovFields = @('pov', 'suggested_pov', 'source_type', 'source_pov', 'target_pov', 'camp')
    # Known POV array fields
    $PovArrayFields = @('pov_tags', 'source_povs')

    if ($Obj -is [System.Management.Automation.PSCustomObject]) {
        foreach ($Prop in @($Obj.PSObject.Properties)) {
            if ($Prop.Name -in $PovFields -and $Prop.Value -is [string] -and $Prop.Value -eq 'cross-cutting') {
                $Prop.Value = 'situations'
                $Count.Value++
            }
            elseif ($Prop.Name -in $PovFields -and $Prop.Value -is [string] -and $Prop.Value -eq 'Cross-cutting') {
                $Prop.Value = 'Situations'
                $Count.Value++
            }
            elseif ($Prop.Name -eq 'category' -and $Prop.Value -is [string] -and $Prop.Value -eq 'Cross-cutting') {
                $Prop.Value = 'Situations'
                $Count.Value++
            }
            elseif ($Prop.Name -in $PovArrayFields -and $Prop.Value -is [System.Collections.IEnumerable] -and $Prop.Value -isnot [string]) {
                # Array field — replace element values
                $NewArr = @($Prop.Value | ForEach-Object {
                    if ($_ -eq 'cross-cutting') { $Count.Value++; 'situations' } else { $_ }
                })
                $Prop.Value = $NewArr
            }
            elseif ($Prop.Value -is [System.Management.Automation.PSCustomObject] -or
                    ($Prop.Value -is [System.Collections.IEnumerable] -and $Prop.Value -isnot [string])) {
                Update-PovValues -Obj $Prop.Value -Count $Count
            }
        }
    }
    elseif ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        foreach ($Item in $Obj) {
            Update-PovValues -Obj $Item -Count $Count
        }
    }
}

# ── Helper: update genus-differentia descriptions ─────────────────────────────
function Update-SituationsDescriptions {
    param(
        [object[]]$Nodes,
        [ref]$Count,
        [ref]$NonMatching
    )

    foreach ($Node in $Nodes) {
        if (-not $Node.PSObject.Properties['description'] -or -not $Node.description) { continue }

        $Desc = $Node.description

        if ($Desc -match $GenusRegex) {
            $NewDesc = $Desc -replace 'A\s+cross-cutting\s+(concept|concern|theme|issue)\s+that', 'A situation that'
            if ($NewDesc -ne $Desc) {
                $Node.description = $NewDesc
                $Count.Value++
            }
        }
        else {
            # Log non-matching descriptions for manual review
            $NonMatching.Value += "$($Node.id): $($Desc.Substring(0, [Math]::Min(80, $Desc.Length)))..."
        }
    }
}

# ── Collect files to process ──────────────────────────────────────────────────
Write-Host "  Collecting files..." -ForegroundColor Yellow

$FileSets = [ordered]@{}

# 1. Taxonomy — all POV files + situations/cross-cutting file + edges
$TaxDir = Join-Path (Join-Path $DataRoot 'taxonomy') 'Origin'
if (Test-Path $TaxDir) {
    $TaxFiles = @(Get-ChildItem -Path $TaxDir -Filter '*.json' -File |
        Where-Object { $_.Name -in @('accelerationist.json', 'safetyist.json', 'skeptic.json',
                                      'cross-cutting.json', 'situations.json', 'edges.json',
                                      'embeddings.json', 'policy_actions.json') } |
        Sort-Object FullName)
    if ($TaxFiles.Count -gt 0) { $FileSets['taxonomy'] = $TaxFiles }
}

# 2. Summaries
$SumDir = Join-Path $DataRoot 'summaries'
if (Test-Path $SumDir) {
    $SumFiles = @(Get-ChildItem -Path $SumDir -Filter '*.json' -File | Sort-Object FullName)
    if ($SumFiles.Count -gt 0) { $FileSets['summaries'] = $SumFiles }
}

# 3. Sources (metadata.json, analysis.json, etc.)
$SrcDir = Join-Path $DataRoot 'sources'
if (Test-Path $SrcDir) {
    $SrcFiles = @(Get-ChildItem -Path $SrcDir -Filter '*.json' -Recurse -File | Sort-Object FullName)
    if ($SrcFiles.Count -gt 0) { $FileSets['sources'] = $SrcFiles }
}

# 4. Conflicts
$ConDir = Join-Path $DataRoot 'conflicts'
if (Test-Path $ConDir) {
    $ConFiles = @(Get-ChildItem -Path $ConDir -Filter '*.json' -File | Sort-Object FullName)
    if ($ConFiles.Count -gt 0) { $FileSets['conflicts'] = $ConFiles }
}

# 5. Debates
$DebDir = Join-Path $DataRoot 'debates'
if (Test-Path $DebDir) {
    $DebFiles = @(Get-ChildItem -Path $DebDir -Filter '*.json' -File | Sort-Object FullName)
    if ($DebFiles.Count -gt 0) { $FileSets['debates'] = $DebFiles }
}

# 6. Harvests
$HarDir = Join-Path $DataRoot 'harvests'
if (Test-Path $HarDir) {
    $HarFiles = @(Get-ChildItem -Path $HarDir -Filter '*.json' -File | Sort-Object FullName)
    if ($HarFiles.Count -gt 0) { $FileSets['harvests'] = $HarFiles }
}

# 7. Proposals
$ProDir = Join-Path (Join-Path $DataRoot 'taxonomy') 'proposals'
if (Test-Path $ProDir) {
    $ProFiles = @(Get-ChildItem -Path $ProDir -Filter '*.json' -File | Sort-Object FullName)
    if ($ProFiles.Count -gt 0) { $FileSets['proposals'] = $ProFiles }
}

$TotalFiles = ($FileSets.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
Write-Host "  Found $TotalFiles files across $($FileSets.Count) directories`n" -ForegroundColor Gray

# ── Step 2A: File rename (git mv) ────────────────────────────────────────────
Write-Host "  Step 2A: File rename..." -ForegroundColor Yellow

$OldCCFile = Join-Path $TaxDir 'cross-cutting.json'
$NewSitFile = Join-Path $TaxDir 'situations.json'
$FileRenamed = $false

if (Test-Path $OldCCFile) {
    if ($DryRun) {
        Write-Host "    [DRY RUN] Would git mv cross-cutting.json → situations.json" -ForegroundColor Yellow
    }
    else {
        try {
            # Use git mv to preserve history
            Push-Location $DataRoot
            $GitResult = & git mv 'taxonomy/Origin/cross-cutting.json' 'taxonomy/Origin/situations.json' 2>&1
            Pop-Location

            if ($LASTEXITCODE -ne 0) {
                Write-Warning "    git mv failed ($GitResult), falling back to Move-Item"
                Move-Item -Path $OldCCFile -Destination $NewSitFile -Force
            }
            $FileRenamed = $true
            Write-Host "    Renamed cross-cutting.json → situations.json" -ForegroundColor Green
        }
        catch {
            New-ActionableError -Goal 'rename cross-cutting.json to situations.json' `
                -Problem $_.Exception.Message `
                -Location 'Invoke-SituationsMigration.ps1:Step2A' `
                -NextSteps @(
                    'Check if file is locked or in use',
                    'Verify git status in ai-triad-data',
                    'Try manually: git mv taxonomy/Origin/cross-cutting.json taxonomy/Origin/situations.json'
                ) -Throw
        }
    }
}
elseif (Test-Path $NewSitFile) {
    Write-Host "    Already renamed (situations.json exists)" -ForegroundColor Gray
    $FileRenamed = $true
}
else {
    Write-Warning "    Neither cross-cutting.json nor situations.json found!"
}

# Update the file list to reference the new name if renamed
if ($FileRenamed -and -not $DryRun) {
    # Re-collect taxonomy files since the name changed
    $TaxFiles = @(Get-ChildItem -Path $TaxDir -Filter '*.json' -File |
        Where-Object { $_.Name -in @('accelerationist.json', 'safetyist.json', 'skeptic.json',
                                      'situations.json', 'edges.json',
                                      'embeddings.json', 'policy_actions.json') } |
        Sort-Object FullName)
    $FileSets['taxonomy'] = $TaxFiles
}

# ── Backup (unless DryRun) ────────────────────────────────────────────────────
$BackupDir = Join-Path $DataRoot '_situations_migration_backup'

if (-not $DryRun) {
    Write-Host "`n  Creating backup in _situations_migration_backup/..." -ForegroundColor Yellow
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

# ── cc- prefix baseline (FM-4 safety check) ──────────────────────────────────
Write-Host "  Capturing cc- prefix baseline..." -ForegroundColor Yellow
$CcPrefixBaseline = 0
foreach ($SetName in $FileSets.Keys) {
    foreach ($File in $FileSets[$SetName]) {
        $Raw = Get-Content -Raw -Path $File.FullName -Encoding UTF8
        $CcPrefixBaseline += ([regex]::Matches($Raw, '"cc-')).Count
    }
}
Write-Host "    cc- prefix count: $CcPrefixBaseline (must not change)" -ForegroundColor Gray

# ── Process files ─────────────────────────────────────────────────────────────
$Manifest = [System.Collections.Generic.List[PSObject]]::new()
$TotalKeyRenames = 0
$TotalPovChanges = 0
$TotalGenusChanges = 0
$NonMatchingDescs = @()
$NonMatchingRef = [ref]$NonMatchingDescs
$FilesChanged = 0
$FilesSkipped = 0

Write-Host "`n  Step 2B-2D: Processing files..." -ForegroundColor Yellow

foreach ($SetName in $FileSets.Keys) {
    Write-Host "  Processing $SetName..." -ForegroundColor Yellow

    foreach ($File in $FileSets[$SetName]) {
        $RelPath = $File.FullName.Substring($DataRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
        $BeforeChecksum = Get-FileChecksum -Path $File.FullName
        $BeforeSize = (Get-Item $File.FullName).Length

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
                before_bytes    = $BeforeSize
                after_bytes     = $null
                byte_delta      = $null
                key_renames     = 0
                pov_changes     = 0
                genus_changes   = 0
            })
            continue
        }

        $KeyCount = [ref]0
        $PovCount = [ref]0
        $GenusCount = [ref]0

        # 2B: JSON key renames (cross_cutting_refs → situation_refs)
        Update-KeyRenames -Obj $Data -Count $KeyCount

        # 2C: POV value changes (structured fields only)
        Update-PovValues -Obj $Data -Count $PovCount

        # 2D: Genus-differentia updates (situations.json / cross-cutting.json only)
        $IsSituationsFile = $File.Name -in @('situations.json', 'cross-cutting.json')
        if ($IsSituationsFile -and $Data.PSObject.Properties['nodes']) {
            Update-SituationsDescriptions -Nodes $Data.nodes -Count $GenusCount -NonMatching $NonMatchingRef
            $NonMatchingDescs = $NonMatchingRef.Value
        }

        # Also update _doc field if present
        if ($IsSituationsFile -and $Data.PSObject.Properties['_doc']) {
            $DocVal = $Data._doc
            if ($DocVal -is [string] -and $DocVal -match 'cross-cutting') {
                $Data._doc = $DocVal -replace 'cross-cutting', 'situations'
                $PovCount.Value++
            }
        }

        $TotalChanges = $KeyCount.Value + $PovCount.Value + $GenusCount.Value

        if ($TotalChanges -eq 0) {
            $FilesSkipped++
            $Manifest.Add([PSCustomObject][ordered]@{
                file            = $RelPath
                status          = 'unchanged'
                error           = $null
                before_checksum = $BeforeChecksum
                after_checksum  = $BeforeChecksum
                before_bytes    = $BeforeSize
                after_bytes     = $BeforeSize
                byte_delta      = 0
                key_renames     = 0
                pov_changes     = 0
                genus_changes   = 0
            })
            continue
        }

        $TotalKeyRenames += $KeyCount.Value
        $TotalPovChanges += $PovCount.Value
        $TotalGenusChanges += $GenusCount.Value
        $FilesChanged++

        $NewJson = $Data | ConvertTo-Json -Depth 30

        if ($DryRun) {
            $EstBytesDelta = [System.Text.Encoding]::UTF8.GetByteCount($NewJson) - $BeforeSize
            Write-Verbose "  [DRY RUN] $RelPath — keys:$($KeyCount.Value) pov:$($PovCount.Value) genus:$($GenusCount.Value) delta:${EstBytesDelta}B"
            $Manifest.Add([PSCustomObject][ordered]@{
                file            = $RelPath
                status          = 'would_change'
                error           = $null
                before_checksum = $BeforeChecksum
                after_checksum  = '(dry run)'
                before_bytes    = $BeforeSize
                after_bytes     = $BeforeSize + $EstBytesDelta
                byte_delta      = $EstBytesDelta
                key_renames     = $KeyCount.Value
                pov_changes     = $PovCount.Value
                genus_changes   = $GenusCount.Value
            })
        }
        else {
            # Atomic write
            $TmpPath = "$($File.FullName).tmp"
            try {
                Write-Utf8NoBom -Path $TmpPath -Value $NewJson  -NoNewline
                Move-Item -Path $TmpPath -Destination $File.FullName -Force
                $AfterChecksum = Get-FileChecksum -Path $File.FullName
                $AfterSize = (Get-Item $File.FullName).Length

                $Manifest.Add([PSCustomObject][ordered]@{
                    file            = $RelPath
                    status          = 'migrated'
                    error           = $null
                    before_checksum = $BeforeChecksum
                    after_checksum  = $AfterChecksum
                    before_bytes    = $BeforeSize
                    after_bytes     = $AfterSize
                    byte_delta      = $AfterSize - $BeforeSize
                    key_renames     = $KeyCount.Value
                    pov_changes     = $PovCount.Value
                    genus_changes   = $GenusCount.Value
                })
            }
            catch {
                if (Test-Path $TmpPath) { Remove-Item -Path $TmpPath -Force -ErrorAction SilentlyContinue }
                Write-Warning "  Failed to write $RelPath — $($_.Exception.Message)"
                $Manifest.Add([PSCustomObject][ordered]@{
                    file            = $RelPath
                    status          = 'error'
                    error           = $_.Exception.Message
                    before_checksum = $BeforeChecksum
                    after_checksum  = $null
                    before_bytes    = $BeforeSize
                    after_bytes     = $null
                    byte_delta      = $null
                    key_renames     = $KeyCount.Value
                    pov_changes     = $PovCount.Value
                    genus_changes   = $GenusCount.Value
                })
            }
        }
    }
}

# ── Post-migration validation ─────────────────────────────────────────────────
Write-Host "`n  Running post-migration validation..." -ForegroundColor Yellow

$ValidationErrors = [System.Collections.Generic.List[string]]::new()

if (-not $DryRun) {
    # V1: Verify no cross_cutting_refs keys remain
    foreach ($SetName in $FileSets.Keys) {
        foreach ($File in $FileSets[$SetName]) {
            try {
                $Raw = Get-Content -Raw -Path $File.FullName
                if ($Raw -match '"cross_cutting_refs"') {
                    $ValidationErrors.Add("$($File.Name) — still contains 'cross_cutting_refs' key")
                }
            }
            catch { }
        }
    }

    # V2: Verify situations.json exists and cross-cutting.json is gone
    if (Test-Path $OldCCFile) {
        $ValidationErrors.Add("cross-cutting.json still exists (rename failed)")
    }
    if (-not (Test-Path $NewSitFile)) {
        $ValidationErrors.Add("situations.json does not exist")
    }

    # V3: cc- prefix count unchanged (FM-4)
    $CcPrefixAfter = 0
    foreach ($SetName in $FileSets.Keys) {
        foreach ($File in $FileSets[$SetName]) {
            try {
                $Raw = Get-Content -Raw -Path $File.FullName -Encoding UTF8
                $CcPrefixAfter += ([regex]::Matches($Raw, '"cc-')).Count
            }
            catch { }
        }
    }
    if ($CcPrefixAfter -ne $CcPrefixBaseline) {
        $ValidationErrors.Add("cc- prefix count changed: $CcPrefixBaseline → $CcPrefixAfter (MUST NOT CHANGE)")
    }
    else {
        Write-Host "    cc- prefix count: $CcPrefixAfter (unchanged — PASS)" -ForegroundColor Green
    }

    # V4: Verify no structured "cross-cutting" POV values remain in taxonomy
    if ($FileSets.Contains('taxonomy')) {
        foreach ($File in $FileSets['taxonomy']) {
            if ($File.Name -eq 'edges.json') { continue }
            try {
                $Data = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
                if ($Data.PSObject.Properties['nodes']) {
                    foreach ($Node in $Data.nodes) {
                        if ($Node.PSObject.Properties['cross_cutting_refs']) {
                            $ValidationErrors.Add("$($File.Name):$($Node.id) — still has 'cross_cutting_refs' property")
                        }
                    }
                }
            }
            catch { }
        }
    }
}

# ── Write manifest ────────────────────────────────────────────────────────────
$ManifestData = [ordered]@{
    migration           = 'Situations terminology migration (cross-cutting → situations)'
    executed_at         = (Get-Date).ToString('o')
    mode                = if ($DryRun) { 'dry_run' } else { 'live' }
    data_root           = $DataRoot
    file_renamed        = $FileRenamed
    total_files         = $TotalFiles
    files_changed       = $FilesChanged
    files_skipped       = $FilesSkipped
    total_key_renames   = $TotalKeyRenames
    total_pov_changes   = $TotalPovChanges
    total_genus_changes = $TotalGenusChanges
    cc_prefix_baseline  = $CcPrefixBaseline
    validation_errors   = @($ValidationErrors)
    non_matching_descriptions = @($NonMatchingDescs)
    files               = @($Manifest)
}

$ManifestPath = Join-Path $DataRoot '_situations_migration_manifest.json'
$ManifestJson = $ManifestData | ConvertTo-Json -Depth 10

if ($DryRun) {
    Write-Host "  [DRY RUN] Manifest would be written to: $ManifestPath" -ForegroundColor Yellow
}
else {
    try {
        Write-Utf8NoBom -Path $ManifestPath -Value $ManifestJson 
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
Write-Host "  File rename     : $(if ($FileRenamed) { 'cross-cutting.json → situations.json' } else { 'N/A' })" -ForegroundColor $(if ($FileRenamed) { 'Green' } else { 'Gray' })
Write-Host "  Files scanned   : $TotalFiles" -ForegroundColor Gray
Write-Host "  Files changed   : $FilesChanged" -ForegroundColor $(if ($FilesChanged -gt 0) { 'Green' } else { 'Gray' })
Write-Host "  Files unchanged : $FilesSkipped" -ForegroundColor Gray
Write-Host "  Key renames     : $TotalKeyRenames (cross_cutting_refs → situation_refs)" -ForegroundColor $(if ($TotalKeyRenames -gt 0) { 'Green' } else { 'Gray' })
Write-Host "  POV changes     : $TotalPovChanges" -ForegroundColor $(if ($TotalPovChanges -gt 0) { 'Green' } else { 'Gray' })
Write-Host "  Genus changes   : $TotalGenusChanges" -ForegroundColor $(if ($TotalGenusChanges -gt 0) { 'Green' } else { 'Gray' })
Write-Host "  cc- prefix      : $CcPrefixBaseline (UNCHANGED)" -ForegroundColor Magenta

# Byte deltas summary
$MigratedFiles = @($Manifest | Where-Object { $_.status -in @('migrated', 'would_change') -and $null -ne $_.byte_delta })
if ($MigratedFiles.Count -gt 0) {
    $TotalByteDelta = ($MigratedFiles | ForEach-Object { $_.byte_delta } | Measure-Object -Sum).Sum
    $AvgByteDelta = [Math]::Round($TotalByteDelta / $MigratedFiles.Count, 1)
    Write-Host "  Byte delta      : ${TotalByteDelta}B total (avg ${AvgByteDelta}B/file)" -ForegroundColor Gray
}

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
    Write-Host "`n  Validation: PASSED" -ForegroundColor Green
}

Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

return [PSCustomObject][ordered]@{
    Mode              = if ($DryRun) { 'dry_run' } else { 'live' }
    FileRenamed       = $FileRenamed
    TotalFiles        = $TotalFiles
    FilesChanged      = $FilesChanged
    FilesSkipped      = $FilesSkipped
    TotalKeyRenames   = $TotalKeyRenames
    TotalPovChanges   = $TotalPovChanges
    TotalGenusChanges = $TotalGenusChanges
    CcPrefixBaseline  = $CcPrefixBaseline
    ValidationErrors  = @($ValidationErrors)
    ManifestPath      = $ManifestPath
    NonMatchingDescs  = @($NonMatchingDescs)
}
