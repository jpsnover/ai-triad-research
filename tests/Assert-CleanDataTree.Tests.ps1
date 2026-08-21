# Tag: summary (t/2902)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Assert-CleanDataTree — dirty-tree-sweep guard (t/2902).
.DESCRIPTION
    Both-arms Gate Verification against a REAL temporary git repo (no native-git
    mocking — the guard's whole job is to read real `git status`):

      DIRTY arm  — target file has uncommitted changes  -> throws (sweep blocked).
      CLEAN arm  — target file matches HEAD             -> returns silently, no
                                                            warning (zero-noise).

    Plus the edge contracts: not-yet-existent target (clean), non-git target
    (clean, no block), -Force downgrades a dirty block to a warning, and the
    opt-in `Write-Utf8NoBom -RequireCleanTree` wiring blocks a dirty overwrite.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Build a throwaway git repo with one committed, clean file. Signing/identity
    # are set LOCAL to this fixture repo only (CI has no signing key) — this is a
    # disposable fixture, not a project repo, so it does not touch the fleet's
    # commit-signing discipline.
    function New-FixtureRepo {
        param([string]$Root)
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
        & git -C $Root init --quiet
        & git -C $Root config user.email 'fixture@example.com'
        & git -C $Root config user.name 'Fixture'
        & git -C $Root config commit.gpgsign false
        $file = Join-Path $Root 'data.json'
        '{ "stance": "aligned" }' | Set-Content -Path $file -Encoding utf8NoBOM
        & git -C $Root add data.json
        & git -C $Root commit --quiet -m 'seed'
        return $file
    }
}

Describe 'Assert-CleanDataTree (t/2902)' -Tag 'summary' {

    Context 'CLEAN arm — committed file matches HEAD' {
        It 'returns silently and emits no warning' {
            $repo = Join-Path $TestDrive 'clean-repo'
            $file = New-FixtureRepo -Root $repo

            # 3>&1 merges the warning stream into output so we can assert on it
            # directly; a void return means a clean pass emits nothing at all.
            $emitted = Assert-CleanDataTree -Path $file 3>&1
            @($emitted).Count | Should -Be 0
        }
    }

    Context 'DIRTY arm — file has uncommitted changes' {
        It 'throws to block the sweep, naming the file' {
            $repo = Join-Path $TestDrive 'dirty-repo'
            $file = New-FixtureRepo -Root $repo
            '{ "stance": "strongly_opposed", "sit-477": true }' | Set-Content -Path $file -Encoding utf8NoBOM

            { Assert-CleanDataTree -Path $file } | Should -Throw -ExpectedMessage '*uncommitted changes*'
        }
    }

    Context '-Force downgrades a dirty block to a warning' {
        It 'warns but does not throw' {
            $repo = Join-Path $TestDrive 'force-repo'
            $file = New-FixtureRepo -Root $repo
            'mutated' | Set-Content -Path $file -Encoding utf8NoBOM

            # A -Force block downgrades to a warning and returns (no throw).
            $emitted = Assert-CleanDataTree -Path $file -Force 3>&1
            @($emitted).Count | Should -BeGreaterThan 0
            "$emitted" | Should -BeLike '*uncommitted changes*'
        }
    }

    Context 'not-yet-existent target' {
        It 'is treated as clean (no throw)' {
            $ghost = Join-Path $TestDrive 'does-not-exist.json'
            { Assert-CleanDataTree -Path $ghost } | Should -Not -Throw
        }
    }

    Context 'target outside any git work tree' {
        It 'does not block (guard defends tracked state only)' {
            # $TestDrive itself is not a git repo.
            $loose = Join-Path $TestDrive 'loose.json'
            'x' | Set-Content -Path $loose -Encoding utf8NoBOM
            { Assert-CleanDataTree -Path $loose } | Should -Not -Throw
        }
    }

    Context 'Write-Utf8NoBom -RequireCleanTree wiring' {
        It 'blocks an overwrite of a dirty target' {
            $repo = Join-Path $TestDrive 'wired-dirty'
            $file = New-FixtureRepo -Root $repo
            'pending edit' | Set-Content -Path $file -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ File = $file } {
                param($File)
                { 'new content' | Write-Utf8NoBom -Path $File -RequireCleanTree } |
                    Should -Throw -ExpectedMessage '*uncommitted changes*'
            }
        }

        It 'writes normally to a clean target with no warning' {
            $repo = Join-Path $TestDrive 'wired-clean'
            $file = New-FixtureRepo -Root $repo

            InModuleScope AITriad -Parameters @{ File = $file } {
                param($File)
                $emitted = 'fresh' | Write-Utf8NoBom -Path $File -RequireCleanTree 3>&1
                @($emitted).Count | Should -Be 0
            }
            (Get-Content -Path $file -Raw).TrimEnd("`n") | Should -Be 'fresh'
        }
    }
}
