# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAuth003 {
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

    # Check 1: Verify caller identity (should be authenticated but not admin)
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/auth/me' -TimeoutSec $TimeoutSec
    $IdentityOk = $r.Success -and ($null -ne $r.Body)
    $IsAnon = $true
    if ($IdentityOk -and $r.Body.PSObject.Properties['anonymous']) {
        $IsAnon = [bool]$r.Body.anonymous
    }
    $Checks.Add((New-CuiCheckResult -Check 'Caller identity' -Pass $IdentityOk `
        -Detail $(if (-not $IsAnon) { 'Authenticated user' } elseif ($IdentityOk) { 'Anonymous — admin rejection tests will use anonymous access' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /api/admin/submissions — should reject non-admin
    $SubSw = [System.Diagnostics.Stopwatch]::StartNew()
    $SubRejected = $false
    try {
        $SubResp = Invoke-WebRequest -Uri "$BaseUrl/api/admin/submissions" -Method GET `
            -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $SubRejected = $false
    } catch {
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        $SubRejected = $StatusCode -in @(401, 403)
    }
    $SubSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Admin submissions rejected' -Pass $SubRejected `
        -Detail $(if ($SubRejected) { 'Correctly rejected (401/403)' } else { 'Unexpected access — may have admin privileges' }) -Ms $SubSw.ElapsedMilliseconds))

    # Check 3: POST /api/admin/rotate-keys — should reject non-admin
    $RotSw = [System.Diagnostics.Stopwatch]::StartNew()
    $RotRejected = $false
    try {
        $RotResp = Invoke-WebRequest -Uri "$BaseUrl/api/admin/rotate-keys" -Method POST `
            -Body '{}' -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $RotRejected = $false
    } catch {
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        $RotRejected = $StatusCode -in @(401, 403)
    }
    $RotSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Admin rotate-keys rejected' -Pass $RotRejected `
        -Detail $(if ($RotRejected) { 'Correctly rejected (401/403)' } else { 'Unexpected access — may have admin privileges' }) -Ms $RotSw.ElapsedMilliseconds))

    # Check 4: GET /api/admin/review/queue — should reject non-admin
    $RevSw = [System.Diagnostics.Stopwatch]::StartNew()
    $RevRejected = $false
    try {
        $RevResp = Invoke-WebRequest -Uri "$BaseUrl/api/admin/review/queue" -Method GET `
            -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $RevRejected = $false
    } catch {
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        $RevRejected = $StatusCode -in @(401, 403)
    }
    $RevSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Admin review queue rejected' -Pass $RevRejected `
        -Detail $(if ($RevRejected) { 'Correctly rejected (401/403)' } else { 'Unexpected access — may have admin privileges' }) -Ms $RevSw.ElapsedMilliseconds))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-AUTH-003' -Domain 'Auth' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
