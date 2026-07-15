# Tag: taxonomy (t/1579 Phase 2)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Get-NodeTestingRecord — Phase 2 of t/1523 (ticket t/1579).
.DESCRIPTION
    Read-only projection of graph_attributes.debate_tested. Get-Tax is
    mocked so the cmdlet operates on a controlled synthetic node set —
    the point of the test is filter/sort/stale/fault semantics, not
    live taxonomy shape (that's covered by the smoke test in the ticket).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Helper to build a POV node with (or without) a debate_tested block.
    # PS 7 quirk: [PSCustomObject]@{} (empty) returns a Hashtable, not a
    # PSCustomObject — use New-Object PSObject -Property $ht which works
    # for empty AND non-empty inputs.
    $script:MakeNode = {
        param(
            [string]$Id, [string]$Pov, [string]$Category = 'Beliefs',
            [string]$Description = 'baseline description',
            [hashtable]$DT = $null,
            [hashtable]$Ga = @{}
        )
        $ga = New-Object PSObject -Property $Ga
        if ($DT) {
            $dtObj = New-Object PSObject -Property $DT
            Add-Member -InputObject $ga -MemberType NoteProperty -Name 'debate_tested' -Value $dtObj -Force
        }
        New-Object PSObject -Property @{
            Id              = $Id
            POV             = $Pov
            Category        = $Category
            Label           = "Label for $Id"
            Description     = $Description
            GraphAttributes = $ga
        }
    }

    # sha256:<hex> of "baseline description" — precomputed so stale-hash
    # cases can pin exactly one node as stale and one as fresh.
    $script:baselineHash = 'sha256:' + (
        [System.BitConverter]::ToString(
            [System.Security.Cryptography.SHA256]::Create().ComputeHash(
                [System.Text.Encoding]::UTF8.GetBytes('baseline description'))
        ).Replace('-', '').ToLower()
    )
}

Describe 'Get-NodeTestingRecord (t/1579 Phase 2)' -Tag 'taxonomy' {

    Context 'Filters + projection' {

        It 'Projects nodes with/without debate_tested; node without emits as untested' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode; H = $script:baselineHash } {
                param($Maker, $H)
                # Only return the two safetyist nodes — no need to simulate
                # Get-Tax's POV filter here, that's Get-Tax's contract not ours.
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'saf-beliefs-001' -Pov 'safetyist' -DT @{
                            tier='well_tested'; sort_key=3.5; engagements=4; challenges=3; held=2; weakened=0;
                            revisions=@(); last_tested='2026-07-01'; description_hash=$H; record=@()
                        })
                        (& $Maker -Id 'saf-desires-002' -Pov 'safetyist')  # no debate_tested
                    )
                }
                $r = Get-NodeTestingRecord -Pov saf 3>$null
                @($r).Count | Should -Be 2
                ($r | Where-Object { $_.NodeId -eq 'saf-beliefs-001' }).Tier      | Should -Be 'well_tested'
                ($r | Where-Object { $_.NodeId -eq 'saf-desires-002' }).Tier     | Should -Be 'untested'
                ($r | Where-Object { $_.NodeId -eq 'saf-desires-002' }).SortKey  | Should -Be 0
            }
        }

        It '-Tier well_tested returns only well_tested nodes' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode; H = $script:baselineHash } {
                param($Maker, $H)
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'n1' -Pov 'safetyist' -DT @{ tier='well_tested'; sort_key=3.5; engagements=4; challenges=3; held=2; weakened=0; revisions=@(); last_tested='2026-07-01'; description_hash=$H; record=@() })
                        (& $Maker -Id 'n2' -Pov 'safetyist' -DT @{ tier='cited';       sort_key=1.2; engagements=1; challenges=0; held=0; weakened=0; revisions=@(); last_tested='2026-06-01'; description_hash=$H; record=@() })
                    )
                }
                $r = Get-NodeTestingRecord -Tier well_tested 3>$null
                @($r).Count | Should -Be 1
                $r[0].NodeId | Should -Be 'n1'
            }
        }

        It '-Category desire filters to Desires' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode } {
                param($Maker)
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'n1' -Pov 'safetyist' -Category 'Beliefs')
                        (& $Maker -Id 'n2' -Pov 'safetyist' -Category 'Desires')
                    )
                }
                $r = Get-NodeTestingRecord -Category desire 3>$null
                @($r).Count       | Should -Be 1
                $r[0].NodeId      | Should -Be 'n2'
                $r[0].Category    | Should -Be 'Desires'
            }
        }
    }

    Context 'Sort orderings' {

        It '-SortBy Debate-Tested (default) orders descending by SortKey' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode; H = $script:baselineHash } {
                param($Maker, $H)
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'a' -Pov 'safetyist' -DT @{ tier='cited'; sort_key=1.5; engagements=1; challenges=0; held=0; weakened=0; revisions=@(); last_tested=''; description_hash=$H; record=@() })
                        (& $Maker -Id 'b' -Pov 'safetyist' -DT @{ tier='well_tested'; sort_key=3.7; engagements=4; challenges=2; held=2; weakened=0; revisions=@(); last_tested=''; description_hash=$H; record=@() })
                        (& $Maker -Id 'c' -Pov 'safetyist' -DT @{ tier='contested'; sort_key=2.4; engagements=2; challenges=1; held=1; weakened=0; revisions=@(); last_tested=''; description_hash=$H; record=@() })
                    )
                }
                $r = Get-NodeTestingRecord 3>$null
                @($r.NodeId) | Should -Be @('b', 'c', 'a')
            }
        }

        It '-SortBy Deficit ranks high-structural-signal untested over no-signal well-tested (t/1588)' {
            InModuleScope AITriad -Parameters @{ H = $script:baselineHash } {
                param($H)
                # t/1588: importance now derives from node STRUCTURE
                # (children/situation_refs/conflict_ids/policy_actions/
                # debate_refs/doctrinally_anchored) + aggregated-cruxes count,
                # normalized divide-by-max across the batch. hi-untested carries
                # max signals on every axis; lo-well-tested carries none.
                Mock Get-Tax {
                    @(
                        [PSCustomObject]@{
                            Id = 'hi-untested'; POV = 'safetyist'; Category = 'Beliefs'
                            Label = 'Hi'; Description = 'x'
                            Children            = @('c1','c2','c3','c4','c5')
                            SituationRefs       = @('sit-1','sit-2')
                            ConflictIds         = @('conf-1','conf-2','conf-3')
                            DoctrinallyAnchored = $true
                            DebateRefs          = @('d1','d2','d3','d4')
                            GraphAttributes = [PSCustomObject]@{
                                policy_actions = @('pol-1','pol-2','pol-3')
                            }
                        }
                        [PSCustomObject]@{
                            Id = 'lo-well-tested'; POV = 'safetyist'; Category = 'Beliefs'
                            Label = 'Lo'; Description = 'x'
                            Children            = @()
                            SituationRefs       = @()
                            ConflictIds         = @()
                            DoctrinallyAnchored = $false
                            DebateRefs          = @()
                            GraphAttributes = [PSCustomObject]@{
                                debate_tested = [PSCustomObject]@{
                                    tier='well_tested'; sort_key=3.9; engagements=8; challenges=4; held=4; weakened=0
                                    revisions=@(); last_tested='2026-07-01'; description_hash=$H; record=@()
                                }
                            }
                        }
                    )
                }
                # Mock Get-CruxLinkCount so we don't touch the real
                # aggregated-cruxes.json in the test scope.
                Mock Get-CruxLinkCount { @{ 'hi-untested' = 7 } }

                $r = Get-NodeTestingRecord -SortBy Deficit 3>$null
                @($r.NodeId) | Should -Be @('hi-untested', 'lo-well-tested')
                $r[0].TestingPriority | Should -BeGreaterThan $r[1].TestingPriority
                # hi-untested is normalized to 1.0 on every axis, so importance
                # = 0.25 + 0.15 + 0.25 + 0.20 + 0.15 = 1.0. Deficit for untested
                # is 1.0, so testing_priority = 1.0.
                $r[0].Importance      | Should -Be 1.0 -Because 'all 5 signals normalize to 1.0'
                $r[0].TestingPriority | Should -Be 1.0
                # lo-well-tested has zero raw signals → importance 0, deficit 0.1.
                $r[1].Importance      | Should -Be 0.0
            }
        }
    }

    Context 'Staleness detection' {

        It 'Stale=$true when current description hash differs from recorded hash' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode } {
                param($Maker)
                # Node's Description is 'edited description' but the recorded hash
                # is for 'baseline description' — hash mismatch → Stale=$true.
                $wrongHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'stale-1' -Pov 'safetyist' -Description 'edited description' -DT @{
                            tier='contested'; sort_key=2.0; engagements=1; challenges=1; held=1; weakened=0;
                            revisions=@(); last_tested='2026-07-01'; description_hash=$wrongHash; record=@()
                        })
                    )
                }
                $r = Get-NodeTestingRecord -Stale 3>$null
                @($r).Count | Should -Be 1
                $r[0].Stale | Should -BeTrue
            }
        }

        It 'Not stale when current hash matches recorded hash' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode; H = $script:baselineHash } {
                param($Maker, $H)
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'fresh' -Pov 'safetyist' -DT @{
                            tier='contested'; sort_key=2.0; engagements=1; challenges=1; held=1; weakened=0;
                            revisions=@(); last_tested='2026-07-01'; description_hash=$H; record=@()
                        })
                    )
                }
                $r = Get-NodeTestingRecord 3>$null
                $r[0].Stale | Should -BeFalse
            }
        }

        It 'Stale=$true when description was DELETED to empty (guards CL t/1579#4 false-negative)' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode } {
                param($Maker)
                # Description is now empty (rolled back / deleted) but recorded
                # hash is a real value. This IS drift and must flag stale.
                $someHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'emptied' -Pov 'safetyist' -Description '' -DT @{
                            tier='contested'; sort_key=2.0; engagements=1; challenges=1; held=1; weakened=0;
                            revisions=@(); last_tested='2026-07-01'; description_hash=$someHash; record=@()
                        })
                    )
                }
                $r = Get-NodeTestingRecord 3>$null
                $r[0].Stale | Should -BeTrue -Because 'empty current description ≠ non-empty recorded hash — CL review t/1579#4'
            }
        }
    }

    Context 'ChallengerCamps projection' {

        It 'Deduplicates challenger camps across record entries' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode; H = $script:baselineHash } {
                param($Maker, $H)
                $rec = @(
                    [PSCustomObject]@{ debate_id='d1'; verdict='held'; strongest_attack_encountered=[PSCustomObject]@{ challenger_camp='accelerationist'; strength=0.7; claim_id='c1'; scheme='rebut' } }
                    [PSCustomObject]@{ debate_id='d2'; verdict='held'; strongest_attack_encountered=[PSCustomObject]@{ challenger_camp='accelerationist'; strength=0.6; claim_id='c2'; scheme='rebut' } }
                    [PSCustomObject]@{ debate_id='d3'; verdict='held'; strongest_attack_encountered=[PSCustomObject]@{ challenger_camp='skeptic';        strength=0.8; claim_id='c3'; scheme='rebut' } }
                )
                Mock Get-Tax {
                    @(
                        (& $Maker -Id 'multi-camp' -Pov 'safetyist' -DT @{
                            tier='well_tested'; sort_key=3.9; engagements=3; challenges=3; held=3; weakened=0;
                            revisions=@(); last_tested='2026-07-03'; description_hash=$H; record=$rec
                        })
                    )
                }
                $r = Get-NodeTestingRecord 3>$null
                @($r[0].ChallengerCamps).Count | Should -Be 2
                @($r[0].ChallengerCamps)       | Should -Contain 'accelerationist'
                @($r[0].ChallengerCamps)       | Should -Contain 'skeptic'
            }
        }
    }

    Context 'Fault: missing/null debate_tested' {

        It 'Handles a graph_attributes with debate_tested = $null without throwing' {
            InModuleScope AITriad -Parameters @{ Maker = $script:MakeNode } {
                param($Maker)
                # Craft a node with graph_attributes.debate_tested EXPLICITLY null.
                $node = & $Maker -Id 'null-dt' -Pov 'safetyist'
                Add-Member -InputObject $node.GraphAttributes -MemberType NoteProperty -Name 'debate_tested' -Value $null -Force
                Mock Get-Tax { @($node) }
                { Get-NodeTestingRecord 3>$null } | Should -Not -Throw
                $r = Get-NodeTestingRecord 3>$null
                $r[0].Tier | Should -Be 'untested'
            }
        }
    }
}
