# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Migrates AI Triad node IDs from legacy slugs to BDI/Situations-aligned names.
.DESCRIPTION
    Final migration — aligns ID slugs with current terminology:
      acc-goals-NNN → acc-desires-NNN    acc-data-NNN → acc-beliefs-NNN
      acc-methods-NNN → acc-intentions-NNN   (same for saf-, skp-)
      cc-NNN → sit-NNN

    Handles ~15,000 ID instances across ~1,800 files. Two replacement modes:
    (a) Parsed JSON for structured ID fields (id, source, target, parent_id, etc.)
    (b) Word-boundary regex for free-text fields (descriptions, rationale)

    Key features:
    - Builds deterministic ID map from taxonomy files (no collisions possible)
    - Re-keys embeddings.json object keys (preserves vectors exactly)
    - Atomic writes, backup, manifest with byte deltas and timing
    - Post-migration validation: counts, referential integrity, grep gate
    - DryRun gate before live execution
.PARAMETER DataRoot
    Path to the data root directory (ai-triad-data).
.PARAMETER DryRun
    Report what would change without writing any files.
.EXAMPLE
    ./Invoke-IdMigration.ps1 -DataRoot '../ai-triad-data' -DryRun
.EXAMPLE
    ./Invoke-IdMigration.ps1 -DataRoot '../ai-triad-data'
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
    New-ActionableError -Goal 'locate data root for ID migration' `
        -Problem "Data root not found: $DataRoot" `
        -Location 'Invoke-IdMigration.ps1' `
        -NextSteps @("Verify the path exists", 'Pass the correct -DataRoot parameter') -Throw
}

$DataRoot = (Resolve-Path $DataRoot).Path
Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  NODE ID SPACE MIGRATION" -ForegroundColor White
Write-Host "  Data root : $DataRoot" -ForegroundColor Gray
Write-Host "  Mode      : $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# ── Step 1: Build ID map from taxonomy files ──────────────────────────────────
Write-Host "  Building ID map from taxonomy..." -ForegroundColor Yellow

$TaxDir = Join-Path (Join-Path $DataRoot 'taxonomy') 'Origin'

# Slug mappings: old category slug → new category slug
$SlugMap = @{
    'goals'   = 'desires'
    'data'    = 'beliefs'
    'methods' = 'intentions'
}

$IdMap = [ordered]@{}  # old ID → new ID

# POV nodes: acc-goals-NNN → acc-desires-NNN, etc.
foreach ($PovFile in @('accelerationist.json', 'safetyist.json', 'skeptic.json')) {
    $FilePath = Join-Path $TaxDir $PovFile
    if (-not (Test-Path $FilePath)) { continue }
    $Data = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
    foreach ($Node in $Data.nodes) {
        $OldId = $Node.id
        # Match pattern: (acc|saf|skp)-(goals|data|methods)-NNN
        if ($OldId -match '^(acc|saf|skp)-(goals|data|methods)-(\d{3})$') {
            $Prefix = $Matches[1]
            $OldSlug = $Matches[2]
            $Num = $Matches[3]
            $NewSlug = $SlugMap[$OldSlug]
            $NewId = "$Prefix-$NewSlug-$Num"
            $IdMap[$OldId] = $NewId
        }
    }
}

# Situation nodes: cc-NNN → sit-NNN
$SitFile = Join-Path $TaxDir 'situations.json'
if (Test-Path $SitFile) {
    $SitData = Get-Content -Raw -Path $SitFile | ConvertFrom-Json
    foreach ($Node in $SitData.nodes) {
        $OldId = $Node.id
        if ($OldId -match '^cc-(\d{3})$') {
            $IdMap[$OldId] = "sit-$($Matches[1])"
        }
    }
}

Write-Host "    ID map: $($IdMap.Count) IDs to migrate" -ForegroundColor Gray

# Collision check
$NewIds = @($IdMap.Values)
$UniqueNew = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($NId in $NewIds) { [void]$UniqueNew.Add($NId) }
if ($UniqueNew.Count -ne $NewIds.Count) {
    New-ActionableError -Goal 'validate ID map' `
        -Problem "ID collision detected: $($NewIds.Count) mapped but only $($UniqueNew.Count) unique" `
        -Location 'Invoke-IdMigration.ps1:Step1' `
        -NextSteps @('Check for duplicate node IDs in taxonomy files') -Throw
}
Write-Host "    Collision check: PASS (all $($IdMap.Count) new IDs unique)" -ForegroundColor Green

# Build regex pattern for free-text replacement (FM-1: word-boundary mode)
# Sort by length descending to prevent partial matches (acc-goals-001 before acc-goals-00)
$SortedOldIds = @($IdMap.Keys | Sort-Object { $_.Length } -Descending)
$RegexPattern = '\b(' + (($SortedOldIds | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')\b'
$CompiledRegex = [regex]::new($RegexPattern, [System.Text.RegularExpressions.RegexOptions]::Compiled)

# ── Collect files ─────────────────────────────────────────────────────────────
Write-Host "  Collecting files..." -ForegroundColor Yellow

$FileSets = [ordered]@{}

# Taxonomy (all files including embeddings, edges, policy_actions)
if (Test-Path $TaxDir) {
    $TaxFiles = @(Get-ChildItem -Path $TaxDir -Filter '*.json' -File |
        Where-Object { $_.Name -notin @('_archived_edges.json', 'Temp.json') } |
        Sort-Object FullName)
    if ($TaxFiles.Count -gt 0) { $FileSets['taxonomy'] = $TaxFiles }
}

foreach ($DirInfo in @(
    @{ Name = 'summaries'; Dir = Join-Path $DataRoot 'summaries' }
    @{ Name = 'sources';   Dir = Join-Path $DataRoot 'sources' }
    @{ Name = 'conflicts'; Dir = Join-Path $DataRoot 'conflicts' }
    @{ Name = 'debates';   Dir = Join-Path $DataRoot 'debates' }
    @{ Name = 'harvests';  Dir = Join-Path $DataRoot 'harvests' }
    @{ Name = 'proposals'; Dir = Join-Path (Join-Path $DataRoot 'taxonomy') 'proposals' }
)) {
    if (Test-Path $DirInfo.Dir) {
        $Recurse = $DirInfo.Name -eq 'sources'
        $Files = @(Get-ChildItem -Path $DirInfo.Dir -Filter '*.json' -File -Recurse:$Recurse | Sort-Object FullName)
        if ($Files.Count -gt 0) { $FileSets[$DirInfo.Name] = $Files }
    }
}

$TotalFiles = ($FileSets.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
Write-Host "    Found $TotalFiles files across $($FileSets.Count) directories" -ForegroundColor Gray

# ── Helper: compute SHA256 ────────────────────────────────────────────────────
function Get-FileChecksum {
    param([string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

# ── Helper: replace IDs in all string values recursively (FM-1 dual mode) ─────
function Update-NodeIds {
    param(
        [object]$Obj,
        [ref]$Count
    )

    if ($null -eq $Obj) { return }

    if ($Obj -is [System.Management.Automation.PSCustomObject]) {
        foreach ($Prop in @($Obj.PSObject.Properties)) {
            if ($Prop.Value -is [string]) {
                # Try exact match first (structured fields)
                if ($IdMap.Contains($Prop.Value)) {
                    $Prop.Value = $IdMap[$Prop.Value]
                    $Count.Value++
                }
                else {
                    # Word-boundary regex for free-text (FM-1b)
                    $NewVal = $CompiledRegex.Replace($Prop.Value, { param($M) $IdMap[$M.Value] })
                    if ($NewVal -ne $Prop.Value) {
                        $MatchCount = $CompiledRegex.Matches($Prop.Value).Count
                        $Prop.Value = $NewVal
                        $Count.Value += $MatchCount
                    }
                }
            }
            elseif ($Prop.Value -is [System.Management.Automation.PSCustomObject] -or
                    ($Prop.Value -is [System.Collections.IEnumerable] -and $Prop.Value -isnot [string])) {
                Update-NodeIds -Obj $Prop.Value -Count $Count
            }
        }
    }
    elseif ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        # For arrays, need to replace element values directly
        if ($Obj -is [object[]]) {
            for ($i = 0; $i -lt $Obj.Count; $i++) {
                if ($Obj[$i] -is [string] -and $IdMap.Contains($Obj[$i])) {
                    $Obj[$i] = $IdMap[$Obj[$i]]
                    $Count.Value++
                }
                elseif ($Obj[$i] -is [string]) {
                    $NewVal = $CompiledRegex.Replace($Obj[$i], { param($M) $IdMap[$M.Value] })
                    if ($NewVal -ne $Obj[$i]) {
                        $MatchCount = $CompiledRegex.Matches($Obj[$i]).Count
                        $Obj[$i] = $NewVal
                        $Count.Value += $MatchCount
                    }
                }
                elseif ($null -ne $Obj[$i]) {
                    Update-NodeIds -Obj $Obj[$i] -Count $Count
                }
            }
        }
        else {
            foreach ($Item in $Obj) {
                Update-NodeIds -Obj $Item -Count $Count
            }
        }
    }
}

# ── Helper: re-key embeddings.json (FM-2) ─────────────────────────────────────
function Update-EmbeddingsKeys {
    param(
        [object]$Data,
        [ref]$Count
    )

    if (-not $Data.PSObject.Properties['nodes']) { return }

    $Nodes = $Data.nodes
    $KeysToRename = @($Nodes.PSObject.Properties | Where-Object { $IdMap.Contains($_.Name) })

    foreach ($Prop in $KeysToRename) {
        $OldKey = $Prop.Name
        $NewKey = $IdMap[$OldKey]
        $Value = $Prop.Value

        $Nodes.PSObject.Properties.Remove($OldKey)
        $Nodes | Add-Member -NotePropertyName $NewKey -NotePropertyValue $Value -Force
        $Count.Value++
    }
}

# ── Capture pre-migration counts ──────────────────────────────────────────────
Write-Host "  Capturing pre-migration counts..." -ForegroundColor Yellow

$PreCounts = [ordered]@{}

# Embeddings key count
$EmbPath = Join-Path $TaxDir 'embeddings.json'
if (Test-Path $EmbPath) {
    $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
    $PreCounts['embeddings_keys'] = @($EmbData.nodes.PSObject.Properties).Count
    $EmbData = $null  # Free memory
}

# Edge count
$EdgePath = Join-Path $TaxDir 'edges.json'
if (Test-Path $EdgePath) {
    $EdgeData = Get-Content -Raw -Path $EdgePath | ConvertFrom-Json
    $PreCounts['edge_count'] = @($EdgeData.edges).Count
    $EdgeData = $null
}

# Node count
$NodeCount = 0
foreach ($PovFile in @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json')) {
    $P = Join-Path $TaxDir $PovFile
    if (Test-Path $P) {
        $D = Get-Content -Raw -Path $P | ConvertFrom-Json
        $NodeCount += @($D.nodes).Count
        $D = $null
    }
}
$PreCounts['node_count'] = $NodeCount

Write-Host "    Nodes: $($PreCounts['node_count']), Edges: $($PreCounts['edge_count']), Embedding keys: $($PreCounts['embeddings_keys'])" -ForegroundColor Gray

# ── Backup ────────────────────────────────────────────────────────────────────
$BackupDir = Join-Path $DataRoot '_id_migration_backup'

if (-not $DryRun) {
    Write-Host "`n  Creating backup..." -ForegroundColor Yellow
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

# ── Process files ─────────────────────────────────────────────────────────────
$Manifest = [System.Collections.Generic.List[PSObject]]::new()
$TotalReplacements = 0
$FilesChanged = 0
$FilesSkipped = 0

Write-Host "  Processing files..." -ForegroundColor Yellow

foreach ($SetName in $FileSets.Keys) {
    Write-Host "  Processing $SetName..." -ForegroundColor Yellow

    foreach ($File in $FileSets[$SetName]) {
        $RelPath = $File.FullName.Substring($DataRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
        $BeforeChecksum = Get-FileChecksum -Path $File.FullName
        $BeforeSize = (Get-Item $File.FullName).Length
        $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

        try {
            $RawJson = Get-Content -Raw -Path $File.FullName -Encoding UTF8
            $Data = $RawJson | ConvertFrom-Json
        }
        catch {
            Write-Warning "  Skipping $RelPath — JSON parse failed: $($_.Exception.Message)"
            $Manifest.Add([PSCustomObject][ordered]@{
                file = $RelPath; status = 'error'; error = "Parse failed: $($_.Exception.Message)"
                before_checksum = $BeforeChecksum; after_checksum = $null
                before_bytes = $BeforeSize; after_bytes = $null; byte_delta = $null
                replacements = 0; elapsed_ms = $Stopwatch.ElapsedMilliseconds
            })
            continue
        }

        $ReplCount = [ref]0

        # Special handling for embeddings.json (FM-2: re-key, don't walk vectors)
        $IsEmbeddings = $File.Name -eq 'embeddings.json'
        if ($IsEmbeddings) {
            Update-EmbeddingsKeys -Data $Data -Count $ReplCount
            # Also update any metadata fields that contain IDs
            if ($Data.PSObject.Properties['nodes']) {
                foreach ($Prop in $Data.nodes.PSObject.Properties) {
                    $NodeObj = $Prop.Value
                    if ($NodeObj.PSObject.Properties['pov']) {
                        # Don't walk vectors — only update metadata strings
                        foreach ($MetaProp in @($NodeObj.PSObject.Properties)) {
                            if ($MetaProp.Name -eq 'vector') { continue }  # Skip vector arrays
                            if ($MetaProp.Value -is [string] -and $IdMap.Contains($MetaProp.Value)) {
                                $MetaProp.Value = $IdMap[$MetaProp.Value]
                                $ReplCount.Value++
                            }
                        }
                    }
                }
            }
        }
        else {
            Update-NodeIds -Obj $Data -Count $ReplCount
        }

        $Stopwatch.Stop()

        if ($ReplCount.Value -eq 0) {
            $FilesSkipped++
            $Manifest.Add([PSCustomObject][ordered]@{
                file = $RelPath; status = 'unchanged'; error = $null
                before_checksum = $BeforeChecksum; after_checksum = $BeforeChecksum
                before_bytes = $BeforeSize; after_bytes = $BeforeSize; byte_delta = 0
                replacements = 0; elapsed_ms = $Stopwatch.ElapsedMilliseconds
            })
            continue
        }

        $TotalReplacements += $ReplCount.Value
        $FilesChanged++

        $NewJson = $Data | ConvertTo-Json -Depth 30

        if ($DryRun) {
            $EstDelta = [System.Text.Encoding]::UTF8.GetByteCount($NewJson) - $BeforeSize
            $ElapsedMs = $Stopwatch.ElapsedMilliseconds
            Write-Verbose "  [DRY RUN] $RelPath — $($ReplCount.Value) replacements, delta:${EstDelta}B, ${ElapsedMs}ms"
            $Manifest.Add([PSCustomObject][ordered]@{
                file = $RelPath; status = 'would_change'; error = $null
                before_checksum = $BeforeChecksum; after_checksum = '(dry run)'
                before_bytes = $BeforeSize; after_bytes = $BeforeSize + $EstDelta; byte_delta = $EstDelta
                replacements = $ReplCount.Value; elapsed_ms = $Stopwatch.ElapsedMilliseconds
            })
        }
        else {
            $TmpPath = "$($File.FullName).tmp"
            try {
                Write-Utf8NoBom -Path $TmpPath -Value $NewJson  -NoNewline
                Move-Item -Path $TmpPath -Destination $File.FullName -Force
                $AfterChecksum = Get-FileChecksum -Path $File.FullName
                $AfterSize = (Get-Item $File.FullName).Length

                $Manifest.Add([PSCustomObject][ordered]@{
                    file = $RelPath; status = 'migrated'; error = $null
                    before_checksum = $BeforeChecksum; after_checksum = $AfterChecksum
                    before_bytes = $BeforeSize; after_bytes = $AfterSize; byte_delta = $AfterSize - $BeforeSize
                    replacements = $ReplCount.Value; elapsed_ms = $Stopwatch.ElapsedMilliseconds
                })
            }
            catch {
                if (Test-Path $TmpPath) { Remove-Item -Path $TmpPath -Force -ErrorAction SilentlyContinue }
                Write-Warning "  Failed to write $RelPath — $($_.Exception.Message)"
                $Manifest.Add([PSCustomObject][ordered]@{
                    file = $RelPath; status = 'error'; error = $_.Exception.Message
                    before_checksum = $BeforeChecksum; after_checksum = $null
                    before_bytes = $BeforeSize; after_bytes = $null; byte_delta = $null
                    replacements = $ReplCount.Value; elapsed_ms = $Stopwatch.ElapsedMilliseconds
                })
            }
        }
    }
}

# ── Post-migration validation ─────────────────────────────────────────────────
Write-Host "`n  Running post-migration validation..." -ForegroundColor Yellow

$ValidationErrors = [System.Collections.Generic.List[string]]::new()

if (-not $DryRun) {
    # V1: Counts unchanged
    $PostNodeCount = 0
    foreach ($PovFile in @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json')) {
        $P = Join-Path $TaxDir $PovFile
        if (Test-Path $P) {
            $D = Get-Content -Raw -Path $P | ConvertFrom-Json
            $PostNodeCount += @($D.nodes).Count; $D = $null
        }
    }
    if ($PostNodeCount -ne $PreCounts['node_count']) {
        $ValidationErrors.Add("Node count changed: $($PreCounts['node_count']) → $PostNodeCount")
    }
    else { Write-Host "    Node count: $PostNodeCount (unchanged)" -ForegroundColor Green }

    if (Test-Path $EdgePath) {
        $PostEdges = Get-Content -Raw -Path $EdgePath | ConvertFrom-Json
        $PostEdgeCount = @($PostEdges.edges).Count
        if ($PostEdgeCount -ne $PreCounts['edge_count']) {
            $ValidationErrors.Add("Edge count changed: $($PreCounts['edge_count']) → $PostEdgeCount")
        }
        else { Write-Host "    Edge count: $PostEdgeCount (unchanged)" -ForegroundColor Green }
        $PostEdges = $null
    }

    if (Test-Path $EmbPath) {
        $PostEmb = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
        $PostEmbKeys = @($PostEmb.nodes.PSObject.Properties).Count
        if ($PostEmbKeys -ne $PreCounts['embeddings_keys']) {
            $ValidationErrors.Add("Embeddings key count changed: $($PreCounts['embeddings_keys']) → $PostEmbKeys")
        }
        else { Write-Host "    Embeddings keys: $PostEmbKeys (unchanged)" -ForegroundColor Green }

        # FM-2: Spot-check 5 random vectors
        $AllKeys = @($PostEmb.nodes.PSObject.Properties.Name)
        $SpotKeys = $AllKeys | Get-Random -Count ([Math]::Min(5, $AllKeys.Count))
        $BackupEmb = Get-Content -Raw -Path (Join-Path (Join-Path (Join-Path $BackupDir 'taxonomy') 'Origin') 'embeddings.json') | ConvertFrom-Json
        foreach ($Key in $SpotKeys) {
            $NewVec = ($PostEmb.nodes.$Key.vector | ConvertTo-Json -Compress)
            # Find the old key
            $OldKey = $IdMap.Keys | Where-Object { $IdMap[$_] -eq $Key } | Select-Object -First 1
            if ($OldKey -and $BackupEmb.nodes.PSObject.Properties[$OldKey]) {
                $OldVec = ($BackupEmb.nodes.$OldKey.vector | ConvertTo-Json -Compress)
                if ($NewVec -ne $OldVec) {
                    $ValidationErrors.Add("Embeddings vector mismatch for $Key (was $OldKey)")
                }
            }
        }
        if ($ValidationErrors.Count -eq 0) {
            Write-Host "    Embeddings spot-check: 5 vectors match" -ForegroundColor Green
        }
        $PostEmb = $null; $BackupEmb = $null
    }

    # V2: File size deltas (flag >5%)
    $LargeDeltaFiles = @($Manifest | Where-Object {
        $_.status -eq 'migrated' -and $_.before_bytes -gt 0 -and
        [Math]::Abs($_.byte_delta) / $_.before_bytes -gt 0.05
    })
    if ($LargeDeltaFiles.Count -gt 0) {
        foreach ($F in $LargeDeltaFiles) {
            $Pct = [Math]::Round([Math]::Abs($F.byte_delta) / $F.before_bytes * 100, 1)
            $ValidationErrors.Add("$($F.file) — size delta $($F.byte_delta)B ($Pct%) exceeds 5% threshold")
        }
    }

    # V3: Zero remaining old IDs (grep gate)
    $OldIdPattern = '(acc|saf|skp)-(goals|data|methods)-\d{3}|"cc-\d{3}"'
    foreach ($SetName in $FileSets.Keys) {
        foreach ($File in $FileSets[$SetName]) {
            $Raw = Get-Content -Raw -Path $File.FullName
            if ($Raw -match $OldIdPattern) {
                $ValidationErrors.Add("$($File.Name) — still contains old-format IDs")
            }
        }
    }
    if ($ValidationErrors.Count -eq 0) {
        Write-Host "    Old ID grep: zero remaining" -ForegroundColor Green
    }

    # V4: Referential integrity
    $AllNewNodes = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($PovFile in @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json')) {
        $P = Join-Path $TaxDir $PovFile
        if (Test-Path $P) {
            $D = Get-Content -Raw -Path $P | ConvertFrom-Json
            foreach ($Node in $D.nodes) { [void]$AllNewNodes.Add($Node.id) }
            $D = $null
        }
    }

    # Check edges
    if (Test-Path $EdgePath) {
        $PostEdges = Get-Content -Raw -Path $EdgePath | ConvertFrom-Json
        $BrokenEdgeRefs = 0
        foreach ($Edge in $PostEdges.edges) {
            $SrcOk = $AllNewNodes.Contains($Edge.source) -or $Edge.source -match '^pol-'
            $TgtOk = $AllNewNodes.Contains($Edge.target) -or $Edge.target -match '^pol-'
            if (-not $SrcOk -or -not $TgtOk) { $BrokenEdgeRefs++ }
        }
        if ($BrokenEdgeRefs -gt 0) {
            $ValidationErrors.Add("$BrokenEdgeRefs edge(s) reference non-existent nodes")
        }
        else { Write-Host "    Edge ref integrity: PASS" -ForegroundColor Green }
        $PostEdges = $null
    }
}

# ── Write manifest ────────────────────────────────────────────────────────────
$ManifestData = [ordered]@{
    migration           = 'Node ID space migration (legacy slugs → BDI/Situations-aligned)'
    executed_at         = (Get-Date).ToString('o')
    mode                = if ($DryRun) { 'dry_run' } else { 'live' }
    data_root           = $DataRoot
    id_map_count        = $IdMap.Count
    total_files         = $TotalFiles
    files_changed       = $FilesChanged
    files_skipped       = $FilesSkipped
    total_replacements  = $TotalReplacements
    pre_counts          = $PreCounts
    validation_errors   = @($ValidationErrors)
    files               = @($Manifest)
}

$ManifestPath = Join-Path $DataRoot '_id_migration_manifest.json'
$ManifestJson = $ManifestData | ConvertTo-Json -Depth 10

if ($DryRun) {
    Write-Host "  [DRY RUN] Manifest would be written to: $ManifestPath" -ForegroundColor Yellow
}
else {
    try {
        Write-Utf8NoBom -Path $ManifestPath -Value $ManifestJson 
        Write-Host "  Manifest written: $ManifestPath" -ForegroundColor Green
    }
    catch { Write-Warning "  Failed to write manifest: $($_.Exception.Message)" }
}

# ── Timing report ─────────────────────────────────────────────────────────────
$SlowFiles = @($Manifest | Where-Object { $_.elapsed_ms -gt 30000 })

# ── Report ────────────────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  MIGRATION $(if ($DryRun) { 'PREVIEW' } else { 'COMPLETE' })" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  IDs mapped       : $($IdMap.Count)" -ForegroundColor Gray
Write-Host "  Files scanned    : $TotalFiles" -ForegroundColor Gray
Write-Host "  Files changed    : $FilesChanged" -ForegroundColor $(if ($FilesChanged -gt 0) { 'Green' } else { 'Gray' })
Write-Host "  Files unchanged  : $FilesSkipped" -ForegroundColor Gray
Write-Host "  Replacements     : $TotalReplacements" -ForegroundColor $(if ($TotalReplacements -gt 0) { 'Green' } else { 'Gray' })

$MigratedFiles = @($Manifest | Where-Object { $_.status -in @('migrated', 'would_change') -and $null -ne $_.byte_delta })
if ($MigratedFiles.Count -gt 0) {
    $TotalByteDelta = ($MigratedFiles | ForEach-Object { $_.byte_delta } | Measure-Object -Sum).Sum
    Write-Host "  Byte delta       : ${TotalByteDelta}B total" -ForegroundColor Gray
}

if ($SlowFiles.Count -gt 0) {
    Write-Host "`n  SLOW FILES (>30s):" -ForegroundColor Yellow
    foreach ($SF in $SlowFiles) {
        Write-Host "    $($SF.file): $([Math]::Round($SF.elapsed_ms / 1000, 1))s" -ForegroundColor Yellow
    }
}

$ErrorFiles = @($Manifest | Where-Object { $_.status -eq 'error' })
if ($ErrorFiles.Count -gt 0) {
    Write-Host "`n  ERRORS:" -ForegroundColor Red
    foreach ($Err in $ErrorFiles) {
        Write-Host "    $($Err.file): $($Err.error)" -ForegroundColor Red
    }
}

if ($ValidationErrors.Count -gt 0) {
    Write-Host "`n  VALIDATION ERRORS:" -ForegroundColor Red
    foreach ($VErr in $ValidationErrors) { Write-Host "    $VErr" -ForegroundColor Red }
}
elseif (-not $DryRun) {
    Write-Host "`n  Validation: PASSED" -ForegroundColor Green
}

Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

return [PSCustomObject][ordered]@{
    Mode              = if ($DryRun) { 'dry_run' } else { 'live' }
    IdMapCount        = $IdMap.Count
    TotalFiles        = $TotalFiles
    FilesChanged      = $FilesChanged
    FilesSkipped      = $FilesSkipped
    TotalReplacements = $TotalReplacements
    PreCounts         = $PreCounts
    ValidationErrors  = @($ValidationErrors)
    ManifestPath      = $ManifestPath
    SlowFiles         = @($SlowFiles | ForEach-Object { $_.file })
}
