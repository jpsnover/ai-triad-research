# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure predicate for the G8b sweep-stall alert (t/3279): did a failed inline reconcile
    sit un-swept past the grace window?

.DESCRIPTION
    Models the correlation the Azure Monitor scheduledQueryRules `alert-grounding-sweep-stall`
    runs in KQL, so both arms are unit-provable offline (Guard Testability, t/2971) — the alert's
    real behavior only surfaces in deployed Azure Monitor, so PR CI can't exercise the KQL directly.
    Keep this logic in lockstep with the bicep query; the KQL is validated against real prod Log_s
    for ≥1 cycle before the alert is trusted (real-env-first, TL t/3279#2).

    Scoped to the REAL edge (TL GV t/3279#2), NOT bare sweep-absence: under minReplicas=0, no-sweep-
    while-cold is benign (cold ⇒ no writes ⇒ no failures ⇒ correctly silent). We fire only when a
    G8a inline reconcile FAILED (its `log.server.warn 'inline grounding reconcile failed'` reaches
    stdout → Log_s — condition 1, pre-verified) and NO `Grounding sweep complete` drained it within N.

.PARAMETER FailureAgeHours
    Hours since the most recent inline-reconcile failure. Negative (or the -1 sentinel) = NO failure
    in the window → never fire.

.PARAMETER SweptWithinWindow
    True iff a `Grounding sweep complete` occurred in [failureTime, failureTime + N] (the backlog was
    drained in time). When true, never fire regardless of age.

.PARAMETER ThresholdHours
    N — grace window. Fire only once N hours have ELAPSED since the failure with no intervening sweep.
    MUST exceed the 15-min sweep cadence with margin (default 2h) so one benign cold gap + warmth
    jitter can't trip it (condition 4). Co-located with the bicep query's `let N`.

.OUTPUTS
    [pscustomobject] @{ Fire = [bool]; Reason = [string] }
      Fire=$true  'stalled-backlog'
      Fire=$false 'no-failure' | 'swept' | 'window-not-elapsed'
#>
function Get-SweepStallVerdict {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [double] $FailureAgeHours,
        [Parameter(Mandatory)] [bool]   $SweptWithinWindow,
        [double] $ThresholdHours = 2
    )

    # No inline-reconcile failure in the window → nothing to be stale about (the benign-cold arm:
    # cold ⇒ no writes ⇒ no failure ⇒ correctly silent).
    if ($FailureAgeHours -lt 0) {
        return [pscustomobject]@{ Fire = $false; Reason = 'no-failure' }
    }

    # A sweep drained the backlog within the grace window — the primary/backstop path worked.
    if ($SweptWithinWindow) {
        return [pscustomobject]@{ Fire = $false; Reason = 'swept' }
    }

    # Grace period (condition 2): a failure whose N-hr window hasn't elapsed is NOT yet an alert —
    # its sweep may still come. Distinct silent arm.
    if ($FailureAgeHours -lt $ThresholdHours) {
        return [pscustomobject]@{ Fire = $false; Reason = 'window-not-elapsed' }
    }

    # Failed inline reconcile + no sweep within N + window elapsed → the failed-inline-then-cold
    # backlog is silently stale. FIRE (the whole reason G8b's obs gap needed closing).
    return [pscustomobject]@{ Fire = $true; Reason = 'stalled-backlog' }
}
