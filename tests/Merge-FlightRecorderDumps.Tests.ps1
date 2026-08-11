# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Merge-FlightRecorderDumps (t/2436).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Helpers — write minimal valid JSONL dumps to a temp directory
    function New-TempDump {
        param([string]$Label, [string]$Dir, [object[]]$Events)
        $path = Join-Path $Dir "${Label}.jsonl"
        $lines = @(
            [ordered]@{ _type = 'header'; timestamp = '2026-08-10T10:00:00.000Z'; uptime_ms = 1000; ring_buffer_capacity = 500; ring_buffer_events_retained = 2; events_lost = 0 } | ConvertTo-Json -Compress
            [ordered]@{ _type = 'dictionary'; entries = @([ordered]@{ handle = 0; category = 'action'; value = 'test'; registered_at = 0; source = $Label }) } | ConvertTo-Json -Compress -Depth 5
            [ordered]@{ _type = 'context'; app = [ordered]@{ version = '1.0.0'; build_date = '2026-08-10' } } | ConvertTo-Json -Compress -Depth 5
        )
        foreach ($evt in $Events) {
            $lines += $evt | ConvertTo-Json -Compress
        }
        $lines | Set-Content -Path $path -Encoding UTF8
        $path
    }
}

Describe 'Merge-FlightRecorderDumps — ByPath (t/2436)' -Tag 'diagnostics','flight-recorder' {

    BeforeEach {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "mfrd-test-$([System.IO.Path]::GetRandomFileName())"
        New-Item -ItemType Directory -Path $TempDir | Out-Null

        # Client has two events at t=100 and t=300; server has one at t=200
        $ClientEvents = @(
            [ordered]@{ _type = 'event'; _seq = 0; _wall = '2026-08-10T10:00:00.100Z'; action = 'click' }
            [ordered]@{ _type = 'event'; _seq = 1; _wall = '2026-08-10T10:00:00.300Z'; action = 'render' }
        )
        $ServerEvents = @(
            [ordered]@{ _type = 'event'; _seq = 0; _wall = '2026-08-10T10:00:00.200Z'; action = 'request' }
        )

        $script:ClientPath = New-TempDump -Label 'client-abc123' -Dir $TempDir -Events $ClientEvents
        $script:ServerPath = New-TempDump -Label 'server-abc123' -Dir $TempDir -Events $ServerEvents
    }

    AfterEach {
        if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
    }

    Context 'Happy path — merge two files' {

        It 'produces a merged JSONL file with events from both sources' {
            $OutPath = Join-Path $TempDir 'merged-out.jsonl'
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath -OutputPath $OutPath

            Test-Path $OutPath | Should -Be $true
            $lines = @(Get-Content $OutPath | Where-Object { $_.Trim() })
            $lines.Count | Should -BeGreaterThan 0
        }

        It 'events are sorted by _wall timestamp (client t=100, server t=200, client t=300)' {
            $OutPath = Join-Path $TempDir 'merged-sorted.jsonl'
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath -OutputPath $OutPath

            $events = @(Get-Content $OutPath | Where-Object { $_.Trim() } | ForEach-Object {
                $obj = $_ | ConvertFrom-Json
                if ($obj.PSObject.Properties['_type'] -and $obj._type -eq 'event') { $obj }
            })
            $events.Count | Should -Be 3
            $events[0]._source | Should -Be 'client'
            $events[1]._source | Should -Be 'server'
            $events[2]._source | Should -Be 'client'
        }

        It 'assigns _merged_seq starting at 0 in ascending order' {
            $OutPath = Join-Path $TempDir 'merged-seq.jsonl'
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath -OutputPath $OutPath

            $events = @(Get-Content $OutPath | Where-Object { $_.Trim() } | ForEach-Object {
                $obj = $_ | ConvertFrom-Json
                if ($obj.PSObject.Properties['_type'] -and $obj._type -eq 'event') { $obj }
            })
            $events[0]._merged_seq | Should -Be 0
            $events[1]._merged_seq | Should -Be 1
            $events[2]._merged_seq | Should -Be 2
        }

        It 'tags each event with _source (client or server)' {
            $OutPath = Join-Path $TempDir 'merged-source.jsonl'
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath -OutputPath $OutPath

            $events = @(Get-Content $OutPath | Where-Object { $_.Trim() } | ForEach-Object {
                $obj = $_ | ConvertFrom-Json
                if ($obj.PSObject.Properties['_type'] -and $obj._type -eq 'event') { $obj }
            })
            $sources = @($events | ForEach-Object { $_._source })
            $sources | Should -Contain 'client'
            $sources | Should -Contain 'server'
        }

        It 'merged header has merged=true and reports total_events' {
            $OutPath = Join-Path $TempDir 'merged-header.jsonl'
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath -OutputPath $OutPath

            $firstLine = Get-Content $OutPath | Select-Object -First 1
            $header = $firstLine | ConvertFrom-Json
            $header._type              | Should -Be 'header'
            $header.merged             | Should -Be $true
            $header.total_events       | Should -Be 3
        }
    }

    Context 'Default OutputPath — sibling of ClientPath named merged-STEM.jsonl' {

        It 'writes to merged-STEM.jsonl in ClientPath directory when -OutputPath omitted' {
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath

            $expectedStem = [System.IO.Path]::GetFileNameWithoutExtension($script:ClientPath)
            $expectedOut  = Join-Path (Split-Path $script:ClientPath) "merged-${expectedStem}.jsonl"
            Test-Path $expectedOut | Should -Be $true
        }
    }

    Context 'Single file (client only)' {

        It 'merges successfully with only -ClientPath — all events tagged client' {
            $OutPath = Join-Path $TempDir 'merged-client-only.jsonl'
            Merge-FlightRecorderDumps -ClientPath $script:ClientPath -OutputPath $OutPath

            Test-Path $OutPath | Should -Be $true
            $events = @(Get-Content $OutPath | Where-Object { $_.Trim() } | ForEach-Object {
                $obj = $_ | ConvertFrom-Json
                if ($obj.PSObject.Properties['_type'] -and $obj._type -eq 'event') { $obj }
            })
            $events.Count | Should -Be 2
            $events | ForEach-Object { $_._source | Should -Be 'client' }
        }
    }

    Context '-PassThru' {

        It 'returns a FileInfo-like object with Events, ClientEvents, ServerEvents counts' {
            $OutPath = Join-Path $TempDir 'merged-passthru.jsonl'
            $result = Merge-FlightRecorderDumps -ClientPath $script:ClientPath -ServerPath $script:ServerPath `
                -OutputPath $OutPath -PassThru

            $result | Should -Not -BeNullOrEmpty
            $result.Events       | Should -Be 3
            $result.ClientEvents | Should -Be 2
            $result.ServerEvents | Should -Be 1
        }
    }

    Context 'Error paths' {

        It 'throws ActionableError when neither -ClientPath nor -ServerPath is provided (ByPath set)' {
            # ByPath requires at least one; when both absent it should throw
            { Merge-FlightRecorderDumps -ClientPath '' -ServerPath '' -OutputPath 'x.jsonl' } |
                Should -Throw
        }

        It 'throws ActionableError when files do not exist' {
            { Merge-FlightRecorderDumps -ClientPath (Join-Path $TempDir 'no-such-client.jsonl') `
                -OutputPath (Join-Path $TempDir 'out.jsonl') } |
                Should -Throw
        }
    }
}
