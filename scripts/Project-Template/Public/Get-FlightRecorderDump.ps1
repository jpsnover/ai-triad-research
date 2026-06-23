function Get-FlightRecorderDump {
    <#
    .SYNOPSIS
        Lists or retrieves flight recorder dump files.
    .DESCRIPTION
        Searches for NDJSON flight recorder dump files in the default dump directory
        or a specified location. Returns FileInfo objects enriched with parsed metadata
        from the dump header (event count, trigger type, timestamp).
    .PARAMETER Last
        Return only the N most recent dumps (by file modification time).
    .PARAMETER DumpDir
        Override the default dump directory. By default, searches the platform-specific
        application data path for flight-recorder dumps.
    .PARAMETER AppName
        Application name used to locate the default dump directory.
        Default: derived from the nearest package.json "name" field.
    .EXAMPLE
        Get-FlightRecorderDump -Last 3
    .EXAMPLE
        Get-FlightRecorderDump -DumpDir ./dumps | Get-FlightRecorderReport
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [int]$Last,

        [Parameter()]
        [string]$DumpDir,

        [Parameter()]
        [string]$AppName
    )

    Set-StrictMode -Version Latest

    if (-not $DumpDir) {
        if (-not $AppName) {
            $pkg = Join-Path $script:RepoRoot 'package.json'
            if (Test-Path $pkg) {
                try { $AppName = (Get-Content $pkg -Raw | ConvertFrom-Json).name } catch { }
            }
            if (-not $AppName) { $AppName = Split-Path $script:RepoRoot -Leaf }
        }

        if ($IsWindows) {
            $DumpDir = Join-Path $env:APPDATA "$AppName/flight-recorder"
        } elseif ($IsMacOS) {
            $DumpDir = Join-Path $HOME "Library/Application Support/$AppName/flight-recorder"
        } else {
            $DumpDir = Join-Path $HOME ".config/$AppName/flight-recorder"
        }
    }

    if (-not (Test-Path $DumpDir)) {
        New-ActionableError `
            -Goal 'List flight recorder dumps' `
            -Problem "Dump directory not found: $DumpDir" `
            -Location 'Get-FlightRecorderDump' `
            -NextSteps @(
                "Verify the app has generated dumps (check if $DumpDir exists)"
                'Pass -DumpDir to specify an alternate location'
                'Pass -AppName if the app name differs from the repo name'
            ) -Throw
    }

    $files = Get-ChildItem -Path $DumpDir -Filter '*.jsonl' |
        Where-Object { $_.Name -match '^(server-)?flight-recorder-' } |
        Sort-Object LastWriteTime -Descending

    if ($Last -gt 0) {
        $files = $files | Select-Object -First $Last
    }

    foreach ($file in $files) {
        $headerLine = [System.IO.File]::ReadLines($file.FullName) |
            Select-Object -First 1

        $header = $null
        $triggerType = $null
        $eventCount = 0

        if ($headerLine) {
            try {
                $parsed = $headerLine | ConvertFrom-Json
                if ($parsed._type -eq 'header') {
                    $header = $parsed
                    $eventCount = if ($parsed.PSObject.Properties['ring_buffer_events_retained']) {
                        $parsed.ring_buffer_events_retained
                    } else { 0 }
                }
            } catch { }
        }

        # Read last line for trigger info
        $lastLine = $null
        foreach ($ln in [System.IO.File]::ReadLines($file.FullName)) {
            if ($ln.Trim()) { $lastLine = $ln }
        }
        if ($lastLine) {
            try {
                $trigger = $lastLine | ConvertFrom-Json
                if ($trigger._type -eq 'trigger') {
                    $triggerType = $trigger.trigger_type
                }
            } catch { }
        }

        $dumpTs = if ($header -and $header.PSObject.Properties['timestamp']) { $header.timestamp } else { $null }
        $appVer = if ($header -and $header.PSObject.Properties['app_version']) { $header.app_version } else { $null }

        $file | Add-Member -NotePropertyName EventCount -NotePropertyValue $eventCount -Force
        $file | Add-Member -NotePropertyName TriggerType -NotePropertyValue $triggerType -Force
        $file | Add-Member -NotePropertyName DumpTimestamp -NotePropertyValue $dumpTs -Force
        $file | Add-Member -NotePropertyName AppVersion -NotePropertyValue $appVer -Force
        $file
    }
}
