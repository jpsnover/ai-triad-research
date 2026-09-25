# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure classifier for t/3652 stranded-branch detection. No network.
.DESCRIPTION
    Given a branch's live tip SHA and the head SHA its PR merged at, classify:
      CLEAN    — tip == merged head (nothing pushed after the merge)
      STRANDED — merged head is an ANCESTOR of tip: commits were pushed after the PR
                 merged and no PR will ever land them (the t/3652 failure)
      DIVERGED — tip is neither equal to nor a descendant of merged head: a force-push
                 over a merged PR. `rev-list mergedHead..tip` would misreport this as an
                 ordinary strand, so it is distinguished explicitly (TL t/3652#3 cond 1).
      UNKNOWN  — a required commit SHA is not present locally (deleted / gc'd / not
                 fetched): cannot classify.

    Squash-safe by construction. The repo squash-merges, so a branch's commits are never
    ancestors of `main`; the ticket's original "commits not reachable from the merge" test
    would false-flag EVERY squash-merged branch. Comparing tip-vs-merged-head sidesteps that.

    Split into its own dot-sourceable file (mirrors FlakeVerdict.ps1) so the three arms are
    unit-testable without executing the full drift check. Uses `git -C <repo>` directly with
    exit-code checks; callers pass a repo that has both SHAs in its object DB.
#>

function Get-BranchStrandVerdict {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$Tip,
        [Parameter(Mandatory)][string]$MergedHead
    )

    $tipFull = (& git -C $RepoRoot rev-parse --verify --quiet "$Tip^{commit}" 2>$null)
    $mhFull  = (& git -C $RepoRoot rev-parse --verify --quiet "$MergedHead^{commit}" 2>$null)
    $tipFull = if ($tipFull) { "$tipFull".Trim() } else { '' }
    $mhFull  = if ($mhFull)  { "$mhFull".Trim() }  else { '' }
    if (-not $tipFull -or -not $mhFull) { return [PSCustomObject]@{ Verdict = 'UNKNOWN'; Ahead = 0 } }
    if ($tipFull -eq $mhFull) { return [PSCustomObject]@{ Verdict = 'CLEAN'; Ahead = 0 } }

    # exit 0 <=> mergedHead is an ancestor of tip  => tip strictly ahead => STRANDED
    & git -C $RepoRoot merge-base --is-ancestor $mhFull $tipFull 2>$null
    if ($LASTEXITCODE -eq 0) {
        $cntRaw = (& git -C $RepoRoot rev-list --count "$mhFull..$tipFull" 2>$null)
        $ahead = if ("$cntRaw".Trim() -match '^\d+$') { [int]("$cntRaw".Trim()) } else { 0 }
        return [PSCustomObject]@{ Verdict = 'STRANDED'; Ahead = $ahead }
    }
    return [PSCustomObject]@{ Verdict = 'DIVERGED'; Ahead = 0 }
}

# t/3652: classify a gh failure into a REASON so the degraded state names its own cause — a
# gh-unauth/gh-absent is a host-config fix, a rate-limit/timeout is transient (TL t/3652#3 cond 2:
# "log WHY too"). Pure (no gh call) so it is unit-testable. Empty string => not a failure.
function Resolve-GhFailureReason {
    [CmdletBinding()]
    param([bool]$TimedOut, [int]$ExitCode, [string]$OutputText)
    if ($TimedOut) { return 'gh-timeout' }
    if ($ExitCode -eq 0) { return '' }
    $t = "$OutputText"
    if ($t -match '(?i)auth|login|token|credential|gh auth') { return 'gh-unauth' }
    if ($t -match '(?i)rate limit|API rate') { return 'gh-rate-limited' }
    return 'gh-error'
}
