# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

Describe 'Get-StaleSimilarityCacheIds' -Tag 'edges' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'TestModuleBootstrap.ps1'); Enter-AITriadTestModule
    }

    BeforeEach {
        $script:Valid = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        foreach ($id in 'sit-001', 'sit-002', 'acc-beliefs-005', 'saf-desires-003') { [void]$script:Valid.Add($id) }
    }

    It 'Returns empty for $null entries' {
        InModuleScope AITriad -Parameters @{ Valid = $script:Valid } {
            param($Valid)
            @(Get-StaleSimilarityCacheIds -Entries $null -ValidNodeIds $Valid).Count | Should -Be 0
        }
    }

    It 'Returns empty when all sources and targets are live' {
        InModuleScope AITriad -Parameters @{ Valid = $script:Valid } {
            param($Valid)
            $entries = @{
                'sit-001' = @(@{ id = 'sit-002'; sim = 0.9 }, @{ id = 'acc-beliefs-005'; sim = 0.8 })
                'saf-desires-003' = @(@{ id = 'sit-001'; sim = 0.7 })
            }
            @(Get-StaleSimilarityCacheIds -Entries $entries -ValidNodeIds $Valid).Count | Should -Be 0
        }
    }

    It 'Flags a stale (retired cc-*) source key' {
        InModuleScope AITriad -Parameters @{ Valid = $script:Valid } {
            param($Valid)
            $entries = @{ 'cc-003' = @(@{ id = 'sit-001'; sim = 0.9 }) }
            $stale = Get-StaleSimilarityCacheIds -Entries $entries -ValidNodeIds $Valid
            $stale | Should -Contain 'cc-003'
        }
    }

    It 'Flags a stale target id' {
        InModuleScope AITriad -Parameters @{ Valid = $script:Valid } {
            param($Valid)
            $entries = @{ 'sit-001' = @(@{ id = 'cc-048'; sim = 0.9 }, @{ id = 'sit-002'; sim = 0.8 }) }
            $stale = Get-StaleSimilarityCacheIds -Entries $entries -ValidNodeIds $Valid
            $stale | Should -Contain 'cc-048'
            $stale | Should -Not -Contain 'sit-002'
        }
    }

    It 'Returns distinct ids across sources and targets' {
        InModuleScope AITriad -Parameters @{ Valid = $script:Valid } {
            param($Valid)
            $entries = @{
                'cc-003' = @(@{ id = 'cc-003'; sim = 0.9 }, @{ id = 'sit-001'; sim = 0.8 })
                'sit-002' = @(@{ id = 'cc-003'; sim = 0.7 })
            }
            $stale = @(Get-StaleSimilarityCacheIds -Entries $entries -ValidNodeIds $Valid)
            $stale.Count | Should -Be 1
            $stale[0] | Should -Be 'cc-003'
        }
    }

    It 'Handles PSCustomObject entry shape' {
        InModuleScope AITriad -Parameters @{ Valid = $script:Valid } {
            param($Valid)
            $entries = @{ 'sit-001' = @([PSCustomObject]@{ id = 'cc-027'; sim = 0.9 }) }
            (Get-StaleSimilarityCacheIds -Entries $entries -ValidNodeIds $Valid) | Should -Contain 'cc-027'
        }
    }
}
