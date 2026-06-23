# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAi003 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /api/proxy/tier returns tier info
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/proxy/tier' -TimeoutSec $TimeoutSec
    $TierOk = $r.Success -and ($null -ne $r.Body)
    $TierName = ''
    if ($TierOk -and $r.Body.PSObject.Properties['tier']) {
        $TierName = $r.Body.tier
    }
    $Checks.Add((New-CuiCheckResult -Check 'Tier endpoint returns data' -Pass $TierOk `
        -Detail $(if ($TierName) { "tier=$TierName" } elseif ($TierOk) { 'Tier info loaded' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /api/proxy/usage returns usage stats
    $ur = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/proxy/usage' -TimeoutSec $TimeoutSec
    $UsageOk = $ur.Success -and ($null -ne $ur.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Usage stats endpoint' -Pass $UsageOk `
        -Detail $(if ($UsageOk) { 'Usage data loaded' } else { "Failed: $($ur.Error)" }) -Ms $ur.ResponseMs))

    # Check 3: GET /api/backends/available returns backend list
    $br = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/backends/available' -TimeoutSec $TimeoutSec
    $BackendsOk = $br.Success -and ($null -ne $br.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Available backends list' -Pass $BackendsOk `
        -Detail $(if ($BackendsOk) { "$(@($br.Body).Count) backends" } else { "Failed: $($br.Error)" }) -Ms $br.ResponseMs))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-AI-003' -Domain 'AI' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
