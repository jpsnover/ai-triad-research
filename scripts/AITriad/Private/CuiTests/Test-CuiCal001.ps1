# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiCal001 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /api/calibration/log — read calibration log
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/calibration/log' -TimeoutSec $TimeoutSec
    $LogOk = $r.Success
    $Checks.Add((New-CuiCheckResult -Check 'Calibration log endpoint' -Pass $LogOk `
        -Detail $(if ($LogOk) { 'Log loaded' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /api/calibration/history — read parameter history
    $hr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/calibration/history' -TimeoutSec $TimeoutSec
    $HistoryOk = $hr.Success
    $Checks.Add((New-CuiCheckResult -Check 'Calibration history endpoint' -Pass $HistoryOk `
        -Detail $(if ($HistoryOk) { 'History loaded' } else { "Failed: $($hr.Error)" }) -Ms $hr.ResponseMs))

    # Check 3: GET /api/admin/calibration/pending — list pending entries
    $pr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/admin/calibration/pending' -TimeoutSec $TimeoutSec
    $PendingOk = $pr.Success
    $Checks.Add((New-CuiCheckResult -Check 'Pending calibration entries' -Pass $PendingOk `
        -Detail $(if ($PendingOk) { 'Pending list loaded' } else { "Failed: $($pr.Error) (may need admin)" }) -Ms $pr.ResponseMs))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-CAL-001' -Domain 'Calibration' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
