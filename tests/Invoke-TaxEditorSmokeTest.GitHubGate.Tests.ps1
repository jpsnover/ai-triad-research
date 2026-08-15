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

    Both gate arms are proven: (1) a GitHub flap with a healthy app yields PASS;
    (2) each real app failure (Health / Endpoints / Azure) still sinks the gate.

    Health-phase mocking: we mock the innermost private Invoke-HealthProbe (and
    Start-Sleep), NOT the public Test-TaxEditorHealth, and let the real
    Test-TaxEditorHealth retry loop run over the mocked probe. An earlier revision
    mocked Test-TaxEditorHealth directly; that ran green on Windows but on the CI
    runner the mock did not intercept — the real health phase hit https://stub
    (~2s vs ~160ms mocked), sank HealthOk, and false-red ARM 1. This is the exact
    proven-on-CI recipe used by Invoke-TaxEditorSmokeTest.ColdStart.Tests.ps1.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-TaxEditorSmokeTest GitHub-flap gate exclusion (t/2673)' -Tag 'health' {

    It 'ARM 1 — GitHub degraded + healthy app yields OverallPass=$true (AC#1)' {
        InModuleScope AITriad {
            Mock Invoke-HealthProbe -MockWith {
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'; $r.Healthy = $true
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o'); $r
            }
            Mock Start-Sleep -MockWith { }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith {
                [PSCustomObject]@{
                    Healthy = $false
                    Checks  = @([PSCustomObject]@{ Check = 'RateLimit'; Pass = $false; Detail = 'API 503 flap' })
                }
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null
            $diag = "HealthOk=$($result.HealthOk) AzureOk=$($result.AzureOk) EndpointsFailed=$($result.EndpointsFailed) GitHubOk=$($result.GitHubOk) OverallPass=$($result.OverallPass)"

            $result.HealthOk        | Should -BeTrue  -Because "healthy-app precondition must hold (mock check): $diag"
            $result.AzureOk         | Should -BeTrue  -Because "healthy-app precondition must hold (mock check): $diag"
            $result.EndpointsFailed | Should -Be 0    -Because "healthy-app precondition must hold (mock check): $diag"
            $result.OverallPass     | Should -BeTrue  -Because "a GitHub API flap is a monitoring signal, not app health — it must not block the traffic shift: $diag"
            $result.GitHubOk        | Should -BeFalse -Because "the degraded GitHub status must still be reported (surfaced as a CI warning): $diag"
        }
    }

    It 'ARM 1 — surfaces a ::warning:: annotation when GitHub is degraded (AC#2)' {
        InModuleScope AITriad {
            Mock Invoke-HealthProbe -MockWith {
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'; $r.Healthy = $true
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o'); $r
            }
            Mock Start-Sleep -MockWith { }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $false; Checks = @() } }

            # 6>&1 merges the Information stream (Write-Host) into the success
            # stream; Out-String renders every record so we can assert on the text.
            $out = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>&1 | Out-String

            $out | Should -Match '::warning::.*GitHub services degraded' -Because 'a degraded GitHub check must surface as a CI warning, not silently pass'
        }
    }

    It 'ARM 2 — a real Health-phase failure still sinks OverallPass (gate integrity, AC#3)' {
        InModuleScope AITriad {
            Mock Invoke-HealthProbe -MockWith {
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'; $r.Healthy = $false
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o'); $r
            }
            Mock Start-Sleep -MockWith { }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }

            # -HealthMaxAttempts 1 → single probe, no retry (fast, deterministic).
            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' -HealthMaxAttempts 1 6>$null

            $result.OverallPass | Should -BeFalse -Because 'a down health phase is real app failure and must still fail the gate'
            $result.HealthOk    | Should -BeFalse
        }
    }

    It 'ARM 2 — a real endpoint failure still sinks OverallPass (gate integrity, AC#3)' {
        InModuleScope AITriad {
            Mock Invoke-HealthProbe -MockWith {
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'; $r.Healthy = $true
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o'); $r
            }
            Mock Start-Sleep -MockWith { }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 500; Pass = $false; Ms = 12; NodeCount = 0; Error = 'HTTP 500'
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass     | Should -BeFalse -Because 'a failing application endpoint is real app failure and must still fail the gate'
            $result.EndpointsFailed | Should -BeGreaterThan 0
        }
    }

    It 'ARM 2 — a real Azure-infra failure still sinks OverallPass (gate integrity, AC#3)' {
        InModuleScope AITriad {
            Mock Invoke-HealthProbe -MockWith {
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'; $r.Healthy = $true
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o'); $r
            }
            Mock Start-Sleep -MockWith { }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $false; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse -Because 'a down Azure infra phase is real app failure and must still fail the gate'
            $result.AzureOk     | Should -BeFalse
        }
    }
}
