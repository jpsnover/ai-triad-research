# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Test-DebateSession (t/2367).
.DESCRIPTION
    Covers: az CLI validation, storage account auto-resolve, direct blob show
    (with UserId), prefix scan (without UserId), not-found returns, OwnerId
    extraction, and SizeBytes propagation.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-DebateSession' -Tag 'health','azure' {

    # ── az CLI validation ────────────────────────────────────────────────────

    It 'Throws when az CLI is not found' {
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        { Test-DebateSession -DebateId 'abc-123' 2>$null } | Should -Throw
    }

    It 'Throws when az CLI is not logged in' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith { $global:LASTEXITCODE = 1; return $null } -ModuleName AITriad
        { Test-DebateSession -DebateId 'abc-123' -StorageAccount 'staitriadx' 2>$null } | Should -Throw
    }

    It 'Throws when no staitriad* storage account is found' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'show') { return '{"id":"sub-123"}' }
            return '[]'
        } -ModuleName AITriad
        { Test-DebateSession -DebateId 'abc-123' 2>$null } | Should -Throw
    }

    # ── direct lookup (UserId provided) ─────────────────────────────────────

    It 'Returns Exists=$true with correct fields when blob is found (UserId path)' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'show' -and $args -contains 'account') {
                return '{"id":"sub-123"}'
            }
            if ($args -contains 'blob' -and $args -contains 'show') {
                return '{"name":"users/user-001/debates/debate-abc-123.json","properties":{"contentLength":4096}}'
            }
            return '[]'
        } -ModuleName AITriad

        $Result = Test-DebateSession -DebateId 'abc-123' -UserId 'user-001' -StorageAccount 'staitriadx'
        $Result.Exists      | Should -BeTrue
        $Result.StoragePath | Should -Be 'users/user-001/debates/debate-abc-123.json'
        $Result.OwnerId     | Should -Be 'user-001'
        $Result.SizeBytes   | Should -Be 4096
    }

    It 'Returns Exists=$false when blob show returns exit code 1 (UserId path)' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            if ($args -contains 'show' -and $args -contains 'account') {
                $global:LASTEXITCODE = 0
                return '{"id":"sub-123"}'
            }
            $global:LASTEXITCODE = 1
            return $null
        } -ModuleName AITriad

        $Result = Test-DebateSession -DebateId 'abc-123' -UserId 'user-001' -StorageAccount 'staitriadx'
        $Result.Exists      | Should -BeFalse
        $Result.StoragePath | Should -BeNullOrEmpty
        $Result.OwnerId     | Should -BeNullOrEmpty
        $Result.SizeBytes   | Should -Be 0
    }

    It 'Strips debate- prefix from DebateId before constructing blob path' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        $script:CapturedArgs = @()
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            $script:CapturedArgs = @($args)
            if ($args -contains 'show' -and $args -contains 'account') {
                return '{"id":"sub-123"}'
            }
            return '{"name":"users/user-001/debates/debate-abc-123.json","properties":{"contentLength":1}}'
        } -ModuleName AITriad

        Test-DebateSession -DebateId 'debate-abc-123' -UserId 'user-001' -StorageAccount 'staitriadx' | Out-Null
        $script:CapturedArgs | Where-Object { $_ -like '*debate-abc-123*' } |
            Should -Not -BeNullOrEmpty -Because 'debate- prefix must be stripped once, not doubled'
    }

    # ── prefix scan (no UserId) ──────────────────────────────────────────────

    It 'Returns Exists=$true with extracted OwnerId when scan finds the blob' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'show' -and $args -contains 'account') {
                return '{"id":"sub-123"}'
            }
            if ($args -contains 'blob' -and $args -contains 'list') {
                return @'
[
  {"name":"users/user-abc/debates/debate-deadbeef-0001.json","properties":{"contentLength":2048}},
  {"name":"users/user-abc/debates/debate-other-id.json","properties":{"contentLength":512}}
]
'@
            }
            return '[]'
        } -ModuleName AITriad

        $Result = Test-DebateSession -DebateId 'deadbeef-0001' -StorageAccount 'staitriadx'
        $Result.Exists      | Should -BeTrue
        $Result.StoragePath | Should -Be 'users/user-abc/debates/debate-deadbeef-0001.json'
        $Result.OwnerId     | Should -Be 'user-abc'
        $Result.SizeBytes   | Should -Be 2048
    }

    It 'Returns Exists=$false when scan finds no matching blob' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'show' -and $args -contains 'account') {
                return '{"id":"sub-123"}'
            }
            if ($args -contains 'blob' -and $args -contains 'list') {
                return '[{"name":"users/user-abc/debates/debate-other-id.json","properties":{"contentLength":512}}]'
            }
            return '[]'
        } -ModuleName AITriad

        $Result = Test-DebateSession -DebateId 'deadbeef-0001' -StorageAccount 'staitriadx'
        $Result.Exists  | Should -BeFalse
        $Result.OwnerId | Should -BeNullOrEmpty
    }

    It 'Throws when blob list fails in scan mode' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            if ($args -contains 'show' -and $args -contains 'account') {
                $global:LASTEXITCODE = 0
                return '{"id":"sub-123"}'
            }
            $global:LASTEXITCODE = 1
            return $null
        } -ModuleName AITriad

        { Test-DebateSession -DebateId 'deadbeef-0001' -StorageAccount 'staitriadx' 2>$null } | Should -Throw
    }

    # ── storage account auto-resolve ─────────────────────────────────────────

    It 'Auto-resolves storage account when -StorageAccount is not supplied' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'show' -and $args -contains 'account') { return '{"id":"sub-123"}' }
            if ($args -contains 'account' -and $args -contains 'list') { return '["staitriadauto"]' }
            if ($args -contains 'blob' -and $args -contains 'show') {
                return '{"name":"users/u1/debates/debate-abc-123.json","properties":{"contentLength":100}}'
            }
            return '[]'
        } -ModuleName AITriad

        $Result = Test-DebateSession -DebateId 'abc-123' -UserId 'u1'
        $Result.Exists | Should -BeTrue
    }
}
