# Tag: graph-attributes-merge (t/3964)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    End-to-end regression test for t/3964: Invoke-AttributeExtraction
    replaced a node's whole graph_attributes on re-extraction, erasing
    registry policy_id's and fields other pipelines write there.
.DESCRIPTION
    Drives a real Invoke-AttributeExtraction -Force call (one node, stubbed
    AI response) and asserts on the WRITTEN taxonomy file. Must fail if the
    old `$OrigNode.graph_attributes = $AttrObj` line (:285) is restored.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
    Import-Module "$PSScriptRoot/../scripts/AIEnrich.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-AttributeExtraction -- merges graph_attributes instead of replacing' -Tag 'graph-attributes-merge' {

    BeforeEach {
        $script:root    = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:taxDir  = Join-Path $root 'taxonomy'
        New-Item -ItemType Directory -Path $taxDir -Force | Out-Null

        $skeptic = [ordered]@{
            last_modified = '2026-01-01'
            nodes = @(
                [ordered]@{
                    id               = 'skp-beliefs-001'
                    label            = 'Test node'
                    graph_attributes = [ordered]@{
                        epistemic_type  = 'stale_value'
                        policy_actions  = @([ordered]@{ action = 'Ban autonomous weapons'; policy_id = 'pol-0001' })
                        debate_tested   = [ordered]@{ status = 'contested'; round = 3 }
                    }
                }
            )
        }
        $script:skepticPath = Join-Path $taxDir 'skeptic.json'
        Set-Content -Path $skepticPath -Value ($skeptic | ConvertTo-Json -Depth 10) -Encoding utf8

        Mock Get-TaxonomyDir  -ModuleName AITriad { $script:taxDir }
        Mock Resolve-AIApiKey -ModuleName AITriad { 'fake-key' }
        Mock Get-Prompt       -ModuleName AITriad { 'prompt text' }

        # Stubbed model response: regenerates epistemic_type (owned field,
        # must update) and returns the SAME action text with NO policy_id
        # (simulating what the real model does -- it never emits ids).
        $script:stubResponse = [ordered]@{
            'skp-beliefs-001' = [ordered]@{
                epistemic_type          = 'empirical_claim'
                rhetorical_strategy     = 'x'
                assumes                 = @()
                falsifiability          = 'x'
                audience                = 'x'
                emotional_register      = 'x'
                policy_actions          = @([ordered]@{ action = 'Ban autonomous weapons' })
                intellectual_lineage    = @()
                steelman_vulnerability  = 'x'
                possible_fallacies      = @()
            }
        } | ConvertTo-Json -Depth 10 -Compress

        Mock Invoke-AIApi -ModuleName AITriad { [PSCustomObject]@{ Text = $script:stubResponse } }
    }

    It 're-extraction preserves debate_tested and the registered policy_id, while updating owned fields' {
        Invoke-AttributeExtraction -POV skeptic -Force -RepoRoot $root -WarningAction SilentlyContinue | Out-Null

        $data = Get-Content -Path $skepticPath -Raw | ConvertFrom-Json
        $node = $data.nodes | Where-Object { $_.id -eq 'skp-beliefs-001' }

        $node.graph_attributes.epistemic_type | Should -Be 'empirical_claim' -Because 'extraction owns this field and must update it'
        $node.graph_attributes.debate_tested.status | Should -Be 'contested' -Because 't/3964: a wholesale replace erased this debate-harvest field'
        $node.graph_attributes.debate_tested.round | Should -Be 3

        @($node.graph_attributes.policy_actions).Count | Should -Be 1
        $node.graph_attributes.policy_actions[0].policy_id | Should -Be 'pol-0001' -Because 't/3964: a wholesale replace erased the registry id (model never returns ids)'
    }
}
