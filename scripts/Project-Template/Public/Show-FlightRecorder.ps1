function Show-FlightRecorder {
    <#
    .SYNOPSIS
        Opens a flight recorder dump in an interactive HTML viewer.
    .DESCRIPTION
        Locates the flight recorder viewer HTML, embeds the NDJSON dump data,
        and opens the result in the default browser. Supports pipeline input
        from Get-FlightRecorderDump.
    .PARAMETER Path
        Path to the JSONL dump file.
    .PARAMETER Last
        Shortcut: open the Nth most recent dump. Default: 1 (latest).
    .EXAMPLE
        Show-FlightRecorder
    .EXAMPLE
        Show-FlightRecorder -Path ./flight-recorder-dump.jsonl
    .EXAMPLE
        Get-FlightRecorderDump -Last 1 | Show-FlightRecorder
    #>
    [CmdletBinding(DefaultParameterSetName = 'ByPath')]
    param(
        [Parameter(ParameterSetName = 'ByPath', ValueFromPipelineByPropertyName)]
        [Alias('FullName')]
        [string]$Path,

        [Parameter(ParameterSetName = 'ByLast')]
        [int]$Last = 1
    )

    process {
        Set-StrictMode -Version Latest

        if (-not $Path) {
            $dump = Get-FlightRecorderDump -Last $Last | Select-Object -First 1
            if (-not $dump) {
                New-ActionableError `
                    -Goal 'Open flight recorder viewer' `
                    -Problem 'No dump files found' `
                    -Location 'Show-FlightRecorder' `
                    -NextSteps @('Check that the app has generated dumps', 'Pass -Path to specify a file directly') -Throw
            }
            $Path = $dump.FullName
        }

        if (-not (Test-Path $Path)) {
            New-ActionableError `
                -Goal 'Open flight recorder viewer' `
                -Problem "File not found: $Path" `
                -Location 'Show-FlightRecorder' `
                -NextSteps @('Verify the dump file path') -Throw
        }

        # Look for viewer HTML in tools/ or lib/flight-recorder/
        $viewerCandidates = @(
            (Join-Path $script:RepoRoot 'tools/flight-recorder-viewer.html')
            (Join-Path $script:RepoRoot 'lib/flight-recorder/viewer.html')
        )
        $viewerPath = $viewerCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

        if (-not $viewerPath) {
            Write-Warning 'No HTML viewer found. Falling back to Get-FlightRecorderReport.'
            Get-FlightRecorderReport -Path $Path
            return
        }

        $data = Get-Content $Path -Raw
        $viewerHtml = Get-Content $viewerPath -Raw
        $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) "fr-viewer-$(Get-Date -Format 'yyyyMMdd-HHmmss').html"
        $jsonSafe = ($data | ConvertTo-Json)
        $injected = $viewerHtml -replace '(?s)(<script id="embedded-data"[^>]*>).*?(</script>)', "`$1`nwindow.__FR_DATA__ = $jsonSafe; `$2"
        Set-Content -Path $tempFile -Value $injected -Encoding utf8NoBOM

        if ($IsWindows) { Start-Process $tempFile }
        elseif ($IsMacOS) { & open $tempFile }
        else { & xdg-open $tempFile }

        [PSCustomObject]@{
            ViewerPath = $tempFile
            DumpPath   = $Path
            FileSize   = (Get-Item $Path).Length
        }
    }
}
