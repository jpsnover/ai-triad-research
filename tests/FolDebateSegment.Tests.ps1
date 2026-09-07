# Tag: qbaf (t/3354 — FOL-on-debate eval clause segmenter, design §4)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the FOL-on-debate clause segmenter (scripts/fol-eval-segment.ps1, design §4).
.DESCRIPTION
    Split-DebateTurnClauses is a PURE, deterministic, offset-preserving transform (no AI, no I/O),
    so the tests dot-source the library directly and assert on the §4 boundary rules, the
    double-annotation-ready spans (§11), and the fragment-drop heuristic (rule 8).
#>

BeforeAll {
    . "$PSScriptRoot/../scripts/fol-eval-segment.ps1"
}

Describe 'Split-DebateTurnClauses — §4 boundary rules' -Tag 'qbaf' {

    It 'returns no clauses for empty / whitespace text' {
        @(Split-DebateTurnClauses -Text '' -DebateId 'd1' -TurnIndex 0).Count | Should -Be 0
        @(Split-DebateTurnClauses -Text "   `t " -DebateId 'd1' -TurnIndex 0).Count | Should -Be 0
    }

    It 'treats a single self-contained sentence as one clause' {
        $c = @(Split-DebateTurnClauses -Text 'Seven firms control 35% of the S&P 500.' -DebateId 'd1' -TurnIndex 2)
        $c.Count | Should -Be 1
        $c[0].text | Should -Be 'Seven firms control 35% of the S&P 500.'
        $c[0].id | Should -Be 'd1:t2:c0'
        $c[0].segmentation_rule | Should -Be 'sentence-initial'
    }

    It 'splits multiple sentences (rule 1)' {
        $c = @(Split-DebateTurnClauses -Text 'Caps protect incumbents. Congress should drop them.' -DebateId 'd1' -TurnIndex 0)
        $c.Count | Should -Be 2
        $c[0].text | Should -Be 'Caps protect incumbents.'
        $c[1].text | Should -Be 'Congress should drop them.'
        $c[1].segmentation_rule | Should -Be 'sentence'
    }

    It 'rule 4 — a trailing normative/rhetorical closer does NOT inherit the factual body (splits at "so")' {
        $c = @(Split-DebateTurnClauses -Text 'Data centers consumed 415 TWh in 2024 so the ban is unjustified' -DebateId 'd1' -TurnIndex 1)
        $c.Count | Should -Be 2
        $c[0].text | Should -Be 'Data centers consumed 415 TWh in 2024'
        $c[1].text | Should -Be 'so the ban is unjustified'
        $c[1].segmentation_rule | Should -Be 'connective-split'
    }

    It 'rule 3 — splits at a discourse connective ("because") into antecedent + consequent' {
        $c = @(Split-DebateTurnClauses -Text 'Congress should not impose caps because caps protect incumbents' -DebateId 'd1' -TurnIndex 0)
        $c.Count | Should -Be 2
        $c[0].text | Should -Be 'Congress should not impose caps'
        $c[1].text | Should -Be 'because caps protect incumbents'
    }

    It 'rule 2 — splits coordinated finite clauses at ", and"' {
        $c = @(Split-DebateTurnClauses -Text 'The caps entrench incumbents, and Congress should drop them' -DebateId 'd1' -TurnIndex 0)
        $c.Count | Should -Be 2
        $c[0].text | Should -Be 'The caps entrench incumbents,'
        $c[1].text | Should -Be 'and Congress should drop them'
        $c[1].segmentation_rule | Should -Be 'coordinator-split'
    }

    It 'rule 5 — attributed restatement: isolates the "X claims that" wrapper from the embedded proposition' {
        $c = @(Split-DebateTurnClauses -Text 'Safetyist claims that the regime monitors clusters above 10^26 ops' -DebateId 'd1' -TurnIndex 3)
        $c.Count | Should -Be 2
        $c[0].is_attribution_wrapper | Should -BeTrue
        $c[0].segmentation_rule | Should -Be 'attribution-wrapper-start'
        $c[1].is_attribution_wrapper | Should -BeFalse
        $c[1].text | Should -Be 'the regime monitors clusters above 10^26 ops'
        $c[1].segmentation_rule | Should -Be 'attributed-content'
    }

    It 'rule 5 — recognizes the "posits that" attribution verb seen in the real corpus' {
        $c = @(Split-DebateTurnClauses -Text 'Skeptic posits that pre-release audits are a prerequisite for progress' -DebateId 'd1' -TurnIndex 5)
        $c.Count | Should -Be 2
        $c[0].is_attribution_wrapper | Should -BeTrue
        $c[1].text | Should -Be 'pre-release audits are a prerequisite for progress'
    }

    It 'rule 8 — drops sub-clausal / punctuation-only fragments' {
        # A stray bare token after a split should not survive as a clause.
        $c = @(Split-DebateTurnClauses -Text 'The ban is premature. No.' -DebateId 'd1' -TurnIndex 0)
        # "No." is a single short token -> dropped; only the substantive clause remains.
        @($c | Where-Object { $_.text -eq 'The ban is premature.' }).Count | Should -Be 1
        @($c | Where-Object { $_.text -match '^No' }).Count | Should -Be 0
    }
}

Describe 'Split-DebateTurnClauses — spans + ids (double-annotation-ready, §11)' -Tag 'qbaf' {

    It 'char offsets round-trip to the original text for every clause' {
        $text = 'Caps protect incumbents. Congress should drop them, and citizens should watch regulators.'
        $c = @(Split-DebateTurnClauses -Text $text -DebateId 'deb-abc' -TurnIndex 4)
        $c.Count | Should -BeGreaterThan 1
        foreach ($cl in $c) {
            # The recorded span must reproduce the recorded text exactly (offset integrity).
            $text.Substring($cl.char_start, $cl.char_end - $cl.char_start) | Should -Be $cl.text
            $cl.char_start | Should -BeGreaterOrEqual 0
            $cl.char_end | Should -BeLessOrEqual $text.Length
        }
    }

    It 'assigns stable, sequential, unique clause ids scoped to debate + turn' {
        $text = 'A first claim here. A second claim here. A third claim here.'
        $c = @(Split-DebateTurnClauses -Text $text -DebateId 'deb-xyz' -TurnIndex 7)
        $c.Count | Should -Be 3
        $c[0].id | Should -Be 'deb-xyz:t7:c0'
        $c[1].id | Should -Be 'deb-xyz:t7:c1'
        $c[2].id | Should -Be 'deb-xyz:t7:c2'
        @($c.id | Sort-Object -Unique).Count | Should -Be 3
        $c | ForEach-Object { $_.turn_index | Should -Be 7 }
    }

    It 'is deterministic — identical input yields identical output' {
        $text = 'Seven firms control 35% of the S&P 500, and that concentration is the real risk.'
        $a = @(Split-DebateTurnClauses -Text $text -DebateId 'd' -TurnIndex 0)
        $b = @(Split-DebateTurnClauses -Text $text -DebateId 'd' -TurnIndex 0)
        ($a | ConvertTo-Json -Depth 5) | Should -Be ($b | ConvertTo-Json -Depth 5)
    }
}
