# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both-arms proof for the t/3584 inquiry data-presence assertion (Test-InquiryDataPresence),
    the ADR-001 silent-empty escape catcher. Exercises the pure verdict helper against
    fixtures — no auth/network — so the escape-catcher logic is proven independently of a live
    hosted run (which needs a real authenticated session and is verified on-demand per t/3584).
#>

Describe 'Test-InquiryDataPresence — ADR-001 empty-shell catcher (t/3584)' -Tag 'health', 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../scripts/AITriad/Private/Test-InquiryDataPresence.ps1"

        # A fully-populated InquiryResult (the PASS shape) as [pscustomobject] — the shape
        # ConvertFrom-Json yields from a real GET /api/inquiry/:jobId response.
        function script:New-RealResult {
            [pscustomobject]@{
                campVerdicts = @(
                    [pscustomobject]@{ camp = 'acc'; verdict = 'supports'; nodes = @('acc-bel-001') },
                    [pscustomobject]@{ camp = 'saf'; verdict = 'opposes'; nodes = @('saf-bel-002') }
                )
                calibration  = @(
                    [pscustomobject]@{ metric = 'grounding-coverage'; value = 0.82; trust = [pscustomobject]@{ verdict = 'trust' } }
                )
                grounding    = [pscustomobject]@{
                    anchorSituationId = 'sit-101'
                    nodesByCamp = [pscustomobject]@{
                        acc = @([pscustomobject]@{ nodeId = 'acc-bel-001'; label = 'x'; camp = 'acc' })
                        saf = @([pscustomobject]@{ nodeId = 'saf-bel-002'; label = 'y'; camp = 'saf' })
                    }
                }
            }
        }
    }

    Context 'PASS arm — real data' {
        It 'passes when campVerdicts, calibration, and grounding nodes are all present' {
            $r = Test-InquiryDataPresence -Result (script:New-RealResult)
            $r.Pass | Should -BeTrue
            $r.CampVerdicts | Should -Be 2
            $r.Calibration | Should -Be 1
            $r.GroundingNodes | Should -Be 2
            $r.Reasons.Count | Should -Be 0
        }
    }

    Context 'FAIL arm — ADR-001 graceful-empty shell (the escape)' {
        It 'fails on the empty-but-valid shell, naming all three empties' {
            $empty = [pscustomobject]@{
                campVerdicts = @()
                calibration  = @()
                grounding    = [pscustomobject]@{ nodesByCamp = [pscustomobject]@{} }
            }
            $r = Test-InquiryDataPresence -Result $empty
            $r.Pass | Should -BeFalse
            $r.CampVerdicts | Should -Be 0
            $r.GroundingNodes | Should -Be 0
            ($r.Reasons -join ' ') | Should -Match 'campVerdicts'
            ($r.Reasons -join ' ') | Should -Match 'calibration'
            ($r.Reasons -join ' ') | Should -Match 'grounding'
        }

        It 'fails on a null result' {
            $r = Test-InquiryDataPresence -Result $null
            $r.Pass | Should -BeFalse
            $r.GroundingNodes | Should -Be 0
        }
    }

    Context 'partial-empty — ALL three arrays are required' {
        It 'fails when only campVerdicts is empty' {
            $x = script:New-RealResult
            $x.campVerdicts = @()
            $r = Test-InquiryDataPresence -Result $x
            $r.Pass | Should -BeFalse
            ($r.Reasons -join ' ') | Should -Match 'campVerdicts'
        }
        It 'fails when only calibration is empty' {
            $x = script:New-RealResult
            $x.calibration = @()
            (Test-InquiryDataPresence -Result $x).Pass | Should -BeFalse
        }
        It 'fails when only grounding nodes are empty' {
            $x = script:New-RealResult
            $x.grounding.nodesByCamp = [pscustomobject]@{}
            (Test-InquiryDataPresence -Result $x).Pass | Should -BeFalse
        }
    }

    Context 'edges' {
        It 'counts a censored calibration entry (null value) as present — gate is entry-count, not value' {
            $x = script:New-RealResult
            $x.calibration = @([pscustomobject]@{ metric = 'depth'; value = $null; trust = [pscustomobject]@{ verdict = 'censored' } })
            $r = Test-InquiryDataPresence -Result $x
            $r.Pass | Should -BeTrue                 # entry present → not the empty shell
            $r.Calibration | Should -Be 1
            $r.CalibrationWithValue | Should -Be 0   # diagnostic: no value
        }
        It 'accepts hashtable-shaped input as well as [pscustomobject]' {
            $h = @{
                campVerdicts = @(@{ camp = 'acc' })
                calibration  = @(@{ metric = 'm'; value = 1 })
                grounding    = @{ nodesByCamp = @{ acc = @(@{ nodeId = 'n1' }) } }
            }
            (Test-InquiryDataPresence -Result $h).Pass | Should -BeTrue
        }
    }
}
