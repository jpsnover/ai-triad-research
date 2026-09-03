# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure predicate for the deploy-drift gate (t/3278): is prod running a stale image?

.DESCRIPTION
    Decides whether to FIRE a "prod is behind main" alert, given the running image's
    build SHA reachability and how long shippable work has sat un-deployed. Kept as a
    pure function — no I/O — so the same logic the deploy-drift workflow runs is proven
    directly by Pester (Guard Testability, t/2971), the way Test-BootFlagEffective.ps1
    (t/3247) is shared between deploy-azure.yml and its test.

    Design constraints baked in per TL GV (t/3278#4):
      1. TIME-based, not commits-behind — a bare commit count false-fires on every normal
         deploy window. The trigger is: shippable work has sat un-deployed > N hours.
      2. "buildSha unreachable" is NOT drift — a failed /health probe (or an image that
         predates the BUILD_SHA marker) must never fire the stale-image alert; a broken
         probe is a distinct condition from a stale image (avoids the t/3110 vacuous-gate
         trap where the gate can't tell "healthy+current" from "can't tell").

.PARAMETER RunningBuildSha
    The build SHA the deployed image reports at /health (buildSha). Empty string, $null,
    or the sentinel 'unknown' all mean UNREACHABLE / unpopulated → never drift.

.PARAMETER UndeployedAgeHours
    Hours since the OLDEST un-deployed commit landed on main (now - commitDate of the first
    commit after RunningBuildSha on origin/main). <= 0 means prod == main HEAD (nothing
    un-deployed). The caller (workflow) computes this from git; the predicate only applies
    the threshold so both arms are unit-testable without a repo.

.PARAMETER ThresholdHours
    N — fire only when UndeployedAgeHours >= this. Default 24h. MUST exceed a normal
    build+deploy turnaround with margin so routine windows stay silent.

.OUTPUTS
    [pscustomobject] @{ Fire = [bool]; Reason = [string] }
      Fire=$true  reason 'stale:<age>h>=<N>h'
      Fire=$false reason 'unreachable' | 'current' | 'within-threshold'
#>
function Get-DeployDriftVerdict {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [AllowNull()]
        [string] $RunningBuildSha,

        [Parameter(Mandatory)]
        [double] $UndeployedAgeHours,

        [double] $ThresholdHours = 24
    )

    # Arm 1 (TL cond. 2): unreachable / unpopulated buildSha is NOT drift. A failed probe
    # or a pre-marker image can't testify to staleness — treat as "can't tell", never fire.
    $sha = if ($null -eq $RunningBuildSha) { '' } else { $RunningBuildSha.Trim() }
    if ($sha -eq '' -or $sha -eq 'unknown') {
        return [pscustomobject]@{ Fire = $false; Reason = 'unreachable' }
    }

    # Prod is current — nothing has landed on main past the deployed commit.
    if ($UndeployedAgeHours -le 0) {
        return [pscustomobject]@{ Fire = $false; Reason = 'current' }
    }

    # Un-deployed work exists but is younger than the threshold — a normal deploy window,
    # stay silent (TL cond. 1: time-based, don't false-fire on routine lag).
    if ($UndeployedAgeHours -lt $ThresholdHours) {
        return [pscustomobject]@{ Fire = $false; Reason = 'within-threshold' }
    }

    # Shippable work has sat un-deployed past the threshold → the silent-drift the gate exists
    # to surface (the #1872/#1877 stranding). FIRE.
    $age = [math]::Round($UndeployedAgeHours, 1)
    return [pscustomobject]@{ Fire = $true; Reason = "stale:${age}h>=${ThresholdHours}h" }
}
