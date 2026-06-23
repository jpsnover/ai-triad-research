function Get-FlightRecorderReport {
    <#
    .SYNOPSIS
        Parses a flight recorder NDJSON dump and produces a summary report.
    .DESCRIPTION
        Reads a flight recorder JSONL file, analyzes events, and builds a report
        including time range, level distribution, component coverage, error summary,
        and optionally full event listings.

        NDJSON structure: line 1 = header, line 2 = dictionary, line 3 = context,
        lines 4..N = events, last line = trigger.
    .PARAMETER Path
        Path to the JSONL dump file. Accepts pipeline input from Get-FlightRecorderDump.
    .PARAMETER Detailed
        Include full event, error, and warning listings in the report.
    .PARAMETER AsObject
        Return structured PSCustomObject instead of formatted text.
    .EXAMPLE
        Get-FlightRecorderReport -Path ./flight-recorder-dump.jsonl
    .EXAMPLE
        Get-FlightRecorderDump -Last 1 | Get-FlightRecorderReport -AsObject
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipelineByPropertyName)]
        [Alias('FullName')]
        [string]$Path,

        [switch]$Detailed,
        [switch]$AsObject
    )

    process {
        Set-StrictMode -Version Latest

        if (-not (Test-Path $Path)) {
            New-ActionableError `
                -Goal 'Generate flight recorder report' `
                -Problem "File not found: $Path" `
                -Location 'Get-FlightRecorderReport' `
                -NextSteps @(
                    'Verify the dump file path is correct'
                    'Run Get-FlightRecorderDump to list available dumps'
                ) -Throw
        }

        $header = $null
        $context = $null
        $dictionary = @{}
        $events = [System.Collections.Generic.List[object]]::new()
        $errors = [System.Collections.Generic.List[object]]::new()
        $warnings = [System.Collections.Generic.List[object]]::new()
        $trigger = $null
        $componentCounts = @{}
        $levelCounts = @{ debug = 0; info = 0; warn = 0; error = 0; fatal = 0 }
        $typeCounts = @{}
        $firstWall = $null
        $lastWall = $null

        foreach ($line in [System.IO.File]::ReadLines($Path)) {
            if (-not $line.Trim()) { continue }
            try { $obj = $line | ConvertFrom-Json } catch { continue }

            $recType = $null
            if ($obj.PSObject.Properties['_type']) { $recType = $obj._type }

            switch ($recType) {
                'header' { $header = $obj }
                'dictionary' {
                    if ($obj.PSObject.Properties['entries']) {
                        foreach ($entry in $obj.entries) {
                            $dictionary["$($entry.handle)"] = $entry.value
                        }
                    }
                }
                'context' { $context = $obj }
                'trigger' { $trigger = $obj }
                'event' {
                    $events.Add($obj)

                    # Resolve dictionary handles for component
                    $componentName = if ($obj.PSObject.Properties['component']) { $obj.component } else { 'unknown' }
                    $handleKey = "$componentName"
                    if ($dictionary.ContainsKey($handleKey)) {
                        $componentName = $dictionary[$handleKey]
                    }

                    $compKey = [string]$componentName
                    if ($componentCounts.ContainsKey($compKey)) { $componentCounts[$compKey]++ }
                    else { $componentCounts[$compKey] = 1 }

                    # Track event types
                    $evtType = ''
                    if ($obj.PSObject.Properties['type']) { $evtType = [string]$obj.type }
                    if ($typeCounts.ContainsKey($evtType)) { $typeCounts[$evtType]++ }
                    else { $typeCounts[$evtType] = 1 }

                    # Track levels
                    $level = 'info'
                    if ($obj.PSObject.Properties['level']) { $level = [string]$obj.level }
                    if ($levelCounts.ContainsKey($level)) { $levelCounts[$level]++ }

                    if ($level -eq 'error' -or $level -eq 'fatal') { $errors.Add($obj) }
                    elseif ($level -eq 'warn') { $warnings.Add($obj) }

                    # Track time range
                    if ($obj.PSObject.Properties['_wall']) {
                        $wall = $obj._wall
                        if ($null -eq $firstWall) { $firstWall = $wall }
                        $lastWall = $wall
                    }
                }
            }
        }

        # Error categories
        $errorCategories = @{}
        foreach ($err in $errors) {
            $cat = 'uncategorized'
            if ($err.PSObject.Properties['error_category']) { $cat = [string]$err.error_category }
            elseif ($err.PSObject.Properties['type']) { $cat = [string]$err.type }
            if ($errorCategories.ContainsKey($cat)) { $errorCategories[$cat]++ }
            else { $errorCategories[$cat] = 1 }
        }

        # Time range
        $timeStart = if ($null -ne $firstWall) {
            [DateTimeOffset]::FromUnixTimeMilliseconds([long]$firstWall).DateTime.ToString('o')
        } else { $null }
        $timeEnd = if ($null -ne $lastWall) {
            [DateTimeOffset]::FromUnixTimeMilliseconds([long]$lastWall).DateTime.ToString('o')
        } else { $null }

        # Top components
        $topComponents = $componentCounts.GetEnumerator() |
            Sort-Object Value -Descending |
            Select-Object @{N='Component';E={$_.Key}}, @{N='Events';E={$_.Value}}

        # Top event types
        $topTypes = $typeCounts.GetEnumerator() |
            Sort-Object Value -Descending |
            Select-Object @{N='Type';E={$_.Key}}, @{N='Count';E={$_.Value}}

        $report = [PSCustomObject]@{
            DumpFile     = $Path
            Header       = if ($header) {
                               [PSCustomObject]@{
                                   SchemaVersion = $header.schema_version
                                   Capacity      = if ($header.PSObject.Properties['ring_buffer_capacity']) { $header.ring_buffer_capacity } else { 0 }
                                   Retained      = if ($header.PSObject.Properties['ring_buffer_events_retained']) { $header.ring_buffer_events_retained } else { 0 }
                                   Total         = if ($header.PSObject.Properties['ring_buffer_events_total']) { $header.ring_buffer_events_total } else { 0 }
                                   Lost          = if ($header.PSObject.Properties['events_lost']) { $header.events_lost } else { 0 }
                               }
                           } else { $null }
            TimeRange    = [PSCustomObject]@{ Start = $timeStart; End = $timeEnd }
            EventCount   = $events.Count
            LevelCounts  = [PSCustomObject]$levelCounts
            ErrorCount   = $errors.Count
            WarningCount = $warnings.Count
            ErrorSummary = $errorCategories
            Components   = @($topComponents)
            EventTypes   = @($topTypes)
            Trigger      = if ($trigger) {
                               [PSCustomObject]@{
                                   Type    = if ($trigger.PSObject.Properties['trigger_type']) { $trigger.trigger_type } else { $null }
                                   Error   = if ($trigger.PSObject.Properties['error']) { $trigger.error.message } else { $null }
                                   Time    = if ($trigger.PSObject.Properties['timestamp']) { $trigger.timestamp } else { $null }
                               }
                           } else { $null }
        }

        if ($Detailed) {
            $report | Add-Member -NotePropertyName Events -NotePropertyValue @($events) -Force
            $report | Add-Member -NotePropertyName Errors -NotePropertyValue @($errors) -Force
            $report | Add-Member -NotePropertyName Warnings -NotePropertyValue @($warnings) -Force
            $report | Add-Member -NotePropertyName Context -NotePropertyValue $context -Force
        }

        if ($AsObject) { $report }
        else { Format-FlightRecorderReport $report }
    }
}

function Format-FlightRecorderReport {
    param([object]$Report)

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("=== Flight Recorder Report ===")
    [void]$sb.AppendLine("File: $($Report.DumpFile)")

    if ($Report.Header) {
        [void]$sb.AppendLine("Events: $($Report.Header.Retained) retained / $($Report.Header.Total) total ($($Report.Header.Lost) lost)")
    } else {
        [void]$sb.AppendLine("Events: $($Report.EventCount)")
    }

    if ($Report.TimeRange.Start) {
        [void]$sb.AppendLine("Time: $($Report.TimeRange.Start) .. $($Report.TimeRange.End)")
    }

    if ($Report.Trigger) {
        [void]$sb.AppendLine("Trigger: $($Report.Trigger.Type)$(if ($Report.Trigger.Error) { " - $($Report.Trigger.Error)" })")
    }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Levels ---")
    [void]$sb.AppendLine("  debug: $($Report.LevelCounts.debug)  info: $($Report.LevelCounts.info)  warn: $($Report.LevelCounts.warn)  error: $($Report.LevelCounts.error)  fatal: $($Report.LevelCounts.fatal)")

    if ($Report.ErrorCount -gt 0) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Errors ($($Report.ErrorCount)) ---")
        foreach ($cat in $Report.ErrorSummary.GetEnumerator()) {
            [void]$sb.AppendLine("  $($cat.Key): $($cat.Value)")
        }
    }
    if ($Report.WarningCount -gt 0) {
        [void]$sb.AppendLine("  Warnings: $($Report.WarningCount)")
    }

    if ($Report.Components.Count -gt 0) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Components (top 15) ---")
        foreach ($comp in $Report.Components | Select-Object -First 15) {
            [void]$sb.AppendLine("  $($comp.Component): $($comp.Events)")
        }
    }

    if ($Report.EventTypes.Count -gt 0) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Event Types (top 10) ---")
        foreach ($t in $Report.EventTypes | Select-Object -First 10) {
            [void]$sb.AppendLine("  $($t.Type): $($t.Count)")
        }
    }

    $sb.ToString()
}
