# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    One-time migration: extracts discovery_log from edges.json into edge_discovery_log.json.
.DESCRIPTION
    Reads edges.json, writes the discovery_log array to a standalone edge_discovery_log.json,
    removes discovery_log from edges.json, and updates last_modified.
    Idempotent — skips if edges.json has no discovery_log key.
.PARAMETER TaxonomyDir
    Path to the taxonomy directory. Default: resolved via Get-TaxonomyDir.
.PARAMETER WhatIf
    Show what would happen without writing files.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaxonomyDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve taxonomy dir
if ([string]::IsNullOrWhiteSpace($TaxonomyDir)) {
    $RepoRoot = Split-Path $PSScriptRoot -Parent
    $ConfigPath = Join-Path $RepoRoot '.aitriad.json'
    if ($env:AI_TRIAD_DATA_ROOT) {
        $DataRoot = $env:AI_TRIAD_DATA_ROOT
    } elseif (Test-Path $ConfigPath) {
        $Config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
        $DataRoot = Join-Path $RepoRoot $Config.data_root
    } else {
        $DataRoot = Join-Path (Split-Path $RepoRoot -Parent) 'ai-triad-data'
    }
    $TaxonomyDir = Join-Path $DataRoot 'taxonomy' 'Origin'
}

$EdgesPath = Join-Path $TaxonomyDir 'edges.json'
$LogPath   = Join-Path $TaxonomyDir 'edge_discovery_log.json'

if (-not (Test-Path $EdgesPath)) {
    Write-Host "edges.json not found at $EdgesPath — nothing to migrate." -ForegroundColor Yellow
    exit 0
}

$EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json

if (-not $EdgesData.PSObject.Properties['discovery_log']) {
    Write-Host "edges.json has no discovery_log key — already migrated or never had one." -ForegroundColor Green
    exit 0
}

$LogEntries = @($EdgesData.discovery_log)
Write-Host "Found $($LogEntries.Count) discovery_log entries to extract." -ForegroundColor Cyan

# Write the standalone log file
if ($PSCmdlet.ShouldProcess($LogPath, "Write $($LogEntries.Count) log entries")) {
    $LogFile = [ordered]@{
        _schema_version = '1.0.0'
        _doc            = 'Edge discovery run log, extracted from edges.json. Written by Invoke-EdgeDiscovery.'
        last_modified   = (Get-Date).ToString('yyyy-MM-dd')
        entries         = $LogEntries
    }
    $LogFile | ConvertTo-Json -Depth 20 | Set-Content -Path $LogPath -Encoding utf8NoBOM
    Write-Host "Wrote $LogPath ($($LogEntries.Count) entries)" -ForegroundColor Green
}

# Remove discovery_log from edges.json and re-write
if ($PSCmdlet.ShouldProcess($EdgesPath, 'Remove discovery_log key and re-write')) {
    $EdgesData.PSObject.Properties.Remove('discovery_log')
    $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
    $EdgesData | ConvertTo-Json -Depth 20 | Set-Content -Path $EdgesPath -Encoding utf8NoBOM
    Write-Host "Updated edges.json (discovery_log removed)" -ForegroundColor Green
}

Write-Host "`nMigration complete." -ForegroundColor Cyan
