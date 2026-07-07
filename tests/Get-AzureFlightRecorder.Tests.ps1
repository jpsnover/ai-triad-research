# Tag: health (t/1377)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Coverage for Get-AzureFlightRecorder -Merged (t/1377) and its pair-discovery
    helper Find-GitHubDumpPair.
.DESCRIPTION
    The critical property this suite guards: Find-GitHubDumpPair must resolve
    both naming schemes:
      - paired: client-{id}.jsonl + server-{id}.jsonl
      - legacy: flight-recorder-{id}.jsonl + server-flight-recorder-{id}.jsonl
    and handle single-side orphans + total-miss without throwing.

    TL approval condition (p/174#1) required an orphan matrix + both-schemes
    proof. That matrix lives in the "Pair discovery matrix" Describe below;
    a deliberate-fail walk-through is captured in the ticket completion comment.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-AzureFlightRecorder - parameter surface (t/1377)' -Tag 'health' {

    It 'Is exported from the module' {
        Get-Command Get-AzureFlightRecorder -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has the Merged parameter set with -Merged and -DumpId (both mandatory)' {
        $cmd = Get-Command Get-AzureFlightRecorder -Module AITriad
        $merged = $cmd.ParameterSets | Where-Object { $_.Name -eq 'Merged' }
        $merged | Should -Not -BeNullOrEmpty
        $mergedNames = @($merged.Parameters | ForEach-Object { $_.Name })
        $mergedNames | Should -Contain 'Merged'
        $mergedNames | Should -Contain 'DumpId'
        ($merged.Parameters | Where-Object { $_.Name -eq 'Merged' }).IsMandatory | Should -Be $true
        ($merged.Parameters | Where-Object { $_.Name -eq 'DumpId' }).IsMandatory | Should -Be $true
    }

    It 'FunctionsToExport in the manifest includes Get-AzureFlightRecorder' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $m = Test-ModuleManifest -Path $manifestPath
        $m.ExportedFunctions.Keys | Should -Contain 'Get-AzureFlightRecorder'
    }
}

Describe 'Find-GitHubDumpPair — pair-discovery matrix (t/1377, TL condition p/174#1)' -Tag 'health' {

    It 'Paired scheme (both sides present) — returns paired scheme and correct client/server' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'client-abc123.jsonl'; size = 100 }
                [PSCustomObject]@{ name = 'server-abc123.jsonl'; size = 200 }
                [PSCustomObject]@{ name = 'client-other456.jsonl'; size = 50 }  # decoy
            )
            $r = Find-GitHubDumpPair -DumpId 'abc123' -Files $files
            $r.Scheme        | Should -Be 'paired'
            $r.Client.name   | Should -Be 'client-abc123.jsonl'
            $r.Server.name   | Should -Be 'server-abc123.jsonl'
            $r.DumpId        | Should -Be 'abc123'
        }
    }

    It 'Legacy scheme (both sides present) — returns legacy scheme and correct client/server' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'flight-recorder-legacy789.jsonl'; size = 100 }
                [PSCustomObject]@{ name = 'server-flight-recorder-legacy789.jsonl'; size = 200 }
            )
            $r = Find-GitHubDumpPair -DumpId 'legacy789' -Files $files
            $r.Scheme       | Should -Be 'legacy'
            $r.Client.name  | Should -Be 'flight-recorder-legacy789.jsonl'
            $r.Server.name  | Should -Be 'server-flight-recorder-legacy789.jsonl'
        }
    }

    It 'Legacy client anchoring — does NOT match server-flight-recorder as client' {
        # The legacy-scheme regex must be anchored so `^flight-recorder-...` does not
        # also match `server-flight-recorder-...` (that would incorrectly assign the
        # server file to the client slot).
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'server-flight-recorder-anchor01.jsonl'; size = 200 }
            )
            $r = Find-GitHubDumpPair -DumpId 'anchor01' -Files $files
            $r.Client | Should -BeNullOrEmpty
            $r.Server.name | Should -Be 'server-flight-recorder-anchor01.jsonl'
        }
    }

    It 'Client-only orphan (paired scheme) — Client set, Server null' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'client-orphC.jsonl'; size = 100 }
                [PSCustomObject]@{ name = 'server-something.jsonl'; size = 50 }  # decoy
            )
            $r = Find-GitHubDumpPair -DumpId 'orphC' -Files $files
            $r.Scheme      | Should -Be 'paired'
            $r.Client.name | Should -Be 'client-orphC.jsonl'
            $r.Server      | Should -BeNullOrEmpty
        }
    }

    It 'Server-only orphan (paired scheme) — Server set, Client null' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'server-orphS.jsonl'; size = 200 }
            )
            $r = Find-GitHubDumpPair -DumpId 'orphS' -Files $files
            $r.Scheme      | Should -Be 'paired'
            $r.Client      | Should -BeNullOrEmpty
            $r.Server.name | Should -Be 'server-orphS.jsonl'
        }
    }

    It 'Client-only orphan (legacy scheme) — Client set, Server null, scheme=legacy' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'flight-recorder-legacyOrphC.jsonl'; size = 100 }
            )
            $r = Find-GitHubDumpPair -DumpId 'legacyOrphC' -Files $files
            $r.Scheme      | Should -Be 'legacy'
            $r.Client.name | Should -Be 'flight-recorder-legacyOrphC.jsonl'
            $r.Server      | Should -BeNullOrEmpty
        }
    }

    It 'Server-only orphan (legacy scheme) — Server set, Client null, scheme=legacy' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'server-flight-recorder-legacyOrphS.jsonl'; size = 200 }
            )
            $r = Find-GitHubDumpPair -DumpId 'legacyOrphS' -Files $files
            $r.Scheme      | Should -Be 'legacy'
            $r.Client      | Should -BeNullOrEmpty
            $r.Server.name | Should -Be 'server-flight-recorder-legacyOrphS.jsonl'
        }
    }

    It 'Total miss — Client and Server both null, no throw' {
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'client-different.jsonl'; size = 100 }
                [PSCustomObject]@{ name = 'server-different.jsonl'; size = 200 }
            )
            $r = Find-GitHubDumpPair -DumpId 'missing999' -Files $files
            $r.Client | Should -BeNullOrEmpty
            $r.Server | Should -BeNullOrEmpty
        }
    }

    It 'Empty file list — no throw, both sides null' {
        InModuleScope AITriad {
            $r = Find-GitHubDumpPair -DumpId 'anyid' -Files @()
            $r.Client | Should -BeNullOrEmpty
            $r.Server | Should -BeNullOrEmpty
        }
    }

    It '$null Files parameter — no throw (strict-mode Count guard)' {
        InModuleScope AITriad {
            # Guards against $null pipeline output — TL's @()-wrap condition.
            { Find-GitHubDumpPair -DumpId 'anyid' -Files $null } | Should -Not -Throw
        }
    }

    It 'DumpId with regex metacharacters is escaped safely (does not glob-match unintended files)' {
        # If DumpId were used unescaped, "a.b" would match "aXb" via the dot metachar.
        InModuleScope AITriad {
            $files = @(
                [PSCustomObject]@{ name = 'flight-recorder-a.b.jsonl'; size = 100 }
                [PSCustomObject]@{ name = 'flight-recorder-aXb.jsonl'; size = 100 }  # should NOT match
            )
            $r = Find-GitHubDumpPair -DumpId 'a.b' -Files $files
            $r.Client.name | Should -Be 'flight-recorder-a.b.jsonl'
        }
    }
}
