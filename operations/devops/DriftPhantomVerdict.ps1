# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure classifier for t/3669: distinguish a PHANTOM dirty tracked file (byte-identical
    to origin/main modulo CRLF/normalization — safe to restore, no owner-claim) from REAL
    WIP (a genuine content diff that must be owner-claimed before restore).
.DESCRIPTION
    Background (the bug this fixes): the previous classifier captured `git diff` STDOUT and
    treated any non-empty output as real WIP. But `git diff` still emits the `diff --git` /
    `index` HEADER lines for a file whose stored blob hash differs (a CRLF-only change changes
    the hash) even when there are zero hunks — so a normalized/CRLF-only file produced
    non-empty stdout and was mis-flagged as real WIP, triggering a false owner-claim escalation
    (p/331#1363-1367). A `git status` M-flag does NOT establish a real diff on the win32 fleet.

    The robust discriminator is the git-diff EXIT CODE, never stdout text:
      exit 0  → identical to origin/main (modulo --ignore-cr-at-eol) → PHANTOM
      exit 1  → genuine content diff                                 → REAL WIP
      other   → query failed (git error / timeout / bad ref)         → REAL WIP (conservative)

    Query-failure is bucketed as REAL on purpose: a failed query must NOT read as "identical /
    phantom / safe" — that would be the same "infer health from silence" trap the whole incident
    class is about. Over-escalating a phantom to an owner-claim is annoying but safe; silently
    dropping real WIP is not. Fail toward escalation.

    This is the PURE half: it takes an already-computed map of file -> exit code and returns the
    buckets, so both arms are unit-testable without a git fixture. The impure git call
    (Get-GitDiffExitCode) lives in check-shared-drift.ps1. Mirrors BranchStrandVerdict.ps1 /
    FlakeVerdict.ps1 (dot-sourceable, arms-testable in isolation).

    HasRealDiff is preserved (= RealWipFiles.Count -gt 0) because the t/2452 backstop reminder
    branches on it: Alarm && !HasRealDiff -> ping DevOps only (phantom, safe restore); Alarm &&
    HasRealDiff -> ping DevOps AND TL (real WIP, owner-claim). PhantomFiles / RealWipFiles are
    additive detail so the ping can name which is which.
.PARAMETER FileExitCodes
    Ordered/hashtable map of dirty-file path -> git-diff-vs-origin exit code (0 | 1 | other).
    Empty map (no dirty files) yields empty buckets and HasRealDiff = $false.
.OUTPUTS
    PSCustomObject { PhantomFiles = [string[]]; RealWipFiles = [string[]]; HasRealDiff = [bool] }
.EXAMPLE
    Get-DriftPhantomVerdict -FileExitCodes @{ 'a.snap' = 0; 'b.ts' = 1 }
    # PhantomFiles = @('a.snap'); RealWipFiles = @('b.ts'); HasRealDiff = $true
#>

function Get-DriftPhantomVerdict {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$FileExitCodes
    )

    $phantom = [System.Collections.Generic.List[string]]::new()
    $realWip = [System.Collections.Generic.List[string]]::new()

    foreach ($file in $FileExitCodes.Keys) {
        $code = $FileExitCodes[$file]
        if ($code -eq 0) {
            # Identical to origin/main modulo CRLF — phantom, safe to restore unilaterally.
            $phantom.Add($file)
        }
        else {
            # exit 1 (real content diff) OR any other/failed code (conservative: fail toward
            # escalation — a failed query must never be silently treated as a safe phantom).
            $realWip.Add($file)
        }
    }

    return [PSCustomObject]@{
        PhantomFiles = @($phantom)
        RealWipFiles = @($realWip)
        HasRealDiff  = $realWip.Count -gt 0
    }
}
