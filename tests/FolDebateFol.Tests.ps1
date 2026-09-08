# Tag: qbaf (t/3354 — FOL-on-debate eval FOL extraction, design §7)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL-on-debate FOL-extraction PURE transforms (scripts/fol-eval-fol.ps1, design §7).
.DESCRIPTION
    ConvertTo-FolClauseFormalized and Measure-FolExtraction are pure (no AI, no I/O). The impure
    Invoke-FolClauseFormalize / Invoke-FolClauseExtraction (which reuse the LogicalFormPass core via the
    module and call the AI backend) are not invoked here — the extraction stage's live behavior is
    covered by the runner's degraded no-key run + the module's own LogicalFormPass tests.
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-fol.ps1"
}

Describe 'ConvertTo-FolClauseFormalized — join, skip-unresolved, never-drop' -Tag 'qbaf' {
    BeforeAll {
        $script:resolved = @(
            # usable (self_contained) -> attempted
            [pscustomobject]@{ id = 'd:t0:c0'; debate_id = 'd'; turn_index = 0; clause_index = 0; text = 'Seven firms control 35%.'; resolved_text = 'Seven firms control 35%.'; char_start = 0; char_end = 24; primary_type = 'assertoric-factual'; attribution = 'own'; anaphora_dependency = 'self-contained'; polarity = 'asserted'; resolution_status = 'self_contained'; coref_usable = $true }
            # usable (resolved) -> attempted
            [pscustomobject]@{ id = 'd:t2:c1'; debate_id = 'd'; turn_index = 2; clause_index = 1; text = 'that entrenches them.'; resolved_text = 'caps entrench incumbents.'; char_start = 0; char_end = 21; primary_type = 'assertoric-causal'; attribution = 'attributed-opponent'; anaphora_dependency = 'demonstrative'; polarity = 'asserted'; resolution_status = 'resolved'; coref_usable = $true }
            # NOT usable (coref unresolved) -> skipped, never formalized
            [pscustomobject]@{ id = 'd:t3:c0'; debate_id = 'd'; turn_index = 3; clause_index = 0; text = 'the threshold matters.'; resolved_text = 'the threshold matters.'; char_start = 0; char_end = 22; primary_type = 'assertoric-factual'; attribution = 'own'; anaphora_dependency = 'topic-ellipsis'; polarity = 'asserted'; resolution_status = 'unresolved'; coref_usable = $false }
        )
    }

    It 'attaches a formalized logical_form and records status' {
        $lf = [pscustomobject]@{ predicate = 'control'; status = 'proposed' }
        $results = @{
            'd:t0:c0' = @{ status = 'formalized'; logical_form = $lf }
            'd:t2:c1' = @{ status = 'invalid'; reason = 'no core event' }
        }
        $out = @(ConvertTo-FolClauseFormalized -Clauses $resolved -Results $results)
        $out.Count | Should -Be 3
        $c0 = $out | Where-Object { $_.id -eq 'd:t0:c0' }
        $c0.fol_status | Should -Be 'formalized'
        $c0.logical_form.predicate | Should -Be 'control'
        $c1 = $out | Where-Object { $_.id -eq 'd:t2:c1' }
        $c1.fol_status | Should -Be 'invalid'
        $c1.fol_reason | Should -Be 'no core event'
        $null -eq $c1.logical_form | Should -BeTrue
    }

    It 'skips coref-unusable clauses (skipped-unresolved, never sent to FOL)' {
        $out = @(ConvertTo-FolClauseFormalized -Clauses $resolved -Results @{})
        $skip = $out | Where-Object { $_.id -eq 'd:t3:c0' }
        $skip.fol_status | Should -Be 'skipped-unresolved'
        $null -eq $skip.logical_form | Should -BeTrue
    }

    It 'never drops a usable clause absent from the results — emits missing' {
        $out = @(ConvertTo-FolClauseFormalized -Clauses $resolved -Results @{})
        $out.Count | Should -Be 3
        ($out | Where-Object { $_.id -eq 'd:t0:c0' }).fol_status | Should -Be 'missing'
    }
}

Describe 'Measure-FolExtraction — outcome counts over the attempted subset' -Tag 'qbaf' {
    It 'excludes skipped-unresolved from the attempted denominator' {
        $formalized = @(
            [pscustomobject]@{ fol_status = 'formalized' }
            [pscustomobject]@{ fol_status = 'formalized' }
            [pscustomobject]@{ fol_status = 'invalid' }
            [pscustomobject]@{ fol_status = 'skipped-unresolved' }
        )
        $s = Measure-FolExtraction -Formalized $formalized
        $s.total | Should -Be 4
        $s.attempted | Should -Be 3                 # 4 total - 1 skipped
        $s.formalized_count | Should -Be 2
        $s.formalized_fraction | Should -Be ([Math]::Round(2 / 3, 4))
    }

    It 'handles an empty set' {
        $s = Measure-FolExtraction -Formalized @()
        $s.total | Should -Be 0
        $s.attempted | Should -Be 0
        $s.formalized_fraction | Should -Be 0.0
    }
}
