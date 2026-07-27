# Tag: ingestion (t/1774)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Fault-injection tests for Invoke-DocSummaryWithCapture (t/1774).
.DESCRIPTION
    t/1728 added per-doc try/catch to Invoke-BatchSummary's parallel block, but
    that inline `ForEach-Object -Parallel` scriptblock can't be reached by Pester
    mocks — so it was only testable against a REPLICA of the pattern. t/1774
    extracts the per-doc "process one doc, or record a failure" step into the
    private Invoke-DocSummaryWithCapture, used by BOTH the sequential and parallel
    batch paths, so the REAL resilience path is directly testable.

    Fault injection here = a Pester Mock that makes Invoke-DocumentSummary throw
    (there is no PowerShell FaultHarness; the TS `/add-fault-test` FaultHarness is
    N/A for PS). These call the fn DIRECTLY (not through -Parallel), so the mock
    applies and the assertions exercise production code, not a copy. Coherent-
    experience checks: no re-throw (direct call would fail the test), no silent
    swallow (Error populated), graceful partial (failure RECORD returned so the
    batch continues), inner ScriptStackTrace preserved for diagnosis.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Minimal values satisfying Invoke-DocumentSummary's mandatory param set so the
    # (mocked) call binds. Values are irrelevant — the mock ignores them.
    $script:Params = @{
        ApiKey               = 'test-key'
        Model                = 'gemini-3.1-flash-lite'
        Temperature          = 0.1
        TaxonomyVersion      = 'v1'
        TaxonomyJson         = '{}'
        SystemPromptTemplate = 'sys'
        OutputSchema         = '{}'
        SummariesDir         = $TestDrive
        Now                  = '2026-01-01T00:00:00Z'
    }
}

Describe 'Invoke-DocSummaryWithCapture — fault capture (t/1774)' -Tag 'ingestion' {

    It 'captures an Invoke-DocumentSummary throw as a failure record (no re-throw) with the inner ScriptStackTrace' {
        InModuleScope AITriad -Parameters @{ P = $script:Params } {
            param($P)
            Mock Invoke-DocumentSummary -MockWith { throw 'simulated extraction failure' }

            # Direct call — if the fn ever RE-THROWS (regression), this line throws
            # and the test fails at the honest production line, not a masked one.
            $result = Invoke-DocSummaryWithCapture -Doc @{ DocId = 'bad-doc-1' } -Params $P

            $result.Success | Should -BeFalse -Because 'AC: one doc failure is recorded, not lost or propagated'
            $result.DocId   | Should -Be 'bad-doc-1'
            $result.Error   | Should -Match 'simulated extraction failure' -Because 'the failure carries the original message (no silent swallow)'
            $result.Error   | Should -Match 'Stack:' -Because 'AC: the inner ScriptStackTrace is captured'
            $result.Error   | Should -Match 'line'   -Because 'AC: the stack trace names a real line (the diagnosability goal)'
            Should -Invoke Invoke-DocumentSummary -Times 1 -Exactly
        }
    }

    It 'passes a successful result through unchanged' {
        InModuleScope AITriad -Parameters @{ P = $script:Params } {
            param($P)
            Mock Invoke-DocumentSummary -MockWith { [PSCustomObject]@{ Success = $true; DocId = 'good-doc'; Note = 'ok' } }

            $result = Invoke-DocSummaryWithCapture -Doc @{ DocId = 'good-doc' } -Params $P

            $result.Success | Should -BeTrue
            $result.DocId   | Should -Be 'good-doc'
            $result.Note    | Should -Be 'ok' -Because 'the successful result is returned untouched'
        }
    }

    It 'normalizes a hashtable result to PSCustomObject (PS 5.1 Measure-Object contract)' {
        InModuleScope AITriad -Parameters @{ P = $script:Params } {
            param($P)
            Mock Invoke-DocumentSummary -MockWith { @{ Success = $true; DocId = 'ht-doc' } }

            $result = Invoke-DocSummaryWithCapture -Doc @{ DocId = 'ht-doc' } -Params $P

            $result | Should -BeOfType ([PSCustomObject]) -Because 'hashtable keys are not PSObject properties in PS 5.1; the batch summary Measure-Object needs a PSCustomObject'
            $result.Success | Should -BeTrue
        }
    }
}
