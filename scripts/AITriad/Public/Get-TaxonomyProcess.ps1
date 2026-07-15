# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyProcess {
    <#
    .SYNOPSIS
        Lists running taxonomy/debate processes.

    .DESCRIPTION
        Scans running Node.js processes and matches command-line patterns to
        identify taxonomy-editor, debate CLI, and web-server instances.
        Output objects include PID, type, start time, and named pipe path
        for flight recorder access.

    .PARAMETER Type
        Filter by process type: cli-debate, electron, web-server.

    .EXAMPLE
        Get-TaxonomyProcess

    .EXAMPLE
        Get-TaxonomyProcess -Type electron

    .EXAMPLE
        Get-TaxonomyProcess | Request-FlightRecorderDump
    .LINK
        Show-AITriadHelp
    .LINK
        Get-Tax
    .LINK
        Get-GraphNode
    .LINK
        Get-TaxonomyHealth
    .LINK
        Compare-Taxonomy
    .LINK
        Test-TaxonomyIntegrity
    .LINK
        Test-OntologyCompliance
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [ValidateSet('cli-debate', 'electron', 'web-server')]
        [string]$Type
    )

    $patterns = @(
        @{ Pattern = 'tsx.*lib/debate/cli\.ts';     Type = 'cli-debate' }
        @{ Pattern = 'taxonomy-editor|electron';    Type = 'electron' }
        @{ Pattern = 'server\.ts';                  Type = 'web-server' }
    )

    $nodeProcesses = Get-Process -Name 'node', 'electron' -ErrorAction SilentlyContinue

    if (-not $nodeProcesses) {
        Write-Verbose 'No node/electron processes found.'
        return
    }

    foreach ($proc in $nodeProcesses) {
        $cmdLine = $null
        try {
            if ($IsWindows) {
                $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction Stop
                $cmdLine = $wmi.CommandLine
            } else {
                $cmdLine = (Get-Content "/proc/$($proc.Id)/cmdline" -Raw -ErrorAction Stop) -replace "`0", ' '
            }
        } catch {
            continue
        }

        if (-not $cmdLine) { continue }

        foreach ($p in $patterns) {
            if ($cmdLine -match $p.Pattern) {
                if ($Type -and $p.Type -ne $Type) { continue }

                $pipeName = "taxonomy-flight-recorder-$($proc.Id)"
                $pipePath = if ($IsWindows) {
                    "\\.\pipe\$pipeName"
                } else {
                    "/tmp/$pipeName.sock"
                }

                [PSCustomObject]@{
                    PID       = $proc.Id
                    Type      = $p.Type
                    StartTime = $proc.StartTime
                    PipePath  = $pipePath
                    PipeName  = $pipeName
                    CmdLine   = $cmdLine
                }
                break
            }
        }
    }
}
