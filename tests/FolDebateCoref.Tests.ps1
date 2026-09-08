# Tag: qbaf (t/3354 — FOL-on-debate eval coref/attribution resolution, design §6)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL-on-debate coref PURE transforms (scripts/fol-eval-coref.ps1, design §6).
.DESCRIPTION
    Format-CorefContextBlock, Format-CorefClauseBlock, ConvertTo-CorefResolved, and
    Measure-CorefCoverage are pure (no AI, no I/O). The impure resolvers
    (Resolve-FolClauseCorefBatch / Invoke-FolCorefResolveDebate, which call the AI backend) are not
    invoked here — the coref stage's live behavior is covered by the runner's -DryRun/-SkipClassify
    paths and manual smoke runs.
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-coref.ps1"
}

Describe 'Format-CorefContextBlock' -Tag 'qbaf' {
    It 'orders prior turns earliest-first and caps to MaxTurns' {
        $stmts = @(
            [pscustomobject]@{ turn_index = 5; content = 'fifth' }
            [pscustomobject]@{ turn_index = 1; content = 'first' }
            [pscustomobject]@{ turn_index = 3; content = 'third' }
        )
        $block = Format-CorefContextBlock -Statements $stmts -MaxTurns 2
        # capped to last 2 by turn order (third, fifth); earliest-first within the cap
        $block | Should -Match '\[turn 3\] third'
        $block | Should -Match '\[turn 5\] fifth'
        $block | Should -Not -Match 'first'
        $block.IndexOf('turn 3') | Should -BeLessThan $block.IndexOf('turn 5')
    }
    It 'tolerates an empty statement set' {
        Format-CorefContextBlock -Statements @() | Should -Be ''
    }
}

Describe 'ConvertTo-CorefResolved — passthrough, join, never-drop' -Tag 'qbaf' {
    BeforeAll {
        $script:assertoric = @(
            [pscustomobject]@{ id = 'd:t0:c0'; debate_id = 'd'; turn_index = 0; clause_index = 0; text = 'Seven firms control 35%.'; char_start = 0; char_end = 24; segmentation_rule = 'sentence-initial'; primary_type = 'assertoric-factual'; attribution = 'own'; anaphora_dependency = 'self-contained'; polarity = 'asserted' }
            [pscustomobject]@{ id = 'd:t2:c1'; debate_id = 'd'; turn_index = 2; clause_index = 1; text = 'that approach entrenches them.'; char_start = 0; char_end = 29; segmentation_rule = 'sentence-initial'; primary_type = 'assertoric-causal'; attribution = 'attributed-opponent'; anaphora_dependency = 'demonstrative'; polarity = 'asserted' }
        )
    }

    It 'passes self-contained clauses through with NO resolution call (status self_contained)' {
        $out = @(ConvertTo-CorefResolved -Clauses $assertoric -Results @{})
        $sc = $out | Where-Object { $_.id -eq 'd:t0:c0' }
        $sc.resolution_status | Should -Be 'self_contained'
        $sc.resolved_text | Should -Be 'Seven firms control 35%.'
        $sc.coref_method | Should -Be 'passthrough'
        $sc.coref_usable | Should -BeTrue
    }

    It 'joins a resolution for a non-self-contained clause and marks it usable when resolved' {
        $results = @{ 'd:t2:c1' = @{ resolved_text = 'the frontier-cap approach entrenches incumbents.'; resolution_status = 'resolved'; confidence = 0.8 } }
        $out = @(ConvertTo-CorefResolved -Clauses $assertoric -Results $results)
        $r = $out | Where-Object { $_.id -eq 'd:t2:c1' }
        $r.resolved_text | Should -Be 'the frontier-cap approach entrenches incumbents.'
        $r.resolution_status | Should -Be 'resolved'
        $r.coref_usable | Should -BeTrue
        $r.coref_method | Should -Be 'llm'
    }

    It 'never drops a non-self-contained clause with no result — emits unresolved/missing (not usable)' {
        $out = @(ConvertTo-CorefResolved -Clauses $assertoric -Results @{})
        $r = $out | Where-Object { $_.id -eq 'd:t2:c1' }
        $r.resolution_status | Should -Be 'unresolved'
        $r.coref_method | Should -Be 'missing'
        $r.coref_usable | Should -BeFalse
        $r.resolved_text | Should -Be 'that approach entrenches them.'   # original text preserved
    }
}

Describe 'Measure-CorefCoverage — §6 coverage loss keyed on anaphora_dependency' -Tag 'qbaf' {
    It 'computes usable/loss fractions overall and per dependency' {
        $resolved = @(
            [pscustomobject]@{ resolution_status = 'self_contained'; anaphora_dependency = 'self-contained' }
            [pscustomobject]@{ resolution_status = 'resolved'; anaphora_dependency = 'demonstrative' }
            [pscustomobject]@{ resolution_status = 'unresolved'; anaphora_dependency = 'attributed-restatement' }
            [pscustomobject]@{ resolution_status = 'partial'; anaphora_dependency = 'attributed-restatement' }
        )
        $cov = Measure-CorefCoverage -Resolved $resolved
        $cov.total | Should -Be 4
        $cov.usable_count | Should -Be 2                 # self_contained + resolved
        $cov.usable_fraction | Should -Be 0.5
        $cov.coverage_loss_count | Should -Be 2          # unresolved + partial
        $ar = $cov.by_anaphora_dependency | Where-Object { $_.anaphora_dependency -eq 'attributed-restatement' }
        $ar.total | Should -Be 2
        $ar.usable | Should -Be 0                        # both attributed-restatement clauses failed
        $ar.usable_fraction | Should -Be 0.0
    }

    It 'handles an empty set' {
        $cov = Measure-CorefCoverage -Resolved @()
        $cov.total | Should -Be 0
        $cov.usable_fraction | Should -Be 0.0
        $cov.coverage_loss_fraction | Should -Be 0.0
    }
}
