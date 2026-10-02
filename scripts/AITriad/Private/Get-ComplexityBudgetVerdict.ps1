# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Pure verdict function for t/3829's complexity-ratchet gate. Dot-sourceable
# directly (not via module InModuleScope) so a Pester test can import it
# in isolation and it doesn't silently break if the caller is refactored --
# the structural intent named at t/3829#6/#7, matching the existing
# DriftPhantomVerdict.ps1 / BranchStrandVerdict.ps1 / FlakeVerdict.ps1 /
# RequiredContextsDriftVerdict.ps1 pattern (those live in operations/devops/
# because THEY are DevOps-owned gates; this one lives here because its only
# callers -- Update-ComplexityBaseline, Test-ComplexityBudget -- are in this
# module; t/3829#11).
#
# Semantics are the CORRECTED Pareto-dominance rule from t/3821#2 (NOT the
# "both fields ratchet independently" version in t/3829's original
# description) -- adopted verbatim from the TS peer's
# complexity-budget-predicate.js, same reasoning: independent minima penalise
# decomposition (splitting one complexity-302 function into several smaller
# ones lowers max but raises countOver, which the old rule scored as a
# regression) and risk permanently wedging a file via write-only-downward
# writing a pair no tree ever actually had.
#
# All impure baseline-walking (reading the JSON, computing `observed` via
# Measure-CodeComplexity, deciding what to write) lives in the CALLERS, never
# here -- this function takes already-computed data and returns a bool.

function Get-ComplexityBudgetVerdict {
    <#
    .SYNOPSIS
        Pure Pareto-dominance verdict for one file's complexity ratchet (t/3829).
    .DESCRIPTION
        PASS if observed does not regress against existing:
          - observed.max < existing.max (decomposition): countOver may rise, but
            only up to a ceiling anchored to existing.max (not existing.countOver,
            which would make the ceiling shrink as decomposition succeeds) --
            max(existing.countOver + 5, ceil(existing.max / threshold)).
          - otherwise: PASS only if observed.max <= existing.max AND
            observed.countOver <= existing.countOver (both held, independently
            ratcheted downward-or-equal).
        FAIL in every other case -- in particular, observed.max > existing.max
        always fails regardless of countOver.
    .PARAMETER Observed
        Hashtable/PSObject with .max and .countOver for the file as measured now.
    .PARAMETER Existing
        Hashtable/PSObject with .max and .countOver for the file's current
        baseline entry.
    .PARAMETER Threshold
        The complexity threshold the baseline was generated against (e.g. 15).
        Must be > 0 (division-by-zero/Infinity hazard if 0; t/3829 inherits this
        hardening from the TS side's SO finding).
    .OUTPUTS
        [bool] -- $true if observed passes (no regression), $false otherwise.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        $Observed,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        $Existing,

        [Parameter(Mandatory)]
        [ValidateScript({ $_ -gt 0 })]
        [int]$Threshold
    )

    Set-StrictMode -Version Latest

    if ($Observed.max -lt $Existing.max) {
        $ceiling = [Math]::Max($Existing.countOver + 5, [Math]::Ceiling($Existing.max / $Threshold))
        return ($Observed.countOver -le $ceiling)
    }

    if ($Observed.max -le $Existing.max -and $Observed.countOver -le $Existing.countOver) {
        return $true
    }

    return $false
}
