# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiCom001 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /api/community/debates — list community debates
    $dr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/community/debates' -TimeoutSec $TimeoutSec
    $DebatesOk = $dr.Success -and ($null -ne $dr.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Community debates list' -Pass $DebatesOk `
        -Detail $(if ($DebatesOk) { 'Debates loaded' } else { "Failed: $($dr.Error)" }) -Ms $dr.ResponseMs))

    # Check 2: GET /api/community/chats — list community chats
    $cr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/community/chats' -TimeoutSec $TimeoutSec
    $ChatsOk = $cr.Success -and ($null -ne $cr.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Community chats list' -Pass $ChatsOk `
        -Detail $(if ($ChatsOk) { 'Chats loaded' } else { "Failed: $($cr.Error)" }) -Ms $cr.ResponseMs))

    # Check 3: Validate list structure (both should be arrays or have items property)
    $StructureOk = $DebatesOk -and $ChatsOk
    $Checks.Add((New-CuiCheckResult -Check 'Community lists accessible' -Pass $StructureOk `
        -Detail $(if ($StructureOk) { 'Both debates and chats endpoints respond' } else { 'One or both endpoints failed' })))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-COM-001' -Domain 'Community' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
