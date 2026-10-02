# Tag: health (t/3846)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-OrphanedWorktreeSafeToDelete — safety check for t/3846's deletion remedy.
.DESCRIPTION
    Get-OrphanedWorktree finds directories present on disk but not registered in
    `git worktree list` -- the inverse of what `git worktree prune` cleans up, so
    `prune` is a no-op for them (t/3846). This helper gates the correct remedy
    (manual deletion) on two safety checks: no `.git` marker (would mean it's a
    real worktree, not residue) and no files outside `node_modules/` (the known
    pollution source, t/2768/t/2769).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-OrphanedWorktreeSafeToDelete (t/3846)' -Tag 'health' {

    BeforeEach {
        $script:Dir = Join-Path ([System.IO.Path]::GetTempPath()) "owsd-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:Dir -Force | Out-Null
    }

    AfterEach {
        Remove-Item -Path $script:Dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'is safe to delete when the dir contains only node_modules residue' {
        New-Item -ItemType Directory -Path (Join-Path $script:Dir 'node_modules\some-pkg') -Force | Out-Null
        'x' | Set-Content -Path (Join-Path $script:Dir 'node_modules\some-pkg\index.js')

        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            (Test-OrphanedWorktreeSafeToDelete -Path $Dir).SafeToDelete | Should -Be $true
        }
    }

    It 'is safe to delete when the dir is entirely empty' {
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            (Test-OrphanedWorktreeSafeToDelete -Path $Dir).SafeToDelete | Should -Be $true
        }
    }

    It 'is NOT safe to delete when a .git marker is present (real worktree, not residue)' {
        'gitdir: /somewhere/.git/worktrees/x' | Set-Content -Path (Join-Path $script:Dir '.git')

        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            $Result = Test-OrphanedWorktreeSafeToDelete -Path $Dir
            $Result.SafeToDelete | Should -Be $false
            $Result.Reason | Should -Match '\.git'
        }
    }

    It 'is NOT safe to delete when files exist outside node_modules/' {
        'x' | Set-Content -Path (Join-Path $script:Dir 'README.md')

        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            $Result = Test-OrphanedWorktreeSafeToDelete -Path $Dir
            $Result.SafeToDelete | Should -Be $false
            $Result.Reason | Should -Match 'node_modules'
        }
    }
}
