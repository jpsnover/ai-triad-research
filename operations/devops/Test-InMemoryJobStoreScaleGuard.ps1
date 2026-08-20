#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    CI gate: fails if maxReplicas > 1 while an in-memory job store is still in use.
.DESCRIPTION
    Reads deploy/azure/main.bicep and checks the taxonomy-editor maxReplicas value.
    Greps taxonomy-editor/src/server/briefExportJobs.ts for the @INMEMORY_JOB_STORE
    marker. If the marker is present and maxReplicas > 1, the gate fails — raising the
    replica count while the job store is per-process in-memory reinstates the t/2884
    cross-replica 404 race. When the store is migrated to shared blob storage (t/2885),
    remove the @INMEMORY_JOB_STORE marker and this gate passes unconditionally.
.PARAMETER BicepPath
    Path to deploy/azure/main.bicep. Defaults to the canonical repo location.
.PARAMETER JobStorePath
    Path to briefExportJobs.ts. Defaults to the canonical repo location.
#>
[CmdletBinding()]
param(
    [string] $BicepPath    = "$PSScriptRoot/../../deploy/azure/main.bicep",
    [string] $JobStorePath = "$PSScriptRoot/../../taxonomy-editor/src/server/briefExportJobs.ts"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── 1. Check for in-memory store marker ───────────────────────────────────────
$markerPresent = (Select-String -Path $JobStorePath -Pattern '@INMEMORY_JOB_STORE' -Quiet) -eq $true

if (-not $markerPresent) {
    Write-Host "InMemoryJobStore scale guard: @INMEMORY_JOB_STORE marker absent — store has been migrated to shared storage. Gate passes unconditionally."
    return
}

# ── 2. Extract taxonomy-editor maxReplicas from main.bicep ────────────────────
$bicepContent = Get-Content -Path $BicepPath -Raw

# The t/2885 cap comment immediately precedes the maxReplicas line — match across newlines.
$match = [regex]::Match($bicepContent, 'maxReplicas capped at 1[\s\S]*?maxReplicas:\s*(\d+)')
if (-not $match.Success) {
    throw "InMemoryJobStore scale guard: could not parse taxonomy-editor maxReplicas from $BicepPath. Ensure the t/2885 cap comment and maxReplicas line are present and intact."
}
$maxReplicas = [int]$match.Groups[1].Value

# ── 3. Enforce the invariant ──────────────────────────────────────────────────
if ($maxReplicas -gt 1) {
    Write-Host "::error::InMemoryJobStore scale guard FAILED: maxReplicas=$maxReplicas but @INMEMORY_JOB_STORE marker is present in briefExportJobs.ts."
    Write-Host "::error::Raising maxReplicas above 1 while the job store is per-process in-memory reinstates the t/2884 cross-replica 404 race (POST on replica A, GET poll on replica B → 404)."
    Write-Host "::error::Implement the blob-backed shared job store (t/2885) and remove @INMEMORY_JOB_STORE before scaling out."
    throw "InMemoryJobStore scale guard FAILED: maxReplicas=$maxReplicas with in-memory job store still in use."
}

Write-Host "InMemoryJobStore scale guard: maxReplicas=$maxReplicas, @INMEMORY_JOB_STORE present — invariant holds. Gate passes."
