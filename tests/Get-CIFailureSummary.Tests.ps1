# Tag: ci (t/2882)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-CIFailureSummary (t/2882) and its pure parser ConvertFrom-CILog.
    The parser is exercised with synthetic gh-log text — no network / no gh call.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue

    # Realistic gh `run view --log` shape: "job<TAB>step<TAB>ISO-timestamp <content>".
    $script:SampleLog = @(
        "test-powershell`tRun tests`t2026-08-12T15:57:47.4Z Describing Register-AIBackend auth hardening",
        "test-powershell`tRun tests`t2026-08-12T15:57:47.4Z   [+] GET / without token returns 401 26ms",
        "test-powershell`tRun tests`t2026-08-12T15:57:47.4Z ##[error][-] GET /api/reveal with spoofed Host header returns 403 17ms",
        "test-powershell`tRun tests`t2026-08-12T15:57:47.4Z ##[group]Message",
        "test-powershell`tRun tests`t2026-08-12T15:57:47.4Z Expected 403, but got 404.",
        "test-powershell`tRun tests`t2026-08-12T15:57:47.4Z at `$status | Should -Be 403, Register-AIBackend.Auth.Tests.ps1:144",
        "test-powershell`tRun tests`t2026-08-12T15:57:50.0Z Tests Passed: 42, Failed: 1, Skipped: 0",
        "test-powershell`tRun tests`t2026-08-12T15:57:50.1Z ##[error]Import-Module: Could not load module 'Foo'",
        "build`tCompile`t2026-08-12T15:58:00.0Z ##[error]Process completed with exit code 1"
    ) -join "`n"
}

Describe 'Get-CIFailureSummary (t/2882)' -Tag 'ci' {

    It 'is exported from the AITriad module' {
        Get-Command -Module AITriad -Name 'Get-CIFailureSummary' | Should -Not -BeNullOrEmpty
    }

    Context 'ConvertFrom-CILog parser' {

        It 'extracts the failing Pester test name (from the [-] line, timestamp/prefix stripped)' {
            InModuleScope AITriad -Parameters @{ Log = $script:SampleLog } {
                param($Log)
                $r = ConvertFrom-CILog -LogText $Log
                $r.FailingTests | Should -Contain 'GET /api/reveal with spoofed Host header returns 403'
                @($r.FailingTests).Count | Should -Be 1
            }
        }

        It 'captures the assertion detail into PesterFailureLines (clean, no gh prefix)' {
            InModuleScope AITriad -Parameters @{ Log = $script:SampleLog } {
                param($Log)
                $r = ConvertFrom-CILog -LogText $Log
                ($r.PesterFailureLines -join "`n") | Should -Match 'Expected 403, but got 404\.'
                # The prefix/timestamp must be stripped.
                ($r.PesterFailureLines -join "`n") | Should -Not -Match 'test-powershell'
            }
        }

        It 'classifies a real infra error as infra, not a test failure' {
            InModuleScope AITriad -Parameters @{ Log = $script:SampleLog } {
                param($Log)
                $r = ConvertFrom-CILog -LogText $Log
                ($r.InfraErrorLines -join "`n") | Should -Match "Could not load module 'Foo'"
                # The [-] test failure must NOT be in the infra bucket.
                ($r.InfraErrorLines -join "`n") | Should -Not -Match 'spoofed Host'
            }
        }

        It 'ignores the generic "Process completed with exit code" step-wrapper noise' {
            InModuleScope AITriad -Parameters @{ Log = $script:SampleLog } {
                param($Log)
                $r = ConvertFrom-CILog -LogText $Log
                ($r.InfraErrorLines -join "`n") | Should -Not -Match 'Process completed with exit code'
            }
        }

        It 'extracts the Pester failed count' {
            InModuleScope AITriad -Parameters @{ Log = $script:SampleLog } {
                param($Log)
                $r = ConvertFrom-CILog -LogText $Log
                $r.FailedCount | Should -Be 1
            }
        }

        It 'returns empty structures (no throw) for an empty log' {
            InModuleScope AITriad {
                $r = ConvertFrom-CILog -LogText ''
                @($r.FailingTests).Count    | Should -Be 0
                @($r.InfraErrorLines).Count | Should -Be 0
            }
        }
    }
}
