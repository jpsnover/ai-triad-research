# Tag: taxonomy (t/1500 Phase 3, TL note 1)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Private/New-AnonymousWebSession — the shared anon-cookie helper
    extracted for t/1500 Phase 3 per DevOps's TL note 1 (e/41).
.DESCRIPTION
    Returns a WebRequestSession on 2xx, $null on any failure — never throws.
    The `never throws` contract matters because callers (Test-TaxEditorEndpoints
    -AnonymousSession, Test-AnonymousDebateFlow) rely on it to degrade
    gracefully rather than abort the whole smoke test.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'New-AnonymousWebSession (t/1500 Phase 3)' -Tag 'taxonomy' {

    It 'Returns a WebRequestSession when the endpoint responds 2xx' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest {
                [PSCustomObject]@{ StatusCode = 200; Content = '{}' }
            }
            $s = New-AnonymousWebSession -BaseUrl 'https://example.com'
            $s | Should -Not -BeNullOrEmpty
            $s | Should -BeOfType [Microsoft.PowerShell.Commands.WebRequestSession]
        }
    }

    It 'Returns $null when the endpoint throws (never propagates)' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest { throw 'net error' }
            $s = New-AnonymousWebSession -BaseUrl 'https://example.com' 4>$null
            $s | Should -BeNullOrEmpty
        }
    }

    It 'Returns $null on non-2xx response' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest {
                [PSCustomObject]@{ StatusCode = 401; Content = 'unauthorized' }
            }
            $s = New-AnonymousWebSession -BaseUrl 'https://example.com' 4>$null
            $s | Should -BeNullOrEmpty
        }
    }

    It 'Defaults to GET on /.auth/anonymous (Azure Easy Auth contract)' {
        InModuleScope AITriad {
            $script:capturedUri = $null
            $script:capturedMethod = $null
            Mock Invoke-WebRequest {
                $script:capturedUri = $Uri
                $script:capturedMethod = $Method
                [PSCustomObject]@{ StatusCode = 200; Content = '{}' }
            } -ParameterFilter { $Uri -like '*/.auth/anonymous' }
            $null = New-AnonymousWebSession -BaseUrl 'https://example.com/'
            $script:capturedUri    | Should -Be 'https://example.com/.auth/anonymous'
            $script:capturedMethod | Should -Be 'GET'
        }
    }

    It 'Accepts a custom endpoint + POST for the app-owned anon path' {
        InModuleScope AITriad {
            $script:capturedUri = $null
            $script:capturedMethod = $null
            Mock Invoke-WebRequest {
                $script:capturedUri = $Uri
                $script:capturedMethod = $Method
                [PSCustomObject]@{ StatusCode = 201; Content = '{}' }
            }
            $null = New-AnonymousWebSession -BaseUrl 'https://x.example' -Endpoint '/api/auth/anonymous' -Method POST
            $script:capturedUri    | Should -Be 'https://x.example/api/auth/anonymous'
            $script:capturedMethod | Should -Be 'POST'
        }
    }

    It 'Strips a trailing slash from BaseUrl before concatenation' {
        InModuleScope AITriad {
            $script:capturedUri = $null
            Mock Invoke-WebRequest {
                $script:capturedUri = $Uri
                [PSCustomObject]@{ StatusCode = 200; Content = '{}' }
            }
            $null = New-AnonymousWebSession -BaseUrl 'https://x.example/'
            $script:capturedUri | Should -Be 'https://x.example/.auth/anonymous' -Because 'no double slash'
        }
    }

    It 'Adds a leading slash if the caller omits one on -Endpoint' {
        InModuleScope AITriad {
            $script:capturedUri = $null
            Mock Invoke-WebRequest {
                $script:capturedUri = $Uri
                [PSCustomObject]@{ StatusCode = 200; Content = '{}' }
            }
            $null = New-AnonymousWebSession -BaseUrl 'https://x.example' -Endpoint 'custom/anon'
            $script:capturedUri | Should -Be 'https://x.example/custom/anon'
        }
    }
}
