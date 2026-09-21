# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    C5 hygiene enforcement for `.trivyignore` (t/3539). Rides the already-required
    `test-powershell` gate (TL ruling t/3539#2, Option C) — no new gate, unbypassable.
.DESCRIPTION
    Arm B (the enforcement leg): the COMMITTED `.trivyignore` must have zero
    REVISIT-uncovered suppression directives. This turns C5 from a point-in-time
    audit into a continuously-true property — a future edit that adds a suppression
    without a REVISIT trigger (or a stray blank line that orphans directives from
    their trigger) fails CI.

    Arm A + edges: the detection logic itself, exercised against crafted fixtures
    so the gate is proven to FAIL on a real gap, not merely pass on a clean file.

    Grouping rule (blank-line-delimited blocks) is documented in the checker at its
    point of use: operations/devops/TrivyIgnoreRevisitLint.ps1.
#>

Describe 'TrivyIgnoreRevisitLint — C5 hygiene (t/3539)' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/TrivyIgnoreRevisitLint.ps1"
        $script:TrivyIgnorePath = "$PSScriptRoot/../.trivyignore"
    }

    Context 'Arm B — the committed .trivyignore (the enforcement leg)' {
        It 'exists' {
            Test-Path -LiteralPath $script:TrivyIgnorePath | Should -BeTrue
        }

        It 'has ZERO suppression directives without a REVISIT trigger' {
            $gaps = @(Get-TrivyIgnoreRevisitGap -Path $script:TrivyIgnorePath)
            $gaps.Count | Should -Be 0 -Because (Format-TrivyIgnoreGapMessage $gaps)
        }
    }

    Context 'Arm A + edges — detection logic on crafted fixtures' {
        It 'FLAGS a directive whose block has no REVISIT' {
            $fixture = @(
                '# some package — no fix',
                '# Exposure: not reachable',
                'CVE-2026-11111'
            )
            $gaps = @(Get-TrivyIgnoreRevisitGap -Line $fixture)
            $gaps.Count | Should -Be 1
            $gaps[0].Directive | Should -Be 'CVE-2026-11111'
        }

        It 'PASSES a directive whose block contains a REVISIT trigger' {
            $fixture = @(
                '# some package — no fix',
                '# REVISIT: drop when upstream ships a fix. Re-scan.',
                'CVE-2026-22222'
            )
            @(Get-TrivyIgnoreRevisitGap -Line $fixture).Count | Should -Be 0
        }

        It 'FLAGS directives orphaned by a stray blank line (the TL edge, t/3539#2)' {
            # REVISIT and the directive are split into two blocks by a blank line,
            # so the directive is no longer covered — must be caught.
            $fixture = @(
                '# some package — no fix',
                '# REVISIT: drop when upstream ships a fix. Re-scan.',
                '',
                'CVE-2026-33333'
            )
            $gaps = @(Get-TrivyIgnoreRevisitGap -Line $fixture)
            $gaps.Count | Should -Be 1
            $gaps[0].Directive | Should -Be 'CVE-2026-33333'
        }

        It 'does NOT treat comment-form CVE annotations (# CVE-...) as directives' {
            $fixture = @(
                '# CVE-2026-44444  somepkg: HIGH — annotation only, no bare directive',
                '# Exposure: not reachable'
            )
            @(Get-TrivyIgnoreRevisitGap -Line $fixture).Count | Should -Be 0
        }

        It 'covers GHSA- and TEMP- directive prefixes' {
            $noRevisit = @('# pkg', 'GHSA-aaaa-bbbb-cccc', 'TEMP-1234567-890')
            $gaps = @(Get-TrivyIgnoreRevisitGap -Line $noRevisit)
            $gaps.Count | Should -Be 2
            $withRevisit = @('# pkg', '# REVISIT: later', 'GHSA-aaaa-bbbb-cccc', 'TEMP-1234567-890')
            @(Get-TrivyIgnoreRevisitGap -Line $withRevisit).Count | Should -Be 0
        }

        It 'scopes REVISIT to its own block (a covered block does not shield the next)' {
            $fixture = @(
                '# pkg A',
                '# REVISIT: later',
                'CVE-2026-00001',
                '',
                '# pkg B — missing its trigger',
                'CVE-2026-00002'
            )
            $gaps = @(Get-TrivyIgnoreRevisitGap -Line $fixture)
            $gaps.Count | Should -Be 1
            $gaps[0].Directive | Should -Be 'CVE-2026-00002'
        }

        It 'reports the correct 1-based line number for a gap' {
            $fixture = @('# pkg', 'CVE-2026-55555')   # directive on line 2
            (Get-TrivyIgnoreRevisitGap -Line $fixture)[0].LineNumber | Should -Be 2
        }
    }
}
