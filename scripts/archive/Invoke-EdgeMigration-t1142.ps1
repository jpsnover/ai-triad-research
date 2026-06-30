# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    One-shot v2 edge-recovery migration (t/1142).
.DESCRIPTION
    Recovers ~553 edges from the t/1094 drop set, per CL audit (t/1134#1):

      Migration 1 — ADDRESSES → RESPONDS_TO (direction preserved, 532 edges)
      Migration 2 — SUPPORTED_BY → SUPPORTS reversed (A→B becomes B→A, ~24, ~21 net after dedup)

    Source for the dropped edges: edges.json.pre-t1094.bak (the backup the
    earlier migration preserved). Applied to the live edges.json. Backs up
    the live file before write.

    Routes every emitted edge through Resolve-EdgeType (t/1093 gate) so any
    future canonical-vocabulary drift is caught at the boundary.
.PARAMETER WhatIf
    Dry-run: report what would happen, don't write.
.EXAMPLE
    pwsh -File scripts/archive/Invoke-EdgeMigration-t1142.ps1 -WhatIf
.EXAMPLE
    pwsh -File scripts/archive/Invoke-EdgeMigration-t1142.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ModulePath = Join-Path $PSScriptRoot '..' 'AITriad' 'AITriad.psm1'
Import-Module $ModulePath -Force -WarningAction SilentlyContinue

$TaxDir       = & (Get-Module AITriad) { Get-TaxonomyDir }
$EdgesPath    = Join-Path $TaxDir 'edges.json'
$BackupSource = Join-Path $TaxDir 'edges.json.pre-t1094.bak'
$BackupTarget = Join-Path $TaxDir 'edges.json.pre-t1142.bak'

foreach ($p in @($EdgesPath, $BackupSource)) {
    if (-not (Test-Path $p)) { throw "Required file not found: $p" }
}

Write-Host '== Edge Recovery Migration t/1142 ==' -ForegroundColor Cyan
Write-Host ("  Current edges: {0}" -f $EdgesPath)
Write-Host ("  Source backup: {0}" -f $BackupSource)
Write-Host ("  Pre-write bak: {0}" -f $BackupTarget)
Write-Host ("  WhatIf:        {0}" -f $WhatIfPreference)
Write-Host ''

# ── Load both files ──────────────────────────────────────
$LiveData   = Get-Content -Raw $EdgesPath    | ConvertFrom-Json
$BackupData = Get-Content -Raw $BackupSource | ConvertFrom-Json
$LiveEdges  = @($LiveData.edges)
$BackupEdges = @($BackupData.edges)
Write-Host ("  Live edges:   {0}" -f $LiveEdges.Count)
Write-Host ("  Backup edges: {0}" -f $BackupEdges.Count)

# ── Build dedup keysets ──────────────────────────────────
# RESPONDS_TO keyset (source|target, directional)
$RespondsToKeys = [System.Collections.Generic.HashSet[string]]::new()
foreach ($E in $LiveEdges) {
    if ($E.type -eq 'RESPONDS_TO') {
        [void]$RespondsToKeys.Add("$($E.source)|$($E.target)")
    }
}
# SUPPORTS keyset (source|target, directional). For Migration 2 dedup we'll
# probe with the REVERSED key (target|source of the SUPPORTED_BY).
$SupportsKeys = [System.Collections.Generic.HashSet[string]]::new()
foreach ($E in $LiveEdges) {
    if ($E.type -eq 'SUPPORTS') {
        [void]$SupportsKeys.Add("$($E.source)|$($E.target)")
    }
}

# ── Locate candidates in backup ──────────────────────────
$AddressesCandidates  = @($BackupEdges | Where-Object { $_.type -eq 'ADDRESSES' })
$SupportedByCandidates = @($BackupEdges | Where-Object { $_.type -eq 'SUPPORTED_BY' })
Write-Host ''
Write-Host ("  ADDRESSES in backup:    {0}" -f $AddressesCandidates.Count)
Write-Host ("  SUPPORTED_BY in backup: {0}" -f $SupportedByCandidates.Count)

# ── Helper: build a recovered edge object with t1142 provenance ─
$Today = (Get-Date).ToString('yyyy-MM-dd')
function New-RecoveredEdge {
    param(
        [Parameter(Mandatory)][PSObject]$Original,
        [Parameter(Mandatory)][string]$NewType,
        [string]$NewSource,
        [string]$NewTarget
    )
    $src = if ($PSBoundParameters.ContainsKey('NewSource')) { $NewSource } else { $Original.source }
    $tgt = if ($PSBoundParameters.ContainsKey('NewTarget')) { $NewTarget } else { $Original.target }
    $obj = [ordered]@{
        source        = $src
        target        = $tgt
        type          = $NewType
        bidirectional = $false
        status        = 'proposed'
        discovered_at = $Today
        model         = 't1142-recovery'
    }
    # Preserve provenance fields where present on the original
    foreach ($f in 'rationale','confidence','weight','strength','notes') {
        if ($Original.PSObject.Properties[$f] -and $null -ne $Original.$f) {
            $obj[$f] = $Original.$f
        }
    }
    # Tag the original type for forensics
    $obj['recovered_from'] = $Original.type
    [PSCustomObject]$obj
}

# ── Migration 1: ADDRESSES → RESPONDS_TO ─────────────────
$M1_Recovered = [System.Collections.Generic.List[PSObject]]::new()
$M1_Deduped   = 0
$M1_GateDropped = 0
foreach ($Orig in $AddressesCandidates) {
    $Resolved = & (Get-Module AITriad) { param($t) Resolve-EdgeType -Type $t } 'RESPONDS_TO'
    if ($Resolved.Action -eq 'drop') { $M1_GateDropped++; continue }
    $Key = "$($Orig.source)|$($Orig.target)"
    if ($RespondsToKeys.Contains($Key)) {
        $M1_Deduped++
        continue
    }
    $M1_Recovered.Add((New-RecoveredEdge -Original $Orig -NewType $Resolved.Type))
    [void]$RespondsToKeys.Add($Key)
}

# ── Migration 2: SUPPORTED_BY → reversed SUPPORTS ────────
$M2_Recovered = [System.Collections.Generic.List[PSObject]]::new()
$M2_Deduped   = 0
$M2_SelfLoop  = 0
$M2_GateDropped = 0
foreach ($Orig in $SupportedByCandidates) {
    # Reverse: original A→B becomes B→A as SUPPORTS
    $NewSrc = $Orig.target
    $NewTgt = $Orig.source
    if ($NewSrc -eq $NewTgt) { $M2_SelfLoop++; continue }
    $Resolved = & (Get-Module AITriad) { param($t) Resolve-EdgeType -Type $t } 'SUPPORTS'
    if ($Resolved.Action -eq 'drop') { $M2_GateDropped++; continue }
    $Key = "$NewSrc|$NewTgt"
    if ($SupportsKeys.Contains($Key)) {
        $M2_Deduped++
        continue
    }
    $M2_Recovered.Add((New-RecoveredEdge -Original $Orig -NewType $Resolved.Type -NewSource $NewSrc -NewTarget $NewTgt))
    [void]$SupportsKeys.Add($Key)
}

# ── Report ───────────────────────────────────────────────
Write-Host ''
Write-Host '== Migration log ==' -ForegroundColor Cyan
Write-Host '  Migration 1 — ADDRESSES → RESPONDS_TO' -ForegroundColor White
Write-Host ('    Candidates: {0}' -f $AddressesCandidates.Count)
Write-Host ('    Recovered:  {0}' -f $M1_Recovered.Count) -ForegroundColor Green
Write-Host ('    Deduped:    {0}  (RESPONDS_TO source|target already present)' -f $M1_Deduped) -ForegroundColor DarkYellow
Write-Host ('    Gate-drop:  {0}  (Resolve-EdgeType rejected)' -f $M1_GateDropped) -ForegroundColor Red
Write-Host ''
Write-Host '  Migration 2 — SUPPORTED_BY → reversed SUPPORTS' -ForegroundColor White
Write-Host ('    Candidates: {0}' -f $SupportedByCandidates.Count)
Write-Host ('    Recovered:  {0}' -f $M2_Recovered.Count) -ForegroundColor Green
Write-Host ('    Deduped:    {0}  (reversed SUPPORTS already present)' -f $M2_Deduped) -ForegroundColor DarkYellow
Write-Host ('    Self-loop:  {0}' -f $M2_SelfLoop) -ForegroundColor Red
Write-Host ('    Gate-drop:  {0}' -f $M2_GateDropped) -ForegroundColor Red
Write-Host ''
Write-Host ('  Net recovery: {0} edges' -f ($M1_Recovered.Count + $M2_Recovered.Count)) -ForegroundColor Cyan
Write-Host ('  Live edges   {0}  →  {1}' -f $LiveEdges.Count, ($LiveEdges.Count + $M1_Recovered.Count + $M2_Recovered.Count))
Write-Host ''

if ($WhatIfPreference) {
    Write-Host 'WhatIf: no files written.' -ForegroundColor Yellow
    return
}

# ── Backup the live edges.json before write ─────────────
Copy-Item -Path $EdgesPath -Destination $BackupTarget -Force
Write-Host ('Backup written: {0}' -f $BackupTarget) -ForegroundColor Green

# ── Append recovered edges + write ───────────────────────
$Merged = [System.Collections.Generic.List[PSObject]]::new()
foreach ($E in $LiveEdges) { $Merged.Add($E) }
foreach ($E in $M1_Recovered) { $Merged.Add($E) }
foreach ($E in $M2_Recovered) { $Merged.Add($E) }
$LiveData.edges = $Merged.ToArray()
if ($LiveData.PSObject.Properties['last_modified']) {
    $LiveData.last_modified = $Today
}
$Json = $LiveData | ConvertTo-Json -Depth 20
Set-Content -Path $EdgesPath -Value $Json -Encoding utf8NoBOM
Write-Host ('edges.json written: {0} edges' -f $Merged.Count) -ForegroundColor Green
