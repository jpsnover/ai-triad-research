# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ─────────────────────────────────────────────────────────────────────────────
# DebateTested pure tier/sort-key computation — faithful port of the TypeScript
# single writer at `lib/debate/debateTested.ts` (t/1579 AC #10).
#
# The TS `computeTierAndSortKey` is the canonical implementation; this PS port
# exists because `Update-NodeTestingRecord -RecomputeOnly` needs to sweep 1000+
# nodes per constant-change, and subprocess-per-node into tsx would be
# infeasible. Cross-language consistency is enforced by the shared fixture at
# `tests/fixtures/tier-sort-key-cases.json` — both PS Pester and TS vitest
# should consume it so any drift fails both sides at once.
#
# If you change semantics here, update lib/debate/debateTested.ts in the same
# commit and add the case to the fixture. Any single-side change is a bug.
# ─────────────────────────────────────────────────────────────────────────────

$script:DebateTestedDefaults = @{
    SEVERE_ATTACK_THRESHOLD             = 0.5
    WELL_TESTED_MIN_CHALLENGES          = 5
    WELL_TESTED_MIN_DEBATES             = 2
    EVIDENCE_SATURATION                 = 5
    COSMETIC_EDIT_SIMILARITY_THRESHOLD  = 0.98
}

$script:DebateTestedVerdictWeights = @{
    held             = 1.0
    refined_held     = 1.0
    refined_pending  = 0.6
    refined_rejected = 0.0
    open             = 0.25
    weakened         = -0.5
    cited            = 0.0
}

function Get-DebateTestedTier {
    <#
    .SYNOPSIS
        Pure recompute of {tier, sort_key} for a Debate-Tested record + revisions.
    .DESCRIPTION
        Faithful port of TypeScript computeTierAndSortKey from
        lib/debate/debateTested.ts. Given an ordered record[] of DebateTestedEntry
        objects (raw PSCustomObject from ConvertFrom-Json is fine) and a
        revisions[] of DebateTestedRevision objects, returns a hashtable with
        keys 'tier' and 'sort_key' identical to what the TS single writer
        would produce. Never mutates inputs.

        Tier rules:
          - Empty record → 'untested', sort_key 0.
          - No entries above SEVERE_ATTACK_THRESHOLD → 'cited' (all-cited
            verdicts) or 'contested' (any non-cited).
          - ≥ MIN_CHALLENGES challenging entries from ≥ MIN_DEBATES distinct
            debates AND most recent held verdict comes after most recent
            weakened (or a revision has held_since=true) → 'well_tested'.
          - Otherwise → 'contested'.

        Sort key = tier_rank + clamp(sum(attack_strength * verdict_weight) /
        EVIDENCE_SATURATION, 0, 0.99), rounded to 2 decimals.
    .PARAMETER Record
        Array of DebateTestedEntry objects. Each must have (at minimum)
        debate_id (string), verdict (string), strongest_attack_encountered
        (object with .strength, or null).
    .PARAMETER Revisions
        Array of DebateTestedRevision objects. Each must have held_since
        (boolean or null).
    .PARAMETER Constants
        Optional hashtable override of any of SEVERE_ATTACK_THRESHOLD,
        WELL_TESTED_MIN_CHALLENGES, WELL_TESTED_MIN_DEBATES,
        EVIDENCE_SATURATION. Missing keys use $script:DebateTestedDefaults.
    .OUTPUTS
        Hashtable with keys 'tier' (untested|cited|contested|well_tested)
        and 'sort_key' (double, rounded to 2 decimals).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [AllowEmptyCollection()]
        [object[]]$Record,

        [Parameter(Mandatory)]
        [AllowNull()]
        [AllowEmptyCollection()]
        [object[]]$Revisions,

        [Parameter()]
        [hashtable]$Constants
    )

    Set-StrictMode -Version Latest

    # ConvertFrom-Json can hand us $null when the field is absent — coerce
    # both inputs to empty arrays so the loop / .Count usage below is safe.
    if ($null -eq $Record)    { $Record    = @() }
    if ($null -eq $Revisions) { $Revisions = @() }

    $c = @{}
    foreach ($k in $script:DebateTestedDefaults.Keys) { $c[$k] = $script:DebateTestedDefaults[$k] }
    if ($Constants) {
        foreach ($k in $Constants.Keys) { $c[$k] = $Constants[$k] }
    }

    if (@($Record).Count -eq 0) {
        return @{ tier = 'untested'; sort_key = 0.0 }
    }

    $challenges           = 0
    $challengeDebateIds   = [System.Collections.Generic.HashSet[string]]::new()
    $evidence             = 0.0

    foreach ($entry in $Record) {
        $attackStrength = 0.0
        $isChallenged   = $false
        if ($entry.PSObject.Properties['strongest_attack_encountered'] -and
            $null -ne $entry.strongest_attack_encountered) {
            $sae = $entry.strongest_attack_encountered
            if ($sae.PSObject.Properties['strength']) {
                $attackStrength = [double]$sae.strength
                if ($attackStrength -ge [double]$c.SEVERE_ATTACK_THRESHOLD) {
                    $isChallenged = $true
                }
            }
        }
        if ($isChallenged) {
            $challenges++
            $null = $challengeDebateIds.Add([string]$entry.debate_id)
        }

        $weight = _Get-DebateTestedVerdictWeight -Verdict ([string]$entry.verdict) -Revisions $Revisions
        $evidence += $attackStrength * $weight
    }

    if ($challenges -eq 0) {
        $allCited = $true
        foreach ($e in $Record) {
            if ([string]$e.verdict -ne 'cited') { $allCited = $false; break }
        }
        $tier = if ($allCited) { 'cited' } else { 'contested' }
    } elseif ($challenges -ge [int]$c.WELL_TESTED_MIN_CHALLENGES -and
              $challengeDebateIds.Count -ge [int]$c.WELL_TESTED_MIN_DEBATES -and
              (_Test-DebateTestedWellTestedOutcome -Record $Record -Revisions $Revisions)) {
        $tier = 'well_tested'
    } else {
        $tier = 'contested'
    }

    $tierRank        = _Get-DebateTestedTierRank -Tier $tier
    $clamped         = $evidence / [double]$c.EVIDENCE_SATURATION
    if ($clamped -lt 0)     { $clamped = 0.0 }
    if ($clamped -gt 0.99)  { $clamped = 0.99 }
    $sortKey         = [Math]::Round(($tierRank + $clamped) * 100) / 100

    return @{ tier = $tier; sort_key = $sortKey }
}

function _Get-DebateTestedTierRank {
    param([Parameter(Mandatory)][string]$Tier)
    Set-StrictMode -Version Latest
    switch ($Tier) {
        'untested'    { return 0 }
        'cited'       { return 1 }
        'contested'   { return 2 }
        'well_tested' { return 3 }
        default       { throw "Unknown tier: $Tier" }
    }
}

function _Get-DebateTestedVerdictWeight {
    param(
        [Parameter(Mandatory)][string]$Verdict,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Revisions
    )
    Set-StrictMode -Version Latest

    if ($Verdict -eq 'refined') {
        $revCount = @($Revisions).Count
        if ($revCount -eq 0) { return $script:DebateTestedVerdictWeights['refined_pending'] }
        $latest = $Revisions[$revCount - 1]
        if ($latest.PSObject.Properties['held_since']) {
            if ($latest.held_since -eq $true)  { return $script:DebateTestedVerdictWeights['refined_held'] }
            if ($latest.held_since -eq $false) { return $script:DebateTestedVerdictWeights['refined_rejected'] }
        }
        return $script:DebateTestedVerdictWeights['refined_pending']
    }

    if ($script:DebateTestedVerdictWeights.ContainsKey($Verdict)) {
        return $script:DebateTestedVerdictWeights[$Verdict]
    }
    return 0.0
}

function _Test-DebateTestedWellTestedOutcome {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Record,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Revisions
    )
    Set-StrictMode -Version Latest

    $lastHeldIdx = -1
    $lastWeakIdx = -1
    for ($i = 0; $i -lt @($Record).Count; $i++) {
        $v = [string]$Record[$i].verdict
        if ($v -eq 'held')     { $lastHeldIdx = $i }
        if ($v -eq 'weakened') { $lastWeakIdx = $i }
    }

    if ($lastWeakIdx -gt $lastHeldIdx) { return $false }

    $hasRecentHeld = $lastHeldIdx -ge 0
    $hasHeldRevision = $false
    foreach ($r in $Revisions) {
        if ($r.PSObject.Properties['held_since'] -and $r.held_since -eq $true) {
            $hasHeldRevision = $true; break
        }
    }
    return ($hasRecentHeld -or $hasHeldRevision)
}
