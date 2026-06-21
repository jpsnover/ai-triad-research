# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-CalibrationTrend {
    <#
    .SYNOPSIS
        Shows rolling calibration metric trends across recent debates.
    .DESCRIPTION
        Loads the N most recent debate sessions, extracts calibration_log
        metrics, and computes rolling averages with trend arrows and
        regression flags.
    .PARAMETER Last
        Number of most recent debates to include (default 10).
    .PARAMETER Since
        Include debates from this date onward (yyyy-MM-dd).
    .PARAMETER PassThru
        Return structured objects for piping.
    .EXAMPLE
        Get-CalibrationTrend -Last 5
    .EXAMPLE
        Get-CalibrationTrend -Since 2026-06-14 -PassThru
    #>
    [CmdletBinding(DefaultParameterSetName = 'Last')]
    param(
        [Parameter(ParameterSetName = 'Last')]
        [int]$Last = 10,

        [Parameter(ParameterSetName = 'Since')]
        [string]$Since,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $DebatesDir = Get-DebatesDir
    if (-not (Test-Path $DebatesDir)) {
        Write-Host "`n  Debates directory not found: $DebatesDir" -ForegroundColor Yellow
        return
    }

    $AllFiles = Get-ChildItem -Path $DebatesDir -Filter 'debate-*.json' |
        Where-Object { $_.Length -gt 10240 } |
        Sort-Object LastWriteTime -Descending

    if ($Since) {
        [datetime]$SinceDate = [datetime]::MinValue
        if (-not [datetime]::TryParse($Since, [ref]$SinceDate)) {
            Write-Host "  Invalid date: $Since" -ForegroundColor Red
            return
        }
        $AllFiles = @($AllFiles | Where-Object { $_.LastWriteTime -ge $SinceDate })
    } else {
        $AllFiles = @($AllFiles | Select-Object -First $Last)
    }

    if ($AllFiles.Count -eq 0) {
        Write-Host "`n  No debate sessions found matching criteria." -ForegroundColor Yellow
        return
    }

    $MetricKeys = @(
        'crux_addressed_ratio'
        'repetition_rate'
        'claims_forgotten_rate'
        'process_reward_mean'
        'concession_cascades'
        'situation_crux_alignment'
    )

    $Labels = @{
        crux_addressed_ratio    = 'Crux addressed'
        repetition_rate         = 'Repetition rate'
        claims_forgotten_rate   = 'Claims forgotten'
        process_reward_mean     = 'Process reward'
        concession_cascades     = 'Concession cascades'
        situation_crux_alignment = 'Sit-crux alignment'
    }

    $LowerIsBetter = @('repetition_rate', 'claims_forgotten_rate', 'concession_cascades')

    $AllMetrics = [System.Collections.Generic.List[hashtable]]::new()

    foreach ($File in $AllFiles) {
        $Data = Get-Content $File.FullName -Raw | ConvertFrom-Json
        $Row = @{ File = $File.Name; Date = $File.LastWriteTime.ToString('yyyy-MM-dd') }

        if ($Data.PSObject.Properties['calibration_log'] -and $Data.calibration_log) {
            $CL = $Data.calibration_log
            foreach ($K in $MetricKeys) {
                if ($CL.PSObject.Properties[$K] -and $null -ne $CL.$K) {
                    $Row[$K] = [double]$CL.$K
                } else {
                    $Row[$K] = $null
                }
            }
        } else {
            foreach ($K in $MetricKeys) { $Row[$K] = $null }
        }

        $AllMetrics.Add($Row)
    }

    $TrendResults = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($K in $MetricKeys) {
        $Values = [System.Collections.Generic.List[double]]::new()
        foreach ($M in $AllMetrics) {
            if ($null -ne $M[$K]) { $Values.Add($M[$K]) }
        }

        $Latest  = $null
        $Average = $null
        $Delta   = $null
        $Trend   = '?'
        $Flag    = ''

        if ($Values.Count -gt 0) {
            $Latest = $Values[0]
            if ($Values.Count -gt 1) {
                $Average = [Math]::Round(($Values | Measure-Object -Average).Average, 4)
                $Delta = [Math]::Round($Latest - $Average, 4)
                $PctChange = if ($Average -ne 0) { $Delta / [Math]::Abs($Average) } else { 0 }

                $IsRegression = $false
                if ($K -in $LowerIsBetter) {
                    if ($PctChange -gt 0.10)  { $Trend = [char]0x2191 + [char]0x2191; $IsRegression = $true }
                    elseif ($PctChange -gt 0.05) { $Trend = [char]0x2191; $IsRegression = $true }
                    elseif ($PctChange -lt -0.10) { $Trend = [char]0x2193 + [char]0x2193 }
                    elseif ($PctChange -lt -0.05) { $Trend = [char]0x2193 }
                    else { $Trend = [char]0x2192 }
                } else {
                    if ($PctChange -lt -0.10)  { $Trend = [char]0x2193 + [char]0x2193; $IsRegression = $true }
                    elseif ($PctChange -lt -0.05) { $Trend = [char]0x2193; $IsRegression = $true }
                    elseif ($PctChange -gt 0.10) { $Trend = [char]0x2191 + [char]0x2191 }
                    elseif ($PctChange -gt 0.05) { $Trend = [char]0x2191 }
                    else { $Trend = [char]0x2192 }
                }

                if ($IsRegression) { $Flag = 'REGRESSION' }
            } else {
                $Average = $Latest
                $Delta = 0
                $Trend = [char]0x2192
            }
        }

        $TrendResults.Add([PSCustomObject]@{
            Metric  = $K
            Label   = $Labels[$K]
            Average = $Average
            Latest  = $Latest
            Delta   = $Delta
            Trend   = $Trend
            Flag    = $Flag
            Values  = $Values.Count
        })
    }

    if ($PassThru) {
        return [PSCustomObject]@{
            DebateCount = $AllMetrics.Count
            Debates     = $AllMetrics.ToArray()
            Trends      = $TrendResults.ToArray()
        }
    }

    # Display
    $RunLabel = if ($Since) { "since $Since" } else { "last $($AllMetrics.Count)" }
    Write-Host "`n  CALIBRATION TREND ($RunLabel debates)" -ForegroundColor White
    Write-Host "  $('─' * 80)" -ForegroundColor DarkGray
    Write-Host ('  {0,-25} {1,10} {2,10} {3,10} {4,5} {5}' -f 'Metric', "$RunLabel avg", 'Latest', 'Delta', 'Trend', '') -ForegroundColor Cyan

    foreach ($R in $TrendResults) {
        if ($null -eq $R.Latest) {
            Write-Host ('  {0,-25} {1,10} {2,10} {3,10} {4,5}' -f $R.Label, '—', '—', '—', '?') -ForegroundColor DarkGray
            continue
        }

        $AvgStr = if ($null -ne $R.Average) { '{0,10:N4}' -f $R.Average } else { '—'.PadLeft(10) }
        $LatStr = '{0,10:N4}' -f $R.Latest
        $DeltaStr = if ($null -ne $R.Delta -and $R.Delta -gt 0) { "+$($R.Delta)" } elseif ($R.Delta -eq 0) { '=' } else { "$($R.Delta)" }

        $TrendColor = if ($R.Flag -eq 'REGRESSION') { 'Red' }
                      elseif ($R.Trend -like "*$([char]0x2191)*" -and $R.Metric -notin $LowerIsBetter) { 'Green' }
                      elseif ($R.Trend -like "*$([char]0x2193)*" -and $R.Metric -in $LowerIsBetter) { 'Green' }
                      else { 'Gray' }

        Write-Host ('  {0,-25} {1} {2} {3,10} ' -f $R.Label, $AvgStr, $LatStr, $DeltaStr) -ForegroundColor Gray -NoNewline
        Write-Host ('{0,3}' -f $R.Trend) -ForegroundColor $TrendColor -NoNewline
        if ($R.Flag) {
            Write-Host "  $([char]0x2190) $($R.Flag)" -ForegroundColor Red
        } else {
            Write-Host ''
        }
    }
    Write-Host "  $('─' * 80)" -ForegroundColor DarkGray
    Write-Host ''
}
