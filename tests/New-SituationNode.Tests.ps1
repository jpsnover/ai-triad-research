# Tag: taxonomy (t/3887)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the shared situation-creation helper (t/3887).
.DESCRIPTION
    New-SituationNode is the single creation path both Invoke-ProposalApply and
    Set-TaxonomyHierarchy call, so the write-time BDI gate (t/2332) cannot be
    forgotten by a second creator. These tests pin the helper's own contract in
    isolation; the per-creator integration is covered by
    SituationBdiGate.Creators.Tests.ps1.
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
}

Describe 'New-SituationNode (t/3887)' -Tag 'taxonomy' {

    It 'mints the standard skeleton and returns it BDI-decomposed on gate success' {
        InModuleScope AITriad -Parameters @{ Good = $script:GoodBdiJson } {
            param($Good)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }
            $node = New-SituationNode -Id 'sit-fixture-910' -Label 'A test situation' -Description 'A fixture description.'
            $node.id          | Should -Be 'sit-fixture-910'
            $node.label       | Should -Be 'A test situation'
            $node.description | Should -Be 'A fixture description.'
            @($node.linked_nodes).Count | Should -Be 0
            @($node.conflict_ids).Count | Should -Be 0
            $node.interpretations.accelerationist.belief | Should -Be 'b-acc'
            $node.interpretations.safetyist.intention    | Should -Be 'i-saf'
            $node.interpretations.skeptic.summary         | Should -Be 's-skp'
        }
    }

    It 'defaults Description to empty string when omitted' {
        InModuleScope AITriad -Parameters @{ Good = $script:GoodBdiJson } {
            param($Good)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }
            $node = New-SituationNode -Id 'sit-fixture-911' -Label 'No description'
            $node.description | Should -Be ''
        }
    }

    It 'propagates the gate''s failure (fail-closed) and never returns a node' {
        InModuleScope AITriad {
            Mock Set-SituationBdiInterpretation { throw 'enrichment failed' }
            { New-SituationNode -Id 'sit-fixture-912' -Label 'Will fail' } | Should -Throw -ExpectedMessage '*enrichment failed*'
        }
    }

    It 'fails closed (TL review condition 3) when the gate "succeeds" but returns a whole-value sentinel' {
        InModuleScope AITriad {
            Mock Set-SituationBdiInterpretation {
                param($Node)
                $Node.interpretations = [pscustomobject][ordered]@{
                    accelerationist = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'N/A'; summary = 's' }
                    safetyist       = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i';   summary = 's' }
                    skeptic         = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i';   summary = 's' }
                }
            }
            { New-SituationNode -Id 'sit-fixture-920' -Label 'Sentinel' } | Should -Throw -ExpectedMessage '*compliance classifier*'
        }
    }

    It 'fails closed on a mixed-case "none" sentinel (whole-value, case-insensitive)' {
        InModuleScope AITriad {
            Mock Set-SituationBdiInterpretation {
                param($Node)
                $Node.interpretations = [pscustomobject][ordered]@{
                    accelerationist = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i';    summary = 's' }
                    safetyist       = [pscustomobject]@{ belief = 'b'; desire = 'None'; intention = 'i'; summary = 's' }
                    skeptic         = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i';    summary = 's' }
                }
            }
            { New-SituationNode -Id 'sit-fixture-921' -Label 'Mixed-case none' } | Should -Throw -ExpectedMessage '*compliance classifier*'
        }
    }

    It 'fails closed on a bare "-" sentinel' {
        InModuleScope AITriad {
            Mock Set-SituationBdiInterpretation {
                param($Node)
                $Node.interpretations = [pscustomobject][ordered]@{
                    accelerationist = [pscustomobject]@{ belief = '-'; desire = 'd'; intention = 'i'; summary = 's' }
                    safetyist       = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                    skeptic         = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                }
            }
            { New-SituationNode -Id 'sit-fixture-922' -Label 'Bare dash' } | Should -Throw -ExpectedMessage '*compliance classifier*'
        }
    }

    It 'accepts a sentence that merely CONTAINS "none" (not a whole-value sentinel)' {
        InModuleScope AITriad {
            Mock Set-SituationBdiInterpretation {
                param($Node)
                $Node.interpretations = [pscustomobject][ordered]@{
                    accelerationist = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                    safetyist       = [pscustomobject]@{ belief = 'b'; desire = 'There is none of this camp agreeing'; intention = 'i'; summary = 's' }
                    skeptic         = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                }
            }
            { New-SituationNode -Id 'sit-fixture-923' -Label 'Sentence containing none' } | Should -Not -Throw
        }
    }

    It 'calls the gate with the exact node it minted (same id/label/description)' {
        InModuleScope AITriad -Parameters @{ Good = $script:GoodBdiJson } {
            param($Good)
            Mock Invoke-AIByUsage { [pscustomobject]@{ Text = $Good } }
            Mock Set-SituationBdiInterpretation -MockWith {
                param($Node)
                $Node.id | Should -Be 'sit-fixture-913'
                $Node.label | Should -Be 'Gate sees this'
                $Node.interpretations = [pscustomobject][ordered]@{
                    accelerationist = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                    safetyist       = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                    skeptic         = [pscustomobject]@{ belief = 'b'; desire = 'd'; intention = 'i'; summary = 's' }
                }
            } -Verifiable
            New-SituationNode -Id 'sit-fixture-913' -Label 'Gate sees this' | Out-Null
            Should -InvokeVerifiable
        }
    }
}
