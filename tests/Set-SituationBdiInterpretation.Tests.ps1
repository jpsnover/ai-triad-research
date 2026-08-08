# Tag: taxonomy (t/2332)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for write-time BDI-decomposition enforcement on new situation nodes
    (t/2332, TL fail-closed decision t/2332#4).
.NOTES
    Set-SituationBdiInterpretation (Private) enriches a minted situation node's
    interpretations via the CL-owned UsageID and FAILS CLOSED on any persistent
    failure. Invoke-ProposalApply skips that single proposal (per-node, additive)
    rather than committing a non-compliant node. AI is mocked — no live calls.

    The fixture node is built in script scope and passed into InModuleScope via
    -Parameters (a PSCustomObject is a reference, so in-scope mutations are visible
    to the assertions here). Fixtures defined in BeforeAll are NOT visible inside
    InModuleScope, which runs in the module's scope — hence the explicit passing.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    function New-FixtureSituationNode {
        # Mirrors the shape minted in Invoke-ProposalApply (NEW + situations).
        [pscustomobject][ordered]@{
            id              = 'sit-fixture-900'
            label           = 'A contested AGI governance scenario'
            description     = 'A situation where camps disagree on AGI oversight.'
            interpretations = [pscustomobject][ordered]@{
                accelerationist = ''
                safetyist       = ''
                skeptic         = ''
            }
            linked_nodes    = @()
            conflict_ids    = @()
        }
    }

    $script:GoodBdiJson = @'
{
  "accelerationist": { "belief": "b-acc", "desire": "d-acc", "intention": "i-acc", "summary": "s-acc" },
  "safetyist":       { "belief": "b-saf", "desire": "d-saf", "intention": "i-saf", "summary": "s-saf" },
  "skeptic":         { "belief": "b-skp", "desire": "d-skp", "intention": "i-skp", "summary": "s-skp" }
}
'@
}

Describe 'Set-SituationBdiInterpretation — success path (t/2332)' -Tag 'taxonomy' {

    It 'Populates all three POVs with non-empty belief/desire/intention/summary' {
        $node = New-FixtureSituationNode
        InModuleScope AITriad -Parameters @{ Node = $node; Good = $script:GoodBdiJson } {
            param($Node, $Good)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }
            Set-SituationBdiInterpretation -Node $Node
        }
        foreach ($pov in 'accelerationist', 'safetyist', 'skeptic') {
            $node.interpretations.$pov.belief    | Should -Not -BeNullOrEmpty
            $node.interpretations.$pov.desire    | Should -Not -BeNullOrEmpty
            $node.interpretations.$pov.intention | Should -Not -BeNullOrEmpty
            $node.interpretations.$pov.summary   | Should -Not -BeNullOrEmpty
        }
    }

    It 'Strips a ```json code fence before parsing' {
        $node = New-FixtureSituationNode
        $fenced = '```json' + "`n" + $script:GoodBdiJson + "`n" + '```'
        InModuleScope AITriad -Parameters @{ Node = $node; Fenced = $fenced } {
            param($Node, $Fenced)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Fenced } }
            { Set-SituationBdiInterpretation -Node $Node } | Should -Not -Throw
        }
        $node.interpretations.skeptic.belief | Should -Be 'b-skp'
    }

    It 'Passes a flash-lite backend fallback to the enrichment call' {
        $node = New-FixtureSituationNode
        InModuleScope AITriad -Parameters @{ Node = $node; Good = $script:GoodBdiJson } {
            param($Node, $Good)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }
            Set-SituationBdiInterpretation -Node $Node
            Should -Invoke Invoke-AIByUsage -Times 1 -ParameterFilter {
                $UsageId -eq 'enrichment.situation-bdi-decomposition' -and
                $FallbackModels -contains 'gemini-3.5-flash-lite'
            }
        }
    }
}

Describe 'Set-SituationBdiInterpretation — fail-closed paths (t/2332)' -Tag 'taxonomy' {

    It 'Throws when the AI call throws (after fallback) and leaves the node un-mutated' {
        $node = New-FixtureSituationNode
        InModuleScope AITriad -Parameters @{ Node = $node } {
            param($Node)
            Mock Invoke-AIByUsage { throw 'backend exhausted' }
            { Set-SituationBdiInterpretation -Node $Node } | Should -Throw
        }
        # Never mutated to a compliant-looking block — still the empty mint state.
        $node.interpretations.accelerationist | Should -Be ''
    }

    It 'Throws on an empty AI response' {
        $node = New-FixtureSituationNode
        InModuleScope AITriad -Parameters @{ Node = $node } {
            param($Node)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = '' } }
            { Set-SituationBdiInterpretation -Node $Node } | Should -Throw
        }
    }

    It 'Throws on invalid JSON' {
        $node = New-FixtureSituationNode
        InModuleScope AITriad -Parameters @{ Node = $node } {
            param($Node)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = 'not json at all' } }
            { Set-SituationBdiInterpretation -Node $Node } | Should -Throw
        }
    }

    It 'Throws on an incomplete decomposition (a POV missing intention)' {
        $node = New-FixtureSituationNode
        $partial = @'
{
  "accelerationist": { "belief": "b", "desire": "d", "intention": "i", "summary": "s" },
  "safetyist":       { "belief": "b", "desire": "d", "intention": "",  "summary": "s" },
  "skeptic":         { "belief": "b", "desire": "d", "intention": "i", "summary": "s" }
}
'@
        InModuleScope AITriad -Parameters @{ Node = $node; Partial = $partial } {
            param($Node, $Partial)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Partial } }
            { Set-SituationBdiInterpretation -Node $Node } | Should -Throw
        }
    }
}

Describe 'Invoke-ProposalApply — per-node skip on enrichment failure (t/2332)' -Tag 'taxonomy' {

    It 'Rejects a situation NEW proposal (Success=false) when BDI enrichment fails — before any write' {
        # Read-only: the fail-closed path returns before $Raw.nodes is appended or the
        # file is written, so this exercises the real Invoke-ProposalApply against the
        # live situations.json without mutating it. sit-99901 passes Test-PovNodeId
        # (^sit-\d{3,}$) and is far above the real corpus so the collision check clears.
        InModuleScope AITriad {
            Mock Set-SituationBdiInterpretation { throw 'enrichment failed' }
            $proposal = [pscustomobject]@{
                action       = 'NEW'
                pov          = 'situations'
                suggested_id = 'sit-99901'
                category     = $null
                label        = 'A contested scenario that fails enrichment'
                description  = 'A fresh situation node whose decomposition errors out.'
            }
            $result = Invoke-ProposalApply -Proposal $proposal
            $result.Success | Should -Be $false
            $result.Error   | Should -Match 'enrichment failed'
            Should -Invoke Set-SituationBdiInterpretation -Times 1
        }
    }
}
