# Tag: policy-registration (t/4004)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/4004: Invoke-AttributeExtraction wrote policy_actions with a null policy_id and never registered
    them; they stayed null until an unrelated Update-PolicyRegistry -Fix swept them up.
.DESCRIPTION
    Drives a real Invoke-AttributeExtraction call (stubbed AI response) and asserts on the WRITTEN
    taxonomy file and registry. The AC check fails if the Step 7 registration call is removed.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
    Import-Module "$PSScriptRoot/../scripts/AIEnrich.psm1" -Force -WarningAction SilentlyContinue
    . (Join-Path $PSScriptRoot 'PolicyPovFixture.ps1')
}

Describe 'Invoke-AttributeExtraction -- registers the policy actions it writes (t/4004)' -Tag 'policy-registration' {

    BeforeEach {
        $script:root   = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:taxDir = Join-Path $root 'taxonomy'
        New-Item -ItemType Directory -Path $taxDir -Force | Out-Null

        # skp-new has no graph_attributes, so a plain (non -Force) run extracts it.
        # skp-done already has attributes and is not re-extracted; its unregistered action must stay
        # unregistered (scoped registration touches only the nodes this run wrote).
        $skeptic = [ordered]@{
            last_modified = '2026-01-01'
            nodes = @(
                [ordered]@{ id = 'skp-new'; label = 'New node' }
                [ordered]@{ id = 'skp-done'; label = 'Done'; graph_attributes = [ordered]@{
                        policy_actions = @([ordered]@{ action = 'Somebody else''s action' }) } }
            )
        }
        $script:skepticPath = Join-Path $taxDir 'skeptic.json'
        Set-Content -Path $skepticPath -Value ($skeptic | ConvertTo-Json -Depth 10) -Encoding utf8
        Add-PolicyPovFillers -Dir $taxDir
        $registry = [ordered]@{ _schema_version = '1.0.0'; _doc = 'x'; policy_count = 1; policies = @(
                [ordered]@{ id = 'pol-007'; action = 'Existing'; source_povs = @('skeptic'); member_count = 0; status = 'active' }) }
        $script:registryPath = Join-Path $taxDir 'policy_actions.json'
        Set-Content -Path $registryPath -Value ($registry | ConvertTo-Json -Depth 10) -Encoding utf8

        Mock Get-TaxonomyDir  -ModuleName AITriad { $script:taxDir }
        Mock Resolve-AIApiKey -ModuleName AITriad { 'fake-key' }
        Mock Get-Prompt       -ModuleName AITriad { 'prompt text' }

        $script:stubResponse = [ordered]@{
            'skp-new' = [ordered]@{
                epistemic_type         = 'x'
                rhetorical_strategy    = 'x'
                assumes                = @()
                falsifiability         = 'x'
                audience               = 'x'
                emotional_register     = 'x'
                policy_actions         = @([ordered]@{ action = 'Fund evals'; framing = 'f' }, [ordered]@{ action = 'Audit labs'; framing = 'f' })
                intellectual_lineage   = @()
                steelman_vulnerability = 'x'
                possible_fallacies     = @()
            }
        } | ConvertTo-Json -Depth 10 -Compress
        Mock Invoke-AIApi -ModuleName AITriad { [PSCustomObject]@{ Text = $script:stubResponse } }
    }

    It 'AC: after a run, the written node has no unregistered actions, with no separate -Fix' {
        Invoke-AttributeExtraction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null

        $node = @((Get-Content -Raw $skepticPath | ConvertFrom-Json).nodes | Where-Object id -eq 'skp-new')[0]
        @($node.graph_attributes.policy_actions | ForEach-Object { $_.policy_id }) | Should -Be @('pol-008', 'pol-009')
        $ids = @((Get-Content -Raw $registryPath | ConvertFrom-Json).policies.id)
        $ids | Should -Contain 'pol-008'
        $ids | Should -Contain 'pol-009'

        $r = InModuleScope AITriad { Update-PolicyRegistry -NodeId 'skp-new' -PassThru 6> $null }
        $r.Unregistered | Should -Be 0
    }

    It 'registers only the nodes it wrote: an untouched node''s unregistered action stays unregistered' {
        Invoke-AttributeExtraction -POV skeptic -RepoRoot $root -WarningAction SilentlyContinue *> $null
        $done = @((Get-Content -Raw $skepticPath | ConvertFrom-Json).nodes | Where-Object id -eq 'skp-done')[0]
        $done.graph_attributes.policy_actions[0].PSObject.Properties['policy_id'] | Should -BeNullOrEmpty
    }

    It 'a registration failure WARNs with the node ids and the remedy, and the taxonomy write stands' {
        Mock Update-PolicyRegistry -ModuleName AITriad { throw 'registry is locked' }
        $warnings = $null
        Invoke-AttributeExtraction -POV skeptic -RepoRoot $root -WarningVariable warnings -WarningAction SilentlyContinue 6> $null | Out-Null

        $msg = @($warnings | ForEach-Object { "$_" }) -join "`n"
        $msg | Should -Match 'policy registration failed'
        $msg | Should -Match 'skp-new'
        $msg | Should -Match 'registry is locked'
        $msg | Should -Match 'Update-PolicyRegistry -Fix'
        $node = @((Get-Content -Raw $skepticPath | ConvertFrom-Json).nodes | Where-Object id -eq 'skp-new')[0]
        @($node.graph_attributes.policy_actions).Count | Should -Be 2
    }

    It '-WhatIf writes nothing and registers nothing' {
        Mock Update-PolicyRegistry -ModuleName AITriad { }
        $before = (Get-FileHash $skepticPath).Hash
        Invoke-AttributeExtraction -POV skeptic -RepoRoot $root -WhatIf -WarningAction SilentlyContinue *> $null
        (Get-FileHash $skepticPath).Hash | Should -Be $before
        Should -Invoke Update-PolicyRegistry -ModuleName AITriad -Times 0 -Exactly
    }

    It 'passes the ids the node held before the merge as -PriorPolicyIds' {
        $s = Get-Content -Raw $skepticPath | ConvertFrom-Json
        $s.nodes[0] | Add-Member -NotePropertyName graph_attributes -NotePropertyValue ([pscustomobject]@{
                policy_actions = @([pscustomobject]@{ action = 'Old'; policy_id = 'pol-007' }) })
        Set-Content -Path $skepticPath -Value ($s | ConvertTo-Json -Depth 10) -Encoding utf8
        Mock Update-PolicyRegistry -ModuleName AITriad { }
        Invoke-AttributeExtraction -POV skeptic -Force -RepoRoot $root -WarningAction SilentlyContinue *> $null
        Should -Invoke Update-PolicyRegistry -ModuleName AITriad -Times 1 -Exactly -ParameterFilter {
            # skp-done is extracted under -Force but absent from the stub response, so it is never written.
            $Fix -and (@($NodeId) -join ',') -eq 'skp-new' -and (@($PriorPolicyIds) -join ',') -eq 'pol-007'
        }
    }
}
