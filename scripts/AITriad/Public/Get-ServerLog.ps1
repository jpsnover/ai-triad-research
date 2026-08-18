# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-ServerLog {
    <#
    .SYNOPSIS
        Retrieve and filter Azure Container App server logs by Pino requestId.
    .DESCRIPTION
        Pulls container-app logs via `az containerapp logs show`, unwraps the ACA
        `{Log,TimeStamp}` envelope, parses the Pino JSON, and filters/correlates by
        requestId, component, level, pattern, or time. The primary use is tracing a
        single request end-to-end from a flight-recorder requestId (t/2761/t/2763).

        Requires the az CLI logged in with access to the container app. No AI calls.
    .PARAMETER RequestId
        (ByRequestId) Trace one request end-to-end. Default -Tail 5000.
    .PARAMETER StartTime
        (ByTimeRange) Lower bound of the post-mortem window (UTC-compared).
    .PARAMETER EndTime
        (ByTimeRange) Upper bound. Defaults to now (UTC) when omitted.
    .PARAMETER Follow
        (Recent/Search) Stream logs live instead of a batch capture.
    .PARAMETER Tail
        Number of log lines to request from ACA. 0 = per-set default
        (Recent 100, ByRequestId 5000, ByTimeRange 10000, Search 1000).
    .PARAMETER Component
        Filter to a single Pino `component`.
    .PARAMETER Level
        Filter to one or more Pino levels (trace/debug/info/warn/error/fatal).
    .PARAMETER Pattern
        (Search: mandatory; other sets: optional) Regex matched against the Pino line.
    .PARAMETER ResourceGroup
        Azure resource group. Default 'ai-triad'.
    .PARAMETER AppName
        Container app name. Default 'taxonomy-editor'.
    .PARAMETER Revision
        Restrict to a specific revision.
    .PARAMETER Raw
        Emit the raw Pino JSON string per line instead of a structured object.
    .OUTPUTS
        [PSCustomObject] with Time, Level, Component, RequestId, Message, Raw
        (or raw JSON strings with -Raw).
    .EXAMPLE
        Get-ServerLog -RequestId a2451012-e019-426c-8541-17e541a594bc
    .EXAMPLE
        Get-ServerLog -Level error -Tail 500
    .EXAMPLE
        Get-ServerLog -StartTime (Get-Date).AddHours(-2) -Component ai
    .EXAMPLE
        Get-ServerLog -Pattern 'GEMINI|quota' -Level warn,error
    .LINK
        Show-AITriadHelp
    .LINK
        Test-AzureHealth
    .LINK
        Get-ContainerAppRevision
    .LINK
        Get-AzureFlightRecorder
    #>
    [CmdletBinding(DefaultParameterSetName = 'Recent')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ParameterSetName = 'ByRequestId', Position = 0)]
        [string]$RequestId,

        [Parameter(Mandatory, ParameterSetName = 'ByTimeRange')]
        [datetime]$StartTime,

        [Parameter(ParameterSetName = 'ByTimeRange')]
        [datetime]$EndTime,

        [Parameter(ParameterSetName = 'Recent')]
        [Parameter(ParameterSetName = 'Search')]
        [switch]$Follow,

        [Parameter(ParameterSetName = 'Recent')]
        [Parameter(ParameterSetName = 'ByRequestId')]
        [Parameter(ParameterSetName = 'ByTimeRange')]
        [Parameter(ParameterSetName = 'Search')]
        [ValidateRange(1, 100000)]
        [int]$Tail = 0,

        [Parameter(ParameterSetName = 'Recent')]
        [Parameter(ParameterSetName = 'ByRequestId')]
        [Parameter(ParameterSetName = 'ByTimeRange')]
        [Parameter(ParameterSetName = 'Search')]
        [string]$Component,

        [Parameter(ParameterSetName = 'Recent')]
        [Parameter(ParameterSetName = 'ByRequestId')]
        [Parameter(ParameterSetName = 'ByTimeRange')]
        [Parameter(ParameterSetName = 'Search')]
        [ValidateSet('trace', 'debug', 'info', 'warn', 'error', 'fatal')]
        [string[]]$Level,

        [Parameter(Mandatory, ParameterSetName = 'Search')]
        [Parameter(ParameterSetName = 'Recent')]
        [Parameter(ParameterSetName = 'ByRequestId')]
        [Parameter(ParameterSetName = 'ByTimeRange')]
        [string]$Pattern,

        [Parameter()]
        [string]$ResourceGroup = 'ai-triad',

        [Parameter()]
        [string]$AppName = 'taxonomy-editor',

        [Parameter()]
        [string]$Revision,

        [Parameter()]
        [switch]$Raw
    )

    begin {
        Set-StrictMode -Version Latest

        $pinoLevelMap   = @{ 10 = 'trace'; 20 = 'debug'; 30 = 'info'; 40 = 'warn'; 50 = 'error'; 60 = 'fatal' }
        $pinoLevelToNum = @{ 'trace' = 10; 'debug' = 20; 'info' = 30; 'warn' = 40; 'error' = 50; 'fatal' = 60 }

        if ($PSCmdlet.ParameterSetName -eq 'ByTimeRange' -and -not $PSBoundParameters.ContainsKey('EndTime')) {
            $EndTime = [datetime]::UtcNow
        }

        $effectiveTail = switch ($PSCmdlet.ParameterSetName) {
            'Recent'      { if ($Tail -gt 0) { $Tail } else { 100 } }
            'ByRequestId' { if ($Tail -gt 0) { $Tail } else { 5000 } }
            'ByTimeRange' { if ($Tail -gt 0) { $Tail } else { 10000 } }
            'Search'      { if ($Tail -gt 0) { $Tail } else { 1000 } }
            default       { if ($Tail -gt 0) { $Tail } else { 100 } }
        }

        $levelNums = if ($Level) { [int[]]@($Level | ForEach-Object { $pinoLevelToNum[$_] }) } else { $null }

        $azArgs = @('containerapp', 'logs', 'show', '--name', $AppName, '--resource-group', $ResourceGroup, '--format', 'json')
        if ($Revision) { $azArgs += @('--revision', $Revision) }

        $isFollow = $Follow.IsPresent -and $PSCmdlet.ParameterSetName -in @('Recent', 'Search')
        if ($isFollow) { $azArgs += @('--follow', '--tail', $effectiveTail) }
        else           { $azArgs += @('--tail', $effectiveTail) }

        Write-Verbose "az $($azArgs -join ' ')"

        # StrictMode-safe field read from a ConvertFrom-Json object: absent property
        # returns $null instead of throwing (project convention — powershell-strict-mode.md).
        $getField = {
            param($obj, [string]$name)
            if ($null -eq $obj) { return $null }
            $p = $obj.PSObject.Properties[$name]
            if ($p) { return $p.Value } else { return $null }
        }

        $parseAndEmit = {
            param([string]$rawLine)
            if ([string]::IsNullOrWhiteSpace($rawLine)) { return }

            # ACA wraps container stdout as {"Log":"<pino-json>","TimeStamp":"..."}.
            $pinoLine = $rawLine
            try {
                $envelope = $rawLine | ConvertFrom-Json -ErrorAction Stop
                $logField = (& $getField $envelope 'Log')
                if ($null -eq $logField) { $logField = (& $getField $envelope 'log') }
                if ($null -ne $logField) { $pinoLine = [string]$logField }
            } catch { }

            if ([string]::IsNullOrWhiteSpace($pinoLine)) { return }

            $entry = $null
            try { $entry = $pinoLine | ConvertFrom-Json -ErrorAction Stop }
            catch { if ($Raw) { Write-Output $pinoLine }; return }

            $entryLevel     = & $getField $entry 'level'
            $entryComponent = & $getField $entry 'component'
            $entryRequestId = & $getField $entry 'requestId'
            $entryTime      = & $getField $entry 'time'
            $entryMsg       = & $getField $entry 'msg'

            if ($levelNums -and ($null -eq $entryLevel -or [int]$entryLevel -notin $levelNums)) { return }
            if ($Component -and $entryComponent -ne $Component) { return }
            if ($PSCmdlet.ParameterSetName -eq 'ByRequestId' -and $entryRequestId -ne $RequestId) { return }

            if ($PSCmdlet.ParameterSetName -eq 'ByTimeRange' -and $entryTime) {
                try {
                    $ts = [System.DateTimeOffset]::FromUnixTimeMilliseconds([long]$entryTime).UtcDateTime
                    if ($ts -lt $StartTime.ToUniversalTime() -or $ts -gt $EndTime.ToUniversalTime()) { return }
                } catch { return }
            }

            if ($Pattern -and $pinoLine -notmatch $Pattern) { return }

            if ($Raw) { Write-Output $pinoLine; return }

            $levelName = if ($null -ne $entryLevel -and $pinoLevelMap.ContainsKey([int]$entryLevel)) {
                $pinoLevelMap[[int]$entryLevel]
            } else { "$entryLevel" }

            $timestamp = $null
            if ($entryTime) {
                try { $timestamp = [System.DateTimeOffset]::FromUnixTimeMilliseconds([long]$entryTime).UtcDateTime }
                catch { $timestamp = $entryTime }
            }

            [PSCustomObject]@{
                Time      = $timestamp
                Level     = $levelName
                Component = $entryComponent
                RequestId = $entryRequestId
                Message   = $entryMsg
                Raw       = $entry
            }
        }
    }

    process {
        Set-StrictMode -Version Latest

        if ($isFollow) {
            & az @azArgs | ForEach-Object { & $parseAndEmit $_ }
        }
        else {
            $rawLines = & az @azArgs 2>&1
            if ($LASTEXITCODE -ne 0) {
                $tailText = @($rawLines) | Select-Object -Last 3 | Out-String -Width 200
                throw (New-ActionableError `
                        -Goal     "Retrieve server logs from '$AppName' in '$ResourceGroup'" `
                        -Problem  "az containerapp logs show exited $LASTEXITCODE. $($tailText.TrimEnd())" `
                        -Location 'Get-ServerLog' `
                        -NextSteps @(
                            'Verify Azure CLI login: az account show',
                            "Check ResourceGroup='$ResourceGroup', AppName='$AppName'",
                            'Confirm the app is running: Test-AzureHealth',
                            'Verify the revision exists: Get-ContainerAppRevision'
                        ))
            }
            foreach ($line in @($rawLines)) {
                & $parseAndEmit ([string]$line)
            }
        }
    }
}
