# Tag: health (t/1712)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-LatestFlightRecorderDump (t/1712).
.DESCRIPTION
    A stub dump (ring_buffer_capacity=1, 0 events, <=1KB) written on startup/
    shutdown can be MORE recent than the real 1.5MB dump, so naively picking the
    newest file yields nothing to triage. Get-LatestFlightRecorderDump returns
    the newest dump above a size floor (default 10KB), excluding stubs.

    These tests build size-controlled dumps in isolated temp dirs (explicit
    -Path, so no OS path detection) and assert: empty dir and all-stub dir yield
    nothing; a mixed dir returns the newest NON-stub even when a stub is newer;
    -All returns every non-stub newest-first; -MinEvents filters on the header's
    ring_buffer_events_total.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    function New-TestDump {
        param(
            [string]$Dir,
            [string]$Name,
            [int]$Events,
            [int]$Capacity,
            [switch]$Stub,
            [datetime]$When
        )
        $header = [ordered]@{
            _type                       = 'header'
            _version                    = 1
            schema_version              = '1.0.0'
            timestamp                   = '2026-07-24T00:00:00.000Z'
            uptime_ms                   = 1000
            ring_buffer_capacity        = $Capacity
            ring_buffer_events_total    = $Events
            ring_buffer_events_retained = $Events
            events_lost                 = 0
        } | ConvertTo-Json -Compress

        $lines = [System.Collections.Generic.List[string]]::new()
        $lines.Add($header)
        if (-not $Stub) {
            # Pad past the 10KB floor: ~60 event lines * ~230 bytes ≈ 13.8KB.
            $filler = '{"_type":"event","level":"info","msg":"' + ('x' * 200) + '"}'
            1..60 | ForEach-Object { $lines.Add($filler) }
        }

        $full = Join-Path $Dir $Name
        Set-Content -Path $full -Value $lines -Encoding utf8
        (Get-Item -Path $full).LastWriteTime = $When
        return $full
    }
}

Describe 'Get-LatestFlightRecorderDump' -Tag 'health' {

    It 'returns nothing for an empty directory' {
        $dir = Join-Path $TestDrive 'empty'
        New-Item -ItemType Directory -Path $dir | Out-Null

        $result = Get-LatestFlightRecorderDump -Path $dir -WarningAction SilentlyContinue
        $result | Should -BeNullOrEmpty -Because 'no dumps at all is a valid empty answer, not an error'
    }

    It 'returns nothing when the directory holds only stubs' {
        $dir = Join-Path $TestDrive 'all-stub'
        New-Item -ItemType Directory -Path $dir | Out-Null
        New-TestDump -Dir $dir -Name 'flight-recorder-stub1.jsonl' -Events 0 -Capacity 1 -Stub -When ([datetime]'2026-07-24T10:00:00') | Out-Null
        New-TestDump -Dir $dir -Name 'flight-recorder-stub2.jsonl' -Events 0 -Capacity 1 -Stub -When ([datetime]'2026-07-24T11:00:00') | Out-Null

        $result = Get-LatestFlightRecorderDump -Path $dir -WarningAction SilentlyContinue
        $result | Should -BeNullOrEmpty -Because 'every file is <=1KB, so none clears the 10KB non-stub floor'
    }

    It 'returns the most recent NON-stub dump even when a stub is newer (the t/1712 bug)' {
        $dir = Join-Path $TestDrive 'mixed'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $older = New-TestDump -Dir $dir -Name 'flight-recorder-older.jsonl'  -Events 50  -Capacity 5000 -When ([datetime]'2026-07-24T09:00:00')
        $newest = New-TestDump -Dir $dir -Name 'flight-recorder-newest.jsonl' -Events 500 -Capacity 5000 -When ([datetime]'2026-07-24T09:30:00')
        # Stub written LATEST — the naive "newest file" would wrongly pick this.
        New-TestDump -Dir $dir -Name 'flight-recorder-stub.jsonl' -Events 0 -Capacity 1 -Stub -When ([datetime]'2026-07-24T10:13:00') | Out-Null

        $result = Get-LatestFlightRecorderDump -Path $dir
        $result | Should -Be $newest -Because 'the newest dump above the size floor wins; the newer stub is excluded'
        $result | Should -Not -Be $older
    }

    It '-All returns every non-stub dump, newest-first, excluding the stub' {
        $dir = Join-Path $TestDrive 'mixed-all'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $older = New-TestDump -Dir $dir -Name 'flight-recorder-older.jsonl'  -Events 50  -Capacity 5000 -When ([datetime]'2026-07-24T09:00:00')
        $newest = New-TestDump -Dir $dir -Name 'flight-recorder-newest.jsonl' -Events 500 -Capacity 5000 -When ([datetime]'2026-07-24T09:30:00')
        New-TestDump -Dir $dir -Name 'flight-recorder-stub.jsonl' -Events 0 -Capacity 1 -Stub -When ([datetime]'2026-07-24T10:13:00') | Out-Null

        $result = @(Get-LatestFlightRecorderDump -Path $dir -All)
        $result.Count | Should -Be 2 -Because 'both real dumps qualify; the stub is excluded'
        $result[0] | Should -Be $newest -Because 'newest-first ordering'
        $result[1] | Should -Be $older
    }

    It '-MinEvents filters on the header ring_buffer_events_total' {
        $dir = Join-Path $TestDrive 'min-events'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $lowEvents  = New-TestDump -Dir $dir -Name 'flight-recorder-low.jsonl'  -Events 50  -Capacity 5000 -When ([datetime]'2026-07-24T09:30:00')
        $highEvents = New-TestDump -Dir $dir -Name 'flight-recorder-high.jsonl' -Events 500 -Capacity 5000 -When ([datetime]'2026-07-24T09:00:00')

        # low.jsonl is newer, but only high.jsonl clears -MinEvents 100.
        $result = Get-LatestFlightRecorderDump -Path $dir -MinEvents 100
        $result | Should -Be $highEvents -Because 'the newer dump has too few events, so the qualifying older one is returned'

        # A floor above every dump yields nothing.
        $none = Get-LatestFlightRecorderDump -Path $dir -MinEvents 10000 -WarningAction SilentlyContinue
        $none | Should -BeNullOrEmpty
    }
}
