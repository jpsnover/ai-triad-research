# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAi001 {
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

    # Check 1: GET current key state for gemini
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/keys/has?backend=gemini' -TimeoutSec $TimeoutSec
    $KeyStateOk = $r.Success
    $OriginalHasKey = $false
    if ($r.Success -and $r.Body.PSObject.Properties['has']) {
        $OriginalHasKey = [bool]$r.Body.has
    }
    $Checks.Add((New-CuiCheckResult -Check 'GET key state' -Pass $KeyStateOk `
        -Detail $(if ($KeyStateOk) { "has=$OriginalHasKey" } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: POST a test key (using a clearly fake key)
    $PostSw = [System.Diagnostics.Stopwatch]::StartNew()
    $PostOk = $false
    try {
        $KeyBody = @{ backend = 'gemini'; key = 'CUI-TEST-FAKE-KEY-DO-NOT-USE' } | ConvertTo-Json -Compress
        $PostResp = Invoke-WebRequest -Uri "$BaseUrl/api/keys" -Method POST `
            -Body $KeyBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $PostOk = $PostResp.StatusCode -eq 200
    } catch { }
    $PostSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'POST test key' -Pass $PostOk `
        -Detail $(if ($PostOk) { 'Key stored' } else { 'POST failed (may need auth)' }) -Ms $PostSw.ElapsedMilliseconds))

    # Check 3: Verify key is now present
    $VerifyR = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/keys/has?backend=gemini' -TimeoutSec $TimeoutSec
    $NowHasKey = $false
    if ($VerifyR.Success -and $VerifyR.Body.PSObject.Properties['has']) {
        $NowHasKey = [bool]$VerifyR.Body.has
    }
    $VerifyOk = $PostOk -and $NowHasKey
    $Checks.Add((New-CuiCheckResult -Check 'Verify key stored' -Pass $VerifyOk `
        -Detail $(if ($VerifyOk) { 'has=true' } elseif (-not $PostOk) { 'Skipped (POST failed)' } else { 'Key not found after POST' }) -Ms $VerifyR.ResponseMs))

    # Check 4: GET masked key list
    $ListR = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/keys/gemini' -TimeoutSec $TimeoutSec
    $ListOk = $ListR.Success
    $Checks.Add((New-CuiCheckResult -Check 'GET masked key' -Pass $ListOk `
        -Detail $(if ($ListOk) { 'Key list loaded' } else { "Failed: $($ListR.Error)" }) -Ms $ListR.ResponseMs))

    # Check 5: Cleanup — delete the test key
    $CleanSw = [System.Diagnostics.Stopwatch]::StartNew()
    $CleanOk = $false
    if ($PostOk) {
        try {
            $DelBody = @{ backend = 'gemini' } | ConvertTo-Json -Compress
            $DelResp = Invoke-WebRequest -Uri "$BaseUrl/api/keys/delete" -Method POST `
                -Body $DelBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
                -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
            $CleanOk = $DelResp.StatusCode -eq 200
        } catch { }
    } else {
        $CleanOk = $true
    }
    $CleanSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Cleanup: delete test key' -Pass $CleanOk `
        -Detail $(if ($CleanOk -and $PostOk) { 'Deleted' } elseif (-not $PostOk) { 'Nothing to clean' } else { 'Cleanup failed' }) -Ms $CleanSw.ElapsedMilliseconds))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-AI-001' -Domain 'AI' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
