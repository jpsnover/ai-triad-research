# Tag: health (t/1491)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers -MaxAttempts / -RetryIntervalSec retry loop added in t/1491.
.DESCRIPTION
    Test-TaxEditorHealth now consolidates the health-poll patterns that were
    hand-rolled in health-monitor.yml, deploy-azure.yml, and deploy-staging.yml.
    These tests assert the new retry surface behaves correctly:
      - MaxAttempts=1 is single-shot (backward-compat)
      - Returns early on first healthy attempt
      - Returns unhealthy result after exhausting attempts
    Sleep is mocked to keep the tests fast.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-TaxEditorHealth retry loop (t/1491)' -Tag 'health' {

    It 'MaxAttempts=1 returns a single-shot result (backward-compat)' {
        InModuleScope AITriad {
            $script:HealthProbeCalls = 0
            Mock Invoke-HealthProbe -MockWith {
                $script:HealthProbeCalls++
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl              = 'https://stub'
                $r.Healthy              = $false
                $r.Checks               = @()
                $r.AverageMs            = 0
                $r.FreeTierKeyPoolSize  = 0
                $r.Timestamp            = (Get-Date).ToString('o')
                $r
            }
            Mock Start-Sleep -MockWith { }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub'

            $result.Healthy              | Should -Be $false
            $script:HealthProbeCalls     | Should -Be 1
            Should -Invoke Start-Sleep -Times 0 -Exactly
        }
    }

    It 'Returns early on first healthy attempt' {
        InModuleScope AITriad {
            $script:HealthProbeCalls = 0
            Mock Invoke-HealthProbe -MockWith {
                $script:HealthProbeCalls++
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl              = 'https://stub'
                $r.Healthy              = ($script:HealthProbeCalls -ge 2)
                $r.Checks               = @()
                $r.AverageMs            = 0
                $r.FreeTierKeyPoolSize  = 0
                $r.Timestamp            = (Get-Date).ToString('o')
                $r
            }
            Mock Start-Sleep -MockWith { }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -MaxAttempts 5 -RetryIntervalSec 1

            $result.Healthy              | Should -Be $true
            $script:HealthProbeCalls     | Should -Be 2
            Should -Invoke Start-Sleep -Times 1 -Exactly
        }
    }

    It 'Returns final unhealthy result after exhausting MaxAttempts' {
        InModuleScope AITriad {
            $script:HealthProbeCalls = 0
            Mock Invoke-HealthProbe -MockWith {
                $script:HealthProbeCalls++
                $r = [TaxEditorHealthResult]::new()
                $r.BaseUrl              = 'https://stub'
                $r.Healthy              = $false
                $r.Checks               = @()
                $r.AverageMs            = 0
                $r.FreeTierKeyPoolSize  = 0
                $r.Timestamp            = (Get-Date).ToString('o')
                $r
            }
            Mock Start-Sleep -MockWith { }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -MaxAttempts 3 -RetryIntervalSec 1

            $result.Healthy              | Should -Be $false
            $script:HealthProbeCalls     | Should -Be 3
            # 3 attempts → 2 sleeps (no sleep after final attempt)
            Should -Invoke Start-Sleep -Times 2 -Exactly
        }
    }
}

Describe 'Test-TaxEditorHealth structured result (t/1491)' -Tag 'health' {

    It 'Reports per-check Healthy flag so callers can identify which probe failed' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                param($Uri)
                if ($Uri -match '/healthz$') {
                    [PSCustomObject]@{
                        StatusCode = 200
                        Headers    = @{ 'Content-Type' = @('application/json') }
                        Content    = '{"status":"healthy"}'
                    }
                } elseif ($Uri -match '/health$') {
                    [PSCustomObject]@{
                        StatusCode = 503
                        Headers    = @{ 'Content-Type' = @('application/json') }
                        Content    = '{"status":"degraded"}'
                    }
                }
            }

            # Auth probe returns no session (t/1841) so the run is deterministic
            # regardless of how the Invoke-WebRequest mock treats /.auth/anonymous.
            Mock New-AnonymousWebSession -MockWith { $null }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -TimeoutSec 1

            # healthz + health + /.auth/anonymous (flags is skipped — no session).
            @($result.Checks).Count | Should -Be 3
            $liveness  = $result.Checks | Where-Object { $_.Endpoint -eq '/healthz' }
            $readiness = $result.Checks | Where-Object { $_.Endpoint -eq '/health' }
            $liveness.Healthy  | Should -Be $true
            $readiness.Healthy | Should -Be $false
            $result.Healthy    | Should -Be $false -Because '/health degraded should sink overall Healthy'
        }
    }
}
