# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiData001 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /api/data/available → { available: true }
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/data/available' -TimeoutSec $TimeoutSec -ExpectedField 'available'
    $Available = $r.Success -and $r.Body.PSObject.Properties['available'] -and $r.Body.available -eq $true
    $Checks.Add((New-CuiCheckResult -Check 'Data available' -Pass $Available `
        -Detail $(if ($Available) { 'available=true' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /health → verify github.rateLimit is present and remaining > 0
    $hr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/health' -TimeoutSec $TimeoutSec -ExpectedField 'status'
    $RateLimitOk = $false
    if ($hr.Success -and $hr.Body -and $hr.Body.PSObject.Properties['github']) {
        $gh = $hr.Body.github
        if ($gh.PSObject.Properties['rateLimit']) {
            $rl = $gh.rateLimit
            if ($rl.PSObject.Properties['remaining']) {
                $RateLimitOk = [int]$rl.remaining -gt 0
            }
        }
    }
    $Checks.Add((New-CuiCheckResult -Check 'GitHub rate limit remaining > 0' -Pass $RateLimitOk `
        -Detail $(if ($RateLimitOk) { "remaining=$($rl.remaining)" } elseif ($hr.Success) { 'Rate limit info not found in /health' } else { "Failed: $($hr.Error)" }) -Ms $hr.ResponseMs))

    # Check 3: All four POV GETs return non-empty (validated via TAX-001 overlap)
    $AllPovOk = $true
    $PovDetail = ''
    foreach ($Pov in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $pr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/taxonomy/$Pov" -TimeoutSec $TimeoutSec -ExpectedField 'nodes'
        $NodeCount = 0
        if ($pr.Success -and $pr.Body.PSObject.Properties['nodes']) {
            $NodeCount = @($pr.Body.nodes).Count
        }
        if ($NodeCount -eq 0) {
            $AllPovOk = $false
            $PovDetail = "$Pov has 0 nodes"
            break
        }
    }
    if ($AllPovOk) { $PovDetail = 'All 4 POVs loaded' }
    $Checks.Add((New-CuiCheckResult -Check 'All POV files populated' -Pass $AllPovOk `
        -Detail $PovDetail))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DATA-001' -Domain 'Data' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
