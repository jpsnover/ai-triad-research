# Tag: ingestion (t/1644)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests that the single-shot summary pipeline persists a debug-raw file when
    the model returns unparseable JSON.
.DESCRIPTION
    Regression coverage for t/1644: the chunked pipeline (Parse-AIResponse)
    saves a <DocId>.debug-raw.txt on JSON parse failure, but the single-shot
    path in Invoke-SummaryPipeline returned 'InvalidJson' silently, leaving
    parse failures on small docs undiagnosable. The single-shot path must now
    mirror the chunked behavior by writing <DocId>-single-shot.debug-raw.txt.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-SummaryPipeline single-shot debug-raw persistence' -Tag 'ingestion' {

    It 'Saves a -single-shot.debug-raw.txt file when the model returns invalid JSON' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("aitriad-t1644-" + [System.Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            try {
                $RawGarbage = 'this is not json at all — the model went off the rails {oops'

                # Keep single-shot: never flip to FIRE (Stage 1 or Stage 2).
                Mock Test-FireRequired { @{ ShouldFire = $false; Reason = 'test' } }
                # Model returns unparseable text.
                Mock Invoke-AIApi { @{ Text = $RawGarbage; Backend = 'gemini-test' } }
                # Repair cannot salvage it either.
                Mock Repair-TruncatedJson { $RawGarbage }
                # Redirect the debug-raw write to the temp dir.
                Mock Get-SummariesDir { $TempDir }

                $Result = Invoke-SummaryPipeline `
                    -SnapshotText 'A short document body that stays under the single-shot threshold.' `
                    -DocId 'debug-raw-test-doc' `
                    -Metadata ([pscustomobject]@{ title = 'Debug Raw Test' }) `
                    -ApiKey 'test-key' `
                    -TaxonomyVersion 'test' `
                    -SystemPromptTemplate 'System prompt.' `
                    -OutputSchema '{}' `
                    -TaxonomyJsonOverride 'x' `
                    -WarningAction SilentlyContinue `
                    -Model 'gemini-test'  # model-lint:allow (mock-only backend id — deliberately not registered)

                $Result.Success | Should -BeFalse
                $Result.Error | Should -Be 'InvalidJson'

                $DebugPath = Join-Path $TempDir 'debug-raw-test-doc-single-shot.debug-raw.txt'
                Test-Path $DebugPath | Should -BeTrue -Because 'the raw model output must be persisted for diagnosis'
                (Get-Content -Raw -Path $DebugPath) | Should -Match 'off the rails'
            }
            finally {
                Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Returns an API-null error and warns when the AI call returns null' {
        InModuleScope AITriad {
            Mock Test-FireRequired { @{ ShouldFire = $false; Reason = 'test' } }
            Mock Invoke-AIApi { $null }

            $WarningsSeen = @()
            $Result = Invoke-SummaryPipeline `
                -SnapshotText 'A short document body that stays under the single-shot threshold.' `
                -DocId 'null-api-test-doc' `
                -Metadata ([pscustomobject]@{ title = 'Null API Test' }) `
                -ApiKey 'test-key' `
                -TaxonomyVersion 'test' `
                -SystemPromptTemplate 'System prompt.' `
                -OutputSchema '{}' `
                -TaxonomyJsonOverride 'x' `
                -WarningVariable WarningsSeen `
                -WarningAction SilentlyContinue `
                -Model 'gemini-test'  # model-lint:allow (mock-only backend id — deliberately not registered)

            $Result.Success | Should -BeFalse
            $Result.Error | Should -Be 'API call returned null'
            ($WarningsSeen -join "`n") | Should -Match 'null-api-test-doc' -Because 'the warning must name the doc ID'
        }
    }
}
