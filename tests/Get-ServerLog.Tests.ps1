# Tag: diagnostics (t/2765)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Get-ServerLog — ACA server-log retrieval + Pino requestId correlation (t/2765).
.DESCRIPTION
    Mocks the az CLI inside the module scope (-ModuleName AITriad, since Get-ServerLog
    invokes `& az` in module scope) and sets $LASTEXITCODE so the exit-code guard sees
    success. Covers: envelope unwrap + level mapping, level/requestId filtering, -Raw
    passthrough, StrictMode safety on a field-sparse line, and the az-failure
    ActionableError.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-ServerLog' -Tag 'diagnostics' {

    It 'Unwraps the ACA envelope, maps level, and filters by -RequestId' {
        Mock az -ModuleName AITriad -MockWith {
            $global:LASTEXITCODE = 0
            @(
                '{"Log":"{\"level\":30,\"time\":1787048352160,\"requestId\":\"abc\",\"component\":\"ai\",\"msg\":\"ok\"}"}',
                '{"Log":"{\"level\":30,\"time\":1787048352160,\"requestId\":\"zzz\",\"msg\":\"other\"}"}'
            )
        }
        $r = @(Get-ServerLog -RequestId 'abc')
        $r.Count      | Should -Be 1 -Because 'only the matching requestId is emitted'
        $r[0].RequestId | Should -Be 'abc'
        $r[0].Level     | Should -Be 'info'
        $r[0].Component  | Should -Be 'ai'
        $r[0].Message    | Should -Be 'ok'
    }

    It 'Filters by -Level' {
        Mock az -ModuleName AITriad -MockWith {
            $global:LASTEXITCODE = 0
            @(
                '{"Log":"{\"level\":30,\"time\":1787048352160,\"msg\":\"info line\"}"}',
                '{"Log":"{\"level\":50,\"time\":1787048352160,\"msg\":\"error line\"}"}'
            )
        }
        $r = @(Get-ServerLog -Level error)
        $r.Count | Should -Be 1
        $r[0].Level | Should -Be 'error'
    }

    It 'Returns raw Pino strings with -Raw' {
        $raw = '{"level":30,"time":1787048352160,"msg":"hello"}'
        Mock az -ModuleName AITriad -MockWith {
            $global:LASTEXITCODE = 0
            @("{`"Log`":`"$($raw -replace '"','\"')`"}")
        }
        $r = @(Get-ServerLog -Raw)
        $r[0] | Should -Be $raw
    }

    It 'Is StrictMode-safe on a line missing requestId/component (no crash)' {
        Mock az -ModuleName AITriad -MockWith {
            $global:LASTEXITCODE = 0
            @('{"Log":"{\"level\":40,\"time\":1787048352160,\"msg\":\"sparse\"}"}')
        }
        # A StrictMode crash on the absent field would throw here and fail the test.
        $r = @(Get-ServerLog)
        $r.Count | Should -Be 1
        $r[0].Level     | Should -Be 'warn'
        $r[0].RequestId | Should -BeNullOrEmpty
        $r[0].Component | Should -BeNullOrEmpty
    }

    It 'Throws an ActionableError when az fails' {
        Mock az -ModuleName AITriad -MockWith { Write-Error 'not logged in'; $global:LASTEXITCODE = 1 }
        { Get-ServerLog *> $null } | Should -Throw
    }

    It 'Is exported and resolvable after import' {
        Get-Command Get-ServerLog -Module AITriad -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}
