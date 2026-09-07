# Tag: qbaf (t/3354 — FOL-on-debate eval clause classifier, design §3)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL-on-debate clause classifier PURE transforms (scripts/fol-eval-classify.ps1, §3).
.DESCRIPTION
    Format-FolClauseBlock, ConvertFrom-FolClauseClassification, and Measure-FolClauseDistribution are
    pure (no AI, no I/O), so the tests dot-source the library and exercise them directly. The impure
    Invoke-FolClauseClassifier / Invoke-FolClauseClassifyBatched (which call the AI backend) are not
    invoked here — the classify stage's live behavior is covered by the runner's -DryRun/-SkipClassify
    paths and manual smoke runs, not by these unit tests.
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-classify.ps1"
}

Describe 'Format-FolClauseBlock' -Tag 'qbaf' {
    It 'renders each clause as an id header plus a TEXT line, shell-safe for quotes/newlines' {
        $clauses = @(
            [pscustomobject]@{ id = 'd:t0:c0'; text = 'Caps protect incumbents.' }
            [pscustomobject]@{ id = 'd:t0:c1'; text = 'He said "no".' }
        )
        $block = Format-FolClauseBlock -Clauses $clauses
        ($block -match '### d:t0:c0') | Should -BeTrue
        ($block -match 'TEXT: Caps protect incumbents\.') | Should -BeTrue
        ($block -match '### d:t0:c1') | Should -BeTrue
        # quotes in the text survive verbatim (string marshaling, not shell)
        $block.Contains('TEXT: He said "no".') | Should -BeTrue
    }
    It 'tolerates an empty clause set' {
        Format-FolClauseBlock -Clauses @() | Should -Be ''
    }
}

Describe 'ConvertFrom-FolClauseClassification — join, validate, never-drop' -Tag 'qbaf' {
    BeforeAll {
        $script:segClauses = @(
            [pscustomobject]@{ id = 'd:t0:c0'; debate_id = 'd'; turn_index = 0; clause_index = 0; text = 'Seven firms control 35%.'; char_start = 0; char_end = 24; segmentation_rule = 'sentence-initial' }
            [pscustomobject]@{ id = 'd:t0:c1'; debate_id = 'd'; turn_index = 0; clause_index = 1; text = 'Congress should act.'; char_start = 25; char_end = 45; segmentation_rule = 'sentence' }
        )
    }

    It 'attaches the classification and flags the assertoric subset' {
        $results = @{
            'd:t0:c0' = @{ primary_type = 'assertoric-factual'; attribution = 'own'; anaphora_dependency = 'self-contained'; polarity = 'asserted'; confidence = 0.9 }
            'd:t0:c1' = @{ primary_type = 'normative-deontic'; attribution = 'own'; anaphora_dependency = 'self-contained'; polarity = 'asserted'; confidence = 0.8 }
        }
        $out = @(ConvertFrom-FolClauseClassification -Clauses $segClauses -Results $results)
        $out.Count | Should -Be 2
        ($out | Where-Object { $_.id -eq 'd:t0:c0' }).primary_type | Should -Be 'assertoric-factual'
        ($out | Where-Object { $_.id -eq 'd:t0:c0' }).is_assertoric | Should -BeTrue
        ($out | Where-Object { $_.id -eq 'd:t0:c1' }).is_assertoric | Should -BeFalse
        # Original segmentation fields preserved (double-annotation-ready).
        ($out | Where-Object { $_.id -eq 'd:t0:c0' }).char_start | Should -Be 0
        ($out | Where-Object { $_.id -eq 'd:t0:c0' }).segmentation_rule | Should -Be 'sentence-initial'
    }

    It 'never drops a clause with no result — emits unclassified/missing, not assertoric' {
        $out = @(ConvertFrom-FolClauseClassification -Clauses $segClauses -Results @{})
        $out.Count | Should -Be 2
        $out | ForEach-Object {
            $_.primary_type | Should -Be 'unclassified'
            $_.classify_method | Should -Be 'missing'
            $_.is_assertoric | Should -BeFalse
        }
    }
}

Describe 'Measure-FolClauseDistribution — §3.3 sanity bands' -Tag 'qbaf' {
    It 'computes per-type fractions, assertoric total, and within_band flags' {
        # 5 assertoric-factual, 5 rhetorical -> factual 0.5 (OUT of 0.20-0.25), assertoric total 0.5 (OUT of 0.55-0.65)
        $classified = @()
        1..5 | ForEach-Object { $classified += [pscustomobject]@{ primary_type = 'assertoric-factual' } }
        1..5 | ForEach-Object { $classified += [pscustomobject]@{ primary_type = 'rhetorical-evaluative' } }
        $d = Measure-FolClauseDistribution -Classified $classified
        $d.total | Should -Be 10
        $d.assertoric_count | Should -Be 5
        $d.assertoric_fraction | Should -Be 0.5
        $d.assertoric_within_band | Should -BeFalse
        ($d.per_type | Where-Object { $_.primary_type -eq 'assertoric-factual' }).fraction | Should -Be 0.5
        ($d.per_type | Where-Object { $_.primary_type -eq 'assertoric-factual' }).within_band | Should -BeFalse
    }

    It 'counts unclassified separately and handles an empty set' {
        $d0 = Measure-FolClauseDistribution -Classified @()
        $d0.total | Should -Be 0
        $d0.assertoric_fraction | Should -Be 0.0

        $mixed = @(
            [pscustomobject]@{ primary_type = 'assertoric-causal' }
            [pscustomobject]@{ primary_type = 'unclassified' }
        )
        $d1 = Measure-FolClauseDistribution -Classified $mixed
        $d1.total | Should -Be 2
        $d1.unclassified_count | Should -Be 1
        $d1.assertoric_count | Should -Be 1
    }
}
