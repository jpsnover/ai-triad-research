# Tag: health (t/2673)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for the t/2673 smoke-test GitHub-flap false-negative gate.
.DESCRIPTION
    Invoke-TaxEditorSmokeTest used to fold GitHubOk into OverallPass. A transient
    GitHub API flap (status page / rate-limit / GHCR — monitoring signals, not app
    health) therefore sank OverallPass even when all 26 app endpoints passed,
    causing a false-negative rollback on the step-1 staging isolation deploy
    (run 31890116255, 2026-08-15). The fix gates OverallPass on app health only
    (Health + Endpoints + Azure) and surfaces a degraded GitHub check as a CI
    warning.

    These tests stub all four phase functions so the orchestration runs offline
    and OverallPass hinges only on the phase(s) under test. Both gate arms are
    proven: (1) a GitHub flap with a healthy app yields PASS; (2) each real app
    failure (Health / Endpoints / Azure) still sinks the gate.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-TaxEditorSmokeTest GitHub-flap gate exclusion (t/2673)' -Tag 'health' {

    BeforeEach {
        InModuleScope AITriad {
            # Healthy defaults for all four phases; individual tests override the
            # one phase they are exercising.
            Mock Test-TaxEditorHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
        }
    }

    It 'ARM 1 — GitHub degraded + healthy app yields OverallPass=$true (AC#1)' {
        InModuleScope AITriad {
            Mock Test-GitHubHealth -MockWith {
                [PSCustomObject]@{
                    Healthy = $false
                    Checks  = @([PSCustomObject]@{ Check = 'RateLimit'; Pass = $false; Detail = 'API 503 flap' })
                }
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeTrue  -Because 'a GitHub API flap is a monitoring signal, not app health — it must not block the traffic shift'
            $result.GitHubOk    | Should -BeFalse -Because 'the degraded GitHub status must still be reported (surfaced as a CI warning)'
            $result.HealthOk    | Should -BeTrue
            $result.AzureOk     | Should -BeTrue
        }
    }

    It 'ARM 1 — surfaces a ::warning:: annotation when GitHub is degraded (AC#2)' {
        InModuleScope AITriad {
            Mock Test-GitHubHealth -MockWith {
                [PSCustomObject]@{ Healthy = $false; Checks = @() }
            }

            # 6>&1 merges the Information stream (Write-Host) into the success
            # stream; Out-String renders every record so we can assert on the text.
            $out = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>&1 | Out-String

            $out | Should -Match '::warning::.*GitHub services degraded' -Because 'a degraded GitHub check must surface as a CI warning, not silently pass'
        }
    }

    It 'ARM 2 — a real Health-phase failure still sinks OverallPass (gate integrity, AC#3)' {
        InModuleScope AITriad {
            Mock Test-TaxEditorHealth -MockWith { [PSCustomObject]@{ Healthy = $false; Checks = @() } }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse -Because 'a down health phase is real app failure and must still fail the gate'
            $result.HealthOk    | Should -BeFalse
        }
    }

    It 'ARM 2 — a real endpoint failure still sinks OverallPass (gate integrity, AC#3)' {
        InModuleScope AITriad {
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 500; Pass = $false; Ms = 12; NodeCount = 0; Error = 'HTTP 500'
                })
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass     | Should -BeFalse -Because 'a failing application endpoint is real app failure and must still fail the gate'
            $result.EndpointsFailed | Should -BeGreaterThan 0
        }
    }

    It 'ARM 2 — a real Azure-infra failure still sinks OverallPass (gate integrity, AC#3)' {
        InModuleScope AITriad {
            Mock Test-AzureHealth -MockWith { [PSCustomObject]@{ Healthy = $false; Checks = @() } }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse -Because 'a down Azure infra phase is real app failure and must still fail the gate'
            $result.AzureOk     | Should -BeFalse
        }
    }
}
