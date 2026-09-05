# Tag: qbaf (t/3339 — cross-conflict classifier runner pure transforms)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for run-xconflict-classifier.ps1's pure transforms (t/3339).
.DESCRIPTION
    ConvertTo-XcInput (candidate rows -> chunked classifier input) and Join-XcPredictions (results ->
    predictions) are exercised WITHOUT the AI backend or a subprocess: the script is dot-sourced with
    $env:XC_RUNNER_NOEXEC set, so main() is skipped and only the functions load.
#>

BeforeAll {
    $env:XC_RUNNER_NOEXEC = '1'
    . "$PSScriptRoot/../scripts/run-xconflict-classifier.ps1"
}

AfterAll {
    Remove-Item Env:\XC_RUNNER_NOEXEC -ErrorAction SilentlyContinue
}

Describe 'ConvertTo-XcInput — candidate rows -> chunked classifier input' -Tag 'qbaf' {

    It 'chunks into synthetic conflicts of BatchSize and maps stance/cand -> a/b keyed by pair_id' {
        $cands = @(
            [pscustomobject]@{ pair_id = 'xc-0'; stance_text = 'A0'; cand_text = 'B0' }
            [pscustomobject]@{ pair_id = 'xc-1'; stance_text = 'A1'; cand_text = 'B1' }
            [pscustomobject]@{ pair_id = 'xc-2'; stance_text = 'A2'; cand_text = 'B2' }
            [pscustomobject]@{ pair_id = 'xc-3'; stance_text = 'A3'; cand_text = 'B3' }
            [pscustomobject]@{ pair_id = 'xc-4'; stance_text = 'A4'; cand_text = 'B4' }
        )
        $out = ConvertTo-XcInput -Candidates $cands -BatchSize 2
        @($out.conflicts).Count | Should -Be 3          # 2 + 2 + 1
        @($out.conflicts[0].pairs).Count | Should -Be 2
        @($out.conflicts[2].pairs).Count | Should -Be 1  # remainder
        $out.conflicts[0].pairs[0].id | Should -Be 'xc-0'
        $out.conflicts[0].pairs[0].a  | Should -Be 'A0'
        $out.conflicts[0].pairs[0].b  | Should -Be 'B0'
        # every pair id preserved exactly once across batches
        $ids = @($out.conflicts | ForEach-Object { $_.pairs } | ForEach-Object { $_.id })
        ($ids | Sort-Object) -join ',' | Should -Be 'xc-0,xc-1,xc-2,xc-3,xc-4'
    }
}

Describe 'Join-XcPredictions — results -> predictions' -Tag 'qbaf' {

    It 'joins by pair_id and carries conflict ids + cosine' {
        $cands = @(
            [pscustomobject]@{ pair_id = 'xc-0'; stance_conflict_id = 'sc0'; cand_conflict_id = 'cc0'; cosine = 0.67 }
        )
        $results = @([pscustomobject]@{ id = 'xc-0'; label = 'contradict'; confidence = 0.93; method = 'llm-batch' })
        $preds = @(Join-XcPredictions -Candidates $cands -Results $results)
        @($preds).Count | Should -Be 1
        $preds[0].predicted          | Should -Be 'contradict'
        $preds[0].confidence         | Should -Be 0.93
        $preds[0].method             | Should -Be 'llm-batch'
        $preds[0].stance_conflict_id | Should -Be 'sc0'
        $preds[0].cand_conflict_id   | Should -Be 'cc0'
        $preds[0].cosine             | Should -Be 0.67
    }

    It 'never drops a pair with no result — emits missing' {
        $cands = @(
            [pscustomobject]@{ pair_id = 'xc-0'; stance_conflict_id = 'sc0'; cand_conflict_id = 'cc0'; cosine = 0.5 }
            [pscustomobject]@{ pair_id = 'xc-1'; stance_conflict_id = 'sc1'; cand_conflict_id = 'cc1'; cosine = 0.6 }
        )
        $results = @([pscustomobject]@{ id = 'xc-0'; label = 'neutral'; confidence = 0.8; method = 'llm-batch' })
        $preds = @(Join-XcPredictions -Candidates $cands -Results $results)
        @($preds).Count | Should -Be 2
        $missing = @($preds | Where-Object { $_.pair_id -eq 'xc-1' })
        $missing[0].predicted | Should -Be 'missing'
        $missing[0].method    | Should -Be 'missing'
    }

    It 'tolerates an empty results set (all missing, none dropped)' {
        $cands = @([pscustomobject]@{ pair_id = 'xc-0'; stance_conflict_id = 'sc0'; cand_conflict_id = 'cc0'; cosine = 0.5 })
        $preds = @(Join-XcPredictions -Candidates $cands -Results @())
        @($preds).Count | Should -Be 1
        $preds[0].method | Should -Be 'missing'
    }
}
