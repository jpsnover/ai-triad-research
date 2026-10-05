# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure predicate for the local CI-alert escalation bridge (t/3912).
.DESCRIPTION
    main-ci-monitor's CANNOT EVALUATE alert persisted 6 days as 29 "Still present" comments on one
    open issue (#2551) and reached no one: GitHub notifications for an idempotent update to a
    long-open issue are wallpaper. The workflow now latches ONE escalation per episode by labelling
    the issue `alert-escalated`. This predicate is the other half: it decides, from already-fetched
    state, what the hourly Orca reminder must surface to the DevOps agent — the only consumer that
    reliably acts.

    Two inputs, two failure shapes:
      - Escalated issues not yet acknowledged (no `owner-acked` label) -> act on each, once.
      - The monitor's heartbeat issue body not refreshed for > HeartbeatStaleHours -> the monitor
        itself is dead or broken BEFORE its own alert step (e.g. checkout or the probe step fails,
        or GitHub auto-disabled the schedule). The workflow cannot report its own death; only an
        outside reader can. This is the surviving vector named on t/3912.

    FAIL-SAFE: a missing heartbeat issue or an unparseable stamp is reported as stale, never as
    healthy — absence of proof of liveness is not liveness.

    PURE: no I/O. The gh calls live in Get-CiAlertEscalations.ps1.
#>

Set-StrictMode -Version Latest

function Get-CiAlertEscalationVerdict {
    [CmdletBinding()]
    param(
        # Open issues carrying the escalation label: objects with number, title, url, labels (string[]).
        [object[]] $EscalatedIssues = @(),
        # Body of the open main-ci-monitor heartbeat issue, or $null if none is open.
        [AllowNull()][AllowEmptyString()] [string] $HeartbeatBody,
        [Parameter(Mandatory)] [datetime] $Now,
        [double] $HeartbeatStaleHours = 12,
        [string] $AckLabel = 'owner-acked'
    )

    $unacked = @($EscalatedIssues | Where-Object { @($_.labels) -notcontains $AckLabel })

    $heartbeatAt = $null
    if ($HeartbeatBody -and $HeartbeatBody -match 'heartbeat:\s*([0-9T:.\-Z]+)') {
        $parsed = [datetime]::MinValue
        if ([datetime]::TryParse($Matches[1], [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal,
                [ref] $parsed)) {
            $heartbeatAt = $parsed
        }
    }

    if ($null -eq $heartbeatAt) {
        $ageHours = $null
        $stale = $true
        $heartbeatReason = if ($HeartbeatBody) { 'heartbeat stamp unparseable' } else { 'no open heartbeat issue' }
    } else {
        $ageHours = [math]::Round(($Now.ToUniversalTime() - $heartbeatAt).TotalHours, 1)
        $stale = $ageHours -gt $HeartbeatStaleHours
        $heartbeatReason = "last heartbeat ${ageHours}h ago (threshold ${HeartbeatStaleHours}h)"
    }

    [pscustomobject]@{
        UnackedEscalations = $unacked
        HeartbeatAt        = $heartbeatAt
        HeartbeatAgeHours  = $ageHours
        HeartbeatStale     = $stale
        HeartbeatReason    = $heartbeatReason
        ShouldAct          = ($unacked.Count -gt 0) -or $stale
    }
}
