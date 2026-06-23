# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax001 {
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
    $DataAvail = $r.Success -and $r.Body.available -eq $true
    $Checks.Add((New-CuiCheckResult -Check 'Data available' -Pass $DataAvail `
        -Detail $(if ($DataAvail) { 'available=true' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Checks 2-5: Each POV file loads with nodes > 0
    foreach ($Pov in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/taxonomy/$Pov" -TimeoutSec $TimeoutSec -ExpectedField 'nodes'
        $NodeCount = 0
        if ($r.Success -and $r.Body.PSObject.Properties['nodes']) {
            $NodeCount = @($r.Body.nodes).Count
        }
        $Pass = $r.Success -and $NodeCount -gt 0
        $Checks.Add((New-CuiCheckResult -Check "$Pov nodes" -Pass $Pass `
            -Detail $(if ($Pass) { "$NodeCount nodes" } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))
    }

    # Check 6: Validate node shape (id, label, category) on first POV
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/taxonomy/accelerationist' -TimeoutSec $TimeoutSec
    $ShapeOk = $false
    if ($r.Success -and $r.Body.PSObject.Properties['nodes'] -and @($r.Body.nodes).Count -gt 0) {
        $Node = $r.Body.nodes[0]
        $ShapeOk = $Node.PSObject.Properties['id'] -and
                   $Node.PSObject.Properties['label'] -and
                   $Node.PSObject.Properties['category']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Node shape (id,label,category)' -Pass $ShapeOk `
        -Detail $(if ($ShapeOk) { 'Valid' } else { 'Missing required fields' }) -Ms $r.ResponseMs))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-TAX-001' -Domain 'Taxonomy' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
