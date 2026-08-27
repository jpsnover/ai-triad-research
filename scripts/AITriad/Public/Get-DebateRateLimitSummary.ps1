# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Summarizes HTTP 429 / rate-limit patterns from a flight recorder JSONL dump, grouped by bucket.
.DESCRIPTION
    Reads a (merged) flight recorder dump and reports, per rate-limit bucket: how many 429s fired,
    the first/last time, and the retry-after distribution (min/max/mean + distinct-value count).
    Distinct retry-after values across one bucket hint at multiple keys / sub-buckets behind it.

    Parsing reuses Get-FlightRecorderReport (-Detailed -AsObject) — this cmdlet is a classifier over
    its .Events, not a second JSONL parser.

    Rate-limit events are identified by schema (see lib/flight-recorder/types.ts and
    taxonomy-editor/src/server/routes/ai.ts):
      - server rate-limiter : type == 'ai.error' with data.limitKey (or data.type in
                              requests_per_minute / tokens_per_day). Bucket = data.limitKey
                              (e.g. 'embed:<ip>' — per-IP local-ONNX bucket, t/3061; 'free:<ip>' —
                              shared free-tier generate bucket). retry-after = ceil(data.retryAfterMs/1000).
      - client 429          : data.http_status == 429 (instrumented web bridge). Bucket = data.method
                              (or data.category). retry-after = data.retry_after_s (when present).
      - github rate limit   : type == 'github.api.rate_limit'.

    SCHEMA REALITY (differs from the ticket's proposal, by design):
      - There is no 'rate_limit_source' field in the dump. Bucket identity is data.limitKey; the
        Source column is its prefix (embed / free / client / github), with LimitType/Backend/Tier
        carrying the rest.
      - retry_after is normalized to seconds from two source fields with different units
        (server data.retryAfterMs [ms], client data.retry_after_s [s]).
      - Per-KEY identity (key_hash / key_slot) is NOT in the flight recorder dump — it is only in the
        Pino server log stream (keyRotator). So "were retries on the same key?" cannot be answered
        from a dump; RetryAfterDistinct is the closest bucket-level signal. For key-level attribution,
        cross-reference the server Pino logs.
.PARAMETER Path
    Path to the flight recorder JSONL dump (merged client+server dump preferred). Accepts pipeline
    input by property name (alias FullName) from Get-FlightRecorderDump / Merge-FlightRecorderDumps.
.PARAMETER PerEvent
    Emit one flat record per rate-limit event (Bucket, Source, LimitType, Backend, Tier,
    RetryAfterSec, WallMs) instead of the grouped per-bucket summary. Useful for drilling in.
.OUTPUTS
    [PSCustomObject] (AITriad.RateLimitSummary) grouped rows, or flat per-event records with -PerEvent.
.EXAMPLE
    Get-DebateRateLimitSummary -Path ./merged-dump.jsonl
    # Per-bucket 429 summary: Bucket, Source, Count, FirstAt/LastAt, retry-after min/max/mean/distinct.
.EXAMPLE
    Get-LatestFlightRecorderDump | Merge-FlightRecorderDumps | Get-DebateRateLimitSummary
.EXAMPLE
    Get-DebateRateLimitSummary -Path ./merged-dump.jsonl -PerEvent | Sort-Object WallMs
    # Every 429 event in time order.
.LINK
    Get-FlightRecorderReport
.LINK
    Merge-FlightRecorderDumps
.LINK
    Show-AITriadHelp
#>
function Get-DebateRateLimitSummary {
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName')]
        [string]$Path,

        [switch]$PerEvent
    )

    process {
        Set-StrictMode -Version Latest

        # Reuse the canonical JSONL parser (throws New-ActionableError on a missing file).
        $report = Get-FlightRecorderReport -Path $Path -Detailed -AsObject
        $events = if ($report.PSObject.Properties['Events']) { @($report.Events) } else { @() }

        $records = [System.Collections.Generic.List[PSObject]]::new()

        foreach ($e in $events) {
            $type = if ($e.PSObject.Properties['type']) { [string]$e.type } else { '' }
            $data = if ($e.PSObject.Properties['data']) { $e.data } else { $null }
            $wall = if ($e.PSObject.Properties['_wall']) { [long]$e._wall } else { $null }

            $isRL      = $false
            $bucket    = $null
            $source    = $null
            $limitType = $null
            $backend   = $null
            $tier      = $null
            $retrySec  = $null

            if ($null -ne $data) {
                $hasLimitKey = [bool]$data.PSObject.Properties['limitKey']
                $dtype       = if ($data.PSObject.Properties['type']) { [string]$data.type } else { '' }
                $httpStatus  = if ($data.PSObject.Properties['http_status']) { $data.http_status } else { $null }

                if ($type -eq 'ai.error' -and ($hasLimitKey -or $dtype -in 'requests_per_minute', 'tokens_per_day')) {
                    # ── Server-side rate-limiter event ──
                    $isRL      = $true
                    $bucket    = if ($hasLimitKey) { [string]$data.limitKey } else { $dtype }
                    $source    = if ($bucket -match '^([^:]+):') { $Matches[1] } else { 'server' }
                    $limitType = $dtype
                    if ($data.PSObject.Properties['backend']) { $backend = [string]$data.backend }
                    if ($data.PSObject.Properties['tier'])    { $tier    = "$($data.tier)" }
                    if ($data.PSObject.Properties['retryAfterMs'] -and $null -ne $data.retryAfterMs) {
                        $retrySec = [int][math]::Ceiling([double]$data.retryAfterMs / 1000)
                    }
                }
                elseif ($null -ne $httpStatus -and [int]$httpStatus -eq 429) {
                    # ── Client-side 429 from the instrumented web bridge ──
                    $isRL   = $true
                    $bucket = if ($data.PSObject.Properties['method'])   { [string]$data.method }
                              elseif ($data.PSObject.Properties['category']) { [string]$data.category }
                              else { 'client' }
                    $source = 'client'
                    if ($data.PSObject.Properties['retry_after_s'] -and $null -ne $data.retry_after_s) {
                        $retrySec = [int][math]::Ceiling([double]$data.retry_after_s)
                    }
                }
            }

            if (-not $isRL -and $type -eq 'github.api.rate_limit') {
                # ── GitHub API rate limit ──
                $isRL   = $true
                $bucket = 'github'
                $source = 'github'
                if ($null -ne $data -and $data.PSObject.Properties['retry_after_s'] -and $null -ne $data.retry_after_s) {
                    $retrySec = [int][math]::Ceiling([double]$data.retry_after_s)
                }
            }

            if ($isRL) {
                $records.Add([PSCustomObject]@{
                    Bucket        = $bucket
                    Source        = $source
                    LimitType     = $limitType
                    Backend       = $backend
                    Tier          = $tier
                    RetryAfterSec = $retrySec
                    WallMs        = $wall
                })
            }
        }

        if ($records.Count -eq 0) {
            Write-Warning "No rate-limit / HTTP 429 events found in $Path."
            return
        }

        if ($PerEvent) {
            $records | Sort-Object WallMs
            return
        }

        # ── Group by bucket → per-bucket summary ──
        $records | Group-Object Bucket | ForEach-Object {
            $g       = @($_.Group)
            $retries = @($g | Where-Object { $null -ne $_.RetryAfterSec } | ForEach-Object { [int]$_.RetryAfterSec })
            $walls   = @($g | Where-Object { $null -ne $_.WallMs } | ForEach-Object { [long]$_.WallMs })

            $first = if ($walls.Count) { [DateTimeOffset]::FromUnixTimeMilliseconds(($walls | Measure-Object -Minimum).Minimum).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $null }
            $last  = if ($walls.Count) { [DateTimeOffset]::FromUnixTimeMilliseconds(($walls | Measure-Object -Maximum).Maximum).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $null }
            $rmin  = if ($retries.Count) { ($retries | Measure-Object -Minimum).Minimum } else { $null }
            $rmax  = if ($retries.Count) { ($retries | Measure-Object -Maximum).Maximum } else { $null }
            $rmean = if ($retries.Count) { [math]::Round(($retries | Measure-Object -Average).Average, 1) } else { $null }

            [PSCustomObject]@{
                PSTypeName         = 'AITriad.RateLimitSummary'
                Bucket             = $_.Name
                Source             = $g[0].Source
                Count              = $g.Count
                FirstAt            = $first
                LastAt             = $last
                RetryAfterMinSec   = $rmin
                RetryAfterMaxSec   = $rmax
                RetryAfterMeanSec  = $rmean
                RetryAfterDistinct = @($retries | Sort-Object -Unique).Count
                LimitType          = (@($g | Where-Object { $_.LimitType } | ForEach-Object { $_.LimitType }) | Select-Object -Unique) -join ','
                Backend            = (@($g | Where-Object { $_.Backend } | ForEach-Object { $_.Backend }) | Select-Object -Unique) -join ','
                Tier               = (@($g | Where-Object { $_.Tier } | ForEach-Object { $_.Tier }) | Select-Object -Unique) -join ','
            }
        } | Sort-Object Bucket
    }
}
