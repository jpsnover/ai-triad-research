# Tag: health (t/3846)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Remove-OrphanedWorktree — background deletion of confirmed .worktrees/ residue.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Remove-OrphanedWorktree' -Tag 'health' {

    BeforeEach {
        $script:Root = Join-Path ([System.IO.Path]::GetTempPath()) "rowt-$(New-Guid)"
        $script:Orphan = Join-Path $script:Root '.worktrees' 'stale'
        New-Item -ItemType Directory -Path (Join-Path $script:Orphan 'node_modules\pkg') -Force | Out-Null
        'x' | Set-Content -Path (Join-Path $script:Orphan 'node_modules\pkg\index.js')
    }

    AfterEach {
        Remove-Item -Path $script:Root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'deletes a directory directly under .worktrees' {
        InModuleScope AITriad -Parameters @{ Orphan = $script:Orphan } {
            param($Orphan)
            Remove-OrphanedWorktree -Path $Orphan | Should -Be $true
            $Deadline = (Get-Date).AddSeconds(15)
            while ((Test-Path $Orphan) -and (Get-Date) -lt $Deadline) { Start-Sleep -Milliseconds 100 }
            Test-Path $Orphan | Should -Be $false
        }
    }

    It 'refuses a path that is not directly under .worktrees' {
        $Elsewhere = Join-Path $script:Root 'not-worktrees'
        New-Item -ItemType Directory -Path $Elsewhere -Force | Out-Null

        InModuleScope AITriad -Parameters @{ Elsewhere = $Elsewhere } {
            param($Elsewhere)
            Remove-OrphanedWorktree -Path $Elsewhere -WarningAction SilentlyContinue | Should -Be $false
            Test-Path $Elsewhere | Should -Be $true
        }
    }

    It 'returns false for a missing directory' {
        InModuleScope AITriad -Parameters @{ Missing = (Join-Path $script:Root '.worktrees' 'gone') } {
            param($Missing)
            Remove-OrphanedWorktree -Path $Missing | Should -Be $false
        }
    }

    It 'does nothing under -WhatIf' {
        InModuleScope AITriad -Parameters @{ Orphan = $script:Orphan } {
            param($Orphan)
            Remove-OrphanedWorktree -Path $Orphan -WhatIf | Should -Be $false
            Test-Path $Orphan | Should -Be $true
        }
    }
}
