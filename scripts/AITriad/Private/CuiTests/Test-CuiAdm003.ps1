# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAdm003 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15,
        [Parameter()][hashtable]$AuthHeaders = @{}
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()
    $BaseUrl = $BaseUrl.TrimEnd('/')

    # Check 1: POST /api/admin/errors — submit a test error report
    $ErrSw = [System.Diagnostics.Stopwatch]::StartNew()
    $SubmitOk = $false
    try {
        $ErrBody = @{
            error   = 'CUI test error — safe to ignore'
            context = @{ source = 'cui-test'; timestamp = (Get-Date -Format 'o') }
        } | ConvertTo-Json -Depth 3 -Compress
        $ErrResp = Invoke-WebRequest -Uri "$BaseUrl/api/admin/errors" -Method POST `
            -Body $ErrBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $SubmitOk = $ErrResp.StatusCode -eq 200
    } catch { }
    $ErrSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Submit error report' -Pass $SubmitOk `
        -Detail $(if ($SubmitOk) { 'Error submitted' } else { 'Submit failed' }) -Ms $ErrSw.ElapsedMilliseconds))

    # Check 2: GET /api/admin/health — verify errorCount is present (errors are visible)
    $hr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/admin/health' -TimeoutSec $TimeoutSec
    $HealthOk = $hr.Success -and ($null -ne $hr.Body)
    $HasErrorCount = $false
    if ($HealthOk -and $hr.Body.PSObject.Properties['errorCount']) {
        $HasErrorCount = $true
    }
    $Checks.Add((New-CuiCheckResult -Check 'Admin health shows errors' -Pass ($HealthOk -and $HasErrorCount) `
        -Detail $(if ($HasErrorCount) { "errorCount=$($hr.Body.errorCount)" } elseif ($HealthOk) { 'Health loaded but no errorCount (may need admin)' } else { "Failed: $($hr.Error)" }) -Ms $hr.ResponseMs))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-ADM-003' -Domain 'Admin' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
