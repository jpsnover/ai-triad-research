# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Arms for the t/3652 stranded-branch detector (check-shared-drift.ps1 / BranchStrandVerdict.ps1).
.DESCRIPTION
    The dangerous class: commits pushed to a branch whose PR already merged strand silently —
    the branch looks healthy, CI may go green, but no PR will land them (near-miss data leak,
    e/203#4). These test the two PURE functions the detector is built on, so all arms run
    offline without gh or a GitHub remote:
      - Get-BranchStrandVerdict — CLEAN / STRANDED / DIVERGED / UNKNOWN (TL t/3652#3 cond 1:
        the DIVERGED arm is the force-push case `rev-list` would misreport as an ordinary strand).
      - Resolve-GhFailureReason — names WHY the check degraded so the return value distinguishes
        gh-absent/unauth/rate-limited/timeout (TL t/3652#3 cond 2).
#>

Describe 'BranchStrandVerdict (t/3652)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/BranchStrandVerdict.ps1"

        # One temp repo with a controlled shape:
        #   A ── M ── N1 ── N2      (M = the head a PR "merged" at; N1,N2 pushed after)
        #    \── D                  (D forked off A, diverges from M)
        $script:repo = Join-Path ([System.IO.Path]::GetTempPath()) ("strand-t3652-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $script:repo -Force | Out-Null
        Push-Location $script:repo
        try {
            git init -q 2>$null
            git config user.email t@t 2>$null; git config user.name t 2>$null
            git config commit.gpgsign false 2>$null
            'a' | Out-File -FilePath (Join-Path $script:repo 'a.txt') -Encoding utf8; git add -A 2>$null; git commit -qm A 2>$null
            $script:shaA = (git rev-parse HEAD).Trim()
            'm' | Out-File -FilePath (Join-Path $script:repo 'm.txt') -Encoding utf8; git add -A 2>$null; git commit -qm M 2>$null
            $script:shaM = (git rev-parse HEAD).Trim()          # the PR's merged head
            'n1' | Out-File -FilePath (Join-Path $script:repo 'n1.txt') -Encoding utf8; git add -A 2>$null; git commit -qm N1 2>$null
            'n2' | Out-File -FilePath (Join-Path $script:repo 'n2.txt') -Encoding utf8; git add -A 2>$null; git commit -qm N2 2>$null
            $script:shaStranded = (git rev-parse HEAD).Trim()   # 2 commits ahead of M
            git checkout -q $script:shaA 2>$null                # fork off A (the common ancestor, not M)
            'd' | Out-File -FilePath (Join-Path $script:repo 'd.txt') -Encoding utf8; git add -A 2>$null; git commit -qm D 2>$null
            $script:shaDiverged = (git rev-parse HEAD).Trim()   # neither equal to nor a descendant of M; D is unlanded
            git checkout -q $script:shaA 2>$null                # a mainline off A: X then Y (Y contains X)
            'x' | Out-File -FilePath (Join-Path $script:repo 'x.txt') -Encoding utf8; git add -A 2>$null; git commit -qm X 2>$null
            $script:shaX = (git rev-parse HEAD).Trim()          # diverged from M, but landed on the mainline (Y)
            'y' | Out-File -FilePath (Join-Path $script:repo 'y.txt') -Encoding utf8; git add -A 2>$null; git commit -qm Y 2>$null
            $script:shaMain = (git rev-parse HEAD).Trim()        # mainline HEAD — contains X, not D
        } finally { Pop-Location }
    }

    AfterAll {
        Remove-Item -LiteralPath $script:repo -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'CLEAN — tip equals the merged head' {
        $v = Get-BranchStrandVerdict -RepoRoot $script:repo -Tip $script:shaM -MergedHead $script:shaM
        $v.Verdict | Should -Be 'CLEAN'
        $v.Ahead   | Should -Be 0
    }

    It 'STRANDED — commits pushed after the merge (merged head is an ancestor of tip)' {
        $v = Get-BranchStrandVerdict -RepoRoot $script:repo -Tip $script:shaStranded -MergedHead $script:shaM
        $v.Verdict | Should -Be 'STRANDED'
        $v.Ahead   | Should -Be 2
    }

    It 'DIVERGED-UNLANDED — tip forked off the merged head AND carries commits not on the mainline (real risk)' {
        $v = Get-BranchStrandVerdict -RepoRoot $script:repo -Tip $script:shaDiverged -MergedHead $script:shaM -MainRef $script:shaMain
        $v.Verdict | Should -Be 'DIVERGED-UNLANDED'
        $v.Ahead   | Should -BeGreaterThan 0
    }

    It 'DIVERGED-STALE — tip diverged from the merged head but 0 unlanded (already on the mainline; nothing at risk)' {
        # shaX is not a descendant of M (=> diverged) but IS reachable from the mainline (shaMain contains X).
        $v = Get-BranchStrandVerdict -RepoRoot $script:repo -Tip $script:shaX -MergedHead $script:shaM -MainRef $script:shaMain
        $v.Verdict | Should -Be 'DIVERGED-STALE'
        $v.Ahead   | Should -Be 0
    }

    It 'DIVERGED falls back to UNLANDED (fail-loud) when the mainline ref is unresolvable' {
        $v = Get-BranchStrandVerdict -RepoRoot $script:repo -Tip $script:shaDiverged -MergedHead $script:shaM -MainRef 'refs/heads/does-not-exist'
        $v.Verdict | Should -Be 'DIVERGED-UNLANDED'
    }

    It 'UNKNOWN — a required SHA is not present locally (cannot classify)' {
        $bogus = '0123456789012345678901234567890123456789'
        $v = Get-BranchStrandVerdict -RepoRoot $script:repo -Tip $bogus -MergedHead $script:shaM
        $v.Verdict | Should -Be 'UNKNOWN'
    }
}

Describe 'Resolve-GhFailureReason (t/3652 degradation naming)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/BranchStrandVerdict.ps1"
    }

    It 'timeout wins regardless of exit code' {
        Resolve-GhFailureReason -TimedOut $true -ExitCode 0 -OutputText '' | Should -Be 'gh-timeout'
    }

    It 'exit 0 (no timeout) is not a failure' {
        Resolve-GhFailureReason -TimedOut $false -ExitCode 0 -OutputText '[]' | Should -Be ''
    }

    It 'auth error text classifies as gh-unauth' {
        Resolve-GhFailureReason -TimedOut $false -ExitCode 1 -OutputText 'gh auth login required: no token' | Should -Be 'gh-unauth'
    }

    It 'rate-limit text classifies as gh-rate-limited' {
        Resolve-GhFailureReason -TimedOut $false -ExitCode 1 -OutputText 'HTTP 403: API rate limit exceeded' | Should -Be 'gh-rate-limited'
    }

    It 'other non-zero exit classifies as gh-error' {
        Resolve-GhFailureReason -TimedOut $false -ExitCode 1 -OutputText 'some other failure' | Should -Be 'gh-error'
    }
}

Describe 'check-shared-drift — stranded detection is N/A without a GitHub origin (t/3652)' -Tag 'devops' {
    # A temp/test repo (or non-GitHub mirror) has no PRs to map — running gh there would just error
    # into a spurious SKIPPED alarm. The github-origin gate must skip the whole detector so the
    # status stays OK and the stranded logic never drives the alarm on such a repo.
    It 'a temp repo with no GitHub origin → StrandedBranchesStatus OK, no findings, no stranded alarm' {
        $repo = Join-Path ([System.IO.Path]::GetTempPath()) ("strand-nogh-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $repo -Force | Out-Null
        Push-Location $repo
        try {
            git init -q 2>$null
            git config user.email t@t 2>$null; git config user.name t 2>$null
            git config commit.gpgsign false 2>$null
            'seed' | Out-File -FilePath (Join-Path $repo 'seed.txt') -Encoding utf8
            git add -A 2>$null; git commit -qm seed 2>$null
        } finally { Pop-Location }
        try {
            $r = & "$PSScriptRoot/../operations/devops/check-shared-drift.ps1" -RepoRoot $repo
            $r.StrandedBranchesStatus | Should -Be 'OK'
            @($r.StrandedBranches).Count | Should -Be 0
            @($r.StrandedBranchesInfo).Count | Should -Be 0
            # A clean temp repo must not alarm from the stranded detector.
            $r.Alarm | Should -BeFalse
        } finally {
            Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
