# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiData003 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /health returns status and version
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/health' -TimeoutSec $TimeoutSec -ExpectedField 'status'
    $HealthOk = $r.Success -and ($null -ne $r.Body)
    $StatusVal = ''
    if ($HealthOk -and $r.Body.PSObject.Properties['status']) {
        $StatusVal = $r.Body.status
    }
    $Checks.Add((New-CuiCheckResult -Check 'Health endpoint responds' -Pass $HealthOk `
        -Detail $(if ($StatusVal) { "status=$StatusVal" } elseif ($HealthOk) { 'Health loaded' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /healthz liveness probe succeeds
    $lr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/healthz' -TimeoutSec $TimeoutSec
    $LiveOk = $lr.Success
    $Checks.Add((New-CuiCheckResult -Check 'Liveness probe (/healthz)' -Pass $LiveOk `
        -Detail $(if ($LiveOk) { 'Liveness OK' } else { "Failed: $($lr.Error)" }) -Ms $lr.ResponseMs))

    # Check 3: Health includes subsystem details (github, storage, or similar)
    $SubsystemOk = $false
    if ($HealthOk -and $r.Body) {
        $SubsystemOk = $r.Body.PSObject.Properties['github'] -or
                       $r.Body.PSObject.Properties['storage'] -or
                       $r.Body.PSObject.Properties['version'] -or
                       $r.Body.PSObject.Properties['uptime']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Health includes subsystem details' -Pass $SubsystemOk `
        -Detail $(if ($SubsystemOk) { 'Subsystem info present' } elseif ($HealthOk) { 'Minimal health (may need admin)' } else { 'No health data' })))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DATA-003' -Domain 'Data' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
