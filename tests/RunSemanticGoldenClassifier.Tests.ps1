# Tag: qbaf (t/3302 Fork-B — golden runner pure transforms)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for run-semantic-golden-classifier.ps1's pure transforms (t/3302).
.DESCRIPTION
    ConvertTo-CCInput (golden pairs -> classifier input) and Join-CCPredictions (results -> predictions)
    are exercised WITHOUT the AI backend or a subprocess: the script is dot-sourced with
    $env:SEMGOLD_RUNNER_NOEXEC set, so main() is skipped and only the functions load.
#>

BeforeAll {
    $env:SEMGOLD_RUNNER_NOEXEC = '1'
    . "$PSScriptRoot/../scripts/run-semantic-golden-classifier.ps1"
}

AfterAll {
    Remove-Item Env:\SEMGOLD_RUNNER_NOEXEC -ErrorAction SilentlyContinue
}

Describe 'ConvertTo-CCInput — golden pairs -> classifier contract' -Tag 'qbaf' {

    It 'groups pairs by conflict_id and maps assertion_a/b -> a/b keyed by pair_id' {
        $pairs = @(
            [pscustomobject]@{ conflict_id = 'c1'; pair_id = 'P001'; assertion_a = 'A one'; assertion_b = 'B one' }
            [pscustomobject]@{ conflict_id = 'c1'; pair_id = 'P002'; assertion_a = 'A two'; assertion_b = 'B two' }
            [pscustomobject]@{ conflict_id = 'c2'; pair_id = 'P003'; assertion_a = 'A three'; assertion_b = 'B three' }
        )
        $out = ConvertTo-CCInput -Pairs $pairs
        @($out.conflicts).Count | Should -Be 2
        $c1 = @($out.conflicts | Where-Object { $_.cid -eq 'c1' })
        @($c1[0].pairs).Count | Should -Be 2
        $c1[0].pairs[0].id | Should -Be 'P001'
        $c1[0].pairs[0].a  | Should -Be 'A one'
        $c1[0].pairs[0].b  | Should -Be 'B one'
    }

    It 'preserves quotes/newlines in assertion text (no shell corruption — file-based)' {
        $pairs = @([pscustomobject]@{ conflict_id = 'c1'; pair_id = 'P001'; assertion_a = "line1`nline2 `"q`""; assertion_b = "it's" })
        $out = ConvertTo-CCInput -Pairs $pairs
        $out.conflicts[0].pairs[0].a | Should -Match 'line2'
        $out.conflicts[0].pairs[0].b | Should -Be "it's"
    }
}

Describe 'Join-CCPredictions — results -> scoreable predictions' -Tag 'qbaf' {

    It 'joins by pair_id and carries gold label + pool + split' {
        $pairs = @(
            [pscustomobject]@{ pair_id = 'P001'; conflict_id = 'c1'; label = 'contradict'; pool = 'REP'; split = 'held_out'; stratum = 'numeric'; precision_trap = $false }
        )
        $results = @([pscustomobject]@{ id = 'P001'; label = 'contradict'; confidence = 0.9; method = 'llm-batch' })
        $preds = @(Join-CCPredictions -Pairs $pairs -Results $results)
        @($preds).Count | Should -Be 1
        $preds[0].gold_label | Should -Be 'contradict'
        $preds[0].predicted  | Should -Be 'contradict'
        $preds[0].confidence | Should -Be 0.9
        $preds[0].pool       | Should -Be 'REP'
        $preds[0].split      | Should -Be 'held_out'
    }

    It 'never drops a pair with no result — emits unresolved / missing' {
        $pairs = @(
            [pscustomobject]@{ pair_id = 'P001'; conflict_id = 'c1'; label = 'neutral'; pool = 'REP'; split = 'tune' }
            [pscustomobject]@{ pair_id = 'P002'; conflict_id = 'c1'; label = 'contradict'; pool = 'ENR'; split = 'held_out' }
        )
        $results = @([pscustomobject]@{ id = 'P001'; label = 'neutral'; confidence = 0.7; method = 'llm-batch' })
        $preds = Join-CCPredictions -Pairs $pairs -Results $results
        @($preds).Count | Should -Be 2
        $missing = @($preds | Where-Object { $_.pair_id -eq 'P002' })
        $missing[0].predicted | Should -Be 'unresolved'
        $missing[0].method    | Should -Be 'missing'
        $missing[0].gold_label | Should -Be 'contradict'
    }

    It 'tolerates an empty results set (all missing, none dropped)' {
        $pairs = @([pscustomobject]@{ pair_id = 'P001'; conflict_id = 'c1'; label = 'neutral'; pool = 'REP'; split = 'tune' })
        $preds = @(Join-CCPredictions -Pairs $pairs -Results @())
        @($preds).Count | Should -Be 1
        $preds[0].method | Should -Be 'missing'
    }
}
