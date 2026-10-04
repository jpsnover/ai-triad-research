# Tag: taxonomy (t/3887)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both arms, both PowerShell situation creators (t/3887): a situation can only be
    committed with BDI-shaped interpretations, or not at all.
.DESCRIPTION
    t/3671's 5th recurrence: Set-TaxonomyHierarchy minted sit-* nodes with flat
    empty interpretations, never calling the write-time BDI gate (t/2332) that
    Invoke-ProposalApply already respected. Both creators now call the single
    shared helper, New-SituationNode, which carries the gate. These tests pin:
      - Invoke-ProposalApply (NEW, situations): gate success writes BDI-shaped
        interpretations; gate failure commits nothing (Success=false, pre-existing
        coverage in Set-SituationBdiInterpretation.Tests.ps1 -- not duplicated here).
      - Set-TaxonomyHierarchy (cross-cutting parent mint): gate success writes
        BDI-shaped interpretations; gate failure skips the parent AND its children
        (TL review condition: the `continue` is at parent-loop level, so no child
        is left pointing at an unminted parent_id); a collision bump resolves the
        FINAL id before the gate call sees it (TL review condition).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:GoodBdiJson = @'
{
  "accelerationist": { "belief": "b-acc", "desire": "d-acc", "intention": "i-acc", "summary": "s-acc" },
  "safetyist":       { "belief": "b-saf", "desire": "d-saf", "intention": "i-saf", "summary": "s-saf" },
  "skeptic":         { "belief": "b-skp", "desire": "d-skp", "intention": "i-skp", "summary": "s-skp" }
}
'@

    function Write-HierarchyFixture([string]$Dir) {
        @{
            nodes = @(
                @{ id = 'acc-beliefs-001'; category = 'Beliefs'; label = 'Existing child'; parent_id = $null; children = @(); situation_refs = @() }
            )
            last_modified = '2026-01-01'
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'accelerationist.json')
        @{ nodes = @(); last_modified = '2026-01-01' } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'safetyist.json')
        @{ nodes = @(); last_modified = '2026-01-01' } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'skeptic.json')
        @{ nodes = @(); last_modified = '2026-01-01' } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'situations.json')
    }

    function Write-HierarchyProposal([string]$Path, [object[]]$Parents) {
        @{
            buckets = @(
                @{
                    pov      = 'situations'
                    category = $null
                    parents  = $Parents
                }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path $Path
    }
}

Describe 'Invoke-ProposalApply (NEW, situations) — shared helper (t/3887)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tti-propapply-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null
        @{ nodes = @(); last_modified = '2026-01-01' } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'situations.json')
    }

    AfterEach {
        Remove-Item -Path $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'writes BDI-shaped interpretations via the shared helper on gate success' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir; Good = $script:GoodBdiJson } {
            param($TempDir, $Good)
            Mock Get-TaxonomyDir { $TempDir }
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }
            $proposal = [pscustomobject]@{
                action       = 'NEW'
                pov          = 'situations'
                suggested_id = 'sit-99910'
                category     = $null
                label        = 'A contested scenario'
                description  = 'A fresh situation node that should pass BDI enrichment.'
            }
            $result = Invoke-ProposalApply -Proposal $proposal
            $result.Success | Should -Be $true -Because ($result.Error)

            $Situations = Get-Content -Raw (Join-Path $TempDir 'situations.json') | ConvertFrom-Json
            @($Situations.nodes).Count | Should -Be 1
            $Situations.nodes[0].interpretations.accelerationist.belief | Should -Be 'b-acc'
        }
    }
}

Describe 'Set-TaxonomyHierarchy (cross-cutting mint) — shared helper (t/3887)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tti-hier-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null
        Write-HierarchyFixture -Dir $script:TempDir
    }

    AfterEach {
        Remove-Item -Path $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'mints a situations parent with BDI-shaped interpretations on gate success' {
        $ProposalPath = Join-Path $script:TempDir 'proposal.json'
        Write-HierarchyProposal -Path $ProposalPath -Parents @(
            @{ label = 'New situation parent'; description = 'desc'; children = @(); promoted_from = $null }
        )
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir; ProposalPath = $ProposalPath; Good = $script:GoodBdiJson } {
            param($TempDir, $ProposalPath, $Good)
            Mock Get-TaxonomyDir { $TempDir }
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }

            Set-TaxonomyHierarchy -ProposalFile $ProposalPath -Confirm:$false | Out-Null

            $Situations = Get-Content -Raw (Join-Path $TempDir 'situations.json') | ConvertFrom-Json
            @($Situations.nodes).Count | Should -Be 1
            $Node = $Situations.nodes[0]
            $Node.id | Should -Match '^sit-\d{3}$'
            $Node.interpretations.accelerationist.belief | Should -Be 'b-acc'
            $Node.interpretations.skeptic.summary         | Should -Be 's-skp'
        }
    }

    It 'skips the parent AND its children when the gate fails -- no child points at an unminted parent_id' {
        $ProposalPath = Join-Path $script:TempDir 'proposal.json'
        Write-HierarchyProposal -Path $ProposalPath -Parents @(
            @{
                label       = 'Parent whose decomposition will fail'
                description = 'desc'
                children    = @(@{ node_id = 'acc-beliefs-001'; relationship = 'is_a'; rationale = 'r' })
                promoted_from = $null
            }
        )
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir; ProposalPath = $ProposalPath } {
            param($TempDir, $ProposalPath)
            Mock Get-TaxonomyDir { $TempDir }
            Mock Set-SituationBdiInterpretation { throw 'enrichment failed' }

            $Stats = Set-TaxonomyHierarchy -ProposalFile $ProposalPath -Confirm:$false -WarningAction SilentlyContinue

            $Stats.Errors | Should -Be 1
            $Stats.NewParents | Should -Be 0
            $Stats.ChildAssignments | Should -Be 0 -Because 'the continue must be at parent-loop level -- the child-assignment block below the mint must never run for a failed parent'

            $Situations = Get-Content -Raw (Join-Path $TempDir 'situations.json') | ConvertFrom-Json
            @($Situations.nodes).Count | Should -Be 0 -Because 'no partially-minted situation node should be committed'

            $Accel = Get-Content -Raw (Join-Path $TempDir 'accelerationist.json') | ConvertFrom-Json
            $Accel.nodes[0].parent_id | Should -BeNullOrEmpty -Because 'the child must not be pointed at a parent that was never minted'
        }
    }

    It 'resolves the collision-bumped id BEFORE the gate call sees it' {
        # Pre-seed situations.json with sit-001 so the first computed id collides.
        $Situations = Get-Content -Raw (Join-Path $script:TempDir 'situations.json') | ConvertFrom-Json
        $Situations.nodes = @(
            [pscustomobject]@{ id = 'sit-001'; label = 'Pre-existing'; description = ''; interpretations = [pscustomobject]@{ accelerationist = ''; safetyist = ''; skeptic = '' }; linked_nodes = @(); conflict_ids = @() }
        )
        $Situations | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'situations.json')

        $ProposalPath = Join-Path $script:TempDir 'proposal.json'
        Write-HierarchyProposal -Path $ProposalPath -Parents @(
            @{ label = 'Collides with sit-001'; description = 'desc'; children = @(); promoted_from = $null }
        )
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir; ProposalPath = $ProposalPath; Good = $script:GoodBdiJson } {
            param($TempDir, $ProposalPath, $Good)
            Mock Get-TaxonomyDir { $TempDir }
            $SeenIds = [System.Collections.Generic.List[string]]::new()
            Mock Invoke-AIByUsage {
                param($UsageId, $Values, $FallbackModels)
                $SeenIds.Add($Values.situation_id)
                [pscustomobject]@{ Text = $Good }
            }

            Set-TaxonomyHierarchy -ProposalFile $ProposalPath -Confirm:$false | Out-Null

            $SeenIds.Count | Should -Be 1
            $SeenIds[0] | Should -Be 'sit-002' -Because 'the gate must see the FINAL post-collision id, not the provisional sit-001 that already existed'
        }
    }
}
