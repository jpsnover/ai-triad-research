# Tag: qbaf (t/3354 — FOL-on-debate clause-classifier scoring vs blind gold, design §5)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL classifier scoring PURE transforms (scripts/fol-eval-score.ps1, design §5).
.DESCRIPTION
    Join-FolGold + Measure-FolClassifierScore are pure (no AI, no I/O). The IO runner
    (score-fol-classifier-gold.ps1) is covered by a manual/CL run once a real gold set exists.
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-score.ps1"
    # 4 gold items; classified: g1 correct, g2 wrong (causal), g3 correct, g4 absent -> 'missing'.
    $script:gold = @(
        [pscustomobject]@{ id = 'g1'; primary_type = 'assertoric-factual'; attribution = 'own'; anaphora_dependency = 'self-contained'; polarity = 'asserted' }
        [pscustomobject]@{ id = 'g2'; primary_type = 'assertoric-factual'; attribution = 'own' }
        [pscustomobject]@{ id = 'g3'; primary_type = 'assertoric-causal'; attribution = 'attributed-opponent' }
        [pscustomobject]@{ id = 'g4'; primary_type = 'normative-deontic' }
    )
    $script:classified = @(
        [pscustomobject]@{ id = 'g1'; primary_type = 'assertoric-factual'; attribution = 'own'; anaphora_dependency = 'self-contained'; polarity = 'asserted' }
        [pscustomobject]@{ id = 'g2'; primary_type = 'assertoric-causal'; attribution = 'own' }
        [pscustomobject]@{ id = 'g3'; primary_type = 'assertoric-causal'; attribution = 'own' }
        [pscustomobject]@{ id = 'x9'; primary_type = 'rhetorical-evaluative' }  # not in gold -> ignored
    )
}

Describe 'Join-FolGold — gold authoritative, missing -> missing, never drop' -Tag 'qbaf' {
    It 'joins by id; a gold id absent from classified becomes pred_type missing' {
        $j = @(Join-FolGold -Classified $classified -Gold $gold)
        $j.Count | Should -Be 4                                  # 4 gold items (x9 ignored — not in gold)
        ($j | Where-Object { $_.id -eq 'g4' }).pred_type | Should -Be 'missing'
        ($j | Where-Object { $_.id -eq 'g1' }).matched | Should -BeTrue
        ($j | Where-Object { $_.id -eq 'g2' }).matched | Should -BeFalse
    }
}

Describe 'Measure-FolClassifierScore — P/R/F1 + confusion + accuracy' -Tag 'qbaf' {
    BeforeAll { $script:score = Measure-FolClassifierScore -Joined (@(Join-FolGold -Classified $classified -Gold $gold)) }

    It 'overall accuracy = matched / n' {
        $score.n | Should -Be 4
        $score.overall_accuracy | Should -Be 0.5                 # g1 + g3 correct of 4
    }
    It 'assertoric-factual: precision 1.0, recall 0.5' {
        $f = $score.per_type | Where-Object { $_.primary_type -eq 'assertoric-factual' }
        $f.support | Should -Be 2
        $f.precision | Should -Be 1.0                            # predicted factual once (g1), correct
        $f.recall | Should -Be 0.5                               # 1 of 2 gold-factual recovered
    }
    It 'assertoric-causal: precision 0.5, recall 1.0' {
        $c = $score.per_type | Where-Object { $_.primary_type -eq 'assertoric-causal' }
        $c.precision | Should -Be 0.5                            # predicted causal twice (g2,g3), 1 correct
        $c.recall | Should -Be 1.0
    }
    It 'a never-predicted type has null precision but a real recall' {
        $nd = $score.per_type | Where-Object { $_.primary_type -eq 'normative-deontic' }
        $null -eq $nd.precision | Should -BeTrue                 # never predicted
        $nd.recall | Should -Be 0.0                              # gold had 1, missed
    }
    It 'confusion matrix records the gold->pred mass incl. missing' {
        $score.confusion['normative-deontic']['missing'] | Should -Be 1
        $score.confusion['assertoric-factual']['assertoric-causal'] | Should -Be 1   # g2 misread
    }
    It 'attribute accuracy scores only rows where both sides carry the attribute' {
        # attribution present on gold g1,g2,g3 and pred g1,g2,g3 -> 3 scoreable; agree on g1,g2 (own/own), g3 gold=attributed-opponent vs pred=own -> 2/3
        $score.attribute_accuracy['attribution'].scoreable | Should -Be 3
        $score.attribute_accuracy['attribution'].correct | Should -Be 2
    }
}
