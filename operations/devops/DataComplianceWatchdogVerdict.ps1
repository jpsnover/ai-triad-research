# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure predicate for the Orca-side reader of the data-compliance alert watchdog (t/4053, leg b).
.DESCRIPTION
    Data-compliance alerts (ai-triad-data issues labelled `data-compliance`) are routed by an Orca
    reminder (r/25 -> CL). Orca reminders coalesce missed fires and stop while the Orca host is down
    (t/4053#3/#5), so a GitHub-scheduled watchdog (ai-triad-data data-compliance-watchdog.yml, leg a)
    labels any alert left unrouted past its threshold `bridge-stale` and @-mentions the PI. This
    predicate is leg b: it decides, from already-fetched state, what DevOps' hourly r/23 must surface.

    Two failure shapes:
      - an open `bridge-stale` issue without `owner-acked`  -> an alert sat unrouted; route it to CL.
      - no SCHEDULED watchdog run concluded success within WatchdogStaleHours -> the watchdog itself is
        dead (schedule auto-disabled after 60 days idle, throttled, or broken before it can report).
        Only scheduled runs count: a manual dispatch proves the script works, not that the schedule
        still fires.

    FAIL-SAFE: no successful scheduled run at all is reported as stale, never as healthy.

    PURE: no I/O. The gh calls live in Get-DataComplianceWatchdog.ps1.
#>

Set-StrictMode -Version Latest

function Get-DataComplianceWatchdogVerdict {
    [CmdletBinding()]
    param(
        # Open data-compliance issues carrying `bridge-stale`: objects with number, title, url, labels (string[]).
        [object[]] $StaleIssues = @(),
        # Completion time (UTC) of the most recent SCHEDULED watchdog run that concluded success, or $null.
        [AllowNull()] [Nullable[datetime]] $LastScheduledSuccessAt,
        [Parameter(Mandatory)] [datetime] $Now,
        [double] $WatchdogStaleHours = 12,
        [string] $AckLabel = 'owner-acked'
    )

    $unrouted = @($StaleIssues | Where-Object { @($_.labels) -notcontains $AckLabel })

    if ($null -eq $LastScheduledSuccessAt) {
        $ageHours = $null
        $watchdogStale = $true
        $reason = 'no successful scheduled watchdog run found'
    } else {
        $ageHours = [math]::Round(($Now.ToUniversalTime() - ([datetime]$LastScheduledSuccessAt).ToUniversalTime()).TotalHours, 1)
        $watchdogStale = $ageHours -gt $WatchdogStaleHours
        $reason = "last successful scheduled watchdog run ${ageHours}h ago (threshold ${WatchdogStaleHours}h)"
    }

    [pscustomobject]@{
        UnroutedAlerts   = $unrouted
        WatchdogAgeHours = $ageHours
        WatchdogStale    = $watchdogStale
        WatchdogReason   = $reason
        ShouldAct        = ($unrouted.Count -gt 0) -or $watchdogStale
    }
}
