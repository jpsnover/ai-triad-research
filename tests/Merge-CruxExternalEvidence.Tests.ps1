# Tag: enrichment (t/1540)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Merge-CruxExternalEvidence (t/1540) — preserves reviewer-entered
    external_evidence across Export-AggregatedCruxes regeneration.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Merge-CruxExternalEvidence preservation (t/1540)' -Tag 'enrichment' {

    BeforeEach {
        $script:PrevPath = Join-Path ([System.IO.Path]::GetTempPath()) ("cxev-prev-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    }
    AfterEach {
        if (Test-Path $script:PrevPath) { Remove-Item $script:PrevPath -Force -ErrorAction SilentlyContinue }
    }

    It 'Preserves external_evidence byte-for-byte on an unchanged corpus (AC #5)' {
        $ev = @(
            [ordered]@{
                url      = 'https://example.org/whitepaper.pdf'
                note     = 'Section 3 covers this crux directly'
                added_by = 'reviewer@example.org'
                added_at = '2026-07-12'
            }
        )
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id                = 'crux-100'
                    statement         = 'AI evaluation methodology needs standardization.'
                    type              = 'empirical'
                    external_evidence = $ev
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-100'; statement = 'AI evaluation methodology needs standardization.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath
            $stats.Preserved | Should -Be 1
            $stats.Dropped   | Should -Be 0
            $Fresh[0].Contains('external_evidence') | Should -BeTrue
            @($Fresh[0]['external_evidence']).Count | Should -Be 1
            $Fresh[0]['external_evidence'][0].url      | Should -Be 'https://example.org/whitepaper.pdf'
            $Fresh[0]['external_evidence'][0].note     | Should -Be 'Section 3 covers this crux directly'
            $Fresh[0]['external_evidence'][0].added_by | Should -Be 'reviewer@example.org'
            $Fresh[0]['external_evidence'][0].added_at | Should -Be '2026-07-12'
        }
    }

    It 'Drops evidence when the id matches but the statement changed (AC #4)' {
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id                = 'crux-050'
                    statement         = 'AI capability progress will slow after 2027.'
                    type              = 'empirical'
                    external_evidence = @(
                        [ordered]@{ url = 'https://example.org/paper-A.pdf'; note = 'directly discusses 2027 timeline'; added_by = 'r'; added_at = '2026-07-12' }
                    )
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        # Different conceptual crux, same id (dedup clustering re-assigned the slot).
        $fresh = @(
            [ordered]@{
                id        = 'crux-050'
                statement = 'Open-weight releases increase misuse risk more than they aid defense.'
                type      = 'empirical'
            }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath
            $stats.Preserved | Should -Be 0
            $stats.Dropped   | Should -Be 1
            $Fresh[0].Contains('external_evidence') | Should -BeFalse
        }
    }

    It 'Preserves across trim-only whitespace differences in statement' {
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id                = 'crux-060'
                    statement         = 'Compute governance is feasible.'
                    type              = 'values'
                    external_evidence = @([ordered]@{ url = 'https://example.org/gov.pdf'; note = 'r'; added_by = 'x'; added_at = '2026-07-12' })
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-060'; statement = "  Compute governance is feasible.`n"; type = 'values' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath
            $stats.Preserved | Should -Be 1
            $stats.Dropped   | Should -Be 0
            $Fresh[0].Contains('external_evidence') | Should -BeTrue
        }
    }

    It 'Ignores previous entries with empty external_evidence arrays' {
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id                = 'crux-070'
                    statement         = 'Something.'
                    type              = 'empirical'
                    external_evidence = @()
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-070'; statement = 'Something.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath
            $stats.Preserved | Should -Be 0
            $stats.Dropped   | Should -Be 0
            $Fresh[0].Contains('external_evidence') | Should -BeFalse
        }
    }

    It 'Does not throw when the previous file is missing (fresh install)' {
        # $script:PrevPath was allocated but never written
        $fresh = @(
            [ordered]@{ id = 'crux-001'; statement = 'X'; type = 'empirical' }
        )
        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath
            $stats.Preserved | Should -Be 0
            $stats.Dropped   | Should -Be 0
            $Fresh[0].Contains('external_evidence') | Should -BeFalse
        }
    }

    It 'Fails open (warn, do not throw) when the previous file is malformed (AC #3)' {
        # Write invalid JSON to force a parse failure inside the helper.
        Set-Content -Path $script:PrevPath -Value '{ this is not valid json' -Encoding utf8NoBOM
        $fresh = @(
            [ordered]@{ id = 'crux-001'; statement = 'X'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            # Should NOT throw. Warning is expected (redirect 3>$null so the test output stays clean).
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath 3>$null
            $stats.Preserved | Should -Be 0
            $stats.Dropped   | Should -Be 0
            $Fresh[0].Contains('external_evidence') | Should -BeFalse
        }
    }

    It 'Preserves multi-entry evidence arrays intact and in order' {
        $ev = @(
            [ordered]@{ url = 'https://example.org/a.pdf'; note = 'first';  added_by = 'r1'; added_at = '2026-07-10' }
            [ordered]@{ url = 'https://example.org/b.pdf'; note = 'second'; added_by = 'r2'; added_at = '2026-07-11' }
            [ordered]@{ url = 'https://example.org/c.pdf'; note = 'third';  added_by = 'r3'; added_at = '2026-07-12' }
        )
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id                = 'crux-080'
                    statement         = 'Multi-evidence crux.'
                    type              = 'empirical'
                    external_evidence = $ev
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-080'; statement = 'Multi-evidence crux.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            $stats = Merge-CruxExternalEvidence -Cruxes $Fresh -PreviousPath $PrevPath
            $stats.Preserved | Should -Be 1
            @($Fresh[0]['external_evidence']).Count | Should -Be 3
            $Fresh[0]['external_evidence'][0].note | Should -Be 'first'
            $Fresh[0]['external_evidence'][1].note | Should -Be 'second'
            $Fresh[0]['external_evidence'][2].note | Should -Be 'third'
        }
    }
}
