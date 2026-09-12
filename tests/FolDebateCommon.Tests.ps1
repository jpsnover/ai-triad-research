# Tag: qbaf (t/3354 — FOL-on-debate eval robust {results:[...]} extraction, t/3354#29)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for ConvertFrom-FolResultsJson (scripts/fol-eval-common.ps1) — the robust {results:[...]} extractor
    that fixes the CLASSIFY-stage starvation CL found on a keyed run (t/3354#29: gemini-flash-lite returned
    valid-but-unwrapped JSON the old strict parser rejected).
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-common.ps1"
}

Describe 'ConvertFrom-FolResultsJson — tolerant extraction' -Tag 'qbaf' {
    It 'accepts the canonical { results: [...] } object' {
        $r = @(ConvertFrom-FolResultsJson -Text '{"results":[{"id":"a"},{"id":"b"}]}')
        $r.Count | Should -Be 2
        $r[0].id | Should -Be 'a'
    }
    It 'accepts a BARE array (the gemini-flash-lite drift, t/3354#29)' {
        $r = @(ConvertFrom-FolResultsJson -Text '[{"id":"a"},{"id":"b"},{"id":"c"}]')
        $r.Count | Should -Be 3
        $r[2].id | Should -Be 'c'
    }
    It 'strips markdown fences before parsing' {
        $txt = "```json`n{`"results`":[{`"id`":`"x`"}]}`n```"
        $r = @(ConvertFrom-FolResultsJson -Text $txt)
        $r.Count | Should -Be 1
        $r[0].id | Should -Be 'x'
    }
    It 'accepts an alternately-keyed wrapper (first array-valued property)' {
        $r = @(ConvertFrom-FolResultsJson -Text '{"classifications":[{"id":"a"},{"id":"b"}]}')
        $r.Count | Should -Be 2
    }
    It 'extracts the JSON object when the model adds prose around it' {
        $r = @(ConvertFrom-FolResultsJson -Text 'Here you go: {"results":[{"id":"z"}]} — done.')
        $r.Count | Should -Be 1
        $r[0].id | Should -Be 'z'
    }
    It 'wraps a single result-row object' {
        $r = @(ConvertFrom-FolResultsJson -Text '{"id":"solo","primary_type":"assertoric-factual"}')
        $r.Count | Should -Be 1
        $r[0].id | Should -Be 'solo'
    }
    It 'returns $null for empty / non-JSON garbage' {
        $null -eq (ConvertFrom-FolResultsJson -Text '') | Should -BeTrue
        $null -eq (ConvertFrom-FolResultsJson -Text '   ') | Should -BeTrue
        $null -eq (ConvertFrom-FolResultsJson -Text 'I could not classify these clauses.') | Should -BeTrue
    }
}
