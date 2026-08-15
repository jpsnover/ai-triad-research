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

    Mock the PRIVATE primitives, not the public phase functions. We mock:
      - Invoke-HealthProbe   (innermost of Test-TaxEditorHealth) + Start-Sleep
      - Invoke-RemoteCheck   (the per-endpoint HTTP primitive of
                              Test-TaxEditorEndpoints AND Invoke-ListLoadContractTest)
      - New-AnonymousWebSession (the anon-session primitive used by the -UserType
                              Anonymous Community re-scan; raw Invoke-WebRequest)
    and let the real Test-TaxEditorHealth / Test-TaxEditorEndpoints run over them.
    Test-AzureHealth / Test-GitHubHealth are mocked directly (they are the phase
    boundary and intercept reliably).

    Why mock the primitive, not the public Test-TaxEditorEndpoints: an earlier
    revision did `Mock Test-TaxEditorEndpoints`. It ran green on Windows but on the
    ubuntu CI runner the mock did NOT intercept — the real 26-endpoint scan hit the
    network, 2 endpoints failed (EndpointsFailed=2), and ARM 1 false-red (run
    31894084737). Same InModuleScope non-interception that first bit the health
    mock (public Test-TaxEditorHealth). Mocking the innermost private primitive is
    the proven-on-CI recipe (Invoke-TaxEditorSmokeTest.ColdStart.Tests.ps1).

    Invoke-RemoteCheck mock shape mirrors the real return object
    (Success/StatusCode/ResponseMs/Body/ContentType/RawBody/Error). Healthy RawBody
    carries a root div + script so the SPA-shell '/' check passes; Body is an empty
    array so (a) the strict-mode `$Check.Body.nodes` guard is skipped for nodes
    routes and (b) the list->load contract test sees an empty list and skips
    gracefully (Pass=$true) rather than a null-item id failure.
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
            Mock New-AnonymousWebSession -MockWith { [Microsoft.PowerShell.Commands.WebRequestSession]::new() }
            Mock Invoke-RemoteCheck -MockWith {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 42; Body = @()
                    ContentType = 'application/json'
                    RawBody = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>'
                    Error = $null
                }
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
            Mock New-AnonymousWebSession -MockWith { [Microsoft.PowerShell.Commands.WebRequestSession]::new() }
            Mock Invoke-RemoteCheck -MockWith {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 42; Body = @()
                    ContentType = 'application/json'
                    RawBody = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>'
                    Error = $null
                }
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
            Mock New-AnonymousWebSession -MockWith { [Microsoft.PowerShell.Commands.WebRequestSession]::new() }
            Mock Invoke-RemoteCheck -MockWith {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 42; Body = @()
                    ContentType = 'application/json'
                    RawBody = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>'
                    Error = $null
                }
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
            Mock New-AnonymousWebSession -MockWith { [Microsoft.PowerShell.Commands.WebRequestSession]::new() }
            # Every endpoint probe fails → the real Test-TaxEditorEndpoints produces
            # failing rows → EndpointsFailed > 0 → the gate must still sink.
            Mock Invoke-RemoteCheck -MockWith {
                [PSCustomObject]@{
                    Success = $false; StatusCode = 500; ResponseMs = 12; Body = $null
                    ContentType = 'application/json'; RawBody = ''; Error = 'HTTP 500'
                }
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
            Mock New-AnonymousWebSession -MockWith { [Microsoft.PowerShell.Commands.WebRequestSession]::new() }
            Mock Invoke-RemoteCheck -MockWith {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 42; Body = @()
                    ContentType = 'application/json'
                    RawBody = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>'
                    Error = $null
                }
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $false; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse -Because 'a down Azure infra phase is real app failure and must still fail the gate'
            $result.AzureOk     | Should -BeFalse
        }
    }
}
