# Tag: policy-registration (t/4004)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Find-PolicyAction: characterization tests (behaviour kept across t/4004 PR 3) and the intended
    behaviour changes from moving its ID minting onto the shared primitive (t/4004#3).
.DESCRIPTION
    Drives real Find-PolicyAction calls with a stubbed AI response and asserts on the WRITTEN
    taxonomy file and registry.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
    Import-Module "$PSScriptRoot/../scripts/AIEnrich.psm1" -Force -WarningAction SilentlyContinue
    . (Join-Path $PSScriptRoot 'PolicyPovFixture.ps1')

    function Set-Fixture([object[]]$Nodes, [object[]]$Policies) {
        Set-Content -Path $script:skepticPath -Encoding utf8 -Value (
            [ordered]@{ last_modified = '2026-01-01'; nodes = @($Nodes) } | ConvertTo-Json -Depth 10)
        Add-PolicyPovFillers -Dir $script:taxDir
        if ($null -ne $Policies) {
            Set-Content -Path $script:registryPath -Encoding utf8 -Value (
                [ordered]@{ _schema_version = '1.0.0'; _doc = 'x'; policy_count = @($Policies).Count; policies = @($Policies) } | ConvertTo-Json -Depth 10)
        }
    }
    function Set-Stub([hashtable]$ByNode) {
        $o = [ordered]@{}
        foreach ($k in $ByNode.Keys) { $o[$k] = [ordered]@{ policy_actions = @($ByNode[$k]) } }
        $script:stubResponse = $o | ConvertTo-Json -Depth 10 -Compress
    }
    function Get-Node([string]$Id) { @((Get-Content -Raw $script:skepticPath | ConvertFrom-Json).nodes | Where-Object id -eq $Id)[0] }
    function Get-Pol([string]$Id) { @((Get-Content -Raw $script:registryPath | ConvertFrom-Json).policies | Where-Object id -eq $Id)[0] }
    function Pol([string]$Id, [string]$Action, [int]$Count) {
        [ordered]@{ id = $Id; action = $Action; source_povs = @('skeptic'); member_count = $Count; status = 'active' }
    }
}

Describe 'Find-PolicyAction' -Tag 'policy-registration' {

    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:taxDir = Join-Path $root 'taxonomy'
        New-Item -ItemType Directory -Path $taxDir -Force | Out-Null
        $script:skepticPath  = Join-Path $taxDir 'skeptic.json'
        $script:registryPath = Join-Path $taxDir 'policy_actions.json'

        Mock Get-TaxonomyDir  -ModuleName AITriad { $script:taxDir }
        Mock Resolve-AIApiKey -ModuleName AITriad { 'fake-key' }
        Mock Get-Prompt       -ModuleName AITriad { 'prompt text' }
        Mock Invoke-AIApi     -ModuleName AITriad { [PSCustomObject]@{ Text = $script:stubResponse } }
    }

    # [crashed pre-PR3]: until t/4004 PR 3, minting any new id threw at Find-PolicyAction.ps1:357
    # ('pol-{0:D3}' -f a [double] from Measure-Object -Maximum; since e1e5305f, 2026-03-28), so these
    # describe the INTENDED behaviour, not the observed one. The rest pass unchanged on the old code.
    Context 'characterization (kept)' {

        It 'keeps a reused registry id on the node' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Shared'; framing = 'f'; policy_id = 'pol-001' }) }
            Find-PolicyAction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Node 'skp-a').graph_attributes.policy_actions[0].policy_id | Should -Be 'pol-001'
        }

        It '[crashed pre-PR3] treats a dangling policy_id (not in the registry) as new and gives it a fresh id' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f'; policy_id = 'pol-777' }) }
            Find-PolicyAction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null
            $id = (Get-Node 'skp-a').graph_attributes.policy_actions[0].policy_id
            $id | Should -Not -Be 'pol-777'
            $id | Should -Match '^pol-\d+$'
            (Get-Pol $id).action | Should -Be 'Brand new'
        }

        It '[crashed pre-PR3] gives a new action an id and a registry entry' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            Find-PolicyAction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Node 'skp-a').graph_attributes.policy_actions[0].policy_id | Should -Be 'pol-002'
            (Get-Pol 'pol-002').action | Should -Be 'Brand new'
        }

        It 'skips a node that already has policy_actions unless -Force' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A'; graph_attributes = [ordered]@{ policy_actions = @() } }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            $r = Find-PolicyAction -POV skeptic -RepoRoot $root -PassThru -WarningAction SilentlyContinue 6> $null
            $r.Processed | Should -Be 0
            $r.Skipped | Should -Be 1
            Should -Invoke Invoke-AIApi -ModuleName AITriad -Times 0 -Exactly
        }

        It '[crashed pre-PR3] -WhatIf writes neither the taxonomy file nor the registry' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            $before = @((Get-FileHash $skepticPath).Hash, (Get-FileHash $registryPath).Hash)
            Find-PolicyAction -POV skeptic -RepoRoot $root -WhatIf -WarningAction SilentlyContinue *> $null
            @((Get-FileHash $skepticPath).Hash, (Get-FileHash $registryPath).Hash) | Should -Be $before
        }

        It '-DryRun calls no API and writes nothing' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            $before = @((Get-FileHash $skepticPath).Hash, (Get-FileHash $registryPath).Hash)
            Find-PolicyAction -POV skeptic -RepoRoot $root -DryRun -WarningAction SilentlyContinue *> $null
            Should -Invoke Invoke-AIApi -ModuleName AITriad -Times 0 -Exactly
            @((Get-FileHash $skepticPath).Hash, (Get-FileHash $registryPath).Hash) | Should -Be $before
        }

        It '[crashed pre-PR3] -PassThru reports processed nodes and actions found' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }, [ordered]@{ id = 'skp-b'; label = 'B' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{
                'skp-a' = @([ordered]@{ action = 'One'; framing = 'f' }, [ordered]@{ action = 'Two'; framing = 'f' })
                'skp-b' = @()
            }
            $r = Find-PolicyAction -POV skeptic -RepoRoot $root -PassThru -WarningAction SilentlyContinue 6> $null
            $r.Processed | Should -Be 2
            $r.ActionsFound | Should -Be 2
            $r.Failed | Should -Be 0
        }
    }

    Context 'intended behaviour changes (t/4004#3)' {

        It 'mints above an id already referenced on a node but missing from the registry (t/3431)' {
            Set-Fixture -Nodes @(
                [ordered]@{ id = 'skp-old'; label = 'Old'; graph_attributes = [ordered]@{ policy_actions = @([ordered]@{ action = 'Prior'; framing = 'f'; policy_id = 'pol-005' }) } }
                [ordered]@{ id = 'skp-a'; label = 'A' }
            ) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            Find-PolicyAction -POV skeptic -Id 'skp-a' -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Node 'skp-a').graph_attributes.policy_actions[0].policy_id | Should -Be 'pol-006'
        }

        It 'counts a reused id correctly (was untouched)' {
            Set-Fixture -Nodes @(
                [ordered]@{ id = 'skp-old'; label = 'Old'; graph_attributes = [ordered]@{ policy_actions = @([ordered]@{ action = 'Shared'; framing = 'f'; policy_id = 'pol-001' }) } }
                [ordered]@{ id = 'skp-a'; label = 'A' }
            ) -Policies @((Pol 'pol-001' 'Shared' 1))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Shared'; framing = 'f'; policy_id = 'pol-001' }) }
            Find-PolicyAction -POV skeptic -Id 'skp-a' -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Pol 'pol-001').member_count | Should -Be 2
        }

        It 'decrements an id a -Force re-analysis dropped (was untouched)' {
            Set-Fixture -Nodes @(
                [ordered]@{ id = 'skp-a'; label = 'A'; graph_attributes = [ordered]@{ policy_actions = @([ordered]@{ action = 'Gone'; framing = 'f'; policy_id = 'pol-001' }) } }
            ) -Policies @((Pol 'pol-001' 'Gone' 1))
            Set-Stub @{ 'skp-a' = @() }
            Find-PolicyAction -POV skeptic -Force -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Pol 'pol-001').member_count | Should -Be 0
        }

        It 'gives a new entry status active (was missing)' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            Find-PolicyAction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Pol 'pol-002').status | Should -Be 'active'
        }

        It 'creates the registry when none exists instead of leaving the id null' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies $null
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            Find-PolicyAction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null
            (Get-Node 'skp-a').graph_attributes.policy_actions[0].policy_id | Should -Be 'pol-001'
            (Get-Pol 'pol-001').action | Should -Be 'Brand new'
        }

        It 'a registration failure WARNs with the node ids and the remedy; the taxonomy write stands' {
            Set-Fixture -Nodes @([ordered]@{ id = 'skp-a'; label = 'A' }) -Policies @((Pol 'pol-001' 'Shared' 0))
            Set-Stub @{ 'skp-a' = @([ordered]@{ action = 'Brand new'; framing = 'f' }) }
            Mock Update-PolicyRegistry -ModuleName AITriad { throw 'registry is locked' }
            $warnings = $null
            Find-PolicyAction -POV skeptic -RepoRoot $root -WarningVariable warnings -WarningAction SilentlyContinue 6> $null | Out-Null
            $msg = @($warnings | ForEach-Object { "$_" }) -join "`n"
            $msg | Should -Match 'Find-PolicyAction: policy registration failed'
            $msg | Should -Match 'skp-a'
            $msg | Should -Match 'Update-PolicyRegistry -Fix'
            (Get-Node 'skp-a').graph_attributes.policy_actions[0].action | Should -Be 'Brand new'
        }
    }
}
