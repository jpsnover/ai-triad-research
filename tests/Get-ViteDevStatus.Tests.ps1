# Tag: health (t/2196)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-ViteDevStatus' -Tag 'health' {

    It 'Is exported from the module' {
        Get-Command Get-ViteDevStatus -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has Port and TimeoutSec parameters' {
        $cmd = Get-Command Get-ViteDevStatus -Module AITriad -ErrorAction Stop
        ($cmd.Parameters.Keys -contains 'Port')       | Should -Be $true
        ($cmd.Parameters.Keys -contains 'TimeoutSec') | Should -Be $true
    }

    It 'Returns Listening=false and early-exit summary when port is not in use' {
        InModuleScope AITriad {
            Mock Get-ViteListeningPid { $null }
            $r = Get-ViteDevStatus -Port 5173
            $r.GetType().Name | Should -Be 'ViteDevStatus'
            $r.Listening      | Should -Be $false
            $r.Summary        | Should -BeLike '*not in use*'
        }
    }

    It 'Returns ViteDevStatus object with populated fields on happy path' {
        InModuleScope AITriad {
            Mock Get-ViteListeningPid { 9999 }
            Mock Get-ViteCimProcess {
                [PSCustomObject]@{
                    Name        = 'node.exe'
                    CommandLine = '"C:\repos\main\taxonomy-editor\node_modules\.bin\vite"'
                }
            }
            Mock Get-ViteHttpStatus { 200 }
            Mock Get-ViteGitRoot   { 'C:\repos\main' }
            Mock Get-ViteWorktreeList {
                @('worktree C:\repos\main', 'HEAD abc123', 'branch refs/heads/main')
            }

            $r = Get-ViteDevStatus -Port 5173
            $r.GetType().Name | Should -Be 'ViteDevStatus'
            $r.Listening      | Should -Be $true
            $r.ProcessId      | Should -Be 9999
            $r.ProcessName    | Should -Be 'node.exe'
            $r.RootHttpStatus | Should -Be 200
            $r.Summary        | Should -Not -BeNullOrEmpty
        }
    }

    It 'Sets IsOrphanedWorktree=$true when workdir not in git worktree list' {
        InModuleScope AITriad {
            Mock Get-ViteListeningPid { 9999 }
            Mock Get-ViteCimProcess {
                [PSCustomObject]@{
                    Name        = 'node.exe'
                    CommandLine = '"C:\repos\orphan\node_modules\.bin\vite"'
                }
            }
            Mock Get-ViteHttpStatus { 200 }
            # rev-parse resolves to an orphan path not in the worktree list
            Mock Get-ViteGitRoot { 'C:\repos\orphan-unregistered' }
            # worktree list contains only main — the orphan path is absent
            Mock Get-ViteWorktreeList {
                @('worktree C:\repos\main-only', 'HEAD abc123', 'branch refs/heads/main')
            }

            $r = Get-ViteDevStatus -Port 5173
            $r.IsOrphanedWorktree   | Should -Be $true
            $r.IsMainRepo           | Should -Be $false
            $r.IsRegisteredWorktree | Should -Be $false
        }
    }
}

Describe 'Get-ViteDevStatus - manifest' -Tag 'health' {
    It 'FunctionsToExport includes Get-ViteDevStatus' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Get-ViteDevStatus'
    }
}
