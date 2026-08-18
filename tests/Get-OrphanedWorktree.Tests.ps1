# Tag: health (t/2769)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Get-OrphanedWorktree — detect unregistered .worktrees/ dirs (t/2769).
.DESCRIPTION
    A leftover .worktrees/ directory git no longer tracks pollutes node_modules
    resolution for `npm run dev` (t/2768). This helper lists such orphans so
    Show-TaxonomyEditor can warn. Mocks `git worktree list --porcelain` in module
    scope and uses real temp directories to exercise path normalization
    (git emits forward-slash paths; on-disk entries use the OS separator).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-OrphanedWorktree (t/2769)' -Tag 'health' {

    BeforeEach {
        $script:Root = Join-Path ([System.IO.Path]::GetTempPath()) "owt-$(New-Guid)"
        $script:WtDir = Join-Path $script:Root '.worktrees'
        New-Item -ItemType Directory -Path (Join-Path $script:WtDir 'reg-a') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:WtDir 'orphan-b') -Force | Out-Null
    }

    AfterEach {
        Remove-Item -Path $script:Root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'returns unregistered .worktrees dirs (git lists only reg-a → orphan-b is flagged)' {
        InModuleScope AITriad -Parameters @{ Root = $script:Root; WtDir = $script:WtDir } {
            param($Root, $WtDir)
            # git registers only reg-a (main repo + one worktree), forward-slash paths.
            $regA = (Join-Path $WtDir 'reg-a').Replace('\', '/')
            Mock git -MockWith {
                @("worktree $($Root.Replace('\','/'))", '', "worktree $regA", '')
            }
            $orphans = @(Get-OrphanedWorktree -RepoRoot $Root)
            $orphans.Count | Should -Be 1
            (Split-Path $orphans[0] -Leaf) | Should -Be 'orphan-b'
        }
    }

    It 'returns empty when every .worktrees dir is registered' {
        InModuleScope AITriad -Parameters @{ Root = $script:Root; WtDir = $script:WtDir } {
            param($Root, $WtDir)
            $regA = (Join-Path $WtDir 'reg-a').Replace('\', '/')
            $regB = (Join-Path $WtDir 'orphan-b').Replace('\', '/')
            Mock git -MockWith { @("worktree $regA", '', "worktree $regB", '') }
            @(Get-OrphanedWorktree -RepoRoot $Root).Count | Should -Be 0
        }
    }

    It 'returns empty when there is no .worktrees directory' {
        InModuleScope AITriad {
            $bare = Join-Path ([System.IO.Path]::GetTempPath()) "owt-bare-$(New-Guid)"
            New-Item -ItemType Directory -Path $bare -Force | Out-Null
            try {
                Mock git -MockWith { @() }
                @(Get-OrphanedWorktree -RepoRoot $bare).Count | Should -Be 0
                Should -Invoke git -Times 0 -Because 'no .worktrees dir → short-circuit before calling git'
            } finally { Remove-Item $bare -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}
