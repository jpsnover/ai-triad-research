# Tag: summary (t/2916)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Save-JsonNodeFieldEdits — the Public durable batch writer (t/2916 Fork 1,
    TL ruling t/2916#8). It reads the target fresh, applies each edit via the Private
    Update-JsonNodeField (chaining RawText->next), writes once via the guarded sink with
    the surgical exemption, and returns a result summary (Applied + NotFound) so a
    not-found node never vanishes silently. TestDrive targets are outside the data root,
    so the dirty-tree guard no-ops here — the exemption itself is proved in
    SurgicalWriteExemption.Tests.ps1.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Save-JsonNodeFieldEdits — durable batch writer (t/2916)' -Tag 'summary' {

    BeforeEach {
        $script:fixture = @'
{
  "nodes": [
    { "id": "sit-001", "type": "situation", "disagreement_type": "empirical" },
    { "id": "sit-002", "label": "no dtype yet" },
    { "id": "sit-003", "disagreement_type": "empirical", "resolved_node_id": "sit-477", "ratio": 3.0 }
  ]
}
'@ -replace "`r`n", "`n"
        $script:path = Join-Path $TestDrive 'situations-fixture.json'
        [System.IO.File]::WriteAllText($script:path, $script:fixture, (New-Object System.Text.UTF8Encoding $false))
    }

    It 'applies multiple edits (read-fresh + chained splice) and preserves foreign WIP byte-identical' {
        $edits = @(
            @{ NodeId = 'sit-001'; Field = 'disagreement_type'; Value = 'normative' }
            @{ NodeId = 'sit-002'; Field = 'disagreement_type'; Value = 'interpretive' }
        )
        $result = Save-JsonNodeFieldEdits -Path $script:path -Edits $edits
        $result.Applied | Should -Be 2

        $after = Get-Content -Raw -Path $script:path
        $o = @(($after | ConvertFrom-Json).nodes)
        (@($o | Where-Object { $_.id -eq 'sit-001' })[0]).disagreement_type | Should -Be 'normative'
        (@($o | Where-Object { $_.id -eq 'sit-002' })[0]).disagreement_type | Should -Be 'interpretive'
        (@($o | Where-Object { $_.id -eq 'sit-002' })[0]).label             | Should -Be 'no dtype yet'
        # foreign WIP on the untouched node survives byte-identical (the sit-477 shape)
        $after | Should -BeLike '*"resolved_node_id": "sit-477"*'
        $after | Should -BeLike '*"ratio": 3.0*'
        # exactly two lines differ from the original — no whole-file churn
        $origLines = @($script:fixture -split "`n")
        $newLines  = @($after -split "`n")
        $newLines.Count | Should -Be $origLines.Count
        $diff = for ($i = 0; $i -lt $origLines.Count; $i++) { if ($origLines[$i] -ne $newLines[$i]) { $i } }
        @($diff).Count | Should -Be 2
    }

    It 'surfaces not-found NodeIds in the result summary (no silent skip) and still lands the valid edits' {
        $edits = @(
            @{ NodeId = 'sit-001'; Field = 'disagreement_type'; Value = 'normative' }
            @{ NodeId = 'sit-999'; Field = 'disagreement_type'; Value = 'x' }   # absent node
        )
        $result = Save-JsonNodeFieldEdits -Path $script:path -Edits $edits
        $result.Applied  | Should -Be 1
        $result.NotFound | Should -Contain 'sit-999'
        (@((Get-Content -Raw -Path $script:path | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'sit-001' })[0]).disagreement_type | Should -Be 'normative'
    }

    It 'is a no-op write when no edit resolves (empty list leaves bytes untouched)' {
        $before = Get-Content -Raw -Path $script:path
        $result = Save-JsonNodeFieldEdits -Path $script:path -Edits @()
        $result.Applied | Should -Be 0
        (Get-Content -Raw -Path $script:path) | Should -Be $before
    }

    It 'aborts the whole batch and writes NOTHING when an edit hits the scalar-only limitation' {
        # An object-valued field trips Update-JsonNodeField's re-parse-verify (duplicate key)
        # -> throw. The batch is atomic on unexpected failure: nothing is written.
        $objFixture = @'
{
  "nodes": [
    { "id": "sit-001", "meta": { "a": 1 }, "note": "object-valued field" }
  ]
}
'@ -replace "`r`n", "`n"
        $p = Join-Path $TestDrive 'obj-fixture.json'
        [System.IO.File]::WriteAllText($p, $objFixture, (New-Object System.Text.UTF8Encoding $false))
        { Save-JsonNodeFieldEdits -Path $p -Edits @(@{ NodeId='sit-001'; Field='meta'; Value='scalar' }) } | Should -Throw
        (Get-Content -Raw -Path $p) | Should -Be $objFixture   # unchanged
    }

    It 'throws New-ActionableError when the target file does not exist' {
        { Save-JsonNodeFieldEdits -Path (Join-Path $TestDrive 'missing.json') -Edits @(@{ NodeId='x'; Field='y'; Value='z' }) } |
            Should -Throw
    }

    It 'throws when an edit hashtable is missing a required key' {
        { Save-JsonNodeFieldEdits -Path $script:path -Edits @(@{ NodeId='sit-001' }) } | Should -Throw
    }
}
