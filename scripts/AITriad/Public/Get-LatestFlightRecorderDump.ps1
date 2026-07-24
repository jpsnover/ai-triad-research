# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-LatestFlightRecorderDump {
    <#
    .SYNOPSIS
        Returns the path of the most recent non-stub flight recorder dump.

    .DESCRIPTION
        Finds the newest meaningful flight recorder dump so a triage caller does
        not accidentally pick up a stub. When the Taxonomy Editor writes a dump
        on startup/shutdown it can emit a tiny stub (ring_buffer_capacity=1, 0
        events, ~500 bytes) that is more recent than the real 1.5MB dump recorded
        earlier — passing the literal "latest" file then yields nothing to triage
        (the failure this cmdlet exists to prevent, t/1712).

        Scans the flight-recorder directory ($env:APPDATA\taxonomy-editor\
        flight-recorder on Windows, the platform equivalent otherwise, or -Path),
        keeps only .jsonl files larger than -MinSizeKB (default 10 KB; stubs are
        always <=1 KB), and returns the most recent survivor's full path. -All
        returns every survivor newest-first; -MinEvents additionally filters on
        the header's ring_buffer_events_total.

        Returns nothing (with a warning) when the directory is missing or holds
        no non-stub dumps — an empty result is a valid answer, not an error.

    .PARAMETER Path
        Flight-recorder directory to scan. Default: the current-OS Electron
        userData flight-recorder path (see Get-FlightRecorderDir).

    .PARAMETER All
        Return the full path of every non-stub dump, sorted newest-first,
        instead of just the most recent.

    .PARAMETER MinEvents
        Additionally require the dump header's ring_buffer_events_total to be at
        least this value. Dumps whose first line is not a parseable header count
        as 0 events and are excluded.

    .PARAMETER MinSizeKB
        Minimum file size (KB) for a dump to count as non-stub. Default: 10.

    .EXAMPLE
        # Path of the most recent meaningful dump — ready to triage
        Get-LatestFlightRecorderDump

    .EXAMPLE
        # Triage the most recent real dump directly
        Get-LatestFlightRecorderDump | Get-FlightRecorderReport -Detailed

    .EXAMPLE
        # All non-stub dumps, newest first
        Get-LatestFlightRecorderDump -All

    .EXAMPLE
        # Most recent dump carrying at least 100 recorded events
        Get-LatestFlightRecorderDump -MinEvents 100
    .LINK
        Show-AITriadHelp
    .LINK
        Get-FlightRecorderDump
    .LINK
        Get-FlightRecorderReport
    .LINK
        Show-FlightRecorder
    .LINK
        Merge-FlightRecorderDumps
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Position = 0)]
        [string]$Path,

        [Parameter()]
        [switch]$All,

        [Parameter()]
        [ValidateRange(0, [int]::MaxValue)]
        [int]$MinEvents,

        [Parameter()]
        [ValidateRange(1, 1048576)]
        [int]$MinSizeKB = 10
    )

    # Header event-total reader (nested — self-contained to this cmdlet).
    # A stub / headerless / corrupt first line counts as 0 events.
    function Get-DumpEventTotal([string]$DumpPath) {
        $FirstLine = Get-Content -Path $DumpPath -TotalCount 1 -ErrorAction SilentlyContinue
        if (-not $FirstLine) { return 0 }
        try {
            $Header = $FirstLine | ConvertFrom-Json
        } catch {
            return 0
        }
        if ($Header.PSObject.Properties['_type'] -and $Header._type -eq 'header' -and
            $Header.PSObject.Properties['ring_buffer_events_total']) {
            return [int]$Header.ring_buffer_events_total
        }
        return 0
    }

    if (-not $Path) { $Path = Get-FlightRecorderDir }

    if (-not (Test-Path -Path $Path)) {
        Write-Warning "Flight recorder dump directory not found: $Path"
        return
    }

    $MinBytes = $MinSizeKB * 1024
    $Candidates = @(
        Get-ChildItem -Path $Path -Filter '*.jsonl' -File |
            Where-Object { $_.Length -gt $MinBytes } |
            Sort-Object -Property LastWriteTime -Descending
    )

    if ($PSBoundParameters.ContainsKey('MinEvents')) {
        $Candidates = @($Candidates | Where-Object { (Get-DumpEventTotal $_.FullName) -ge $MinEvents })
    }

    if ($Candidates.Count -eq 0) {
        $EventClause = if ($PSBoundParameters.ContainsKey('MinEvents')) { ", >= $MinEvents events" } else { '' }
        Write-Warning "No non-stub flight recorder dumps (> ${MinSizeKB}KB${EventClause}) found in: $Path"
        return
    }

    if ($All) {
        foreach ($Dump in $Candidates) { $Dump.FullName }
        return
    }

    $Candidates[0].FullName
}
