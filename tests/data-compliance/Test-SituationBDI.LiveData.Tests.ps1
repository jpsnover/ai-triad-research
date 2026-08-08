# Tag: taxonomy, DataCompliance (t/1312, relocated t/2332)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Live-data compliance trip-wire for the situation BDI-decomposition check.
    Asserts the current situations corpus (../ai-triad-data) is fully decomposed.
.NOTES
    RELOCATED from the required `test-powershell` merge gate to a data-triggered /
    scheduled job (t/2324 TL decision; t/2331 DevOps job; t/2332 PowerShell move).

    WHY THIS IS NOT A CODE GATE: this asserts an exact live-corpus count, which is a
    property of the DATA repo, not of any code change. Sitting it in the code merge
    gate coupled every unrelated code PR to data-corpus completeness — a single
    non-decomposed situation (sit-471..475, t/2323) reds the whole fleet. It now runs
    where the data actually changes; regressions alert the data/PS owner instead of
    blocking code merges. The check *logic* stays covered in the code gate via a
    fixture-based test (tests/Test-OntologyCompliance.SituationBDI.Tests.ps1, t/2332).

    UPDATING THE BASELINE is still the intended way to record backfill progress:
    - 411->412 (t/1655): corpus grew by one net compliant non-deprecated situation.
    - 412->435 (t/1805): workflow-app v1.0.0 wrote sit-448..470 un-enriched; decomposed
      via enrichment.situation-bdi-decomposition, merged with CL sign-off.
    - 435->440 (t/2323): sit-471..475 added with flat-string interpretations; decomposed
      via enrichment.situation-bdi-decomposition.
    When this trip-wire fires, run the backfill on the flagged ids, then bump the count.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:Ontology = Test-OntologyCompliance -Quiet -PassThru -ErrorAction Continue 2>$null
    $script:BdiCheck = $script:Ontology.Checks |
        Where-Object { $_.Category -eq 'BDI' -and $_.Check -like '*BDI decomposition*' } |
        Select-Object -First 1
}

Describe 'Situation BDI-decomposition live-data baseline (t/1312, relocated t/2332)' -Tag 'taxonomy', 'DataCompliance' {

    It 'The BDI-decomposition check is present against the live corpus' {
        $script:BdiCheck | Should -Not -BeNullOrEmpty
    }

    It 'Live-data baseline: 440 / 440 non-deprecated situations pass, 1 exempt (post-t/2323 backfill)' {
        $script:BdiCheck.Status | Should -Be 'pass'
        $script:BdiCheck.Detail | Should -Match '440 / 440'
        $script:BdiCheck.Detail | Should -Match '1 exempt via \[DEPRECATED\] prefix'
    }

    It 'Deprecation is signalled by the [DEPRECATED] description prefix (CL Q1 answer)' {
        # Verify the live corpus carries at least one [DEPRECATED] situation so the
        # exemption path is exercised against real data.
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
