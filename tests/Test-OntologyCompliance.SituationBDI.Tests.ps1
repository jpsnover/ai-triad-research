# Tag: taxonomy (t/1312)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Gate tests for the situation BDI-decomposition compliance check in
    Test-OntologyCompliance (t/1312, wording approved by CL at t/1312#2).
.NOTES
    These tests verify the *check logic* — presence, CL-approved wording, Detail
    shape, and (fixture-based) correct classification of non-decomposed nodes.
    They do NOT assert the live-corpus NNN/NNN count: that live-data baseline was
    moved to tests/data-compliance/ (t/2332) so a situations-data change can no
    longer red this required merge gate. See the data-compliance suite for the
    live count trip-wire.
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

    It 'The Detail line has the CL-approved shape (pass/total accounting)' {
        # Both pass and fail states share the "$Pass / $NonDep non-deprecated" prefix.
        # Fail-state breakdown (non-decomposed / missing) only appears when status=='fail'.
        # Shape only — no exact count — so live-corpus drift can't break this gate.
        $script:BdiCheck.Detail | Should -Match '\d+ / \d+ non-deprecated situations'
        if ($script:BdiCheck.Status -eq 'fail') {
            $script:BdiCheck.Detail | Should -Match 'belief \+ desire \+ intention'
            $script:BdiCheck.Detail | Should -Match 'non-decomposed'
            $script:BdiCheck.Detail | Should -Match 'missing the interpretations block'
        }
    }

    It 'Detail does NOT include a ticket-ref (CL Q3 answer)' {
        # CL: "drop the ticket ref from the runtime Detail" (t/1312#2 Q3)
        $script:BdiCheck.Detail | Should -Not -Match 't/1\d{3}'
        $script:BdiCheck.Detail | Should -Not -Match 't/1306'
    }

    It 'Fix instructions reference the CL-owned UsageID (creation-path adopters) — only emitted on fail' {
        # Add-Check only stores Fix hints when status is 'fail'; on 'pass' Fix is empty.
        # Verify the passing-state Fix is empty AND that the check name still signals
        # what would be recommended if the corpus regresses.
        if ($script:BdiCheck.Status -eq 'pass') {
            $script:BdiCheck.Fix | Should -BeNullOrEmpty
        } else {
            $script:BdiCheck.Fix | Should -Match 'enrichment.situation-bdi-decomposition'
            $script:BdiCheck.Fix | Should -Match 'Invoke-AIByUsage'
        }
    }
}

Describe 'Situation BDI-decomposition classification logic (fixture-based, t/2332)' -Tag 'taxonomy' {
    # The live-data NNN/NNN baseline moved to tests/data-compliance/ so it no longer
    # gates code merges. This suite keeps the *logic* covered in the required gate by
    # driving the extracted Private helper (Test-SituationBdiDecomposition) with a
    # synthetic fixture — decoupled from live corpus size. Fixture is JSON parsed via
    # ConvertFrom-Json so node shape matches production (situations.json) exactly.

    BeforeAll {
        $script:FixtureJson = @'
{
  "nodes": [
    {
      "id": "sit-fixture-pass",
      "description": "A situation that is fully decomposed across all three POVs.",
      "interpretations": {
        "accelerationist": { "belief": "b", "desire": "d", "intention": "i" },
        "safetyist":       { "belief": "b", "desire": "d", "intention": "i" },
        "skeptic":         { "belief": "b", "desire": "d", "intention": "i" }
      }
    },
    {
      "id": "sit-fixture-flatstring",
      "description": "A situation with legacy flat-string interpretations.",
      "interpretations": {
        "accelerationist": "accelerationists welcome this",
        "safetyist":       "safetyists worry about this",
        "skeptic":         "skeptics doubt this"
      }
    },
    {
      "id": "sit-fixture-missingblock",
      "description": "A situation with no interpretations block at all."
    },
    {
      "id": "sit-fixture-partialbdi",
      "description": "A situation where one POV is missing the intention field.",
      "interpretations": {
        "accelerationist": { "belief": "b", "desire": "d", "intention": "i" },
        "safetyist":       { "belief": "b", "desire": "d" },
        "skeptic":         { "belief": "b", "desire": "d", "intention": "i" }
      }
    },
    {
      "id": "sit-fixture-deprecated",
      "description": "[DEPRECATED] superseded situation, exempt from the check.",
      "interpretations": {}
    }
  ]
}
'@
        $script:Fixture = $script:FixtureJson | ConvertFrom-Json
        $script:Result = InModuleScope AITriad -Parameters @{ Nodes = $script:Fixture.nodes } {
            param($Nodes)
            Test-SituationBdiDecomposition -Node $Nodes
        }
    }

    It 'Counts the fully-decomposed situation as passing' {
        $script:Result.Pass | Should -Be 1
    }

    It 'Flags the legacy flat-string interpretation as non-decomposed' {
        $script:Result.NonDecomposedIds | Should -Contain 'sit-fixture-flatstring'
    }

    It 'Flags a POV missing the intention field as non-decomposed' {
        $script:Result.NonDecomposedIds | Should -Contain 'sit-fixture-partialbdi'
        $script:Result.NonDecomposed | Should -Be 2
    }

    It 'Flags the missing interpretations block as empty' {
        $script:Result.EmptyIds | Should -Contain 'sit-fixture-missingblock'
        $script:Result.Empty | Should -Be 1
    }

    It 'Exempts the [DEPRECATED]-prefixed situation from the non-deprecated set' {
        $script:Result.Deprecated | Should -Be 1
        # 5 nodes total, 1 deprecated → 4 non-deprecated evaluated
        $script:Result.NonDeprecated | Should -Be 4
    }

    It 'Reports total failures = non-decomposed + empty' {
        $script:Result.Fail | Should -Be 3
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
