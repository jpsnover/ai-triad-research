# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    One-shot migration to bring edges.json into the canonical 8-type vocabulary (t/1094).
.DESCRIPTION
    Reads taxonomy edges.json, applies Resolve-EdgeType to every edge:
      - Canonical (8 types) → kept as-is
      - MOTIVATES/COMPLEMENTS/ENABLES → reclassified to SUPPORTS, with dedup
        against the existing SUPPORTS source|target keyset
      - Everything else → dropped with a per-type tally

    Writes a backup (edges.json.pre-t1094.bak) before any modification, then
    emits the migrated edges.json + a structured migration log to stdout.
.PARAMETER WhatIf
    Dry-run: don't write anything; just report what would happen.
.EXAMPLE
    pwsh -File scripts/archive/Invoke-EdgeMigration-t1094.ps1
.EXAMPLE
    pwsh -File scripts/archive/Invoke-EdgeMigration-t1094.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ModulePath = Join-Path $PSScriptRoot '..' 'AITriad' 'AITriad.psm1'
Import-Module $ModulePath -Force -WarningAction SilentlyContinue

$TaxDir    = & (Get-Module AITriad) { Get-TaxonomyDir }
$EdgesPath = Join-Path $TaxDir 'edges.json'
$BackupPath = "$EdgesPath.pre-t1094.bak"

if (-not (Test-Path $EdgesPath)) {
    throw "edges.json not found at: $EdgesPath"
}

Write-Host '== Edge Migration t/1094 ==' -ForegroundColor Cyan
Write-Host ("  Source:  {0}" -f $EdgesPath)
Write-Host ("  Backup:  {0}" -f $BackupPath)
Write-Host ("  WhatIf:  {0}" -f $WhatIfPreference)
Write-Host ''

# ── Load ─────────────────────────────────────────────────
$Data = Get-Content -Raw $EdgesPath | ConvertFrom-Json
$Edges = @($Data.edges)
Write-Host ("  Loaded:  {0} edges" -f $Edges.Count) -ForegroundColor Gray

# ── Build SUPPORTS keyset for dedup (case-sensitive source|target) ──
$SupportsKeys = [System.Collections.Generic.HashSet[string]]::new()
foreach ($E in $Edges) {
    if ($E.type -eq 'SUPPORTS') {
        [void]$SupportsKeys.Add("$($E.source)|$($E.target)")
    }
}
Write-Host ("  Existing SUPPORTS edges: {0}" -f $SupportsKeys.Count) -ForegroundColor Gray

# ── Process every edge ───────────────────────────────────
$NewEdges      = [System.Collections.Generic.List[PSObject]]::new()
$AcceptedByType = @{}
$ReclassifiedByType = @{}
$DedupedByType = @{}
$DroppedByType = @{}

foreach ($Edge in $Edges) {
    $OrigType = if ($Edge.PSObject.Properties['type']) { [string]$Edge.type } else { '' }
    $Resolved = & (Get-Module AITriad) { param($t) Resolve-EdgeType -Type $t } $OrigType

    switch ($Resolved.Action) {
        'accept' {
            $NewEdges.Add($Edge)
            if (-not $AcceptedByType.ContainsKey($OrigType)) { $AcceptedByType[$OrigType] = 0 }
            $AcceptedByType[$OrigType]++
        }
        'reclassify' {
            $Key = "$($Edge.source)|$($Edge.target)"
            if ($SupportsKeys.Contains($Key)) {
                if (-not $DedupedByType.ContainsKey($OrigType)) { $DedupedByType[$OrigType] = 0 }
                $DedupedByType[$OrigType]++
            } else {
                # Mutate the edge in place to the canonical type, then add
                $Edge.type = $Resolved.Type
                $NewEdges.Add($Edge)
                [void]$SupportsKeys.Add($Key)
                if (-not $ReclassifiedByType.ContainsKey($OrigType)) { $ReclassifiedByType[$OrigType] = 0 }
                $ReclassifiedByType[$OrigType]++
            }
        }
        'drop' {
            if (-not $DroppedByType.ContainsKey($OrigType)) { $DroppedByType[$OrigType] = 0 }
            $DroppedByType[$OrigType]++
        }
    }
}

# ── Report ───────────────────────────────────────────────
function Format-Bucket($map, $label, $color) {
    $total = ($map.Values | Measure-Object -Sum).Sum
    Write-Host ('  {0,-13} {1,6} edges across {2,3} types' -f $label, $total, $map.Count) -ForegroundColor $color
    foreach ($k in ($map.Keys | Sort-Object { -$map[$_] })) {
        Write-Host ('    {0,-30} {1,6}' -f $k, $map[$k]) -ForegroundColor DarkGray
    }
}

Write-Host ''
Write-Host '== Migration log ==' -ForegroundColor Cyan
Format-Bucket $AcceptedByType    'accepted'     'Green'
Write-Host ''
Format-Bucket $ReclassifiedByType 'reclassified' 'Yellow'
Write-Host ''
Format-Bucket $DedupedByType     'deduped'      'DarkYellow'
Write-Host ''
Format-Bucket $DroppedByType     'dropped'      'Red'
Write-Host ''
Write-Host ('  Before:  {0} edges' -f $Edges.Count)
Write-Host ('  After:   {0} edges  (delta {1:+#;-#;0})' -f $NewEdges.Count, ($NewEdges.Count - $Edges.Count)) -ForegroundColor Cyan
Write-Host ''

# ── Write (unless -WhatIf) ───────────────────────────────
if ($WhatIfPreference) {
    Write-Host 'WhatIf: not writing edges.json or backup.' -ForegroundColor Yellow
    return
}

# Backup
Copy-Item -Path $EdgesPath -Destination $BackupPath -Force
Write-Host ("Backup written: {0}" -f $BackupPath) -ForegroundColor Green

# Update last_modified + edges array, preserve everything else (including edge_types metadata)
$Data.edges = $NewEdges.ToArray()
if ($Data.PSObject.Properties['last_modified']) {
    $Data.last_modified = (Get-Date).ToString('yyyy-MM-dd')
}

$Json = $Data | ConvertTo-Json -Depth 20
Set-Content -Path $EdgesPath -Value $Json -Encoding utf8NoBOM
Write-Host ("edges.json written: {0} edges" -f $NewEdges.Count) -ForegroundColor Green
