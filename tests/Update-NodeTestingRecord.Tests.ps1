# Tag: taxonomy (t/1579 Phase 2)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Update-NodeTestingRecord — Phase 2 of t/1523 (ticket t/1579).
.DESCRIPTION
    Recompute pure function is exercised by
    tests/Get-DebateTestedTier.Tests.ps1 against the shared JSON fixture
    (AC #10 cross-language consistency). This suite covers the cmdlet's
    file-scan + selective-rewrite + WhatIf + idempotence + fault
    behavior.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:workDir = Join-Path ([System.IO.Path]::GetTempPath()) "updtestrec-$(Get-Random)"
    $null = New-Item -ItemType Directory -Path $script:workDir -Force

    # Baseline POV file with one node whose stored tier is deliberately WRONG
    # (should be well_tested but stored as untested) and one node that's
    # already correct → run should update exactly 1 node.
    $script:povContent = @{
        nodes = @(
            @{
                id = 'saf-beliefs-001'
                label = 'Wrong tier stored — should recompute to well_tested'
                description = 'baseline description'
                graph_attributes = @{
                    debate_tested = @{
                        tier = 'untested'      # WRONG — should be well_tested
                        sort_key = 0.0          # WRONG — should be ~3.x
                        engagements = 2
                        challenges = 2
                        held = 2
                        weakened = 0
                        revisions = @()
                        last_tested = '2026-07-02'
                        description_hash = 'sha256:test'
                        record = @(
                            @{ debate_id='d1'; date='2026-07-01'; pipeline_version='v'; verdict='held';
                               strongest_attack_encountered=@{ claim_id='c1'; strength=0.7; scheme='rebut'; challenger_camp='acc' };
                               claim_outcomes=@{ thrived=2; survived=1; died=0 }; concession=$null }
                            @{ debate_id='d2'; date='2026-07-02'; pipeline_version='v'; verdict='held';
                               strongest_attack_encountered=@{ claim_id='c2'; strength=0.7; scheme='rebut'; challenger_camp='saf' };
                               claim_outcomes=@{ thrived=2; survived=1; died=0 }; concession=$null }
                        )
                    }
                }
            }
            @{
                id = 'saf-beliefs-002'
                label = 'Correctly-stored contested node'
                description = 'baseline'
                graph_attributes = @{
                    debate_tested = @{
                        tier = 'contested'
                        sort_key = 2.14
                        engagements = 1
                        challenges = 1
                        held = 1
                        weakened = 0
                        revisions = @()
                        last_tested = '2026-07-01'
                        description_hash = 'sha256:test2'
                        record = @(
                            @{ debate_id='d1'; date='2026-07-01'; pipeline_version='v'; verdict='held';
                               strongest_attack_encountered=@{ claim_id='c1'; strength=0.7; scheme='rebut'; challenger_camp='acc' };
                               claim_outcomes=@{ thrived=2; survived=1; died=0 }; concession=$null }
                        )
                    }
                }
            }
            @{
                id = 'saf-desires-003'
                label = 'Node without debate_tested — must be skipped, never mutated'
                description = 'no record'
                graph_attributes = @{ falsifiability = 'medium' }
            }
        )
    }
}

AfterAll {
    if ($script:workDir -and (Test-Path $script:workDir)) {
        Remove-Item -Recurse -Force $script:workDir -ErrorAction SilentlyContinue
    }
}

Describe 'Update-NodeTestingRecord -RecomputeOnly (t/1579 Phase 2)' -Tag 'taxonomy' {

    BeforeEach {
        # Write the seed POV file into the per-test taxonomy dir.
        $povPath = Join-Path $script:workDir 'safetyist.json'
        $script:povContent | ConvertTo-Json -Depth 20 | Set-Content -Path $povPath -Encoding utf8NoBOM
    }

    It '-WhatIf reports the correctly-mismatched node without writing' {
        InModuleScope AITriad -Parameters @{ WorkDir = $script:workDir } {
            param($WorkDir)
            Mock Get-TaxonomyDir { $WorkDir }
            $bytesBefore = (Get-Item (Join-Path $WorkDir 'safetyist.json')).Length

            $changes = Update-NodeTestingRecord -RecomputeOnly -Pov saf -WhatIf 6>$null
            $changes = @($changes | Where-Object { $_ -is [PSCustomObject] })

            $changes.Count            | Should -Be 1
            $changes[0].NodeId        | Should -Be 'saf-beliefs-001'
            $changes[0].OldTier       | Should -Be 'untested'
            $changes[0].NewTier       | Should -Be 'well_tested'
            $changes[0].OldSortKey    | Should -Be 0
            $changes[0].NewSortKey    | Should -BeGreaterOrEqual 3

            # File must be untouched (byte-count invariant is enough since we
            # know nothing else runs against WorkDir under -WhatIf).
            (Get-Item (Join-Path $WorkDir 'safetyist.json')).Length | Should -Be $bytesBefore
        }
    }

    It 'Live run rewrites tier + sort_key and leaves historical fields untouched' {
        InModuleScope AITriad -Parameters @{ WorkDir = $script:workDir } {
            param($WorkDir)
            Mock Get-TaxonomyDir { $WorkDir }

            $before = Get-Content (Join-Path $WorkDir 'safetyist.json') -Raw | ConvertFrom-Json
            $beforeNode = $before.nodes | Where-Object { $_.id -eq 'saf-beliefs-001' }
            $beforeRecordCount = @($beforeNode.graph_attributes.debate_tested.record).Count
            $beforeEngagements = $beforeNode.graph_attributes.debate_tested.engagements
            $beforeLastTested  = $beforeNode.graph_attributes.debate_tested.last_tested
            $beforeDescHash    = $beforeNode.graph_attributes.debate_tested.description_hash

            $changes = Update-NodeTestingRecord -RecomputeOnly -Pov saf -Confirm:$false 6>$null
            $changes = @($changes | Where-Object { $_ -is [PSCustomObject] })
            $changes.Count | Should -Be 1

            $after = Get-Content (Join-Path $WorkDir 'safetyist.json') -Raw | ConvertFrom-Json
            $afterNode = $after.nodes | Where-Object { $_.id -eq 'saf-beliefs-001' }

            # Tier + sort_key updated
            $afterNode.graph_attributes.debate_tested.tier     | Should -Be 'well_tested'
            $afterNode.graph_attributes.debate_tested.sort_key | Should -BeGreaterOrEqual 3

            # Historical fields untouched (byte-for-byte on the ones this
            # cmdlet is contractually forbidden to rewrite).
            @($afterNode.graph_attributes.debate_tested.record).Count | Should -Be $beforeRecordCount
            $afterNode.graph_attributes.debate_tested.engagements     | Should -Be $beforeEngagements
            $afterNode.graph_attributes.debate_tested.last_tested     | Should -Be $beforeLastTested
            $afterNode.graph_attributes.debate_tested.description_hash| Should -Be $beforeDescHash
        }
    }

    It 'Idempotence: second live run reports zero changes' {
        InModuleScope AITriad -Parameters @{ WorkDir = $script:workDir } {
            param($WorkDir)
            Mock Get-TaxonomyDir { $WorkDir }

            $null = Update-NodeTestingRecord -RecomputeOnly -Pov saf -Confirm:$false 6>$null
            $second = Update-NodeTestingRecord -RecomputeOnly -Pov saf -Confirm:$false 6>$null
            $second = @($second | Where-Object { $_ -is [PSCustomObject] })
            $second.Count | Should -Be 0
        }
    }

    It '-NodeId scopes the rewrite; other nodes with wrong tiers are not touched' {
        InModuleScope AITriad -Parameters @{ WorkDir = $script:workDir } {
            param($WorkDir)
            Mock Get-TaxonomyDir { $WorkDir }

            $changes = Update-NodeTestingRecord -RecomputeOnly -Pov saf -NodeId 'saf-beliefs-002' -Confirm:$false 6>$null
            $changes = @($changes | Where-Object { $_ -is [PSCustomObject] })
            # saf-beliefs-002 was already correct (contested + 2.14), so 0 changes.
            $changes.Count | Should -Be 0

            # And saf-beliefs-001 (wrong tier) MUST still be wrong because it was scoped out.
            $after = Get-Content (Join-Path $WorkDir 'safetyist.json') -Raw | ConvertFrom-Json
            ($after.nodes | Where-Object { $_.id -eq 'saf-beliefs-001' }).graph_attributes.debate_tested.tier | Should -Be 'untested'
        }
    }

    It 'Fault: node without graph_attributes.debate_tested is skipped, never mutated' {
        InModuleScope AITriad -Parameters @{ WorkDir = $script:workDir } {
            param($WorkDir)
            Mock Get-TaxonomyDir { $WorkDir }
            { Update-NodeTestingRecord -RecomputeOnly -Pov saf -Confirm:$false 6>$null } | Should -Not -Throw

            # saf-desires-003 (no debate_tested) must still exist with the same shape.
            $after = Get-Content (Join-Path $WorkDir 'safetyist.json') -Raw | ConvertFrom-Json
            $n3 = $after.nodes | Where-Object { $_.id -eq 'saf-desires-003' }
            $n3 | Should -Not -BeNullOrEmpty
            $n3.graph_attributes.PSObject.Properties['debate_tested'] | Should -BeNullOrEmpty
        }
    }
}
