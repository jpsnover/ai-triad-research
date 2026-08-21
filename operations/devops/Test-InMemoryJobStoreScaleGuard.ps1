#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    CI gate: fails if maxReplicas > 1 while any in-memory job store is still in use.
.DESCRIPTION
    Reads deploy/azure/main.bicep and checks the taxonomy-editor maxReplicas value.
    Greps all *.ts files under taxonomy-editor/src/server/** for the @INMEMORY_JOB_STORE
    marker. If ANY file carries the marker and maxReplicas > 1, the gate fails — raising
    the replica count while any job store is per-process in-memory reinstates the t/2884
    cross-replica 404 race. When ALL marked stores are migrated to shared blob storage
    (t/2885), remove their @INMEMORY_JOB_STORE markers and this gate passes unconditionally.
.PARAMETER BicepPath
    Path to deploy/azure/main.bicep. Defaults to the canonical repo location.
.PARAMETER ServerDir
    Directory to search for @INMEMORY_JOB_STORE markers. Defaults to
    taxonomy-editor/src/server. All *.ts files are checked recursively.
#>
[CmdletBinding()]
param(
    [string] $BicepPath = "$PSScriptRoot/../../deploy/azure/main.bicep",
    [string] $ServerDir = "$PSScriptRoot/../../taxonomy-editor/src/server"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── 1. Check for in-memory store markers across all server files ───────────────
$markedFiles = @(Get-ChildItem -Path $ServerDir -Recurse -Filter '*.ts' |
    Where-Object { Select-String -Path $_.FullName -Pattern '@INMEMORY_JOB_STORE' -Quiet })

if ($markedFiles.Count -eq 0) {
    Write-Host "InMemoryJobStore scale guard: no @INMEMORY_JOB_STORE markers found in $ServerDir — all stores migrated. Gate passes unconditionally."
    return
}

# ── 2. Extract taxonomy-editor maxReplicas from main.bicep ────────────────────
# NOTE: the regex anchors on the literal string 'maxReplicas capped at 1' — that
# string is load-bearing for this gate (Gate Co-Location, t/2885). Rewording the
# cap comment in main.bicep requires updating the regex here.
$bicepContent = Get-Content -Path $BicepPath -Raw
$match = [regex]::Match($bicepContent, 'maxReplicas capped at 1[\s\S]*?maxReplicas:\s*(\d+)')
if (-not $match.Success) {
    throw "InMemoryJobStore scale guard: could not parse taxonomy-editor maxReplicas from $BicepPath. Ensure the t/2885 cap comment and maxReplicas line are present and intact."
}
$maxReplicas = [int]$match.Groups[1].Value

# ── 3. Enforce the invariant ──────────────────────────────────────────────────
if ($maxReplicas -gt 1) {
    $fileList = ($markedFiles | Select-Object -ExpandProperty Name) -join ', '
    Write-Host "::error::InMemoryJobStore scale guard FAILED: maxReplicas=$maxReplicas but @INMEMORY_JOB_STORE markers present in: $fileList"
    Write-Host "::error::Raising maxReplicas above 1 while any job store is per-process in-memory reinstates the cross-replica 404 race (POST on replica A, GET poll on replica B → 404)."
    Write-Host "::error::Migrate ALL marked stores to shared blob storage and remove their @INMEMORY_JOB_STORE markers before scaling out. See t/2885."
    throw "InMemoryJobStore scale guard FAILED: maxReplicas=$maxReplicas with in-memory stores still in use: $fileList"
}

Write-Host "InMemoryJobStore scale guard: maxReplicas=$maxReplicas, @INMEMORY_JOB_STORE present in $($markedFiles.Count) file(s) ($($markedFiles.Name -join ', ')) — invariant holds. Gate passes."
