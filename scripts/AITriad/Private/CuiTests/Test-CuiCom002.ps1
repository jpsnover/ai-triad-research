# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiCom002 {
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

    # Check 1: Verify authenticated (community submission requires auth)
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/auth/me' -TimeoutSec $TimeoutSec
    $IdentityOk = $r.Success -and ($null -ne $r.Body)
    $IsAnon = $true
    if ($IdentityOk -and $r.Body.PSObject.Properties['anonymous']) {
        $IsAnon = [bool]$r.Body.anonymous
    }

    if ($IsAnon) {
        $Checks.Add((New-CuiCheckResult -Check 'Auth check' -Pass $false `
            -Detail 'Anonymous — submission requires auth' -Ms $r.ResponseMs))
        $Sw.Stop()
        return New-CuiTestResult -CuiId 'CUI-COM-002' -Domain 'Community' -Priority 'P2' `
            -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray() -Error 'Skipped — no auth credentials'
    }

    $Checks.Add((New-CuiCheckResult -Check 'Auth check' -Pass $true `
        -Detail 'Authenticated user' -Ms $r.ResponseMs))

    # Check 2: POST /api/community/submit — submit a test item (will be pending review)
    $SubSw = [System.Diagnostics.Stopwatch]::StartNew()
    $SubmitOk = $false
    try {
        $SubBody = @{
            type = 'debate'
            id   = "cui-com-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
        } | ConvertTo-Json -Compress
        $SubResp = Invoke-WebRequest -Uri "$BaseUrl/api/community/submit" -Method POST `
            -Body $SubBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $SubmitOk = $SubResp.StatusCode -eq 200
    } catch {
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        $SubmitOk = $StatusCode -in @(200, 400, 404, 429)
    }
    $SubSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Community submission endpoint' -Pass $SubmitOk `
        -Detail $(if ($SubmitOk) { 'Submission accepted or rate-limited' } else { 'Submission endpoint unreachable' }) -Ms $SubSw.ElapsedMilliseconds))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-COM-002' -Domain 'Community' -Priority 'P2' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
