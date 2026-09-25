# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Arms for the t/3669 phantom-vs-real WIP discriminator (check-shared-drift.ps1 /
    DriftPhantomVerdict.ps1).
.DESCRIPTION
    The bug this guards against: a CRLF-only / normalized dirty file (byte-identical to
    origin/main) was mis-classified as REAL WIP because the old code captured `git diff` STDOUT
    and `git diff` prints the `diff --git`/`index` header (zero hunks) for a blob-hash-differing
    file — so the captured string was non-empty and the phantom mis-escalated to a false
    owner-claim (p/331#1363-1367). The fix discriminates on the git-diff EXIT CODE.

    These test the PURE verdict (Get-DriftPhantomVerdict) by injecting the file->exit-code map,
    so both arms run offline without a git fixture — exit 0 = phantom, 1 = real, -1 = query-failed
    (bucketed conservatively as real; a failed diff must never read as a safe phantom).
#>

Describe 'DriftPhantomVerdict (t/3669)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/DriftPhantomVerdict.ps1"
    }

    It 'PHANTOM arm: exit 0 (CRLF-only / identical) is a phantom, NOT real WIP' {
        $v = Get-DriftPhantomVerdict -FileExitCodes ([ordered]@{ 'a/routeTable.test.ts.snap' = 0 })
        $v.PhantomFiles | Should -Be @('a/routeTable.test.ts.snap')
        $v.RealWipFiles | Should -BeNullOrEmpty
        $v.HasRealDiff  | Should -BeFalse
    }

    It 'REAL arm: exit 1 (genuine content diff) is real WIP' {
        $v = Get-DriftPhantomVerdict -FileExitCodes ([ordered]@{ 'src/sessionSlice.ts' = 1 })
        $v.RealWipFiles | Should -Be @('src/sessionSlice.ts')
        $v.PhantomFiles | Should -BeNullOrEmpty
        $v.HasRealDiff  | Should -BeTrue
    }

    It 'QUERY-FAIL arm: exit -1 (git error/timeout) buckets conservatively as REAL, never phantom' {
        # A failed query must NOT read as "identical/safe" — that is the exact "infer safe from
        # silence" trap. Fail toward escalation.
        $v = Get-DriftPhantomVerdict -FileExitCodes ([ordered]@{ 'src/unreadable.ts' = -1 })
        $v.RealWipFiles | Should -Be @('src/unreadable.ts')
        $v.PhantomFiles | Should -BeNullOrEmpty
        $v.HasRealDiff  | Should -BeTrue
    }

    It 'MIXED: a phantom alongside real WIP is split into the correct buckets (independent, not lumped)' {
        $v = Get-DriftPhantomVerdict -FileExitCodes ([ordered]@{
                'a.snap'   = 0   # phantom
                'b.ts'     = 1   # real
                'c.broken' = -1  # real (conservative)
            })
        $v.PhantomFiles | Should -Be @('a.snap')
        ($v.RealWipFiles | Sort-Object) | Should -Be (@('b.ts', 'c.broken') | Sort-Object)
        $v.HasRealDiff  | Should -BeTrue
    }

    It 'EMPTY: no dirty files yields empty buckets and HasRealDiff = false' {
        $v = Get-DriftPhantomVerdict -FileExitCodes ([ordered]@{})
        $v.PhantomFiles | Should -BeNullOrEmpty
        $v.RealWipFiles | Should -BeNullOrEmpty
        $v.HasRealDiff  | Should -BeFalse
    }

    It 'ALL-PHANTOM does NOT set HasRealDiff (the incident: several CRLF-only files, no real WIP)' {
        $v = Get-DriftPhantomVerdict -FileExitCodes ([ordered]@{
                'debateSlices.test.ts'   = 0
                'storeTestHarness.ts'    = 0
                'routeTable.test.ts.snap' = 0
            })
        $v.PhantomFiles.Count | Should -Be 3
        $v.RealWipFiles | Should -BeNullOrEmpty
        $v.HasRealDiff  | Should -BeFalse
    }
}
