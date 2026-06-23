# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAdm004 {
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

    # Check 1: POST /api/flight-recorder/dump — submit a test flight recorder dump
    $DumpSw = [System.Diagnostics.Stopwatch]::StartNew()
    $DumpOk = $false
    try {
        $DumpBody = @{
            events = @(
                @{ type = 'cui.test'; message = 'CUI test flight recorder probe'; timestamp = (Get-Date -Format 'o') }
            )
            metadata = @{ source = 'cui-test' }
        } | ConvertTo-Json -Depth 4 -Compress
        $DumpResp = Invoke-WebRequest -Uri "$BaseUrl/api/flight-recorder/dump" -Method POST `
            -Body $DumpBody -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $DumpOk = $DumpResp.StatusCode -eq 200
    } catch { }
    $DumpSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Submit flight recorder dump' -Pass $DumpOk `
        -Detail $(if ($DumpOk) { 'Dump accepted' } else { 'Dump failed' }) -Ms $DumpSw.ElapsedMilliseconds))

    # Check 2: GET /api/flight-recorder/list — list available dumps
    $lr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/flight-recorder/list' -TimeoutSec $TimeoutSec
    $ListOk = $lr.Success -and ($null -ne $lr.Body)
    $Checks.Add((New-CuiCheckResult -Check 'List flight recorder dumps' -Pass $ListOk `
        -Detail $(if ($ListOk) { 'Dump list loaded' } else { "Failed: $($lr.Error)" }) -Ms $lr.ResponseMs))

    # Check 3: Validate list structure (should be array or have files property)
    $StructureOk = $false
    if ($ListOk) {
        if ($lr.Body -is [System.Array]) {
            $StructureOk = $true
        } elseif ($lr.Body.PSObject.Properties['files']) {
            $StructureOk = $true
        }
    }
    $Checks.Add((New-CuiCheckResult -Check 'Dump list structure valid' -Pass $StructureOk `
        -Detail $(if ($StructureOk) { 'Valid list structure' } elseif ($ListOk) { 'Unexpected structure' } else { 'No data to validate' })))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-ADM-004' -Domain 'Admin' -Priority 'P2' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
