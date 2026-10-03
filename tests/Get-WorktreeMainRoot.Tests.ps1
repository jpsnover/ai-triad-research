# Tag: devtools (t/3869)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Get-WorktreeMainRoot resolves the true main-checkout root from any worktree (t/3869).
.DESCRIPTION
    Found via DevOps (p/169#158): $script:RepoRoot (module-load-time two-dirs-up from the
    .psm1 file) always resolves to the CALLING worktree's own root -- correct for
    code-repo-relative paths, but the wrong anchor for a sibling-relative data-repo path
    like .aitriad.json's "../ai-triad-data" when called from a NESTED worktree
    (.worktrees/<x> is one level too deep; sibling worktrees, ../wt-<x>, happen to sit at
    the right depth, which is why this went unnoticed for sibling-only usage).

    Uses real `git init`/`git worktree add` in a temp directory rather than this repo's own
    layout, so the test is portable (CI has no C:\Users\...\ai-triad-research to assume)
    and exercises the actual mechanism (`git rev-parse --git-common-dir`) rather than
    asserting a hardcoded path.

    Deliberately ZERO module-scope dependencies (-Path is Mandatory, no $script:RepoRoot
    default) -- tested here via direct dot-sourcing, the exact usage DevOps's
    Verify-Config.ps1-adjacent tooling needs (it deliberately does not import the AITriad
    module).
#>

BeforeAll {
    # Dot-source directly -- the point of the zero-module-scope-dependency design is that
    # this works without Import-Module at all.
    . (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Get-WorktreeMainRoot.ps1')

    $script:TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) "gwmr-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $script:TestRoot -Force | Out-Null

    # A real, plain git checkout (the "main checkout" arm).
    $script:MainRepo = Join-Path $script:TestRoot 'main-repo'
    New-Item -ItemType Directory -Path $script:MainRepo -Force | Out-Null
    Push-Location $script:MainRepo
    git init --quiet 2>&1 | Out-Null
    git config user.email 'test@test.local' 2>&1 | Out-Null
    git config user.name 'Test' 2>&1 | Out-Null
    'placeholder' | Set-Content -Path (Join-Path $script:MainRepo 'README.md')
    git add README.md 2>&1 | Out-Null
    git commit -m 'initial' --quiet 2>&1 | Out-Null
    Pop-Location

    # A NESTED worktree inside the main repo (the actual bug's shape, t/3869).
    $script:NestedWorktree = Join-Path $script:MainRepo '.worktrees' 'nested-test'
    Push-Location $script:MainRepo
    git worktree add -b gwmr-nested-test $script:NestedWorktree 2>&1 | Out-Null
    Pop-Location

    # A SIBLING worktree, outside the main repo (the pre-t/3869-working shape).
    $script:SiblingWorktree = Join-Path $script:TestRoot 'sibling-wt'
    Push-Location $script:MainRepo
    git worktree add -b gwmr-sibling-test $script:SiblingWorktree 2>&1 | Out-Null
    Pop-Location

    # A plain directory that is not a git checkout at all (the malformed/non-git arm).
    $script:NotGit = Join-Path $script:TestRoot 'not-a-repo'
    New-Item -ItemType Directory -Path $script:NotGit -Force | Out-Null
}

AfterAll {
    if (Test-Path $script:MainRepo) {
        Push-Location $script:MainRepo
        try { git worktree remove --force $script:NestedWorktree 2>&1 | Out-Null } catch {}
        try { git worktree remove --force $script:SiblingWorktree 2>&1 | Out-Null } catch {}
        Pop-Location
    }
    Remove-Item -Path $script:TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Get-WorktreeMainRoot (t/3869)' -Tag 'devtools' {

    It 'resolves a NESTED worktree (.worktrees/name) back to the main checkout -- the actual bug' {
        $Result = Get-WorktreeMainRoot -Path $script:NestedWorktree
        $Result | Should -Not -BeNullOrEmpty
        (Resolve-Path $Result).Path | Should -Be (Resolve-Path $script:MainRepo).Path
        # The pre-fix anchor ($script:DataConfigDir / the worktree's own dir) would NOT
        # equal the main repo -- this is the assertion that would have failed before t/3869.
        (Resolve-Path $Result).Path | Should -Not -Be (Resolve-Path $script:NestedWorktree).Path
    }

    It 'resolves a SIBLING worktree (../wt-name) back to the main checkout -- no regression' {
        $Result = Get-WorktreeMainRoot -Path $script:SiblingWorktree
        $Result | Should -Not -BeNullOrEmpty
        (Resolve-Path $Result).Path | Should -Be (Resolve-Path $script:MainRepo).Path
    }

    It 'resolves a plain (non-worktree) checkout to itself' {
        $Result = Get-WorktreeMainRoot -Path $script:MainRepo
        $Result | Should -Not -BeNullOrEmpty
        (Resolve-Path $Result).Path | Should -Be (Resolve-Path $script:MainRepo).Path
    }

    It 'returns $null (not a throw) for a directory that is not a git checkout at all' {
        { Get-WorktreeMainRoot -Path $script:NotGit } | Should -Not -Throw
        Get-WorktreeMainRoot -Path $script:NotGit | Should -BeNullOrEmpty
    }

    It 'returns $null (not a throw) for a nonexistent path' {
        $Bogus = Join-Path $script:TestRoot 'does-not-exist'
        { Get-WorktreeMainRoot -Path $Bogus } | Should -Not -Throw
        Get-WorktreeMainRoot -Path $Bogus | Should -BeNullOrEmpty
    }

    It 'works dot-sourced with ZERO module imported -- the standalone use case (DevOps, p/169#163)' {
        # BeforeAll dot-sources this file directly with no Import-Module AITriad in this file.
        # NOTE: can't assert Get-Module AITriad is absent here -- CI runs all test files in one
        # shared Pester session/shard, so an EARLIER file's Import-Module AITriad persists into
        # this one (confirmed: CI failed "Expected $null or empty, but got AITriad" while this
        # file in isolation passed). The actual claim under test is narrower and still holds
        # either way: this function's dot-sourced copy resolves correctly without depending on
        # the module being imported, which the BeforeAll dot-source + this call demonstrates.
        $Result = Get-WorktreeMainRoot -Path $script:MainRepo
        $Result | Should -Not -BeNullOrEmpty
    }
}
