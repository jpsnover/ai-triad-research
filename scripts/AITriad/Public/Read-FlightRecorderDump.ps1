# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Read-FlightRecorderDump {
    <#
    .SYNOPSIS
        Structured error/retry summary from a flight recorder JSONL dump (t/3726).

    .DESCRIPTION
        Diagnosing a dump by hand means manually grouping errors, counting retry
        attempts, and computing backoff intervals from raw timestamps. This cmdlet
        does that in one pass: parses the JSONL (same header/dictionary/context/event
        shape as Get-FlightRecorderReport), then produces an error summary, retry-chain
        reconstruction, preceding-warning context, and a client/server event split.

        Retry-chain correlation: flight-recorder `ai.*` events carry no single shared
        correlation id across a retry sequence (confirmed against lib/flight-recorder
        + lib/debate/aiAdapter.ts) — this is exactly why manual timestamp correlation
        was needed. Chains group by the first non-null of call_id/request_id/turn_id,
        falling back to a synthetic "component|backend|model" key when none is set.

        Client/server split relies on the `_source` tag that ONLY merged dumps carry
        (Merge-FlightRecorderDumps / the taxonomy-editor server merge). A raw
        single-source dump reports Available=$false rather than a silent 0/0 split.

    .PARAMETER Path
        Path to the JSONL dump file. Can be piped from Get-FlightRecorderDump.

    .PARAMETER ErrorsOnly
        Restrict output to the error list (skip summary/retry/warning sections).

    .PARAMETER GroupByComponent
        Group the error summary by Component alone instead of (Component, Type).

    .PARAMETER ShowRetryStats
        Reconstruct retry chains (ai.retry/ai.error/ai.response) with attempt counts,
        computed backoff intervals, and final status.

    .PARAMETER WarningLookback
        Number of same-component prior events to scan for warnings preceding each
        error. Default: 5.

    .PARAMETER AsObject
        Return structured output instead of formatted text.

    .EXAMPLE
        Read-FlightRecorderDump -Path ./flight-recorder-dump.jsonl

    .EXAMPLE
        Get-FlightRecorderDump -Last 1 | Read-FlightRecorderDump -ShowRetryStats

    .EXAMPLE
        Read-FlightRecorderDump -Path ./dump.jsonl -ErrorsOnly -GroupByComponent -AsObject
    .LINK
        Show-AITriadHelp
    .LINK
        Get-FlightRecorderDump
    .LINK
        Get-FlightRecorderReport
    .LINK
        Merge-FlightRecorderDumps
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('FullName')]
        [string]$Path,

        [Parameter()]
        [switch]$ErrorsOnly,

        [Parameter()]
        [switch]$GroupByComponent,

        [Parameter()]
        [switch]$ShowRetryStats,

        [Parameter()]
        [ValidateRange(1, 1000)]
        [int]$WarningLookback = 5,

        [Parameter()]
        [switch]$AsObject
    )

    process {
        if (-not (Test-Path -LiteralPath $Path)) {
            New-ActionableError `
                -Goal 'Read flight recorder dump' `
                -Problem "File not found: $Path" `
                -Location 'Read-FlightRecorderDump' `
                -NextSteps @(
                    'Verify the dump file path is correct'
                    'Run Get-FlightRecorderDump to list available dumps'
                ) `
                -Throw
        }

        $header = $null
        $dictionary = @{}
        $events = [System.Collections.Generic.List[object]]::new()

        foreach ($line in [System.IO.File]::ReadLines($Path)) {
            if (-not $line.Trim()) { continue }
            try {
                $obj = $line | ConvertFrom-Json
            } catch {
                continue
            }

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
                'event' {
                    # Resolve dictionary handles for component/speaker (same convention as
                    # Get-FlightRecorderReport — component/speaker may be a handle int).
                    $componentName = $obj.component
                    $compKey = "$componentName"
                    if ($dictionary.ContainsKey($compKey)) { $componentName = $dictionary[$compKey] }
                    $obj | Add-Member -NotePropertyName '_resolvedComponent' -NotePropertyValue ([string]$componentName) -Force

                    if ($obj.PSObject.Properties['speaker']) {
                        $spk = $obj.speaker
                        $spkKey = "$spk"
                        if ($dictionary.ContainsKey($spkKey)) { $spk = $dictionary[$spkKey] }
                        $obj | Add-Member -NotePropertyName '_resolvedSpeaker' -NotePropertyValue ([string]$spk) -Force
                    }

                    $events.Add($obj)
                }
            }
        }

        function script:Get-EventWallIso([object]$Evt) {
            if ($Evt.PSObject.Properties['_wall'] -and $Evt._wall) {
                return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Evt._wall).UtcDateTime.ToString('o')
            }
            return $null
        }

        function script:Get-EventLevel([object]$Evt) {
            if ($Evt.PSObject.Properties['level'] -and $Evt.level) { return [string]$Evt.level }
            return 'info'
        }

        function script:Get-EventType([object]$Evt) {
            if ($Evt.PSObject.Properties['type'] -and $Evt.type) { return [string]$Evt.type }
            return ''
        }

        # ── Errors ────────────────────────────────────────────────────────────
        $errorRecords = [System.Collections.Generic.List[object]]::new()
        for ($i = 0; $i -lt $events.Count; $i++) {
            $evt = $events[$i]
            $level = script:Get-EventLevel $evt
            if ($level -ne 'error' -and $level -ne 'fatal') { continue }

            $errorCategory = if ($evt.PSObject.Properties['error_category']) { [string]$evt.error_category } else { $null }
            $message = if ($evt.PSObject.Properties['message']) { [string]$evt.message } else { $null }

            $precedingWarnings = [System.Collections.Generic.List[object]]::new()
            if (-not $ErrorsOnly) {
                $scanned = 0
                for ($j = $i - 1; $j -ge 0 -and $scanned -lt $WarningLookback; $j--) {
                    $prior = $events[$j]
                    if ($prior._resolvedComponent -ne $evt._resolvedComponent) { continue }
                    $scanned++
                    if ((script:Get-EventLevel $prior) -eq 'warn') {
                        $precedingWarnings.Add([PSCustomObject]@{
                            Seq         = if ($prior.PSObject.Properties['_seq']) { $prior._seq } else { $null }
                            TimestampUtc = script:Get-EventWallIso $prior
                            Type        = script:Get-EventType $prior
                            Message     = if ($prior.PSObject.Properties['message']) { [string]$prior.message } else { $null }
                        })
                    }
                }
            }

            $errorRecords.Add([PSCustomObject]@{
                Seq            = if ($evt.PSObject.Properties['_seq']) { $evt._seq } else { $null }
                TimestampUtc   = script:Get-EventWallIso $evt
                Component      = $evt._resolvedComponent
                Type           = script:Get-EventType $evt
                Level          = $level
                ErrorCategory  = $errorCategory
                Message        = $message
                DebateId       = if ($evt.PSObject.Properties['debate_id']) { [string]$evt.debate_id } else { $null }
                TurnId         = if ($evt.PSObject.Properties['turn_id']) { [string]$evt.turn_id } else { $null }
                CallId         = if ($evt.PSObject.Properties['call_id']) { [string]$evt.call_id } else { $null }
                RequestId      = if ($evt.PSObject.Properties['request_id']) { [string]$evt.request_id } else { $null }
                PrecedingWarnings = @($precedingWarnings)
            })
        }

        $result = [PSCustomObject]@{
            DumpFile = $Path
            Header   = if ($header) {
                [PSCustomObject]@{
                    SchemaVersion  = if ($header.PSObject.Properties['schema_version']) { $header.schema_version } else { $null }
                    Timestamp      = if ($header.PSObject.Properties['timestamp']) { $header.timestamp } else { $null }
                    AppVersion     = if ($header.PSObject.Properties['app_version']) { $header.app_version } else { $null }
                    Platform       = if ($header.PSObject.Properties['platform']) { $header.platform } else { $null }
                    ElectronVersion = if ($header.PSObject.Properties['electron_version']) { $header.electron_version } else { $null }
                    Capacity       = if ($header.PSObject.Properties['ring_buffer_capacity']) { $header.ring_buffer_capacity } else { 0 }
                    Retained       = if ($header.PSObject.Properties['ring_buffer_events_retained']) { $header.ring_buffer_events_retained } else { 0 }
                    Total          = if ($header.PSObject.Properties['ring_buffer_events_total']) { $header.ring_buffer_events_total } else { 0 }
                    Lost           = if ($header.PSObject.Properties['events_lost']) { $header.events_lost } else { 0 }
                }
            } else { $null }
            Errors      = @($errorRecords)
            ErrorCount  = $errorRecords.Count
        }

        if (-not $ErrorsOnly) {
            # ── ErrorSummary — group by (Component,Type) or Component alone ────
            $summaryGroups = @{}
            foreach ($rec in $errorRecords) {
                $key = if ($GroupByComponent) { $rec.Component } else { "$($rec.Component)|$($rec.Type)" }
                if (-not $summaryGroups.ContainsKey($key)) {
                    $summaryGroups[$key] = [PSCustomObject]@{
                        Component = $rec.Component
                        Type      = if ($GroupByComponent) { $null } else { $rec.Type }
                        Count     = 0
                        First     = $rec.TimestampUtc
                        Last      = $rec.TimestampUtc
                    }
                }
                $g = $summaryGroups[$key]
                $g.Count++
                if ($rec.TimestampUtc -and ($null -eq $g.First -or $rec.TimestampUtc -lt $g.First)) { $g.First = $rec.TimestampUtc }
                if ($rec.TimestampUtc -and ($null -eq $g.Last -or $rec.TimestampUtc -gt $g.Last)) { $g.Last = $rec.TimestampUtc }
            }
            $result | Add-Member -NotePropertyName ErrorSummary -NotePropertyValue @($summaryGroups.Values | Sort-Object Count -Descending) -Force

            # ── Server vs client split — only meaningful on a merged dump ──────
            $hasSource = @($events | Where-Object { $_.PSObject.Properties['_source'] }).Count -gt 0
            if ($hasSource) {
                $clientCount = @($events | Where-Object { $_._source -eq 'client' }).Count
                $serverCount = @($events | Where-Object { $_._source -eq 'server' }).Count
                $result | Add-Member -NotePropertyName ServerVsClient -NotePropertyValue ([PSCustomObject]@{
                    Available = $true
                    Client    = $clientCount
                    Server    = $serverCount
                }) -Force
            } else {
                $result | Add-Member -NotePropertyName ServerVsClient -NotePropertyValue ([PSCustomObject]@{
                    Available = $false
                    Reason    = 'single-source dump (no _source tag — not a merged dump)'
                }) -Force
            }
        }

        if ($ShowRetryStats) {
            # ── Retry chain reconstruction ──────────────────────────────────────
            $chains = @{}
            foreach ($evt in $events) {
                $etype = script:Get-EventType $evt
                if ($etype -ne 'ai.retry' -and $etype -ne 'ai.error' -and $etype -ne 'ai.response') { continue }

                $key = $null
                foreach ($idProp in @('call_id', 'request_id', 'turn_id')) {
                    if ($evt.PSObject.Properties[$idProp] -and $evt.$idProp) { $key = [string]$evt.$idProp; break }
                }
                if (-not $key) {
                    $backend = if ($evt.PSObject.Properties['data'] -and $evt.data.PSObject.Properties['backend']) { [string]$evt.data.backend } else { '?' }
                    $model = if ($evt.PSObject.Properties['data'] -and $evt.data.PSObject.Properties['model']) { [string]$evt.data.model } else { '?' }
                    $key = "$($evt._resolvedComponent)|$backend|$model"
                }

                if (-not $chains.ContainsKey($key)) { $chains[$key] = [System.Collections.Generic.List[object]]::new() }
                $chains[$key].Add($evt)
            }

            $retryChains = [System.Collections.Generic.List[object]]::new()
            foreach ($key in $chains.Keys) {
                $chainEvents = @($chains[$key] | Sort-Object { if ($_.PSObject.Properties['_seq']) { $_._seq } else { 0 } })
                $retryEvents = @($chainEvents | Where-Object { (script:Get-EventType $_) -eq 'ai.retry' })
                if ($retryEvents.Count -eq 0) { continue }   # not a retry chain — a single clean call/error

                $walls = @($chainEvents | ForEach-Object { if ($_.PSObject.Properties['_wall']) { [long]$_._wall } else { $null } } | Where-Object { $null -ne $_ })
                $backoffIntervalsMs = [System.Collections.Generic.List[object]]::new()
                for ($k = 1; $k -lt $walls.Count; $k++) { $backoffIntervalsMs.Add($walls[$k] - $walls[$k - 1]) }

                $lastType = script:Get-EventType $chainEvents[-1]
                $finalStatus = switch ($lastType) {
                    'ai.response' { 'recovered' }
                    'ai.error'    { 'failed' }
                    default       { 'unresolved' }
                }

                $retryChains.Add([PSCustomObject]@{
                    CorrelationKey     = $key
                    AttemptCount       = $retryEvents.Count + 1   # retries + the initial attempt
                    FirstEventSeq      = if ($chainEvents[0].PSObject.Properties['_seq']) { $chainEvents[0]._seq } else { $null }
                    FirstErrorTimestampUtc = script:Get-EventWallIso $chainEvents[0]
                    FinalStatus        = $finalStatus
                    BackoffIntervalsMs = @($backoffIntervalsMs)
                })
            }
            $result | Add-Member -NotePropertyName RetryChains -NotePropertyValue @($retryChains | Sort-Object FirstEventSeq) -Force
        }

        if ($AsObject) {
            $result
        } else {
            _Format-FlightRecorderDumpRead $result -ErrorsOnly:$ErrorsOnly -ShowRetryStats:$ShowRetryStats
        }
    }
}

function _Format-FlightRecorderDumpRead {
    param([object]$Result, [switch]$ErrorsOnly, [switch]$ShowRetryStats)

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("=== Flight Recorder Dump: Errors/Retry Summary ===")
    [void]$sb.AppendLine("File: $($Result.DumpFile)")

    if ($Result.Header) {
        [void]$sb.AppendLine("Build: $($Result.Header.AppVersion ?? 'n/a')  Platform: $($Result.Header.Platform ?? 'n/a')  Timestamp: $($Result.Header.Timestamp ?? 'n/a')")
        [void]$sb.AppendLine("Events: $($Result.Header.Retained) retained / $($Result.Header.Total) total ($($Result.Header.Lost) lost)")
    }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Errors ($($Result.ErrorCount)) ---")
    foreach ($rec in $Result.Errors) {
        $ids = @()
        if ($rec.CallId) { $ids += "call=$($rec.CallId)" }
        if ($rec.RequestId) { $ids += "req=$($rec.RequestId)" }
        if ($rec.TurnId) { $ids += "turn=$($rec.TurnId)" }
        $idStr = if ($ids.Count -gt 0) { " [$($ids -join ', ')]" } else { '' }
        [void]$sb.AppendLine("  [$($rec.TimestampUtc)] $($rec.Component)/$($rec.Type) ($($rec.ErrorCategory ?? 'uncategorized'))$idStr")
        if ($rec.Message) { [void]$sb.AppendLine("    $($rec.Message)") }
        if (-not $ErrorsOnly -and $rec.PrecedingWarnings.Count -gt 0) {
            [void]$sb.AppendLine("    Preceding warnings: $($rec.PrecedingWarnings.Count)")
            foreach ($w in $rec.PrecedingWarnings) { [void]$sb.AppendLine("      - [$($w.TimestampUtc)] $($w.Type): $($w.Message)") }
        }
    }

    if (-not $ErrorsOnly) {
        if ($Result.ErrorSummary -and $Result.ErrorSummary.Count -gt 0) {
            [void]$sb.AppendLine("")
            [void]$sb.AppendLine("--- Error Summary ---")
            foreach ($g in $Result.ErrorSummary) {
                $label = if ($g.Type) { "$($g.Component)/$($g.Type)" } else { $g.Component }
                [void]$sb.AppendLine("  $($label): $($g.Count)  ($($g.First) .. $($g.Last))")
            }
        }

        if ($Result.ServerVsClient) {
            [void]$sb.AppendLine("")
            [void]$sb.AppendLine("--- Server vs Client ---")
            if ($Result.ServerVsClient.Available) {
                [void]$sb.AppendLine("  Client: $($Result.ServerVsClient.Client)  Server: $($Result.ServerVsClient.Server)")
            } else {
                [void]$sb.AppendLine("  Not available: $($Result.ServerVsClient.Reason)")
            }
        }
    }

    if ($ShowRetryStats -and $Result.RetryChains) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Retry Chains ($($Result.RetryChains.Count)) ---")
        foreach ($chain in $Result.RetryChains) {
            [void]$sb.AppendLine("  $($chain.CorrelationKey): $($chain.AttemptCount) attempt(s), $($chain.FinalStatus)")
            if ($chain.BackoffIntervalsMs.Count -gt 0) {
                [void]$sb.AppendLine("    Backoff intervals (ms): $($chain.BackoffIntervalsMs -join ', ')")
            }
        }
    }

    $sb.ToString()
}
