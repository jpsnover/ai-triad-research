# Tag: taxonomy-write-scope (t/3943)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Get-UnregisteredPolicyActionNodeIds (t/3943).
.DESCRIPTION
    Pure read-only detection helper backing Invoke-BatchSummary's post-batch
    drift WARN. Must never write any file it scans.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Get-UnregisteredPolicyActionNodeIds' -Tag 'taxonomy-write-scope' {

    BeforeEach {
        $script:taxDir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $taxDir -Force | Out-Null
    }

    It 'returns node ids with a null policy_id policy action' {
        $skeptic = [ordered]@{
            nodes = @(
                [ordered]@{
                    id               = 'skp-beliefs-313'
                    label            = 'Node with unregistered policy action'
                    graph_attributes = [ordered]@{
                        policy_actions = @(
                            [ordered]@{ action = 'Some action'; framing = 'skeptic'; policy_id = $null }
                        )
                    }
                }
                [ordered]@{
                    id               = 'skp-beliefs-999'
                    label            = 'Node with a registered policy action'
                    graph_attributes = [ordered]@{
                        policy_actions = @(
                            [ordered]@{ action = 'Another action'; framing = 'skeptic'; policy_id = 'pol-001' }
                        )
                    }
                }
            )
        }
        Set-Content -Path (Join-Path $taxDir 'skeptic.json') -Value ($skeptic | ConvertTo-Json -Depth 10) -Encoding utf8

        # @() here matters: the helper deliberately returns unwrapped (no
        # comma) so IT doesn't double-nest when a caller wraps it -- per
        # repo convention, wrap at the call site, same as Invoke-BatchSummary.
        $result = @(InModuleScope AITriad -Parameters @{ taxDir = $taxDir } {
            Mock Get-TaxonomyDir { $taxDir }
            Get-UnregisteredPolicyActionNodeIds
        })

        $result.Count | Should -Be 1
        $result[0] | Should -Be 'skp-beliefs-313'
    }

    It 'returns an empty array when every policy action has a policy_id' {
        $skeptic = [ordered]@{
            nodes = @(
                [ordered]@{
                    id               = 'skp-beliefs-001'
                    label            = 'Fully registered node'
                    graph_attributes = [ordered]@{
                        policy_actions = @(
                            [ordered]@{ action = 'An action'; framing = 'skeptic'; policy_id = 'pol-001' }
                        )
                    }
                }
            )
        }
        Set-Content -Path (Join-Path $taxDir 'skeptic.json') -Value ($skeptic | ConvertTo-Json -Depth 10) -Encoding utf8

        $result = InModuleScope AITriad -Parameters @{ taxDir = $taxDir } {
            Mock Get-TaxonomyDir { $taxDir }
            Get-UnregisteredPolicyActionNodeIds
        }

        @($result).Count | Should -Be 0
    }

    It 'never writes to any taxonomy file it scans' {
        $skeptic = [ordered]@{
            nodes = @(
                [ordered]@{
                    id               = 'skp-beliefs-313'
                    label            = 'Node with unregistered policy action'
                    graph_attributes = [ordered]@{
                        policy_actions = @(
                            [ordered]@{ action = 'Some action'; framing = 'skeptic'; policy_id = $null }
                        )
                    }
                }
            )
        }
        $filePath = Join-Path $taxDir 'skeptic.json'
        Set-Content -Path $filePath -Value ($skeptic | ConvertTo-Json -Depth 10) -Encoding utf8
        $before = Get-Content -Path $filePath -Raw

        InModuleScope AITriad -Parameters @{ taxDir = $taxDir } {
            Mock Get-TaxonomyDir { $taxDir }
            Get-UnregisteredPolicyActionNodeIds
        } | Out-Null

        $after = Get-Content -Path $filePath -Raw
        $after | Should -Be $before -Because 'this is a read-only detector -- it must never rewrite a taxonomy file'
    }
}
