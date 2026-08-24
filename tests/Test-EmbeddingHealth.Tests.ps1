# Tag: health (t/2787)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-EmbeddingHealth — /api/embeddings/compute smoke test (t/2787).
.DESCRIPTION
    Mocks the module-internal Invoke-RemoteCheck + New-AnonymousWebSession +
    Get-TaxEditorBaseUrl so the probe runs offline. Covers a healthy compute
    (200 + vectors), the t/2784 failure (500), a 200-with-no-vectors degenerate
    case, and asserts the anon session + x-request-id header are threaded so a
    failure is traceable with Get-ServerLog.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-EmbeddingHealth (t/2787)' -Tag 'health' {

    BeforeEach {
        InModuleScope AITriad {
            Mock New-AnonymousWebSession -MockWith { [Microsoft.PowerShell.Commands.WebRequestSession]::new() }
            Mock Get-TaxEditorBaseUrl -MockWith { 'https://prod.example' }
            function script:New-RC ($Success, $Status, $Body) {
                [PSCustomObject]@{
                    Success = $Success; StatusCode = $Status; ResponseMs = 42
                    Body = $Body; ContentType = 'application/json'; RawBody = ''
                    Error = $(if (-not $Success) { "HTTP $Status" } else { $null })
                }
            }
        }
    }

    It 'Healthy when compute returns 200 + a non-empty vector' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck -MockWith {
                New-RC $true 200 ([PSCustomObject]@{ vectors = @(, @(0.1, 0.2, 0.3, 0.4)) })
            }
            $h = Test-EmbeddingHealth 6>$null
            $h.Healthy    | Should -BeTrue
            $h.StatusCode | Should -Be 200
            $h.VectorDims | Should -Be 4
            $h.RequestId  | Should -Not -BeNullOrEmpty
            $h.Error      | Should -BeNullOrEmpty
        }
    }

    It 'Unhealthy on a 500 (the t/2784 failure) — surfaces status + a traceable requestId' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck -MockWith { New-RC $false 500 $null }
            $h = Test-EmbeddingHealth 6>$null
            $h.Healthy    | Should -BeFalse
            $h.StatusCode | Should -Be 500
            $h.Error      | Should -Match '500'
            $h.RequestId  | Should -Not -BeNullOrEmpty -Because 'the requestId must be reported for Get-ServerLog correlation'
        }
    }

    It 'Unhealthy when 200 carries no vectors' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck -MockWith { New-RC $true 200 ([PSCustomObject]@{ vectors = @() }) }
            $h = Test-EmbeddingHealth 6>$null
            $h.Healthy | Should -BeFalse
            $h.Error   | Should -Match 'no vectors'
        }
    }

    It 'Threads anon session + x-request-id header + JSON body to the compute endpoint' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck -MockWith { New-RC $true 200 ([PSCustomObject]@{ vectors = @(, @(1.0)) }) }
            $h = Test-EmbeddingHealth 6>$null
            Should -Invoke Invoke-RemoteCheck -Times 1 -Exactly -ParameterFilter {
                $Path -like '/api/embeddings/compute*' -and $Method -eq 'POST' -and
                $null -ne $Session -and
                $ExtraHeaders['x-request-id'] -eq $h.RequestId
            }
        }
    }

    It '-Backend is forwarded as a ?backend= query hint and echoed in output' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck -MockWith { New-RC $true 200 ([PSCustomObject]@{ vectors = @(, @(1.0)) }) }
            $h = Test-EmbeddingHealth -Backend 'gemini' 6>$null
            $h.Backend | Should -Be 'gemini'
            Should -Invoke Invoke-RemoteCheck -Times 1 -Exactly -ParameterFilter { $Path -like '*backend=gemini*' }
        }
    }

    It 'Is exported and resolvable after import' {
        Get-Command Test-EmbeddingHealth -Module AITriad -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}
