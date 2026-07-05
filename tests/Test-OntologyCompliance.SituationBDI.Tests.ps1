# Tag: taxonomy (t/1312)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the situation BDI-decomposition compliance check added to
    Test-OntologyCompliance under t/1312. Wording approved by CL at t/1312#2.
.NOTES
    Live-data baseline may shift as t/1306 backfill lands. Update the
    128/283 numbers when that happens — that's the intended way this
    regression trip-wire records backfill progress.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Cache one PassThru run so tests share it (fast + avoids re-scanning ~5k nodes)
    $script:Ontology = Test-OntologyCompliance -Quiet -PassThru -ErrorAction Continue 2>$null
    $script:BdiCheck = $script:Ontology.Checks |
        Where-Object { $_.Category -eq 'BDI' -and $_.Check -like '*BDI decomposition*' } |
        Select-Object -First 1
}

Describe 'Situation BDI-decomposition compliance check (t/1312)' -Tag 'taxonomy' {

    It 'The BDI-decomposition check is present in Test-OntologyCompliance output' {
        $script:BdiCheck | Should -Not -BeNullOrEmpty
        $script:BdiCheck.Check | Should -Match 'BDI decomposition'
    }

    It 'The check uses CL-approved wording (t/1312#2)' {
        # CL approved: 'Situation interpretations: per-POV BDI decomposition'
        $script:BdiCheck.Check | Should -BeLike 'Situation interpretations: per-POV BDI decomposition*'
    }

    It 'The Detail line has the CL-approved shape (pass/total + fail breakdown)' {
        # Approved wording: "$Pass / $NonDep non-deprecated situations have full per-POV BDI decomposition
        # (all three POVs carry non-empty belief + desire + intention). $Fail fail: $NonDecomposed non-decomposed,
        # $Empty missing the interpretations block."
        $script:BdiCheck.Detail | Should -Match '\d+ / \d+ non-deprecated situations'
        $script:BdiCheck.Detail | Should -Match 'belief \+ desire \+ intention'
        $script:BdiCheck.Detail | Should -Match 'non-decomposed'
        $script:BdiCheck.Detail | Should -Match 'missing the interpretations block'
    }

    It 'Detail does NOT include a ticket-ref (CL Q3 answer)' {
        # CL: "drop the ticket ref from the runtime Detail" (t/1312#2 Q3)
        $script:BdiCheck.Detail | Should -Not -Match 't/1\d{3}'
        $script:BdiCheck.Detail | Should -Not -Match 't/1306'
    }

    It 'Fix instructions reference the CL-owned UsageID (creation-path adopters)' {
        $script:BdiCheck.Fix | Should -Match 'enrichment.situation-bdi-decomposition'
        $script:BdiCheck.Fix | Should -Match 'Invoke-AIByUsage'
    }

    It 'Live-data baseline: 128 pass / 283 fail non-deprecated situations (t/1306 backfill in flight)' {
        # This is the trip-wire — will need updating as the backfill lands. Match the exact
        # baseline reproduced by CL and this ticket's design in t/1312#1.
        $script:BdiCheck.Status | Should -Be 'fail'
        $script:BdiCheck.Detail | Should -Match '128 / 411'
        $script:BdiCheck.Detail | Should -Match '283 fail'
        $script:BdiCheck.Detail | Should -Match '250 non-decomposed'
        $script:BdiCheck.Detail | Should -Match '33 missing'
    }

    It 'Detail includes first-N offending IDs (CL Q4 answer: first 10 of N)' {
        # Non-decomposed and empty samples both appear
        $script:BdiCheck.Detail | Should -Match 'non-decomposed sample:'
        $script:BdiCheck.Detail | Should -Match 'empty sample:'
    }

    It 'Deprecation is signalled by the [DEPRECATED] description prefix (CL Q1 answer)' {
        # Verify the fixture we ran against carries at least one [DEPRECATED] situation
        # so the exemption path was exercised.
        InModuleScope AITriad {
            $tax = Get-TaxonomyDir
            $sitPath = Join-Path $tax 'situations.json'
            Test-Path $sitPath | Should -Be $true
            $sit = Get-Content -Raw -Path $sitPath -Encoding utf8 | ConvertFrom-Json
            $deprecated = @($sit.nodes | Where-Object {
                $_.PSObject.Properties['description'] -and
                ([string]$_.description).TrimStart().StartsWith('[DEPRECATED]')
            })
            $deprecated.Count | Should -BeGreaterThan 0
        }
    }
}

Describe 'Ingestion no-op confirmation (t/1312 Part 2)' -Tag 'taxonomy' {

    It 'No PowerShell public cmdlet writes new situation nodes (grep sanity)' {
        # Part 2 of the ticket confirmed at t/1312#1 as a no-op — this test makes
        # that a regression-detectable claim: if any Public cmdlet ever starts
        # writing situations.json, we want to know so we can wire it to
        # enrichment.situation-bdi-decomposition per CL's guidance.
        $publicDir = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public'
        $writers = @(Get-ChildItem -Path $publicDir -Filter '*.ps1' -File |
            Where-Object {
                $raw = Get-Content -Raw -Path $_.FullName
                $raw -match 'Set-Content.*situations\.json' -or
                $raw -match 'situations\.json.*Set-Content' -or
                $raw -match '\[System\.IO\.File\]::Move\(.+situations\.json' -or
                $raw -match 'situations\.json.*File\.Move'
            })
        # Empty array is expected today. If this test starts failing, adopt the
        # UsageID pattern in the newly-writing cmdlet before merging.
        @($writers).Count | Should -Be 0
    }
}
