# Tag: health (t/1696)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for the t/1696 smoke-test Health-Checks cold-start false-red.
.DESCRIPTION
    Invoke-TaxEditorSmokeTest's Health phase used to call Test-TaxEditorHealth
    with the default MaxAttempts=1 (single ~15s probe, no retry). On a
    scale-from-zero cold start the first request exceeds the timeout, so both
    /healthz and /health report FAIL, sinking HealthOk (and OverallPass) even
    though the app is healthy — the very next Endpoint phase hit the now-warm
    container and passed (t/1657 prod re-verify, 2026-07-22).

    The fix threads cold-start-tolerant retry (HealthMaxAttempts /
    HealthRetryIntervalSec, defaulting to 5 / 10s) into the Health phase. These
    tests mock the innermost Invoke-HealthProbe so the REAL Test-TaxEditorHealth
    retry loop + the smoke-test wiring run together; the other three phases are
    stubbed so the orchestration runs offline. Start-Sleep is mocked for speed.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-TaxEditorSmokeTest Health-phase cold-start tolerance (t/1696)' -Tag 'health' {

    BeforeEach {
        InModuleScope AITriad {
            # Stub the three non-health phases so the orchestration runs offline
            # and OverallPass hinges only on the health phase under test.
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Health'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Start-Sleep -MockWith { }
        }
    }

    It 'yields HealthOk=$true when a cold container warms up on a later probe (default attempts)' {
        InModuleScope AITriad {
            $script:Probe = 0
            Mock Invoke-HealthProbe -MockWith {
                $script:Probe++
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'
                $r.Healthy = ($script:Probe -ge 3)   # cold for 2 probes, then warm
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o')
                $r
            }

            # No explicit -HealthMaxAttempts → default (5) must tolerate the cold start.
            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.HealthOk    | Should -BeTrue -Because 'the default health retry must ride out a scale-from-zero cold start (AC#1/AC#3)'
            $result.OverallPass | Should -BeTrue -Because 'a healthy-but-cold app with all other phases green must yield Overall PASS'
            $script:Probe       | Should -Be 3 -Because 'it should stop probing on the first healthy result'
        }
    }

    It 'still reports HealthOk=$false for a genuinely-down app after exhausting attempts (gate integrity, AC#2)' {
        InModuleScope AITriad {
            $script:Probe = 0
            Mock Invoke-HealthProbe -MockWith {
                $script:Probe++
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'
                $r.Healthy = $false                  # never recovers
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o')
                $r
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' -HealthMaxAttempts 4 -HealthRetryIntervalSec 1 6>$null

            $result.HealthOk    | Should -BeFalse -Because 'an app that never returns healthy within the budget must still fail (no falsely-green gate)'
            $result.OverallPass | Should -BeFalse -Because 'a down health phase must sink OverallPass even with other phases green'
            $script:Probe       | Should -Be 4 -Because 'it must exhaust exactly HealthMaxAttempts probes before giving up'
            Should -Invoke Start-Sleep -Times 3 -Exactly -Because '4 attempts → 3 inter-attempt sleeps (none after the last)'
        }
    }

    It 'fast-fail path: HealthMaxAttempts=1 is single-shot (no retry, no sleep)' {
        InModuleScope AITriad {
            $script:Probe = 0
            Mock Invoke-HealthProbe -MockWith {
                $script:Probe++
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'
                $r.Healthy = $false
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o')
                $r
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' -HealthMaxAttempts 1 6>$null

            $result.HealthOk | Should -BeFalse
            $script:Probe    | Should -Be 1 -Because 'HealthMaxAttempts=1 preserves the prior single-shot behavior'
            Should -Invoke Start-Sleep -Times 0 -Exactly
        }
    }
}
