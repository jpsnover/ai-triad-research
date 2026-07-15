# Tag: taxonomy (t/1579 AC #10 — cross-language consistency)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Cross-language consistency test for computeTierAndSortKey. AC #10 of t/1579.
.DESCRIPTION
    Reads the shared fixture at tests/fixtures/tier-sort-key-cases.json (the
    same file the TS vitest suite for debateTested.test.ts should consume) and
    runs every case through the PS port at Private/Get-DebateTestedTier.ps1.

    Any drift between the PS port and the TS single writer at
    lib/debate/debateTested.ts fails a case here — enforcing that the recompute
    cmdlet (Update-NodeTestingRecord -RecomputeOnly) stays byte-identical to
    the writer that produced the original tier + sort_key. Without this test,
    a subtle port bug surfaces as "recompute changed tiers the writer wouldn't
    have" — an undebuggable class of divergence the single-writer rule exists
    to prevent.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:fixturePath = Join-Path $PSScriptRoot 'fixtures' 'tier-sort-key-cases.json'
    $script:fixture = Get-Content $script:fixturePath -Raw | ConvertFrom-Json
    $script:results = @{}
}

Describe 'computeTierAndSortKey — cross-language consistency (t/1579 AC #10)' -Tag 'taxonomy' {

    Context 'Case-by-case tier + sort_key expectations' {

        It 'Every fixture case matches the expected tier (and sort_key range if specified)' {
            InModuleScope AITriad -Parameters @{ Fixture = $script:fixture; Results = $script:results } {
                param($Fixture, $Results)

                $constants = @{}
                foreach ($p in $Fixture.constants.PSObject.Properties) {
                    $constants[$p.Name] = $p.Value
                }

                foreach ($case in $Fixture.cases) {
                    $record    = @($case.record)
                    $revisions = @($case.revisions)
                    $r = Get-DebateTestedTier -Record $record -Revisions $revisions -Constants $constants
                    $Results[$case.id] = $r

                    $r.tier | Should -Be $case.expect.tier -Because "case '$($case.id)' tier"

                    if ($case.expect.PSObject.Properties['sort_key']) {
                        $r.sort_key | Should -Be $case.expect.sort_key -Because "case '$($case.id)' sort_key exact"
                    }
                    if ($case.expect.PSObject.Properties['sort_key_range']) {
                        $range = $case.expect.sort_key_range
                        $r.sort_key | Should -BeGreaterOrEqual $range.min_inclusive -Because "case '$($case.id)' sort_key >= $($range.min_inclusive)"
                        $r.sort_key | Should -BeLessThan       $range.max_exclusive -Because "case '$($case.id)' sort_key < $($range.max_exclusive)"
                    }
                }
            }
        }
    }

    Context 'Comparative orderings (relative sort_key invariants)' {

        It 'Every ordering pair holds (greater_id.sort_key > lesser_id.sort_key)' {
            InModuleScope AITriad -Parameters @{ Fixture = $script:fixture; Results = $script:results } {
                param($Fixture, $Results)

                # Ensure the per-case results are populated even if the earlier
                # It ran in a different InModuleScope frame — recompute lazily.
                if (@($Results.Keys).Count -eq 0) {
                    $constants = @{}
                    foreach ($p in $Fixture.constants.PSObject.Properties) { $constants[$p.Name] = $p.Value }
                    foreach ($case in $Fixture.cases) {
                        $Results[$case.id] = Get-DebateTestedTier -Record @($case.record) -Revisions @($case.revisions) -Constants $constants
                    }
                }

                foreach ($o in $Fixture.orderings) {
                    $g = $Results[$o.greater_id]
                    $l = $Results[$o.lesser_id]
                    $g | Should -Not -BeNullOrEmpty -Because "greater_id '$($o.greater_id)' must have a computed result"
                    $l | Should -Not -BeNullOrEmpty -Because "lesser_id '$($o.lesser_id)' must have a computed result"
                    $g.$($o.on) | Should -BeGreaterThan $l.$($o.on) -Because "ordering: $($o.reason)"
                }
            }
        }
    }

    Context 'Constants override' {

        It 'Overriding WELL_TESTED_MIN_CHALLENGES demotes a formerly-well_tested case to contested' {
            InModuleScope AITriad {
                # Two challenges, two distinct debates, most recent held → well_tested at default (2).
                # Raise the threshold to 3 → same input becomes contested.
                $record = @(
                    [PSCustomObject]@{ debate_id='d1'; date='2026-07-01'; pipeline_version='v'; verdict='held';
                        strongest_attack_encountered=[PSCustomObject]@{ claim_id='c1'; strength=0.7; scheme='rebut'; challenger_camp='a' };
                        claim_outcomes=[PSCustomObject]@{ thrived=2; survived=1; died=0 }; concession=$null }
                    [PSCustomObject]@{ debate_id='d2'; date='2026-07-02'; pipeline_version='v'; verdict='held';
                        strongest_attack_encountered=[PSCustomObject]@{ claim_id='c2'; strength=0.7; scheme='rebut'; challenger_camp='b' };
                        claim_outcomes=[PSCustomObject]@{ thrived=2; survived=1; died=0 }; concession=$null }
                )
                $defaultResult  = Get-DebateTestedTier -Record $record -Revisions @()
                $raisedResult   = Get-DebateTestedTier -Record $record -Revisions @() -Constants @{ WELL_TESTED_MIN_CHALLENGES = 3 }

                $defaultResult.tier | Should -Be 'well_tested'
                $raisedResult.tier  | Should -Be 'contested' -Because 'raised threshold flips the tier — the whole point of Update-NodeTestingRecord -RecomputeOnly'
            }
        }
    }
}
