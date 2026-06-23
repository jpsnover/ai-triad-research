# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax011 {
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

    # Check 1: GET /api/sync/status returns sync state
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/sync/status' -TimeoutSec $TimeoutSec
    $StatusOk = $r.Success
    $HasBranch = $false
    if ($r.Success -and $r.Body) {
        $HasBranch = $r.Body.PSObject.Properties['branch'] -or
                     $r.Body.PSObject.Properties['sessionBranch'] -or
                     $r.Body.PSObject.Properties['currentBranch']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Sync status endpoint' -Pass $StatusOk `
        -Detail $(if ($HasBranch) { 'Branch info present' } elseif ($StatusOk) { 'Status loaded (no branch info)' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /api/sync/unsynced returns file list
    $ur = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/sync/unsynced' -TimeoutSec $TimeoutSec
    $UnsyncedOk = $ur.Success
    $Checks.Add((New-CuiCheckResult -Check 'Unsynced files endpoint' -Pass $UnsyncedOk `
        -Detail $(if ($UnsyncedOk) { 'Unsynced list loaded' } else { "Failed: $($ur.Error)" }) -Ms $ur.ResponseMs))

    # Check 3: GET /api/sync/node-diff returns diff data
    $dr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/sync/node-diff' -TimeoutSec $TimeoutSec
    $DiffOk = $dr.Success
    $Checks.Add((New-CuiCheckResult -Check 'Node diff endpoint' -Pass $DiffOk `
        -Detail $(if ($DiffOk) { 'Diff data loaded' } else { "Failed: $($dr.Error)" }) -Ms $dr.ResponseMs))

    # Check 4: POST /api/sync/commit — test that commit endpoint accepts requests (won't actually commit without changes)
    $CommitSw = [System.Diagnostics.Stopwatch]::StartNew()
    $CommitAccessible = $false
    try {
        $CommitBody = @{ message = 'CUI test — no-op probe' } | ConvertTo-Json -Compress
        $CommitResp = Invoke-WebRequest -Uri "$BaseUrl/api/sync/commit" -Method POST `
            -Body $CommitBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $CommitAccessible = $true
    } catch {
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        $CommitAccessible = $StatusCode -in @(200, 400, 409)
    }
    $CommitSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Commit endpoint accessible' -Pass $CommitAccessible `
        -Detail $(if ($CommitAccessible) { 'Endpoint reachable' } else { 'Commit endpoint unreachable' }) -Ms $CommitSw.ElapsedMilliseconds))

    # Check 5: POST /api/sync/create-pr — test that PR creation endpoint is accessible
    $PrSw = [System.Diagnostics.Stopwatch]::StartNew()
    $PrAccessible = $false
    try {
        $PrBody = @{ title = 'CUI test probe'; body = 'Probe only — no PR created' } | ConvertTo-Json -Compress
        $PrResp = Invoke-WebRequest -Uri "$BaseUrl/api/sync/create-pr" -Method POST `
            -Body $PrBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $PrAccessible = $true
    } catch {
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        $PrAccessible = $StatusCode -in @(200, 400, 401, 403, 409)
    }
    $PrSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'PR creation endpoint accessible' -Pass $PrAccessible `
        -Detail $(if ($PrAccessible) { 'Endpoint reachable' } else { 'PR endpoint unreachable' }) -Ms $PrSw.ElapsedMilliseconds))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-TAX-011' -Domain 'Taxonomy' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
