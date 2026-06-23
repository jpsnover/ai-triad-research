# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb005 {
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
    $DebateId = "cui-del-test-$(Get-Date -Format 'yyyyMMddHHmmss')"

    # Check 1: Create a test debate to delete
    $CreateSw = [System.Diagnostics.Stopwatch]::StartNew()
    $CreateOk = $false
    try {
        $DebateObj = @{
            id         = $DebateId
            topic      = 'CUI delete test — should be removed'
            transcript = @()
        } | ConvertTo-Json -Compress
        $PutResp = Invoke-WebRequest -Uri "$BaseUrl/api/debates" -Method PUT `
            -Body $DebateObj -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $CreateOk = $PutResp.StatusCode -eq 200
    } catch { }
    $CreateSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Create test debate' -Pass $CreateOk `
        -Detail $(if ($CreateOk) { "Created $DebateId" } else { 'Create failed (may need auth)' }) -Ms $CreateSw.ElapsedMilliseconds))

    # Check 2: Verify it exists
    $VerifySw = [System.Diagnostics.Stopwatch]::StartNew()
    $ExistsOk = $false
    if ($CreateOk) {
        $vr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/debates/$DebateId" -TimeoutSec $TimeoutSec
        $ExistsOk = $vr.Success -and ($null -ne $vr.Body)
    }
    $VerifySw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Verify debate exists' -Pass $ExistsOk `
        -Detail $(if ($ExistsOk) { 'Found' } elseif (-not $CreateOk) { 'Skipped — create failed' } else { 'Not found after create' }) -Ms $VerifySw.ElapsedMilliseconds))

    # Check 3: DELETE the debate
    $DelSw = [System.Diagnostics.Stopwatch]::StartNew()
    $DeleteOk = $false
    if ($CreateOk) {
        try {
            $DelResp = Invoke-WebRequest -Uri "$BaseUrl/api/debates/$DebateId" -Method DELETE `
                -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
            $DeleteOk = $DelResp.StatusCode -eq 200
        } catch { }
    }
    $DelSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'DELETE debate' -Pass $DeleteOk `
        -Detail $(if ($DeleteOk) { "Deleted $DebateId" } elseif (-not $CreateOk) { 'Skipped — create failed' } else { 'Delete failed' }) -Ms $DelSw.ElapsedMilliseconds))

    # Check 4: Verify it's gone
    $GoneSw = [System.Diagnostics.Stopwatch]::StartNew()
    $GoneOk = $false
    if ($DeleteOk) {
        $gr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/debates/$DebateId" -TimeoutSec $TimeoutSec -AcceptableStatusCodes @(404)
        $GoneOk = -not $gr.Success -or $gr.StatusCode -eq 404 -or ($gr.Success -and $gr.Body -eq $null)
    }
    $GoneSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Verify debate deleted' -Pass $GoneOk `
        -Detail $(if ($GoneOk) { 'Confirmed removed' } elseif (-not $DeleteOk) { 'Skipped — delete failed' } else { 'Still exists after delete' }) -Ms $GoneSw.ElapsedMilliseconds))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DEB-005' -Domain 'Debate' -Priority 'P2' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
