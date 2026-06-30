# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-FreeTierStatus' {

    It 'Is exported from the module' {
        Get-Command Get-FreeTierStatus -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has BaseUrl and TimeoutSec parameters' {
        $cmd = Get-Command Get-FreeTierStatus -Module AITriad -ErrorAction Stop
        $cmd | Should -Not -BeNullOrEmpty
        ($cmd.Parameters.Keys -contains 'BaseUrl') | Should -Be $true
        ($cmd.Parameters.Keys -contains 'TimeoutSec') | Should -Be $true
    }

    It 'Returns a FreeTierStatus object with mapped fields from /api/proxy/usage' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 5
                    Body = [PSCustomObject]@{
                        tier   = 'free'
                        limits = [PSCustomObject]@{ tokensPerDay = 500000; requestsPerMinute = 10 }
                        usage  = [PSCustomObject]@{ tokensToday = 125000; resetsAt = '2026-06-30T00:00:00Z' }
                    }
                    Error = $null
                }
            }
            $r = Get-FreeTierStatus -BaseUrl 'https://stub.example.com'
            $r.GetType().Name | Should -Be 'FreeTierStatus'
            $r.Tier | Should -Be 'free'
            $r.DailyTokenBudget | Should -Be 500000
            $r.TokensUsedToday  | Should -Be 125000
            $r.TokensRemainingToday | Should -Be 375000
            $r.BudgetUtilizationPct | Should -Be 25
            $r.RPMLimit | Should -Be 10
            $r.BaseUrl | Should -Be 'https://stub.example.com'
        }
    }

    It 'Computes 50/80/95 percent milestones from DailyTokenBudget' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 1
                    Body = [PSCustomObject]@{
                        tier   = 'free'
                        limits = [PSCustomObject]@{ tokensPerDay = 1000; requestsPerMinute = 10 }
                        usage  = [PSCustomObject]@{ tokensToday = 0; resetsAt = '2026-06-30T00:00:00Z' }
                    }
                    Error = $null
                }
            }
            $r = Get-FreeTierStatus -BaseUrl 'https://stub.example.com'
            $r.MilestoneWarnings['50pct'] | Should -Be 500
            $r.MilestoneWarnings['80pct'] | Should -Be 800
            $r.MilestoneWarnings['95pct'] | Should -Be 950
        }
    }

    It 'Clamps TokensRemaining to 0 when usage exceeds budget' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 1
                    Body = [PSCustomObject]@{
                        tier   = 'free'
                        limits = [PSCustomObject]@{ tokensPerDay = 500000; requestsPerMinute = 10 }
                        usage  = [PSCustomObject]@{ tokensToday = 750000; resetsAt = '2026-06-30T00:00:00Z' }
                    }
                    Error = $null
                }
            }
            $r = Get-FreeTierStatus -BaseUrl 'https://stub.example.com'
            $r.TokensRemainingToday | Should -Be 0
        }
    }

    It 'Derives LastResetTime as 24h before resetsAt' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 1
                    Body = [PSCustomObject]@{
                        tier   = 'free'
                        limits = [PSCustomObject]@{ tokensPerDay = 500000; requestsPerMinute = 10 }
                        usage  = [PSCustomObject]@{ tokensToday = 100; resetsAt = '2026-06-30T00:00:00Z' }
                    }
                    Error = $null
                }
            }
            $r = Get-FreeTierStatus -BaseUrl 'https://stub.example.com'
            $r.LastResetTime | Should -Be '2026-06-29T00:00:00Z'
        }
    }

    It 'Throws ActionableError when /api/proxy/usage returns non-200' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $false; StatusCode = 503; ResponseMs = 100
                    Body = $null; Error = 'Service unavailable'
                }
            }
            { Get-FreeTierStatus -BaseUrl 'https://stub.example.com' } | Should -Throw
        }
    }

    It 'Includes the static AllowedRoutes list' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 1
                    Body = [PSCustomObject]@{
                        tier   = 'free'
                        limits = [PSCustomObject]@{ tokensPerDay = 500000; requestsPerMinute = 10 }
                        usage  = [PSCustomObject]@{ tokensToday = 0; resetsAt = '2026-06-30T00:00:00Z' }
                    }
                    Error = $null
                }
            }
            $r = Get-FreeTierStatus -BaseUrl 'https://stub.example.com'
            $r.AllowedRoutes | Should -Contain '/api/ai/generate'
            $r.AllowedRoutes | Should -Contain '/api/embeddings/compute'
            $r.AllowedRoutes | Should -Contain '/api/auth/anonymous'
            $r.AllowedRoutes.Count | Should -BeGreaterThan 3
        }
    }
}

Describe 'Get-FreeTierStatus - manifest' {
    It 'FunctionsToExport includes Get-FreeTierStatus' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Get-FreeTierStatus'
    }
}
