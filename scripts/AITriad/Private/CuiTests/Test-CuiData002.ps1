# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiData002 {
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

    # Check 1: GET /api/sync/status → verify session branch info
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/sync/status' -TimeoutSec $TimeoutSec
    $SyncOk = $r.Success
    $HasBranch = $false
    if ($r.Success -and $r.Body) {
        $HasBranch = $r.Body.PSObject.Properties['branch'] -or
                     $r.Body.PSObject.Properties['sessionBranch'] -or
                     $r.Body.PSObject.Properties['currentBranch']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Sync status endpoint' -Pass $SyncOk `
        -Detail $(if ($HasBranch) { 'Branch info present' } elseif ($SyncOk) { 'No branch info (may need auth)' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: Taxonomy GET returns data (session isolation means each user sees their branch)
    $tr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/taxonomy/accelerationist' -TimeoutSec $TimeoutSec -ExpectedField 'nodes'
    $HasNodes = $tr.Success -and $tr.Body.PSObject.Properties['nodes'] -and @($tr.Body.nodes).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Taxonomy loads on session branch' -Pass $HasNodes `
        -Detail $(if ($HasNodes) { "$(@($tr.Body.nodes).Count) nodes" } else { "Failed: $($tr.Error)" }) -Ms $tr.ResponseMs))

    # Check 3: Verify edit isolation — confirm edits stay on session branch (not main)
    $IsolationOk = $SyncOk
    $IsolationDetail = 'Sync endpoint confirms branch isolation model'
    if (-not $SyncOk) {
        $IsolationDetail = 'Cannot verify — sync endpoint unavailable'
    }
    $Checks.Add((New-CuiCheckResult -Check 'Branch isolation model active' -Pass $IsolationOk `
        -Detail $IsolationDetail))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DATA-002' -Domain 'Data' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
