function Find-FlightRecorderPattern {
    <#
    .SYNOPSIS
        Scans multiple flight recorder dumps for recurring error patterns.
    .DESCRIPTION
        Reads all dumps in the specified directory (or the default dump location),
        groups errors by type + message, and flags patterns exceeding the occurrence
        threshold. Useful for the weekly maintenance check: "any recurring errors
        appearing 3+ times across dumps?"
    .PARAMETER DumpDir
        Directory containing JSONL dump files. Defaults to the platform-specific
        flight recorder dump directory.
    .PARAMETER MinOccurrences
        Minimum number of times an error pattern must appear to be reported. Default: 3.
    .PARAMETER Last
        Only scan the N most recent dump files.
    .EXAMPLE
        Find-FlightRecorderPattern -MinOccurrences 2
    .EXAMPLE
        Find-FlightRecorderPattern -DumpDir ./dumps -Last 10
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$DumpDir,

        [Parameter()]
        [int]$MinOccurrences = 3,

        [Parameter()]
        [int]$Last = 0
    )

    Set-StrictMode -Version Latest

    $dumpParams = @{}
    if ($DumpDir) { $dumpParams['DumpDir'] = $DumpDir }
    if ($Last -gt 0) { $dumpParams['Last'] = $Last }

    $dumps = Get-FlightRecorderDump @dumpParams
    if (-not $dumps) {
        Write-Warning 'No flight recorder dumps found.'
        return
    }

    $patternMap = @{}

    foreach ($dump in $dumps) {
        $report = Get-FlightRecorderReport -Path $dump.FullName -Detailed -AsObject
        foreach ($err in $report.Errors) {
            $errType = if ($err.PSObject.Properties['type']) { $err.type } else { 'unknown' }
            $errMsg = if ($err.PSObject.Properties['message']) { $err.message } else { '' }
            # Normalize: strip variable parts (timestamps, IDs, numbers)
            $normalized = $errMsg -replace '\b[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\b', '<uuid>' `
                                  -replace '\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', '<timestamp>' `
                                  -replace '\b\d{3,}\b', '<N>'
            $key = "${errType}|${normalized}"

            if (-not $patternMap.ContainsKey($key)) {
                $patternMap[$key] = [PSCustomObject]@{
                    Type         = $errType
                    Message      = $errMsg
                    Normalized   = $normalized
                    Count        = 0
                    DumpFiles    = [System.Collections.Generic.List[string]]::new()
                    FirstSeen    = $dump.LastWriteTime
                    LastSeen     = $dump.LastWriteTime
                }
            }

            $pattern = $patternMap[$key]
            $pattern.Count++
            if ($dump.Name -notin $pattern.DumpFiles) {
                $pattern.DumpFiles.Add($dump.Name)
            }
            if ($dump.LastWriteTime -lt $pattern.FirstSeen) { $pattern.FirstSeen = $dump.LastWriteTime }
            if ($dump.LastWriteTime -gt $pattern.LastSeen) { $pattern.LastSeen = $dump.LastWriteTime }
        }
    }

    $recurring = $patternMap.Values |
        Where-Object { $_.Count -ge $MinOccurrences } |
        Sort-Object Count -Descending

    if (-not $recurring) {
        Write-Host "No recurring error patterns found (threshold: $MinOccurrences occurrences across $(@($dumps).Count) dumps)."
        return
    }

    Write-Host "=== Recurring Error Patterns (>= $MinOccurrences occurrences) ==="
    Write-Host "Scanned: $(@($dumps).Count) dumps"
    Write-Host ""

    foreach ($p in $recurring) {
        Write-Host "[$($p.Count)x] $($p.Type)"
        Write-Host "  Message: $($p.Message)"
        Write-Host "  Dumps:   $($p.DumpFiles -join ', ')"
        Write-Host "  Range:   $($p.FirstSeen.ToString('yyyy-MM-dd')) .. $($p.LastSeen.ToString('yyyy-MM-dd'))"
        Write-Host ""
    }

    $recurring
}
