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

$BicepEnv = & (Join-Path $PSScriptRoot 'Get-BicepBaseEnv.ps1') -BicepPath $BicepPath
if ($BicepEnv.Count -eq 0) {
    Write-Error "Get-BicepBaseEnv.ps1 returned 0 entries — Bicep parse failed or baseEnv block is empty"
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
    $valProp = $e.PSObject.Properties['value']
    if ($null -ne $valProp) { $CurrentMap[$e.name] = $valProp.Value }
}

# Idempotency check — skip update if all literal keys already match
$Drifted = [System.Collections.Generic.List[string]]::new()
foreach ($key in $BicepEnv.Keys) {
    if ($CurrentMap[$key] -ne $BicepEnv[$key]) {
        $Drifted.Add("$key (was='$($CurrentMap[$key])', expected='$($BicepEnv[$key])')")
    }
}

if ($Drifted.Count -eq 0) {
    Write-Host "Staging baseEnv matches Bicep — no update needed"
    exit 0
}

Write-Host "Drift detected in $($Drifted.Count) key(s):"
$Drifted | ForEach-Object { Write-Host "  $_" }

if ($DryRun) {
    Write-Host "[DryRun] Would call: az containerapp update --set-env-vars ..."
    exit 2
}

# Synchronous (no --no-wait) so failures surface immediately and the following
# New-ContainerAppRevision inherits the updated template (t/2630 TL condition)
$EnvArgs = @($BicepEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
Write-Host "Syncing to Azure..."
az containerapp update --name $AppName -g $ResourceGroup --set-env-vars @EnvArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "az containerapp update failed (exit $LASTEXITCODE)"
    exit 1
}
Write-Host "Staging baseEnv synced successfully"
