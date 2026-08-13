# Tag: enrichment (t/2212)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Test-AIBackendHealth (t/2212).
.DESCRIPTION
    Mocks Invoke-AIApi to verify status/latency/error-message output without
    hitting live backends. Exercises: ok, timeout, error, and -All dispatch.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-AIBackendHealth' -Tag 'enrichment' {

    Context 'Single backend — ok' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                [PSCustomObject]@{ Text = 'pong'; Backend = 'gemini'; Model = 'gemini-3.7-flash'; Truncated = $false; Usage = $null; RawResponse = $null }
            }
        }

        It 'Returns status ok when Invoke-AIApi succeeds' {
            $Result = Test-AIBackendHealth -Backend gemini
            $Result.Status   | Should -Be 'ok'
            $Result.Backend  | Should -Be 'gemini'
            $Result.LatencyMs | Should -BeGreaterOrEqual 0
            $Result.ErrorMessage | Should -BeNullOrEmpty
        }

        It 'Populates Model from ai-models.json defaults' {
            $Result = Test-AIBackendHealth -Backend gemini
            $Result.Model | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Single backend — error (null result, no timeout)' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad { $null }
        }

        It 'Returns status error when Invoke-AIApi returns null' {
            $Result = Test-AIBackendHealth -Backend gemini
            $Result.Status | Should -Be 'error'
            $Result.ErrorMessage | Should -Not -BeNullOrEmpty
        }

        It 'Does not throw — failure is a reported row' {
            { Test-AIBackendHealth -Backend claude } | Should -Not -Throw
        }
    }

    Context 'Single backend — timeout' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                # Simulate a slow call by writing a timeout warning, then returning null.
                Write-Warning 'Request timed out after 15 seconds (TaskCanceled)'
                $null
            }
        }

        It 'Returns status timeout when warning contains timeout keyword' {
            $Result = Test-AIBackendHealth -Backend gemini -TimeoutSec 15
            $Result.Status | Should -Be 'timeout'
        }
    }

    Context '-All dispatch' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                [PSCustomObject]@{ Text = 'ok'; Backend = 'x'; Model = 'x'; Truncated = $false; Usage = $null; RawResponse = $null }
            }
        }

        It 'Emits one row per backend in ai-models.json defaults' {
            $Results = @(Test-AIBackendHealth -All)
            $Results.Count | Should -BeGreaterThan 1
        }

        It 'All rows have required properties' {
            $Results = @(Test-AIBackendHealth -All)
            foreach ($R in $Results) {
                $R.PSObject.Properties.Name | Should -Contain 'Backend'
                $R.PSObject.Properties.Name | Should -Contain 'Model'
                $R.PSObject.Properties.Name | Should -Contain 'Status'
                $R.PSObject.Properties.Name | Should -Contain 'LatencyMs'
                $R.PSObject.Properties.Name | Should -Contain 'ErrorMessage'
            }
        }
    }

    Context 'Parameter validation' {
        It 'Rejects an unknown backend name' {
            { Test-AIBackendHealth -Backend 'nonexistent-backend' } | Should -Throw
        }

        It 'Requires either -Backend or -All' {
            { Test-AIBackendHealth } | Should -Throw
        }
    }
}
