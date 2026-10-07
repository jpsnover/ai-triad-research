# Tag: taxonomy (t/4004)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# t/4004: Update-PolicyRegistry -NodeId (node-scoped registration) and the shared minting primitive in
# Private/PolicyRegistryCore.ps1. Update-PolicyRegistry.Tests.ps1 is the unchanged regression arm for the
# corpus-wide -Fix path; this file covers what's new.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    # Writes skeptic.json + policy_actions.json into a fresh temp dir and returns the dir.
    function New-PolicyFixture([object[]]$Nodes, [object[]]$Policies) {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "polreg-scoped-$(Get-Random)"
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        [ordered]@{ _schema_version = '1.0.0'; nodes = @($Nodes) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'skeptic.json')
        [ordered]@{ _schema_version = '1.0.0'; _doc = 'x'; policy_count = @($Policies).Count; policies = @($Policies) } |
            ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'policy_actions.json')
        return $Dir
    }
    function Node([string]$Id, [object[]]$Actions) {
        [ordered]@{ id = $Id; graph_attributes = [ordered]@{ policy_actions = @($Actions) } }
    }
    function Act([string]$Action, [string]$PolicyId) {
        if ($PolicyId) { [ordered]@{ action = $Action; framing = 'f'; policy_id = $PolicyId } } else { [ordered]@{ action = $Action; framing = 'f' } }
    }
    function Pol([string]$Id, [string]$Action, [int]$Count) {
        [ordered]@{ id = $Id; action = $Action; source_povs = @('skeptic'); member_count = $Count; status = 'active' }
    }
    function Read-Registry([string]$Dir) { Get-Content -Raw (Join-Path $Dir 'policy_actions.json') | ConvertFrom-Json }
    function Read-Skeptic([string]$Dir) { Get-Content -Raw (Join-Path $Dir 'skeptic.json') | ConvertFrom-Json }
}

Describe 'Update-PolicyRegistry -NodeId (t/4004 node-scoped registration)' -Tag 'taxonomy' {

    AfterEach { if ($script:Dir) { Remove-Item $script:Dir -Recurse -Force -ErrorAction SilentlyContinue } }

    It 'mints ids only for the target nodes and leaves a non-target unregistered action alone' {
        $script:Dir = New-PolicyFixture -Nodes @(
            (Node 'skp-1' @((Act 'kept' 'pol-001')))
            (Node 'skp-target' @((Act 'fresh action' $null)))
            (Node 'skp-other' @((Act 'not mine' $null)))
        ) -Policies @((Pol 'pol-001' 'kept' 1))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            Update-PolicyRegistry -Fix -NodeId 'skp-target' *> $null
        }
        $nodes = (Read-Skeptic $script:Dir).nodes
        @($nodes | Where-Object id -eq 'skp-target')[0].graph_attributes.policy_actions[0].policy_id | Should -Be 'pol-002'
        @($nodes | Where-Object id -eq 'skp-other')[0].graph_attributes.policy_actions[0].PSObject.Properties['policy_id'] | Should -BeNullOrEmpty
        @((Read-Registry $script:Dir).policies.id) | Should -Contain 'pol-002'
    }

    It 'increments member_count when a target node references an existing id' {
        $script:Dir = New-PolicyFixture -Nodes @(
            (Node 'skp-1' @((Act 'shared' 'pol-001')))
            (Node 'skp-target' @((Act 'shared' 'pol-001')))
        ) -Policies @((Pol 'pol-001' 'shared' 1))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            Update-PolicyRegistry -Fix -NodeId 'skp-target' *> $null
        }
        @((Read-Registry $script:Dir).policies | Where-Object id -eq 'pol-001')[0].member_count | Should -Be 2
    }

    It 'decrements member_count for an id the target node dropped (PriorPolicyIds), and leaves an unrelated stale count alone' {
        # skp-target used to hold pol-001 and pol-002; its re-extraction kept only pol-002.
        # pol-003 has a stale count (9) but is unrelated to skp-target, so a scoped call must not touch it.
        $script:Dir = New-PolicyFixture -Nodes @(
            (Node 'skp-1' @((Act 'dropped' 'pol-001'); (Act 'unrelated' 'pol-003')))
            (Node 'skp-target' @((Act 'kept' 'pol-002')))
        ) -Policies @((Pol 'pol-001' 'dropped' 2), (Pol 'pol-002' 'kept' 1), (Pol 'pol-003' 'unrelated' 9))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            Update-PolicyRegistry -Fix -NodeId 'skp-target' -PriorPolicyIds 'pol-001', 'pol-002' *> $null
        }
        $pols = (Read-Registry $script:Dir).policies
        @($pols | Where-Object id -eq 'pol-001')[0].member_count | Should -Be 1   # was 2, skp-target dropped it
        @($pols | Where-Object id -eq 'pol-002')[0].member_count | Should -Be 1
        @($pols | Where-Object id -eq 'pol-003')[0].member_count | Should -Be 9   # unrelated: untouched
    }

    It 'never removes an orphan in node-scoped mode' {
        $script:Dir = New-PolicyFixture -Nodes @(
            (Node 'skp-target' @((Act 'fresh' $null)))
        ) -Policies @((Pol 'pol-001' 'orphan' 1))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            Update-PolicyRegistry -Fix -NodeId 'skp-target' *> $null
        }
        @((Read-Registry $script:Dir).policies.id) | Should -Contain 'pol-001'
    }

    It 'is idempotent: a second scoped run mints nothing and leaves both files byte-identical' {
        $script:Dir = New-PolicyFixture -Nodes @(
            (Node 'skp-target' @((Act 'fresh' $null)))
        ) -Policies @((Pol 'pol-001' 'kept' 0))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            Update-PolicyRegistry -Fix -NodeId 'skp-target' *> $null
        }
        $before = @((Get-FileHash (Join-Path $script:Dir 'skeptic.json')).Hash, (Get-FileHash (Join-Path $script:Dir 'policy_actions.json')).Hash)
        $r = InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            Update-PolicyRegistry -Fix -NodeId 'skp-target' -PassThru 6> $null
        }
        $r.Unregistered | Should -Be 0
        @((Get-FileHash (Join-Path $script:Dir 'skeptic.json')).Hash, (Get-FileHash (Join-Path $script:Dir 'policy_actions.json')).Hash) | Should -Be $before
    }

    It 'REFUSES a corrupt registry with an ActionableError and writes nothing' {
        $script:Dir = New-PolicyFixture -Nodes @((Node 'skp-target' @((Act 'fresh' $null)))) -Policies @()
        Set-Content -Path (Join-Path $script:Dir 'policy_actions.json') -Value '{ not json'
        $skpBefore = (Get-FileHash (Join-Path $script:Dir 'skeptic.json')).Hash
        $err = $null
        try {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                Update-PolicyRegistry -Fix -NodeId 'skp-target' *> $null
            }
        } catch { $err = $_ }
        $err | Should -Not -BeNullOrEmpty
        $err.Exception.Message | Should -Match 'Error:'
        $err.Exception.Message | Should -Match 'not valid JSON'
        (Get-FileHash (Join-Path $script:Dir 'skeptic.json')).Hash | Should -Be $skpBefore
        Get-Content -Raw (Join-Path $script:Dir 'policy_actions.json') | Should -Match 'not json'
    }
}

Describe 'Assert-PolicyIdsUnminted (t/4004 condition 3: same taken set as minting)' -Tag 'taxonomy' {

    AfterEach { if ($script:Dir) { Remove-Item $script:Dir -Recurse -Force -ErrorAction SilentlyContinue } }

    It 'refuses a minted id that is already in the registry on disk' {
        $script:Dir = New-PolicyFixture -Nodes @() -Policies @((Pol 'pol-005' 'x' 0))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            { Assert-PolicyIdsUnminted -TaxDir $Dir -RegistryPath (Join-Path $Dir 'policy_actions.json') -MintedIds 'pol-005' } |
                Should -Throw -ExpectedMessage '*already taken*'
        }
    }

    It 'refuses a minted id that is NOT in the registry but IS referenced on a node' {
        $script:Dir = New-PolicyFixture -Nodes @((Node 'skp-1' @((Act 'a' 'pol-007')))) -Policies @()
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            { Assert-PolicyIdsUnminted -TaxDir $Dir -RegistryPath (Join-Path $Dir 'policy_actions.json') -MintedIds 'pol-007' } |
                Should -Throw -ExpectedMessage '*already taken*'
        }
    }

    It 'passes when no minted id is taken' {
        $script:Dir = New-PolicyFixture -Nodes @((Node 'skp-1' @((Act 'a' 'pol-007')))) -Policies @((Pol 'pol-005' 'x' 0))
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            { Assert-PolicyIdsUnminted -TaxDir $Dir -RegistryPath (Join-Path $Dir 'policy_actions.json') -MintedIds 'pol-008' } | Should -Not -Throw
        }
    }

    It 'a collision inside -Fix refuses before ANY write (no duplicate id reaches disk)' {
        # Force the allocator to start at 0 so it mints pol-001, which skp-1 already references: the
        # same outcome as a concurrent writer taking the id between our scan and our write.
        $script:Dir = New-PolicyFixture -Nodes @(
            (Node 'skp-1' @((Act 'a' 'pol-001')))
            (Node 'skp-target' @((Act 'fresh' $null)))
        ) -Policies @((Pol 'pol-001' 'a' 1))
        $err = $null
        try {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                Mock Get-TakenPolicyIdMax { 0 }
                Mock Write-Utf8NoBom { throw 'must not write' }
                Update-PolicyRegistry -Fix -NodeId 'skp-target' *> $null
            }
        } catch { $err = $_ }
        $err.Exception.Message | Should -Match 'already taken'
        $err.Exception.Message | Should -Not -Match 'must not write'
    }
}
