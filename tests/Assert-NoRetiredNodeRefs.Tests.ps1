# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

Describe 'Assert-NoRetiredNodeRefs' -Tag 'crux' {
    BeforeAll {
        Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
    }

    It 'Passes on an empty collection' {
        InModuleScope AITriad {
            { Assert-NoRetiredNodeRefs -Cruxes @() } | Should -Not -Throw
        }
    }

    It 'Passes on $null' {
        InModuleScope AITriad {
            { Assert-NoRetiredNodeRefs -Cruxes $null } | Should -Not -Throw
        }
    }

    It 'Passes when all linked_node_ids are live (sit/acc/saf/skp) — ordered entries' {
        InModuleScope AITriad {
            $cruxes = @(
                [ordered]@{ id = 'crux-001'; linked_node_ids = @('sit-005', 'acc-beliefs-012') }
                [ordered]@{ id = 'crux-002'; linked_node_ids = @('saf-desires-003', 'skp-intentions-009') }
            )
            { Assert-NoRetiredNodeRefs -Cruxes $cruxes } | Should -Not -Throw
        }
    }

    It 'Passes when linked_node_ids is empty or absent' {
        InModuleScope AITriad {
            $cruxes = @(
                [ordered]@{ id = 'crux-001'; linked_node_ids = @() }
                [ordered]@{ id = 'crux-002' }  # no linked_node_ids key
            )
            { Assert-NoRetiredNodeRefs -Cruxes $cruxes } | Should -Not -Throw
        }
    }

    It 'Throws on a retired cc-* linked_node_id (ordered entry)' {
        InModuleScope AITriad {
            $cruxes = @(
                [ordered]@{ id = 'crux-001'; linked_node_ids = @('sit-005', 'cc-003') }
            )
            { Assert-NoRetiredNodeRefs -Cruxes $cruxes } | Should -Throw
        }
    }

    It 'Names the offending crux and cc-* ref in the error (rendered Error: label)' {
        InModuleScope AITriad {
            $cruxes = @(
                [ordered]@{ id = 'crux-042'; linked_node_ids = @('cc-048') }
            )
            { Assert-NoRetiredNodeRefs -Cruxes $cruxes } | Should -Throw -ExpectedMessage '*crux-042*'
            { Assert-NoRetiredNodeRefs -Cruxes $cruxes } | Should -Throw -ExpectedMessage '*cc-048*'
        }
    }

    It 'Detects cc-* in PSCustomObject entries (JSON round-trip shape)' {
        InModuleScope AITriad {
            $cruxes = @(
                [PSCustomObject]@{ id = 'crux-009'; linked_node_ids = @('cc-027') }
            )
            { Assert-NoRetiredNodeRefs -Cruxes $cruxes } | Should -Throw
        }
    }
}
