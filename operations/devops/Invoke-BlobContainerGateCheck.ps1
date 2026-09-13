#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Post-deploy gate: verify all 8 blob containers exist and are accessible.
.DESCRIPTION
    Called by deploy-azure.yml after the Bicep deploy, before traffic switch,
    and by the test-powershell live-Azure probe. Discriminates a definitive
    RBAC denial (403 AuthorizationPermissionMismatch) from an ambiguous
    ContainerNotFound so on-call gets an actionable error. Every unresolved
    non-zero az exit blocks — retry changes WHEN we conclude failure, never
    WHETHER. (t/2718)

    Flakiness hardening (t/3461): `az storage container show --auth-mode login`
    MASKS a transient 403/throttle/token-propagation blip as ContainerNotFound,
    so a blip flips all containers to "not exist" at once and reds a blocking
    suite (2026-09-13 P1; p/331). Ambiguous/transient-class errors are now
    RETRIED with linear backoff; only a definitive RBAC denial fails fast (it
    won't self-heal, and fast failure is what on-call wants). A genuinely-missing
    container simply stays missing across all attempts and still blocks.
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
    ),
    # Bounded retry for transient-class errors (masked 403 / throttle / auth blip).
    # A real missing container or real RBAC loss does not self-heal across attempts.
    [int] $MaxAttempts = 3,
    # Linear backoff base (delay = base * attempt). Injectable → 0 in tests.
    [int] $RetryDelaySeconds = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Classify an az stderr string.
#   rbac-denied : definitive 403 (missing role) — DO NOT retry, fail fast.
#   notfound    : ContainerNotFound — AMBIGUOUS (real-missing OR masked transient
#                 403/throttle under --auth-mode login) — retry, then block if it persists.
#   transient   : AuthenticationFailed / throttle / server-busy / timeout — retry.
#   unknown     : unrecognized — retry (conservative) then block.
function Get-AzContainerErrorClass ([string] $AzStderr) {
    if ($AzStderr -match 'AuthorizationPermissionMismatch|does not have .+permission') {
        return 'rbac-denied'
    }
    if ($AzStderr -match 'ContainerNotFound|The specified container does not exist') {
        return 'notfound'
    }
    if ($AzStderr -match 'AuthenticationFailed|TooManyRequests|429|ServerBusy|503|Service Unavailable|timed out|timeout|temporarily') {
        return 'transient'
    }
    return 'unknown'
}

if ($Containers.Count -ne 8) {
    throw "Container list sync error: expected 8, got $($Containers.Count). Update deploy-azure.yml and main.bicep together."
}

$RetryableClasses = @('notfound', 'transient', 'unknown')

$Failed = @()
foreach ($c in $Containers) {
    $ok = $false
    $lastClass = 'unknown'
    $lastStderr = ''
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $azOutput = az storage container show --account-name $StorageAccount --name $c --auth-mode login --output none 2>&1
        if ($LASTEXITCODE -eq 0) {
            $ok = $true
            break
        }
        $lastStderr = ($azOutput | Out-String).Trim()
        $lastClass = Get-AzContainerErrorClass $lastStderr

        if ($lastClass -eq 'rbac-denied') {
            # Definitive 403 — a missing Storage Blob Data role. Won't self-heal;
            # fail fast so on-call fixes RBAC instead of waiting out retries.
            Write-Host "::error::RBAC DENIED on blob container '$c' — SP lacks a Storage Blob Data role on $StorageAccount (definitive 403 AuthorizationPermissionMismatch; NOT retried). Diagnose: az rest --method get --url https://management.azure.com/<sa-resource-id>/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&`$filter=atScope()"
            break
        }

        if (($attempt -lt $MaxAttempts) -and ($RetryableClasses -contains $lastClass)) {
            $delay = $RetryDelaySeconds * $attempt
            Write-Host "  [retry $attempt/$MaxAttempts] '$c' transient-class error ($lastClass) — retrying in ${delay}s. (ContainerNotFound under --auth-mode login can be a MASKED 403/throttle, not deletion.)"
            if ($delay -gt 0) { Start-Sleep -Seconds $delay }
            continue
        }
        break  # non-retryable, or attempts exhausted
    }

    if (-not $ok) {
        # Emit the final actionable error (retries exhausted or non-retryable).
        switch ($lastClass) {
            'rbac-denied' { }  # already emitted above (fail-fast branch)
            'notfound' {
                Write-Host "::error::Blob container '$c' unreadable after $MaxAttempts attempt(s) (storageAccount=$StorageAccount). az returned ContainerNotFound — under --auth-mode login this may be a MASKED 403/throttle that did NOT self-heal, NOT necessarily deletion. Verify SP role state (Storage Blob Data role on the SA) and container existence before assuming the container was deleted."
            }
            'transient' {
                Write-Host "::error::Blob container '$c' unreadable after $MaxAttempts attempt(s) — transient-class az error that did not clear (storageAccount=$StorageAccount): $lastStderr"
            }
            default {
                Write-Host "::error::Blob container '$c' check failed after $MaxAttempts attempt(s) — unexpected az error (storageAccount=$StorageAccount): $lastStderr"
            }
        }
        $Failed += $c  # Every unresolved container blocks (t/2718 must-hold)
    } else {
        Write-Host "  [OK] $c"
    }
}

if ($Failed.Count -gt 0) {
    throw "Post-deploy blob container check FAILED: $($Failed.Count) container(s) missing or inaccessible after retries — $($Failed -join ', ')"
}
Write-Host "All $($Containers.Count) blob containers verified."
