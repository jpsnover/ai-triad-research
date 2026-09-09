# Tag: qbaf (t/3354 — FOL-on-debate eval contradiction + paraphrase FN-rate, design §8)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL-on-debate contradiction + FN-rate PURE transforms (scripts/fol-eval-contradict.ps1, §8).
.DESCRIPTION
    Everything in this stage is pure (no AI, no I/O): the structural detector (Test-FolClausePair /
    Find-IntraDebateContradictions) and the make-or-break paraphrase FN-rate (Measure-ParaphraseFnRate).
    The tests dot-source the library and exercise them directly, including the WITH/WITHOUT-normalization
    delta that is the design's headline (§8).
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-contradict.ps1"
    function New-Lf { param($pred, $args_, $pol = 'positive')
        [pscustomobject]@{ predicate = $pred; args = @($args_ | ForEach-Object { [pscustomobject]@{ role = 'patient'; ref = $_ } }); polarity = $pol; about = @() }
    }
}

Describe 'Get-NormalizedPredicate' -Tag 'qbaf' {
    It 'case-folds and applies the map; unmapped -> lowercased self' {
        Get-NormalizedPredicate -Predicate 'Protect' -NormalizationMap @{ protect = 'P' } | Should -Be 'P'
        Get-NormalizedPredicate -Predicate 'Cartelize' -NormalizationMap @{} | Should -Be 'cartelize'
        Get-NormalizedPredicate -Predicate '' | Should -Be ''
    }
}

Describe 'Test-FolClausePair — structural relation' -Tag 'qbaf' {
    It 'contradict = same predicate + overlapping participants + opposite polarity' {
        $a = New-Lf 'protect' @('lit:"incumbents"') 'positive'
        $b = New-Lf 'protect' @('lit:"incumbents"') 'negative'
        Test-FolClausePair -LfA $a -LfB $b | Should -Be 'contradict'
    }
    It 'agree = same predicate + overlapping participants + same polarity' {
        $a = New-Lf 'protect' @('lit:"incumbents"') 'positive'
        $b = New-Lf 'protect' @('lit:"consumers"', 'lit:"incumbents"') 'positive'
        Test-FolClausePair -LfA $a -LfB $b | Should -Be 'agree'
    }
    It 'neutral = disjoint participants (predicate coincidence does not fire)' {
        $a = New-Lf 'protect' @('lit:"incumbents"') 'positive'
        $b = New-Lf 'protect' @('lit:"consumers"') 'negative'
        Test-FolClausePair -LfA $a -LfB $b | Should -Be 'neutral'
    }
    It 'normalization can turn a raw-neutral (different predicate) pair into a contradiction' {
        $a = New-Lf 'protect' @('lit:"incumbents"') 'positive'
        $b = New-Lf 'cartelize' @('lit:"incumbents"') 'negative'
        Test-FolClausePair -LfA $a -LfB $b -NormalizationMap @{} | Should -Be 'neutral'
        Test-FolClausePair -LfA $a -LfB $b -NormalizationMap @{ protect = 'P'; cartelize = 'P' } | Should -Be 'contradict'
    }
}

Describe 'Find-IntraDebateContradictions — cross-agent only, formalized only' -Tag 'qbaf' {
    BeforeAll {
        $script:formalized = @(
            [pscustomobject]@{ id = 'd:t0:c0'; debate_id = 'd'; turn_index = 0; fol_status = 'formalized'; logical_form = (New-Lf 'protect' @('lit:"incumbents"') 'positive') }
            [pscustomobject]@{ id = 'd:t1:c0'; debate_id = 'd'; turn_index = 1; fol_status = 'formalized'; logical_form = (New-Lf 'protect' @('lit:"incumbents"') 'negative') }
            # same speaker as t0 (should NOT pair with t0)
            [pscustomobject]@{ id = 'd:t2:c0'; debate_id = 'd'; turn_index = 2; fol_status = 'formalized'; logical_form = (New-Lf 'protect' @('lit:"incumbents"') 'negative') }
            # not formalized -> excluded
            [pscustomobject]@{ id = 'd:t3:c0'; debate_id = 'd'; turn_index = 3; fol_status = 'skipped-unresolved'; logical_form = $null }
        )
        $script:speakers = @{ 'd|0' = 'Accelerationist'; 'd|1' = 'Safetyist'; 'd|2' = 'Accelerationist'; 'd|3' = 'Skeptic' }
    }

    It 'finds the cross-agent contradiction (t0 acc vs t1 saf), not the same-agent pair (t0 vs t2)' {
        $r = @(Find-IntraDebateContradictions -Formalized $formalized -SpeakerMap $speakers)
        $contra = @($r | Where-Object { $_.relation -eq 'contradict' })
        $contra.Count | Should -Be 1
        $contra[0].id_a | Should -Be 'd:t0:c0'
        $contra[0].id_b | Should -Be 'd:t1:c0'
        $contra[0].speaker_a | Should -Be 'Accelerationist'
        $contra[0].speaker_b | Should -Be 'Safetyist'
    }
    It 'excludes non-formalized clauses' {
        $r = @(Find-IntraDebateContradictions -Formalized $formalized -SpeakerMap $speakers)
        @($r | Where-Object { $_.id_a -eq 'd:t3:c0' -or $_.id_b -eq 'd:t3:c0' }).Count | Should -Be 0
    }
}

Describe 'Measure-ParaphraseFnRate — the make-or-break metric' -Tag 'qbaf' {
    It 'raw FN-rate 1.0 (all different predicates) drops to 0.0 with normalization' {
        $fixture = [pscustomobject]@{ cases = @(
                [pscustomobject]@{
                    canonical_predicate = 'protect-incumbents'
                    surface_forms       = @(
                        [pscustomobject]@{ text = 'a'; raw_predicate = 'protect' }
                        [pscustomobject]@{ text = 'b'; raw_predicate = 'cartelize' }
                        [pscustomobject]@{ text = 'c'; raw_predicate = 'build-moat' }
                    )
                    normalization_map   = [pscustomobject]@{ protect = 'protect-incumbents'; cartelize = 'protect-incumbents'; 'build-moat' = 'protect-incumbents' }
                }
            ) }
        $fn = Measure-ParaphraseFnRate -Fixture $fixture
        $fn.gold_pairs | Should -Be 3          # C(3,2)
        $fn.raw_fn_rate | Should -Be 1.0       # every pair missed without normalization
        $fn.normalized_fn_rate | Should -Be 0.0
        $fn.normalization_gap | Should -Be 1.0
    }
    It 'handles an empty fixture' {
        $fn = Measure-ParaphraseFnRate -Fixture ([pscustomobject]@{ cases = @() })
        $fn.gold_pairs | Should -Be 0
        $fn.raw_fn_rate | Should -Be 0.0
    }
}
