#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Post-deploy gate: verify all 8 blob containers exist and are accessible.
.DESCRIPTION
    Called by deploy-azure.yml after the Bicep deploy, before traffic switch.
    Discriminates ContainerNotFound (404) from RBAC failures (403) so on-call
    gets an actionable error rather than "container missing" for an auth regression.
    Every non-zero az exit code blocks — classification is diagnostic-only. (t/2718)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $StorageAccount,
    # SYNC WITH main.bicep: analyticsContainer, stagingAnalyticsContainer,
    # userContentContainer, stagingUserContentContainer, communityContainer,
    # stagingCommunityContainer, briefExportsContainer, stagingBriefExportsContainer.
    # Update both if a container is added or removed.
    [string[]] $Containers = @(
        'analytics', 'staging-analytics',
        'user-content', 'staging-user-content',
        'community', 'staging-community',
        'brief-exports', 'staging-brief-exports'
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AzContainerErrorClass ([string] $AzStderr) {
    if ($AzStderr -match 'ContainerNotFound|The specified container does not exist') {
        return 'missing'
    }
    if ($AzStderr -match 'AuthorizationPermissionMismatch|AuthenticationFailed|does not have .+permission') {
        return 'rbac'
    }
    return 'unknown'
}

if ($Containers.Count -ne 6) {
    throw "Container list sync error: expected 6, got $($Containers.Count). Update deploy-azure.yml and main.bicep together."
}

$Failed = @()
foreach ($c in $Containers) {
    $azOutput = az storage container show --account-name $StorageAccount --name $c --auth-mode login --output none 2>&1
    if ($LASTEXITCODE -ne 0) {
        $azStderr = ($azOutput | Out-String).Trim()
        switch (Get-AzContainerErrorClass $azStderr) {
            'missing' {
                Write-Host "::error::Blob container '$c' does not exist after Bicep deploy (storageAccount=$StorageAccount)"
            }
            'rbac' {
                Write-Host "::error::RBAC failure checking blob container '$c' — SP may lack Storage Blob Data Reader on $StorageAccount. Diagnose: az role assignment list --scope .../storageAccounts/$StorageAccount"
            }
            default {
                Write-Host "::error::Blob container '$c' check failed — unexpected az error (storageAccount=$StorageAccount): $azStderr"
            }
        }
        $Failed += $c  # Always: categorization is diagnostic-only — every non-zero exit blocks
    } else {
        Write-Host "  [OK] $c"
    }
}

if ($Failed.Count -gt 0) {
    throw "Post-deploy blob container check FAILED: $($Failed.Count) container(s) missing or inaccessible — $($Failed -join ', ')"
}
Write-Host "All $($Containers.Count) blob containers verified."
