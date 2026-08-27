# Tag: enrichment (t/3029)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Test-AIBackendQuota (t/3029).
.DESCRIPTION
    Mocks Invoke-AIApi (the shared probe's transport) to verify quota classification and
    best-effort ResetAt extraction without hitting live backends. Exercises: ok, quota (429),
    quota with a recoverable reset date (400 body), error, -All dispatch, and validation.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-AIBackendQuota' -Tag 'enrichment' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Test-AIBackendQuota' | Should -Not -BeNullOrEmpty
    }

    Context 'Single backend — ok' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                [PSCustomObject]@{ Text = 'pong'; Backend = 'gemini'; Model = 'm'; Truncated = $false; Usage = $null; RawResponse = $null }
            }
        }
        It 'returns status ok with no ResetAt' {
            $r = Test-AIBackendQuota -Backend gemini
            $r.Status  | Should -Be 'ok'
            $r.ResetAt | Should -BeNullOrEmpty
        }
    }

    Context 'Single backend — quota (HTTP 429)' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                Write-Warning 'gemini: API call failed (HTTP 429) — Rate limit exceeded — wait a moment and try again.'
                $null
            }
        }
        It 'classifies a 429 as quota' {
            $r = Test-AIBackendQuota -Backend gemini
            $r.Status | Should -Be 'quota'
        }
    }

    Context 'Single backend — quota with recoverable reset date (HTTP 400 body)' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                Write-Warning 'claude: API call failed (HTTP 400) — invalid_request_error'
                Write-Warning 'claude: Response body: {"error":{"message":"You have exhausted your quota. Quota resets 2026-09-01T00:00:00Z"}}'
                $null
            }
        }
        It 'classifies a 400 quota body as quota and extracts ResetAt' {
            $r = Test-AIBackendQuota -Backend claude
            $r.Status  | Should -Be 'quota'
            $r.ResetAt | Should -Be '2026-09-01T00:00:00Z'
        }
    }

    Context 'Single backend — error (null, no warning)' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad { $null }
        }
        It 'returns status error, not quota' {
            $r = Test-AIBackendQuota -Backend gemini
            $r.Status  | Should -Be 'error'
            $r.ResetAt | Should -BeNullOrEmpty
        }
        It 'does not throw — failure is a reported row' {
            { Test-AIBackendQuota -Backend claude } | Should -Not -Throw
        }
    }

    Context '-All / bare dispatch' {
        BeforeEach {
            Mock Invoke-AIApi -ModuleName AITriad {
                [PSCustomObject]@{ Text = 'ok'; Backend = 'x'; Model = 'x'; Truncated = $false; Usage = $null; RawResponse = $null }
            }
        }
        It 'a bare call probes every backend in ai-models.json defaults' {
            $results = @(Test-AIBackendQuota)
            $results.Count | Should -BeGreaterThan 1
        }
        It 'all rows expose Backend, Model, Status, ResetAt' {
            foreach ($row in @(Test-AIBackendQuota -All)) {
                $row.PSObject.Properties.Name | Should -Contain 'Backend'
                $row.PSObject.Properties.Name | Should -Contain 'Model'
                $row.PSObject.Properties.Name | Should -Contain 'Status'
                $row.PSObject.Properties.Name | Should -Contain 'ResetAt'
            }
        }
    }

    Context 'Parameter validation' {
        It 'rejects an unknown backend name' {
            { Test-AIBackendQuota -Backend 'nonexistent-backend' } | Should -Throw
        }
    }
}
