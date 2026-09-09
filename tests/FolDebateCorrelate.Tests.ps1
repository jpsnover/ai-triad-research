# Tag: qbaf (t/3354 — FOL-on-debate eval summary-corpus direction + correlation, design §8 i / §9)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL-on-debate correlation PURE transforms (scripts/fol-eval-correlate.ps1, §8 i / §9).
.DESCRIPTION
    Get-SummaryClaimLogicalForms, Find-SummaryCorpusContradictions, and New-CorrelationIndex are pure
    (no AI, no I/O). Find-SummaryCorpusContradictions needs Test-FolClausePair, so the detector library is
    dot-sourced too. The runner's read-only summary-corpus load is covered by the degraded no-key run.
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-contradict.ps1"
    . "$PSScriptRoot/../scripts/fol-eval-correlate.ps1"
    function New-Lf { param($pred, $arg, $pol = 'positive')
        [pscustomobject]@{ predicate = $pred; args = @([pscustomobject]@{ role = 'patient'; ref = $arg }); polarity = $pol; about = @() }
    }
}

Describe 'Get-SummaryClaimLogicalForms — extract claims carrying a logical_form' -Tag 'qbaf' {
    It 'pulls BDI key_points (camp acc/saf/skp) + factual_claims, skipping claims without a logical_form' {
        $summary = [pscustomobject]@{
            pov_summaries  = [pscustomobject]@{
                accelerationist = [pscustomobject]@{ key_points = @(
                        [pscustomobject]@{ logical_form = (New-Lf 'protect' 'lit:"incumbents"') }
                        [pscustomobject]@{ point = 'no logical form here' }
                    ) }
                safetyist       = [pscustomobject]@{ key_points = @([pscustomobject]@{ logical_form = (New-Lf 'ban' 'lit:"asi"') }) }
            }
            factual_claims = @([pscustomobject]@{ logical_form = (New-Lf 'consume' 'lit:"415 twh"') })
        }
        $lfs = @(Get-SummaryClaimLogicalForms -Summary $summary -SourceId 'doc1')
        $lfs.Count | Should -Be 3           # acc[0], saf[0], factual[0] — acc[1] skipped
        ($lfs | Where-Object { $_.camp -eq 'acc' }).claim_ref | Should -Be 'doc1|acc|0'
        ($lfs | Where-Object { $_.camp -eq 'factual' }).claim_ref | Should -Be 'doc1|factual|0'
    }
    It 'tolerates a summary with no logical forms' {
        @(Get-SummaryClaimLogicalForms -Summary ([pscustomobject]@{ factual_claims = @() }) -SourceId 'd').Count | Should -Be 0
    }
}

Describe 'Find-SummaryCorpusContradictions — debate clause vs summary corpus' -Tag 'qbaf' {
    It 'emits contradict pairs with full provenance (debate clause + summary claim_ref)' {
        $formalized = @(
            [pscustomobject]@{ id = 'd:t0:c0'; debate_id = 'd'; turn_index = 0; fol_status = 'formalized'; logical_form = (New-Lf 'protect' 'lit:"incumbents"' 'positive') }
            [pscustomobject]@{ id = 'd:t1:c0'; debate_id = 'd'; turn_index = 1; fol_status = 'skipped-unresolved'; logical_form = $null }
        )
        $summaryLfs = @(
            [pscustomobject]@{ source = 'doc1'; camp = 'saf'; claim_ref = 'doc1|saf|0'; logical_form = (New-Lf 'protect' 'lit:"incumbents"' 'negative') }
        )
        $r = @(Find-SummaryCorpusContradictions -Formalized $formalized -SummaryLfs $summaryLfs)
        $r.Count | Should -Be 1
        $r[0].relation | Should -Be 'contradict'
        $r[0].debate_clause | Should -Be 'd:t0:c0'
        $r[0].summary_claim | Should -Be 'doc1|saf|0'
    }
    It 'tolerates empty inputs' {
        @(Find-SummaryCorpusContradictions -Formalized @() -SummaryLfs @()).Count | Should -Be 0
    }
}

Describe 'New-CorrelationIndex — §9 per-debate joinable counts' -Tag 'qbaf' {
    It 'aggregates formalized + intra + summary contradictions per debate and carries the FN-rate' {
        $formalized = @(
            [pscustomobject]@{ debate_id = 'd'; fol_status = 'formalized' }
            [pscustomobject]@{ debate_id = 'd'; fol_status = 'formalized' }
            [pscustomobject]@{ debate_id = 'e'; fol_status = 'skipped-unresolved' }
        )
        $intra = @([pscustomobject]@{ debate_id = 'd'; relation = 'contradict' })
        $summary = @([pscustomobject]@{ debate_id = 'd'; relation = 'contradict' }, [pscustomobject]@{ debate_id = 'd'; relation = 'agree' })
        $fn = [pscustomobject]@{ raw_fn_rate = 1.0; normalized_fn_rate = 0.0; normalization_gap = 1.0; gold_pairs = 10 }
        $idx = New-CorrelationIndex -Formalized $formalized -IntraContradictions $intra -SummaryContradictions $summary -FnReport $fn
        $idx.debates | Should -Be 2
        $d = $idx.per_debate | Where-Object { $_.debate_id -eq 'd' }
        $d.assertoric_formalized | Should -Be 2
        $d.intra_debate_contradictions | Should -Be 1
        $d.summary_corpus_contradictions | Should -Be 1      # the 'agree' is not counted
        $idx.paraphrase_fn_rate.gap | Should -Be 1.0
    }
}
