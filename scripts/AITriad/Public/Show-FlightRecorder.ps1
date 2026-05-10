# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-FlightRecorder {
    <#
    .SYNOPSIS
        Opens a flight recorder dump file in the interactive HTML viewer.

    .DESCRIPTION
        Launches the flight recorder viewer (tools/flight-recorder-viewer.html)
        in the default browser with the specified dump file. The viewer supports
        filtering, search, timeline visualization, and event detail inspection.

    .PARAMETER Path
        Path to a .jsonl flight recorder dump file. Can be piped from
        Get-FlightRecorderDump.

    .PARAMETER Last
        Shortcut: open the Nth most recent dump file. Default: 1 (latest).

    .EXAMPLE
        # Open the most recent dump
        Show-FlightRecorder -Last 1

    .EXAMPLE
        # Open a specific dump file
        Show-FlightRecorder -Path ~/Library/Application\ Support/taxonomy-editor/flight-recorder/flight-recorder-2026-05-10.jsonl

    .EXAMPLE
        # Pipe from Get-FlightRecorderDump
        Get-FlightRecorderDump -Last 1 | Show-FlightRecorder
    #>
    [CmdletBinding(DefaultParameterSetName = 'ByPath')]
    param(
        [Parameter(ParameterSetName = 'ByPath', ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName')]
        [string]$Path,

        [Parameter(ParameterSetName = 'ByLast')]
        [int]$Last = 0
    )

    process {
        # Resolve the dump file
        if ($PSCmdlet.ParameterSetName -eq 'ByLast' -or (-not $Path -and $Last -eq 0)) {
            if ($Last -le 0) { $Last = 1 }
            $dump = Get-FlightRecorderDump -Last $Last | Select-Object -First 1
            if (-not $dump) {
                Write-Error "No flight recorder dump files found."
                return
            }
            $Path = $dump.FullName
        }

        if (-not (Test-Path $Path)) {
            Write-Error "Dump file not found: $Path"
            return
        }

        # Find the viewer HTML
        $viewerPath = $null
        $candidates = @(
            (Join-Path $PSScriptRoot '../../tools/flight-recorder-viewer.html')  # From module
            (Join-Path $PSScriptRoot '../../../tools/flight-recorder-viewer.html')  # From source
        )
        # Also check relative to repo root via .aitriad.json
        $repoRoot = $PSScriptRoot
        while ($repoRoot -and -not (Test-Path (Join-Path $repoRoot '.aitriad.json'))) {
            $repoRoot = Split-Path $repoRoot -Parent
            if (-not $repoRoot -or $repoRoot -eq (Split-Path $repoRoot -Parent)) { $repoRoot = $null; break }
        }
        if ($repoRoot) {
            $candidates += Join-Path $repoRoot 'tools/flight-recorder-viewer.html'
        }

        foreach ($c in $candidates) {
            $resolved = Resolve-Path $c -ErrorAction SilentlyContinue
            if ($resolved) { $viewerPath = $resolved.Path; break }
        }

        if (-not $viewerPath) {
            Write-Error "Flight recorder viewer HTML not found. Expected at tools/flight-recorder-viewer.html"
            return
        }

        # Read the dump file content
        $dumpContent = Get-Content -Raw -Path $Path

        # Create a temporary HTML file that auto-loads the dump data
        $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) 'flight-recorder-viewer'
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

        $viewerHtml = Get-Content -Raw -Path $viewerPath

        # Escape the NDJSON content for embedding in JavaScript
        $escapedContent = $dumpContent.Replace('\', '\\').Replace('`', '\`').Replace('$', '\$').Replace("'", "\'")

        # Inject auto-load script before closing </body>
        $autoLoadScript = @"
<script>
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('fileName').textContent = '$([System.IO.Path]::GetFileName($Path))';
    parseNdjson(``$escapedContent``);
});
</script>
"@
        $outputHtml = $viewerHtml.Replace('</body>', "$autoLoadScript`n</body>")

        $tempFile = Join-Path $tempDir "viewer-$(Get-Date -Format 'yyyyMMdd-HHmmss').html"
        Set-Content -Path $tempFile -Value $outputHtml -Encoding UTF8

        Write-Host "Opening flight recorder viewer..." -ForegroundColor Cyan
        Write-Host "  Dump: $Path" -ForegroundColor Gray
        Write-Host "  Events: $((Select-String -Path $Path -Pattern '"_type"\s*:\s*"event"' -AllMatches).Matches.Count)" -ForegroundColor Gray

        # Open in default browser
        if ($IsMacOS) {
            & open $tempFile
        } elseif ($IsWindows) {
            & start $tempFile
        } else {
            & xdg-open $tempFile
        }

        # Return the temp file path for reference
        [PSCustomObject]@{
            ViewerPath = $tempFile
            DumpPath   = $Path
            DumpSize   = (Get-Item $Path).Length
        }
    }
}
