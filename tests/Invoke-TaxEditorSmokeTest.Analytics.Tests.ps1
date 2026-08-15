# Tag: health (t/2667)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for the t/2667 analytics write/read round-trip probe added to
    Invoke-TaxEditorSmokeTest (Phase 5).
.DESCRIPTION
    Q3b prevention (failure Class 3): the blob analytics backend silently drops
    events when misconfigured while the server still returns 200. The probe's
    authoritative detector is a DELTA READ-BACK — read aggregated totalEvents,
    POST a synthetic event, read again, require the count to increase.

    These tests mock the Private Invoke-RemoteCheck (the analytics phase's HTTP
    helper) inside the module and stub the other four phases so the orchestration
    runs offline. Gate integrity is proven both ways: a clean round-trip passes,
    and each failure mode (silent drop / write unreachable / read path broken)
    sinks OverallPass and surfaces in FailedEndpoints.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-TaxEditorSmokeTest analytics round-trip probe (t/2667)' -Tag 'health' {

    BeforeEach {
        InModuleScope AITriad {
            # Stub the four non-analytics phases so OverallPass hinges on analytics.
            Mock Test-TaxEditorHealth -MockWith {
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl = 'https://stub'; $r.Healthy = $true
                $r.Checks = @(); $r.AverageMs = 0; $r.FreeTierKeyPoolSize = 0
                $r.Timestamp = (Get-Date).ToString('o'); $r
            }
            Mock Test-TaxEditorEndpoints -MockWith {
                @([PSCustomObject]@{
                    Endpoint = '/api/models'; Category = 'Core'; Description = 'stub'
                    Status = 200; Pass = $true; Ms = 42; NodeCount = 0; Error = $null
                })
            }
            Mock Test-AzureHealth  -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Test-GitHubHealth -MockWith { [PSCustomObject]@{ Healthy = $true; Checks = @() } }
            Mock Start-Sleep -MockWith { }

            # Helper builds an Invoke-RemoteCheck-shaped result.
            function script:New-RCResult ($Success, $Status, $Body) {
                [PSCustomObject]@{
                    Success = $Success; StatusCode = $Status; ResponseMs = 10
                    Body = $Body; ContentType = 'application/json'; RawBody = ''; Error = $(if (-not $Success) { "HTTP $Status" } else { $null })
                }
            }
        }
    }

    It 'clean round-trip: totalEvents increases → Analytics PASS, OverallPass true' {
        InModuleScope AITriad {
            $script:QueryCall = 0
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/query' } -MockWith {
                $script:QueryCall++
                $total = if ($script:QueryCall -eq 1) { 5 } else { 6 }   # +1 after write
                New-RCResult $true 200 ([PSCustomObject]@{ summary = [PSCustomObject]@{ totalEvents = $total } })
            }
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/event' } -MockWith {
                New-RCResult $true 200 ([PSCustomObject]@{ ok = $true; count = 1 })
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeTrue -Because 'a clean analytics round-trip with all other phases green must pass'
            @($result.FailedEndpoints | Where-Object { $_.Category -eq 'Analytics' }).Count |
                Should -Be 0 -Because 'neither analytics probe should fail on a healthy round-trip'
            @($result.Categories | Where-Object { $_.Category -eq 'Analytics' }).Count |
                Should -Be 1 -Because 'the Analytics category must appear in the per-category breakdown'
        }
    }

    It 'SILENT DROP: totalEvents flat after a 200 write → delta FAILS, OverallPass false (the critical catch)' {
        InModuleScope AITriad {
            $script:QueryCall = 0
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/query' } -MockWith {
                $script:QueryCall++
                New-RCResult $true 200 ([PSCustomObject]@{ summary = [PSCustomObject]@{ totalEvents = 5 } })  # never increases
            }
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/event' } -MockWith {
                New-RCResult $true 200 ([PSCustomObject]@{ ok = $true; count = 1 })  # server reports success — the trap
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse -Because 'a silent drop (write 200 but nothing stored) must sink the gate'
            $delta = $result.FailedEndpoints | Where-Object { $_.Endpoint -like '*delta read-back*' }
            $delta | Should -Not -BeNullOrEmpty -Because 'the delta read-back is the authoritative silent-drop detector'
            $delta.Error | Should -Match 'Silent drop'
            # The write probe alone reports 200+ok:true — proving it can NOT be the detector.
            $write = $result.FailedEndpoints | Where-Object { $_.Endpoint -eq 'POST /api/analytics/event' }
            $write | Should -BeNullOrEmpty -Because 'the write is reachability-only; it passes on the silent drop, which is exactly why the delta is needed'
        }
    }

    It 'WRITE UNREACHABLE: POST non-200 → write probe FAILS, OverallPass false' {
        InModuleScope AITriad {
            $script:QueryCall = 0
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/query' } -MockWith {
                $script:QueryCall++
                New-RCResult $true 200 ([PSCustomObject]@{ summary = [PSCustomObject]@{ totalEvents = 5 } })
            }
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/event' } -MockWith {
                New-RCResult $false 502 $null
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse
            $write = $result.FailedEndpoints | Where-Object { $_.Endpoint -eq 'POST /api/analytics/event' }
            $write | Should -Not -BeNullOrEmpty -Because 'an unreachable write endpoint must fail the gate'
        }
    }

    It 'READ PATH BROKEN: baseline query non-200 → delta FAILS "Baseline read failed", OverallPass false' {
        InModuleScope AITriad {
            $script:QueryCall = 0
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/query' } -MockWith {
                $script:QueryCall++
                New-RCResult $false 302 $null   # e.g. auth redirect / read path down
            }
            Mock Invoke-RemoteCheck -ParameterFilter { $Path -eq '/api/analytics/event' } -MockWith {
                New-RCResult $true 200 ([PSCustomObject]@{ ok = $true; count = 1 })
            }

            $result = Invoke-TaxEditorSmokeTest -BaseUrl 'https://stub' 6>$null

            $result.OverallPass | Should -BeFalse
            $delta = $result.FailedEndpoints | Where-Object { $_.Endpoint -like '*delta read-back*' }
            $delta | Should -Not -BeNullOrEmpty
            $delta.Error | Should -Match 'Baseline read failed'
        }
    }
}
