# Tag: graph-attributes-merge (t/3964)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Merge-NodeGraphAttributes / Merge-PolicyActionsPreservingIds (t/3964).
.DESCRIPTION
    Invoke-AttributeExtraction.ps1:285 used to replace a node's whole
    graph_attributes with the model's output, erasing registry policy_id's
    and any field other pipelines (debate harvest) write there.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Merge-NodeGraphAttributes' -Tag 'graph-attributes-merge' {

    BeforeAll {
        $script:OwnedFields = @(
            'epistemic_type', 'rhetorical_strategy', 'assumes',
            'falsifiability', 'audience', 'emotional_register',
            'policy_actions', 'intellectual_lineage',
            'steelman_vulnerability', 'possible_fallacies'
        )
    }

    It 'returns the new attributes unchanged when the node had none before' {
        $new = [PSCustomObject]@{ epistemic_type = 'empirical_claim' }
        $r = InModuleScope AITriad -Parameters @{ new = $new; owned = $OwnedFields } {
            Merge-NodeGraphAttributes -Existing $null -New $new -OwnedFields $owned
        }
        $r.epistemic_type | Should -Be 'empirical_claim'
    }

    It 'preserves a field extraction does not own (debate_tested) and updates an owned field' {
        $existing = [PSCustomObject]@{
            epistemic_type = 'old_value'
            debate_tested   = [PSCustomObject]@{ status = 'contested'; round = 3 }
        }
        $new = [PSCustomObject]@{ epistemic_type = 'empirical_claim' }

        $r = InModuleScope AITriad -Parameters @{ existing = $existing; new = $new; owned = $OwnedFields } {
            Merge-NodeGraphAttributes -Existing $existing -New $new -OwnedFields $owned
        }

        $r.epistemic_type | Should -Be 'empirical_claim' -Because 'extraction owns this field and must update it'
        $r.debate_tested.status | Should -Be 'contested' -Because 'debate-harvest fields are not owned by extraction and must survive'
        $r.debate_tested.round | Should -Be 3
    }

    It 'carries an existing policy_id over to a regenerated action matching on text' {
        $existing = [PSCustomObject]@{
            policy_actions = @([PSCustomObject]@{ action = 'Ban autonomous weapons'; policy_id = 'pol-0001' })
        }
        $new = [PSCustomObject]@{
            policy_actions = @([PSCustomObject]@{ action = 'Ban autonomous weapons' })
        }

        $r = InModuleScope AITriad -Parameters @{ existing = $existing; new = $new; owned = $OwnedFields } {
            Merge-NodeGraphAttributes -Existing $existing -New $new -OwnedFields $owned
        }

        @($r.policy_actions).Count | Should -Be 1
        $r.policy_actions[0].policy_id | Should -Be 'pol-0001'
    }

    Context 't/3964 condition 1 -- WARN on a field outside the owned-fields contract' {
        It 'WARNs naming any field the model returns outside OwnedFields' {
            $new = [PSCustomObject]@{ epistemic_type = 'x'; made_up_field = 'should not exist' }

            $w = @(InModuleScope AITriad -Parameters @{ new = $new; owned = $OwnedFields } {
                Merge-NodeGraphAttributes -Existing $null -New $new -OwnedFields $owned -NodeId 'test-node' -WarningVariable w -WarningAction SilentlyContinue | Out-Null
                $w
            })

            $w | Where-Object { $_ -match 'made_up_field' } | Should -Not -BeNullOrEmpty
        }
    }

    Context 't/3964 condition 2 -- WARN naming ids when a registered action is dropped' {
        It 'WARNs naming the registry id when the model stops returning a previously-registered action' {
            $existing = @(
                [PSCustomObject]@{ action = 'Ban autonomous weapons'; policy_id = 'pol-0001' }
                [PSCustomObject]@{ action = 'Mandate audits'; policy_id = 'pol-0002' }
            )
            $new = @([PSCustomObject]@{ action = 'Mandate audits' })

            $w = @(InModuleScope AITriad -Parameters @{ existing = $existing; new = $new } {
                Merge-PolicyActionsPreservingIds -ExistingActions $existing -NewActions $new -NodeId 'test-node' -WarningVariable w -WarningAction SilentlyContinue | Out-Null
                $w
            })

            $w | Where-Object { $_ -match 'pol-0001' } | Should -Not -BeNullOrEmpty -Because 'the dropped registry id must be named in the WARN'
        }
    }

    Context 't/3964 condition 3 -- ambiguous existing ids leave the new id null and WARN' {
        It 'leaves policy_id null and WARNs when two existing actions share text but different ids' {
            $existing = @(
                [PSCustomObject]@{ action = 'Mandate audits'; policy_id = 'pol-0001' }
                [PSCustomObject]@{ action = 'Mandate audits'; policy_id = 'pol-0002' }
            )
            $new = @([PSCustomObject]@{ action = 'Mandate audits' })

            $result = @(InModuleScope AITriad -Parameters @{ existing = $existing; new = $new } {
                Merge-PolicyActionsPreservingIds -ExistingActions $existing -NewActions $new -NodeId 'test-node' -WarningAction SilentlyContinue
            })
            $w = @(InModuleScope AITriad -Parameters @{ existing = $existing; new = $new } {
                Merge-PolicyActionsPreservingIds -ExistingActions $existing -NewActions $new -NodeId 'test-node' -WarningVariable w -WarningAction SilentlyContinue | Out-Null
                $w
            })

            $result[0].policy_id | Should -Be $null -Because 'the existing text is ambiguous between two different ids -- must never guess'
            $w | Where-Object { $_ -match 'DIFFERENT registry ids' } | Should -Not -BeNullOrEmpty
        }
    }
}
