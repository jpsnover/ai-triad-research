# Tag: health (t/3829)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Update-ComplexityBaseline / Test-ComplexityBudget integration (t/3829).
.DESCRIPTION
    Exercises the generator and enforcer together against isolated temp trees
    (never the real scripts/ tree -- that stays fast/deterministic here; the
    live-fire run against the real tree happens once, manually, before landing,
    per t/3829#4's "live-fire before landing: register at error, run the real
    tree, observe").

    Covers the three Gate Verification arms the ticket requires:
      1. New over-threshold function in a non-baselined file -> error.
      2. max/countOver regression in a baselined file -> error.
      3. Unmodified tree -> clean.
    Plus the generator's own self-validation and write-only-downward behavior.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    function New-OffenderFixture([string]$Dir, [string]$Name, [int]$ClauseCount) {
        # baseline 1 + N if/elseif clauses -> complexity = N + 1
        $clauses = for ($i = 0; $i -lt $ClauseCount; $i++) {
            if ($i -eq 0) { "if (`$c$i) { $i }" } else { "elseif (`$c$i) { $i }" }
        }
        $body = $clauses -join ' '
        Set-Content -Path (Join-Path $Dir "$Name.ps1") -Value "function $Name { $body }"
    }
}

Describe 'Update-ComplexityBaseline / Test-ComplexityBudget (t/3829)' -Tag 'health' {

    BeforeEach {
        $script:Dir = Join-Path ([System.IO.Path]::GetTempPath()) "cbt-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:Dir -Force | Out-Null
        $script:BaselinePath = Join-Path $script:Dir 'complexity-baseline.json'
    }

    AfterEach {
        Remove-Item -Path $script:Dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Context 'Update-ComplexityBaseline (generator)' {

        It 'baselines only offenders (max > threshold), never sub-threshold files' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20   # complexity 21
            New-OffenderFixture $script:Dir 'Test-Fine' 2        # complexity 3
            $r = Update-ComplexityBaseline -Path $script:Dir -Threshold 15
            $r.OffenderCount | Should -Be 1

            $baseline = Get-Content $script:BaselinePath -Raw | ConvertFrom-Json
            $baseline.PSObject.Properties.Name | Should -Contain 'Test-Offender.ps1'
            $baseline.PSObject.Properties.Name | Should -Not -Contain 'Test-Fine.ps1'
        }

        It 'records __meta__.threshold and __meta__.scan' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null
            $baseline = Get-Content $script:BaselinePath -Raw | ConvertFrom-Json
            $baseline.__meta__.threshold | Should -Be 15
            $baseline.__meta__.scan | Should -Be (Split-Path $script:Dir -Leaf)
        }

        It 'drops a cured file (improved to at-or-below threshold) from the baseline entirely' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            # "Cure" it: rewrite with low complexity.
            New-OffenderFixture $script:Dir 'Test-Offender' 2
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            $baseline = Get-Content $script:BaselinePath -Raw | ConvertFrom-Json
            $baseline.PSObject.Properties.Name | Should -Not -Contain 'Test-Offender.ps1'
        }

        It 'write-only-downward: a regression keeps the OLD frozen value, not the worse observed one' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20   # complexity 21
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null
            $before = (Get-Content $script:BaselinePath -Raw | ConvertFrom-Json).'Test-Offender.ps1'.max

            New-OffenderFixture $script:Dir 'Test-Offender' 30   # complexity 31 -- regression
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 -WarningAction SilentlyContinue | Out-Null

            $after = (Get-Content $script:BaselinePath -Raw | ConvertFrom-Json).'Test-Offender.ps1'.max
            $after | Should -Be $before -Because 'write-only-downward must never raise a recorded number'
        }
    }

    Context 'Test-ComplexityBudget — Gate Verification Arm 1: new offender, non-baselined file' {

        It 'flags a new over-threshold function in a file absent from the baseline' {
            New-OffenderFixture $script:Dir 'Test-Baselined' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            New-OffenderFixture $script:Dir 'Test-NewOffender' 20   # not in baseline

            $r = Test-ComplexityBudget -Path $script:Dir
            $r.Passed | Should -Be $false
            ($r.Violations | Where-Object Reason -eq 'new-offender').File | Should -Contain 'Test-NewOffender.ps1'
        }
    }

    Context 'Test-ComplexityBudget — Gate Verification Arm 2: regression in a baselined file' {

        It 'flags max rising in a baselined file' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20   # complexity 21
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            New-OffenderFixture $script:Dir 'Test-Offender' 30   # complexity 31 -- regression

            $r = Test-ComplexityBudget -Path $script:Dir
            $r.Passed | Should -Be $false
            ($r.Violations | Where-Object Reason -eq 'regression').File | Should -Contain 'Test-Offender.ps1'
        }

        It '-FailOnViolation throws when a violation exists' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null
            New-OffenderFixture $script:Dir 'Test-Offender' 30

            { Test-ComplexityBudget -Path $script:Dir -FailOnViolation } | Should -Throw
        }
    }

    Context 'Test-ComplexityBudget — Gate Verification Arm 3: unmodified tree is clean' {

        It 'passes with zero violations immediately after generating the baseline' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            New-OffenderFixture $script:Dir 'Test-Fine' 2
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            $r = Test-ComplexityBudget -Path $script:Dir
            $r.Passed | Should -Be $true
            $r.Violations.Count | Should -Be 0
        }

        It '-FailOnViolation does not throw on a clean tree' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null
            { Test-ComplexityBudget -Path $script:Dir -FailOnViolation } | Should -Not -Throw
        }
    }

    Context 'Separator normalization (t/3874) — a baseline generated on one OS, enforced on another' {
        # The real bug: scripts/complexity-baseline.json was generated on Windows (keys like
        # 'AITriad\Private\Foo.ps1') and enforced on Linux CI, where Measure-CodeComplexity's
        # File (via [System.IO.Path]::GetRelativePath) is '/'-separated. ContainsKey never
        # matched, so all 229 baselined files read as brand-new offenders (177 surfaced over
        # threshold). These tests hand-write a '\'-keyed entry -- the exact legacy shape --
        # against a nested fixture, so they exercise the normalization fix regardless of which
        # OS runs them (both Get-ComplexityScanTargets' write-side and the two cmdlets' read-side
        # now normalize unconditionally to '/', not by checking the current OS).

        It 'a legacy backslash-keyed baseline entry matches the forward-slash-produced path (Test-ComplexityBudget / lookup)' {
            $sub = Join-Path $script:Dir 'sub'
            New-Item -ItemType Directory -Path $sub -Force | Out-Null
            New-OffenderFixture $sub 'Test-Nested' 20   # complexity 21

            $baseline = [ordered]@{
                __meta__              = [ordered]@{ threshold = 15; scan = (Split-Path $script:Dir -Leaf); doc = 'test' }
                'sub\Test-Nested.ps1' = [ordered]@{ max = 21; countOver = 1 }
            }
            $baseline | ConvertTo-Json -Depth 5 | Set-Content -Path $script:BaselinePath

            $r = Test-ComplexityBudget -Path $script:Dir
            $r.Passed | Should -Be $true -Because 'a backslash-keyed entry must match the forward-slash-produced path, not read as a new offender'
            $r.Violations.Count | Should -Be 0
        }

        It 'a legacy backslash-keyed baseline entry is recognized by Update-ComplexityBaseline too (generation side), not duplicated' {
            $sub = Join-Path $script:Dir 'sub'
            New-Item -ItemType Directory -Path $sub -Force | Out-Null
            New-OffenderFixture $sub 'Test-Nested' 20   # complexity 21

            $baseline = [ordered]@{
                __meta__              = [ordered]@{ threshold = 15; scan = (Split-Path $script:Dir -Leaf); doc = 'test' }
                'sub\Test-Nested.ps1' = [ordered]@{ max = 21; countOver = 1 }
            }
            $baseline | ConvertTo-Json -Depth 5 | Set-Content -Path $script:BaselinePath

            $r = Update-ComplexityBaseline -Path $script:Dir -Threshold 15
            $r.OffenderCount | Should -Be 1 -Because 'the legacy backslash key and the forward-slash observed path are the SAME file, not two entries'

            $written = Get-Content $script:BaselinePath -Raw | ConvertFrom-Json
            $keys = @($written.PSObject.Properties.Name | Where-Object { $_ -ne '__meta__' })
            $keys.Count | Should -Be 1
            $keys[0] | Should -Be 'sub/Test-Nested.ps1' -Because 'regeneration must always emit forward-slash keys'
        }

        It 'Update-ComplexityBaseline never emits a key containing a backslash, even for nested files' {
            $sub = Join-Path $script:Dir 'sub'
            New-Item -ItemType Directory -Path $sub -Force | Out-Null
            New-OffenderFixture $sub 'Test-Nested' 20

            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            $written = Get-Content $script:BaselinePath -Raw | ConvertFrom-Json
            $keys = @($written.PSObject.Properties.Name | Where-Object { $_ -ne '__meta__' })
            $keys | Should -Not -BeNullOrEmpty
            @($keys | Where-Object { $_.Contains('\') }).Count | Should -Be 0
        }

        It 'Test-ComplexityBudget reports a NEW nested offender with a forward-slash File path' {
            $sub = Join-Path $script:Dir 'sub'
            New-Item -ItemType Directory -Path $sub -Force | Out-Null
            New-OffenderFixture $sub 'Test-Nested' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            New-OffenderFixture $sub 'Test-NewNested' 20   # not in baseline, nested

            $r = Test-ComplexityBudget -Path $script:Dir
            $r.Passed | Should -Be $false
            ($r.Violations | Where-Object Reason -eq 'new-offender').File | Should -Contain 'sub/Test-NewNested.ps1'
        }
    }

    Context 'Test-ComplexityBudget — threshold/scan mismatch (ties the pair structurally)' {

        It 'reads the threshold from baseline __meta__ when -Threshold is omitted' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null
            (Test-ComplexityBudget -Path $script:Dir).Threshold | Should -Be 15
        }

        It 'hard-errors when an explicit -Threshold disagrees with the baseline-recorded value' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null
            { Test-ComplexityBudget -Path $script:Dir -Threshold 20 } | Should -Throw
        }

        It 'hard-errors on a scan-scope mismatch' {
            New-OffenderFixture $script:Dir 'Test-Offender' 20
            Update-ComplexityBaseline -Path $script:Dir -Threshold 15 | Out-Null

            $raw = Get-Content $script:BaselinePath -Raw | ConvertFrom-Json
            $raw.__meta__.scan = 'some-other-scope'
            $raw | ConvertTo-Json -Depth 5 | Set-Content -Path $script:BaselinePath

            { Test-ComplexityBudget -Path $script:Dir } | Should -Throw
        }

        It 'hard-errors when the baseline file does not exist' {
            { Test-ComplexityBudget -Path $script:Dir } | Should -Throw
        }
    }
}
