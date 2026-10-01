# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure predicates: dedup the hourly shared-tree drift ping (t/3801) WITHOUT ever masking a
    materially-changed condition.
.DESCRIPTION
    t/2452's backstop fires hourly; its own designed remediation (ff/checkout) is now
    classifier-blocked for the agent (t/3801), so an unchanged parked condition (e.g. a stale
    LessonsLearned.md phantom + a genuine PowerShell WIP file, behind N) re-pings every hour
    with nothing new to act on — owner-unactionable noise that trains the fleet to ignore the
    one alert that exists to catch a real divergence.

    THE LOAD-BEARING PART (TL t/3801#2, re-affirmed t/3801#5): the dedup key must be the
    reason CATEGORY *plus the dirty-file set INCLUDING each file's content state*, never the
    reason string or the path set alone. TL's failure case: a third file appears, OR a file's
    classification flips (redundant/phantom -> real-WIP, i.e. "WIP swapped for something
    dangerous"), while the coarse reason string stays identical ("behind N, N dirty files") —
    a reason-only or path-only key would suppress exactly that change. Get-DriftFingerprint
    therefore hashes every alarm-contributing path TOGETHER WITH its classification, so the
    fingerprint changes on: a new file (tracked, untracked, junk, branch), a removed file, or
    any file's classification changing — never on mere reordering (everything is ordinal-sorted
    before hashing).

    FAIL-SAFE (t/3738 spirit, carried here): Get-ShouldPing treats a missing or unreadable
    stored fingerprint as "not parked" -> PING. Suppression requires proof of an unchanged
    prior state; absence of that proof is never read as "safe to suppress."

    OBSERVABILITY (TL t/3801#2, mandatory): a suppressed ping is NOT the same as nothing
    happening -- the calling shim (check-shared-drift.ps1) must still write a durable record
    every run (telemetry log + a parked-state marker a status surface can read), independent of
    these pure functions. "Snoozed" must never mean "invisible" -- that is the exact silent-
    degradation shape the fleet has been bitten by repeatedly (t/3396, t/3695, t/3738).

    PURE halves only: both functions take already-computed state and return a verdict, no I/O.
    The impure parts (classifying files, reading/writing the stored fingerprint, appending
    telemetry) live in check-shared-drift.ps1. Mirrors DriftSyncVerdict.ps1 / DriftPhantomVerdict.ps1.
.PARAMETER (see each function)
#>

function Get-DriftReasonCategory {
    <#
    .SYNOPSIS
        Pure: coarse human-readable category for the current alarm state. Part of the
        fingerprint input, NOT a substitute for the per-file content-state hash below --
        t/3801's bug class is two runs sharing a category while their content differs.
    .OUTPUTS
        [string] one of: diverged | dirty-real-wip | dirty-redundant | behind-only |
        junk-or-branch | none
    #>
    param(
        [int]$Behind = 0,
        [int]$Ahead = 0,
        [string[]]$RealWipFiles = @(),
        [string[]]$PhantomFiles = @(),
        [string[]]$JunkPaths = @(),
        [string[]]$SuspiciousPaths = @(),
        [string[]]$ShellFragmentPaths = @(),
        [string[]]$NestedWorktrees = @(),
        [string[]]$StrandedBranches = @(),
        [string]$StrandedBranchesStatus = 'OK'
    )
    if ($Ahead -gt 0 -and $Behind -gt 0) { return 'diverged' }
    if (@($RealWipFiles | Where-Object { $_ }).Count -gt 0) { return 'dirty-real-wip' }
    if (@($PhantomFiles | Where-Object { $_ }).Count -gt 0) { return 'dirty-redundant' }
    if ($Behind -gt 0) { return 'behind-only' }
    $hasJunkOrBranch = (@($JunkPaths | Where-Object { $_ }).Count -gt 0) `
        -or (@($SuspiciousPaths | Where-Object { $_ }).Count -gt 0) `
        -or (@($ShellFragmentPaths | Where-Object { $_ }).Count -gt 0) `
        -or (@($NestedWorktrees | Where-Object { $_ }).Count -gt 0) `
        -or (@($StrandedBranches | Where-Object { $_ }).Count -gt 0) `
        -or ($StrandedBranchesStatus -ne 'OK')
    if ($hasJunkOrBranch) { return 'junk-or-branch' }
    return 'none'
}

function Get-DriftFingerprint {
    <#
    .SYNOPSIS
        Pure: deterministic fingerprint of the FULL alarm-contributing state (not just the
        TL-named "dirty-tracked-set" — every category check-shared-drift.ps1 can alarm on is
        folded in, since any of them changing should re-fire just as much as a dirty-file flip).
    .DESCRIPTION
        Composite key = ReasonCategory + ordinal-sorted "(path|classification)" pairs for every
        dirty TRACKED file (classification = phantom|real-wip, from Get-DriftPhantomVerdict) +
        ordinal-sorted untracked/branch path sets (JunkPaths, SuspiciousPaths,
        ShellFragmentPaths, NestedWorktrees, StrandedBranches) + StrandedBranchesStatus.
        Untracked-class sets have no separate "content state" the way tracked files do (a 0-byte
        junk file's content IS its classification; a path appearing/disappearing IS the signal),
        so the path alone is sufficient for those -- the content-state requirement is specific to
        tracked dirty files, which is where "WIP silently swapped for something dangerous" lives.
        SHA-256 the composite, return lowercase hex (not security-sensitive; collision-resistance
        for determinism, matching Get-SummariesInputHash's conventions elsewhere in this repo).
    .OUTPUTS
        [string] 64-char lowercase hex sha256.
    #>
    param(
        [string]$ReasonCategory = 'none',
        [PSCustomObject[]]$DirtyFileStates = @(),   # each { Path; State }  State = 'phantom'|'real-wip'
        [string[]]$JunkPaths = @(),
        [string[]]$SuspiciousPaths = @(),
        [string[]]$ShellFragmentPaths = @(),
        [string[]]$NestedWorktrees = @(),
        [string[]]$StrandedBranches = @(),
        [string]$StrandedBranchesStatus = 'OK'
    )

    # PowerShell gotcha guard: [System.Array]::Sort([string[]]$x, ...) with the cast INLINE at the
    # call site converts to a NEW array (a copy) and sorts THAT -- the original $x variable is left
    # unsorted. Typing the variable at declaration (not at the Sort call) makes the assignment do
    # the one-time conversion, so $x IS the typed array Sort mutates in place.
    [string[]]$dirtyPairs = @($DirtyFileStates | Where-Object { $_ -and $_.Path } | ForEach-Object {
        "$($_.Path)=$($_.State)"
    })
    [System.Array]::Sort($dirtyPairs, [System.StringComparer]::Ordinal)

    $sortedSet = { param([string[]]$s)
        [string[]]$arr = @($s | Where-Object { $_ })
        [System.Array]::Sort($arr, [System.StringComparer]::Ordinal)
        $arr
    }

    # PowerShell gotcha guard: a scriptblock that "returns" a zero-item array collapses to $null
    # when captured via `&` (pipeline-empty-output semantics), not an empty array. Every
    # invocation site below is wrapped in @() to force array context regardless, else
    # [string]::Join throws ArgumentNullException the moment any set here is empty.
    $parts = @(
        "category=$ReasonCategory",
        "dirty=[$([string]::Join(',', @($dirtyPairs)))]",
        "junk=[$([string]::Join(',', @(& $sortedSet $JunkPaths)))]",
        "suspicious=[$([string]::Join(',', @(& $sortedSet $SuspiciousPaths)))]",
        "shellfrag=[$([string]::Join(',', @(& $sortedSet $ShellFragmentPaths)))]",
        "nestedwt=[$([string]::Join(',', @(& $sortedSet $NestedWorktrees)))]",
        "stranded=[$([string]::Join(',', @(& $sortedSet $StrandedBranches)))]",
        "strandedStatus=$StrandedBranchesStatus"
    )
    $composite = [string]::Join("`n", $parts)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($composite)
        -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
    } finally { $sha.Dispose() }
}

function Get-ShouldPing {
    <#
    .SYNOPSIS
        Pure: should this run's alarm actually notify, or is it an already-escalated,
        materially-unchanged parked condition?
    .DESCRIPTION
        FAIL-SAFE, not fail-open: $StoredStateValid=$false (missing/corrupt/unreadable stored
        state) is treated as "nothing is parked" -> PING. Suppression requires POSITIVE proof of
        an identical prior fingerprint; absence of that proof is never read as "safe to suppress"
        (t/3738 fail-closed lesson, applied to a ping decision instead of a merge decision).
    .OUTPUTS
        [bool] $true = ping, $false = suppress (already parked, unchanged).
    #>
    param(
        [Parameter(Mandatory)] [bool]$Alarm,
        [string]$CurrentFingerprint,
        [string]$StoredFingerprint,
        [bool]$StoredStateValid = $true
    )
    if (-not $Alarm) { return $false }               # nothing to ping about
    if (-not $StoredStateValid) { return $true }      # fail-safe: can't trust suppression state
    if ([string]::IsNullOrEmpty($StoredFingerprint)) { return $true }  # nothing parked yet
    return ($CurrentFingerprint -ne $StoredFingerprint)
}
