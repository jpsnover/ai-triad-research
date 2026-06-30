# Tag: debate (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Update-DebateProgress (private)' -Tag 'debate' {

    It 'Creates the file on first write with batch_name and started_at' {
        InModuleScope AITriad {
            $f = Join-Path ([System.IO.Path]::GetTempPath()) "debate-progress-$(Get-Random).json"
            try {
                Update-DebateProgress -Path $f -BatchName 'batch-a' -DebateName 'd1' -Fields @{ status = 'running' }
                Test-Path $f | Should -Be $true
                $state = Get-Content -Raw $f | ConvertFrom-Json
                $state.batch_name | Should -Be 'batch-a'
                $state.started_at | Should -Not -BeNullOrEmpty
                @($state.debates).Count | Should -Be 1
                $state.debates[0].name | Should -Be 'd1'
                $state.debates[0].status | Should -Be 'running'
                $state.debates[0].last_update_at | Should -Not -BeNullOrEmpty
            } finally { if (Test-Path $f) { Remove-Item $f -Force } }
        }
    }

    It 'Seeds pending debates from -Debates list on first write' {
        InModuleScope AITriad {
            $f = Join-Path ([System.IO.Path]::GetTempPath()) "debate-progress-$(Get-Random).json"
            try {
                Update-DebateProgress -Path $f -BatchName 'b' -DebateName 'd1' `
                    -Debates @('d1', 'd2', 'd3') -Fields @{ status = 'running' }
                $state = Get-Content -Raw $f | ConvertFrom-Json
                @($state.debates).Count | Should -Be 3
                ($state.debates | Where-Object { $_.name -eq 'd2' }).status | Should -Be 'pending'
                ($state.debates | Where-Object { $_.name -eq 'd1' }).status | Should -Be 'running'
            } finally { if (Test-Path $f) { Remove-Item $f -Force } }
        }
    }

    It 'Upserts an existing debate without losing siblings' {
        InModuleScope AITriad {
            $f = Join-Path ([System.IO.Path]::GetTempPath()) "debate-progress-$(Get-Random).json"
            try {
                Update-DebateProgress -Path $f -BatchName 'b' -DebateName 'd1' -Debates @('d1', 'd2') -Fields @{ status = 'running' }
                Update-DebateProgress -Path $f -DebateName 'd1' -Fields @{ status = 'done'; current_turn = 12 }
                $state = Get-Content -Raw $f | ConvertFrom-Json
                @($state.debates).Count | Should -Be 2
                $d1 = $state.debates | Where-Object { $_.name -eq 'd1' }
                $d1.status | Should -Be 'done'
                $d1.current_turn | Should -Be 12
                ($state.debates | Where-Object { $_.name -eq 'd2' }).status | Should -Be 'pending'
            } finally { if (Test-Path $f) { Remove-Item $f -Force } }
        }
    }

    It 'Always stamps last_update_at' {
        InModuleScope AITriad {
            $f = Join-Path ([System.IO.Path]::GetTempPath()) "debate-progress-$(Get-Random).json"
            try {
                Update-DebateProgress -Path $f -BatchName 'b' -DebateName 'd1' -Fields @{ status = 'running' }
                $first = (Get-Content -Raw $f | ConvertFrom-Json).debates[0].last_update_at
                Start-Sleep -Milliseconds 1100  # ISO-second resolution
                Update-DebateProgress -Path $f -DebateName 'd1' -Fields @{ current_turn = 5 }
                $second = (Get-Content -Raw $f | ConvertFrom-Json).debates[0].last_update_at
                $second | Should -Not -Be $first
            } finally { if (Test-Path $f) { Remove-Item $f -Force } }
        }
    }

    It 'Reinitializes when the existing file is corrupted (does not throw)' {
        InModuleScope AITriad {
            $f = Join-Path ([System.IO.Path]::GetTempPath()) "debate-progress-$(Get-Random).json"
            try {
                Set-Content -Path $f -Value '{ this is not json' -Encoding utf8NoBOM
                { Update-DebateProgress -Path $f -BatchName 'b2' -DebateName 'd1' -Fields @{ status = 'running' } } | Should -Not -Throw
                $state = Get-Content -Raw $f | ConvertFrom-Json
                $state.batch_name | Should -Be 'b2'
            } finally { if (Test-Path $f) { Remove-Item $f -Force } }
        }
    }
}

Describe 'Watch-DebateProgress (public)' -Tag 'debate' {
    It 'Is exported' {
        Get-Command Watch-DebateProgress -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }
    It 'Has expected parameters' {
        $cmd = Get-Command Watch-DebateProgress -Module AITriad
        foreach ($p in 'Path','IntervalSeconds','HungAfterMinutes') {
            $cmd.Parameters.ContainsKey($p) | Should -Be $true
        }
    }
}

Describe 'Invoke-DebateBatch (public)' -Tag 'debate' {
    It 'Is exported' {
        Get-Command Invoke-DebateBatch -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }
    It 'Has expected parameters' {
        $cmd = Get-Command Invoke-DebateBatch -Module AITriad
        foreach ($p in 'ConfigPath','OutputDirectory','ProgressFile','StopOnFailure') {
            $cmd.Parameters.ContainsKey($p) | Should -Be $true
        }
    }
}

Describe 'Manifest export' -Tag 'debate' {
    It 'FunctionsToExport includes Watch-DebateProgress and Invoke-DebateBatch' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Watch-DebateProgress'
        $manifest.ExportedFunctions.Keys | Should -Contain 'Invoke-DebateBatch'
    }
}
