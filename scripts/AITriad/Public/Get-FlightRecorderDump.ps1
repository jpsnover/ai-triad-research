# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-FlightRecorderDump {
    <#
    .SYNOPSIS
        Lists or retrieves flight recorder dump files from the Taxonomy Editor.

    .DESCRIPTION
        Scans the Taxonomy Editor's userData directory for flight recorder dump
        files (.jsonl). Returns file info objects that can be piped to
        Show-FlightRecorder for viewing.

    .PARAMETER Last
        Return only the N most recent dump files. Default: returns all.

    .PARAMETER DumpDir
        Override the default dump directory. Default: auto-detected from
        Electron userData path.

    .EXAMPLE
        # List all dump files
        Get-FlightRecorderDump

    .EXAMPLE
        # Get the most recent dump
        Get-FlightRecorderDump -Last 1

    .EXAMPLE
        # Get last 5 dumps and show details
        Get-FlightRecorderDump -Last 5 | Format-Table Name, Length, LastWriteTime

    .EXAMPLE
        # Open the most recent dump in the viewer
        Get-FlightRecorderDump -Last 1 | Show-FlightRecorder
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [int]$Last,

        [Parameter()]
        [string]$DumpDir
    )

    if (-not $DumpDir) {
        # Auto-detect Electron userData path
        if ($IsMacOS) {
            $DumpDir = Join-Path $HOME 'Library/Application Support/taxonomy-editor/flight-recorder'
        } elseif ($IsWindows) {
            $DumpDir = Join-Path $env:APPDATA 'taxonomy-editor/flight-recorder'
        } else {
            $DumpDir = Join-Path $HOME '.config/taxonomy-editor/flight-recorder'
        }
    }

    if (-not (Test-Path $DumpDir)) {
        Write-Warning "Flight recorder dump directory not found: $DumpDir"
        Write-Warning "Run the Taxonomy Editor and click 'Dump Log' to create a dump."
        return
    }

    $files = Get-ChildItem -Path $DumpDir -Filter 'flight-recorder-*.jsonl' |
        Sort-Object LastWriteTime -Descending

    if ($files.Count -eq 0) {
        Write-Warning "No flight recorder dump files found in: $DumpDir"
        return
    }

    if ($Last -gt 0) {
        $files = $files | Select-Object -First $Last
    }

    # Add parsed summary info to each file
    foreach ($file in $files) {
        $summary = @{
            EventCount = 0
            ErrorCount = 0
            TriggerType = $null
            AppVersion = $null
            DebateId = $null
        }

        # Parse first few lines for header/trigger info
        $lines = Get-Content $file.FullName -TotalCount 5
        foreach ($line in $lines) {
            try {
                $obj = $line | ConvertFrom-Json
                if ($obj._type -eq 'header') {
                    $summary.EventCount = $obj.ring_buffer_events_retained
                    $summary.AppVersion = $obj.app_version
                    $summary.DebateId = $obj.active_debate_id
                }
                if ($obj._type -eq 'trigger') {
                    $summary.TriggerType = $obj.trigger_type
                }
            } catch { }
        }

        # Count errors by scanning event lines
        $errorMatches = Select-String -Path $file.FullName -Pattern '"level"\s*:\s*"(error|fatal)"' -AllMatches
        $errorCount = if ($errorMatches) { @($errorMatches.Matches).Count } else { 0 }

        $file | Add-Member -NotePropertyName Events -NotePropertyValue $summary.EventCount -Force
        $file | Add-Member -NotePropertyName Errors -NotePropertyValue $errorCount -Force
        $file | Add-Member -NotePropertyName Trigger -NotePropertyValue $summary.TriggerType -Force
        $file | Add-Member -NotePropertyName AppVersion -NotePropertyValue $summary.AppVersion -Force
        $file | Add-Member -NotePropertyName DebateId -NotePropertyValue $summary.DebateId -Force

        $file
    }
}
