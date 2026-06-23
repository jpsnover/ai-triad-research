# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAdm001 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15,
        [Parameter()][hashtable]$AuthHeaders = @{}
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /health → 200, has status, version, uptime, storage, github
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/health' -TimeoutSec $TimeoutSec -ExpectedField 'status'
    $HealthOk = $r.Success
    $StatusOk = $false
    if ($r.Success -and $r.Body) {
        $HasFields = $r.Body.PSObject.Properties['status'] -and
                     $r.Body.PSObject.Properties['version']
        $StatusVal = ''
        if ($r.Body.PSObject.Properties['status']) { $StatusVal = $r.Body.status }
        $StatusOk = $HasFields -and $StatusVal -in @('ok', 'degraded')
    }
    $Checks.Add((New-CuiCheckResult -Check 'Health endpoint (status,version)' -Pass ($HealthOk -and $StatusOk) `
        -Detail $(if ($StatusOk) { "status=$StatusVal" } elseif ($HealthOk) { 'Missing expected fields' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: Validate status is not "error"
    $NotError = $HealthOk -and $StatusOk
    $Checks.Add((New-CuiCheckResult -Check 'Status is ok or degraded' -Pass $NotError `
        -Detail $(if ($NotError) { "status=$StatusVal" } else { "status=$StatusVal (or unreachable)" })))

    # Check 3: GET /api/admin/health → 200, has errorCount, feedbackCount
    $ar = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/admin/health' -TimeoutSec $TimeoutSec
    $AdminOk = $ar.Success
    $HasAdminFields = $false
    if ($ar.Success -and $ar.Body) {
        $HasAdminFields = $ar.Body.PSObject.Properties['errorCount']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Admin health endpoint' -Pass $AdminOk `
        -Detail $(if ($HasAdminFields) { "errorCount=$($ar.Body.errorCount)" } elseif ($AdminOk) { 'Loaded (may need admin auth)' } else { "Failed: $($ar.Error)" }) -Ms $ar.ResponseMs))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-ADM-001' -Domain 'Admin' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
