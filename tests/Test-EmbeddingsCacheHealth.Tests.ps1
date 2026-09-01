# Tag: diagnostics (t/3168)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Test-EmbeddingsCacheHealth (t/3168). Mocks Get-TaxEditorServerLogs (the log seam,
    via -ModuleName so module-internal calls are intercepted) so no live Azure call is made — asserts
    the resolving/re-computing/no-traffic/unknown verdict logic, the compute-duration percentiles,
    load-shed and cache-ready detection, and the guard rails.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    # Build a parsed console row in the shape Get-TaxEditorServerLogs emits. Defined in test scope;
    # the mock bodies below close over it (Mock -ModuleName routes interception to module-internal
    # calls while the MockWith scriptblock still runs in this scope).
    function New-Row {
        param([string]$Path, [string]$Message, $Status, $DurationMs, [string]$Revision = 'rev-abc')
        [PSCustomObject]@{
            PSTypeName = 'AITriad.ServerLogEntry'
            Time       = [datetime]::UtcNow
            Level      = 'info'
            RequestId  = $null
            Component  = 'server'
            Method     = 'POST'
            Path       = $Path
            Status     = $Status
            DurationMs = $DurationMs
            Message    = $Message
            Revision   = $Revision
            Raw        = $null
        }
    }
}

Describe 'Test-EmbeddingsCacheHealth' -Tag 'diagnostics' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Test-EmbeddingsCacheHealth' | Should -Not -BeNullOrEmpty
    }

    It 'verdict=resolving when compute p95 is fast and there is no load-shed' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith {
            @(
                New-Row -Path '/api/embeddings/compute' -DurationMs 5
                New-Row -Path '/api/embeddings/compute' -DurationMs 10
                New-Row -Path '/api/embeddings/compute' -DurationMs 50
                New-Row -Path '/api/embeddings/compute' -DurationMs 100
                New-Row -Path '/api/embeddings/compute' -DurationMs 150
                New-Row -Path '/api/embeddings/compute' -DurationMs 183 -Revision 'rev-live'
            )
        }
        $r = Test-EmbeddingsCacheHealth
        $r.Verdict          | Should -Be 'resolving'
        $r.ComputeCount     | Should -Be 6
        $r.ComputeP50Ms     | Should -Be 50
        $r.ComputeP95Ms     | Should -Be 183
        $r.LoadShed503Count | Should -Be 0
        $r.Revision         | Should -Be 'rev-live'   # newest row's revision wins
    }

    It 'verdict=re-computing when compute p95 exceeds ~1s' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith {
            @(
                New-Row -Path '/api/embeddings/compute' -DurationMs 1500
                New-Row -Path '/api/embeddings/compute' -DurationMs 3000
                New-Row -Path '/api/embeddings/compute' -DurationMs 8400
            )
        }
        $r = Test-EmbeddingsCacheHealth
        $r.Verdict      | Should -Be 're-computing'
        $r.ComputeP95Ms | Should -BeGreaterThan 1000
    }

    It 'verdict=re-computing when a load-shed 503 is present even if durations look fast' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith {
            @(
                New-Row -Path '/api/embeddings/compute' -DurationMs 10
                New-Row -Path '/api/embeddings/compute' -DurationMs 20
                New-Row -Message 'embeddings.compute: load-shed 503' -Status 503
            )
        }
        $r = Test-EmbeddingsCacheHealth
        $r.LoadShed503Count | Should -Be 1
        $r.Verdict          | Should -Be 're-computing'
    }

    It 'verdict=no-traffic (never false-passes) when there are zero compute rows' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith {
            @( New-Row -Message 'embeddings.json loaded: 812 nodes' )   # boot signal, no compute traffic
        }
        $r = Test-EmbeddingsCacheHealth
        $r.ComputeCount         | Should -Be 0
        $r.Verdict              | Should -Be 'no-traffic'
        $r.CacheReadySignalSeen | Should -BeTrue
    }

    It 'verdict=unknown in the 500-1000ms grey band' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith {
            @(
                New-Row -Path '/api/embeddings/compute' -DurationMs 600
                New-Row -Path '/api/embeddings/compute' -DurationMs 700
                New-Row -Path '/api/embeddings/compute' -DurationMs 800
            )
        }
        $r = Test-EmbeddingsCacheHealth
        $r.Verdict | Should -Be 'unknown'
    }

    It 'passes the default 30-minute window and embeddings pattern through to Get-TaxEditorServerLogs' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith { @() }
        Test-EmbeddingsCacheHealth | Out-Null
        Should -Invoke Get-TaxEditorServerLogs -ModuleName AITriad -Times 1 -Exactly -ParameterFilter {
            $Pattern -eq 'embeddings' -and (($To - $From).TotalMinutes -ge 29 -and ($To - $From).TotalMinutes -le 31)
        }
    }

    It 'throws an actionable error when -From is after -To' {
        Mock Get-TaxEditorServerLogs -ModuleName AITriad -MockWith { @() }
        { Test-EmbeddingsCacheHealth -From ([datetime]'2026-08-27T11:00:00Z') -To ([datetime]'2026-08-27T10:00:00Z') } |
            Should -Throw
    }
}
