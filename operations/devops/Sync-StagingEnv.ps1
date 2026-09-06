<#
.SYNOPSIS
    Syncs main.bicep baseEnv literal entries to the staging Container App
    env template. Idempotent — exits 0 with no-op if already in sync. (t/2630)

.PARAMETER MockCurrentEnvPath
    Testing only: path to a JSON file whose content replaces the az containerapp
    show query. Eliminates the real Azure call so tests run without credentials.

.PARAMETER DryRun
    Testing only: skip the az containerapp update call. Exits 2 if drift
    detected, 0 if in sync. Proves the drift-detection path without touching Azure.
#>
[CmdletBinding()]
Param(
    [string] $BicepPath,
    [string] $AppName         = 'taxonomy-editor-staging',
    [string] $ResourceGroup   = 'ai-triad',
    [string] $MockCurrentEnvPath,
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $BicepPath) {
    $BicepPath = Join-Path $PSScriptRoot '../../deploy/azure/main.bicep'
}

$isStaging = $AppName -like '*-staging*'
$getEnvArgs = @{ BicepPath = $BicepPath }
if ($isStaging) { $getEnvArgs['ForStaging'] = $true }
$BicepEnv = & (Join-Path $PSScriptRoot 'Get-BicepBaseEnv.ps1') @getEnvArgs
if ($BicepEnv.Count -eq 0) {
    Write-Error "Get-BicepBaseEnv.ps1 returned 0 entries — Bicep parse failed or baseEnv block is empty"
    exit 1
}

# Get full managed-name set (all key names bicep declares, including non-literal values)
# Used to safely scope orphan detection — a key absent from this set was removed from bicep. (t/3345)
$getEnvArgsNamesOnly = @{ BicepPath = $BicepPath; NamesOnly = $true }
if ($isStaging) { $getEnvArgsNamesOnly['ForStaging'] = $true }
$ManagedNames = & (Join-Path $PSScriptRoot 'Get-BicepBaseEnv.ps1') @getEnvArgsNamesOnly

# Fail-closed: NamesOnly must be a strict superset of the literal-value set.
# If it isn't, the bicep parse is broken — abort rather than risk mass-wiping env vars. (t/3345)
if ($null -eq $ManagedNames -or $ManagedNames.Count -eq 0 -or $ManagedNames.Count -lt $BicepEnv.Count) {
    Write-Error ("Get-BicepBaseEnv.ps1 -NamesOnly returned $($ManagedNames.Count) names but the " +
        "literal-value pass returned $($BicepEnv.Count) — NamesOnly must be a superset. " +
        "Aborting reconcile to prevent mass-wipe of env vars. (t/3345)")
    exit 1
}

# Get current staging env vars from the active template
if ($MockCurrentEnvPath) {
    $CurrentEnvJson = Get-Content $MockCurrentEnvPath | ConvertFrom-Json
} else {
    $CurrentEnvJson = az containerapp show --name $AppName -g $ResourceGroup `
        --query 'properties.template.containers[0].env' -o json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        Write-Error "az containerapp show failed (exit $LASTEXITCODE)"
        exit 1
    }
}

$CurrentMap = @{}
foreach ($e in @($CurrentEnvJson)) {
    # az returns secret-backed vars as {secretRef:'x', value:''} — skip them.
    # Filtering only on value-property presence misses this case (empty string passes).
    $secretRefProp = $e.PSObject.Properties['secretRef']
    if ($null -ne $secretRefProp -and $secretRefProp.Value -ne '') { continue }
    $valProp = $e.PSObject.Properties['value']
    if ($null -ne $valProp) { $CurrentMap[$e.name] = $valProp.Value }
}

# Workflow-injected keys set per-revision at deploy time — not bicep-managed.
# Exclude from orphan detection so they don't trigger false positives. (t/3345)
$WorkflowManagedKeys = @('DEPLOY_TAG', 'DEPLOY_SHA')

# Idempotency check — skip update if all literal keys already match
$Drifted = [System.Collections.Generic.List[string]]::new()
foreach ($key in $BicepEnv.Keys) {
    if ($CurrentMap[$key] -ne $BicepEnv[$key]) {
        $Drifted.Add("$key (was='$($CurrentMap[$key])', expected='$($BicepEnv[$key])')")
    }
}

# Orphan check: live app-template env keys absent from the full bicep managed set.
# A key removed from bicep but still in the live ACA template is stale standing-state. (t/3345)
$Orphans = @($CurrentMap.Keys | Where-Object { $_ -notin $ManagedNames -and $_ -notin $WorkflowManagedKeys })

if ($Drifted.Count -eq 0 -and $Orphans.Count -eq 0) {
    Write-Host "Staging baseEnv matches Bicep — no update needed"
    exit 0
}

if ($Drifted.Count -gt 0) {
    Write-Host "Drift detected in $($Drifted.Count) key(s):"
    $Drifted | ForEach-Object { Write-Host "  $_" }
}

# Phase-1 (t/3345): warn about orphaned keys; Phase-2 will auto-remove after TL GV.
if ($Orphans.Count -gt 0) {
    Write-Host ("::warning::Staging env has $($Orphans.Count) orphaned key(s) not in bicep managed set: " +
        "$($Orphans -join ', '). These were removed from bicep but persist in the live app template. " +
        "Unset manually until Phase-2 lands: " +
        "az containerapp update --name $AppName -g $ResourceGroup " +
        "--remove-env-vars $($Orphans -join ' ') (t/3345)")
}

if ($DryRun) {
    Write-Host "[DryRun] Would call: az containerapp update --set-env-vars ..."
    exit 2
}

# Synchronous (no --no-wait) so failures surface immediately and the following
# New-ContainerAppRevision inherits the updated template (t/2630 TL condition)
if ($Drifted.Count -gt 0) {
    $EnvArgs = @($BicepEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
    Write-Host "Syncing to Azure..."
    az containerapp update --name $AppName -g $ResourceGroup --set-env-vars @EnvArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "az containerapp update failed (exit $LASTEXITCODE)"
        exit 1
    }
    Write-Host "Staging baseEnv synced successfully"
}
if ($Orphans.Count -gt 0) {
    Write-Host ("Orphaned key(s) not removed (Phase-1 warn-only, pending Phase-2 TL GV): " +
        "$($Orphans -join ', ') (t/3345)")
}
