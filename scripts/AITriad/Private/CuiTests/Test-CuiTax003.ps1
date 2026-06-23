# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax003 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: Taxonomy loads (search is client-side — need data to search)
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/taxonomy/accelerationist' -TimeoutSec $TimeoutSec -ExpectedField 'nodes'
    $HasNodes = $r.Success -and $r.Body.PSObject.Properties['nodes'] -and @($r.Body.nodes).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Taxonomy data loads' -Pass $HasNodes `
        -Detail $(if ($HasNodes) { "$(@($r.Body.nodes).Count) nodes" } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: Nodes have searchable fields (label, description)
    $SearchableOk = $false
    if ($HasNodes) {
        $Node = $r.Body.nodes[0]
        $SearchableOk = $Node.PSObject.Properties['label'] -and
                        $Node.PSObject.Properties['description'] -and
                        $Node.label.Length -gt 0
    }
    $Checks.Add((New-CuiCheckResult -Check 'Nodes have searchable fields' -Pass $SearchableOk `
        -Detail $(if ($SearchableOk) { "label='$($Node.label.Substring(0, [Math]::Min(40, $Node.label.Length)))'" } else { 'Missing label or description' })))

    # Check 3: Multiple POVs available for cross-POV search
    $PovCount = 0
    foreach ($Pov in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $pr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/taxonomy/$Pov" -TimeoutSec $TimeoutSec -ExpectedField 'nodes'
        if ($pr.Success -and $pr.Body.PSObject.Properties['nodes'] -and @($pr.Body.nodes).Count -gt 0) {
            $PovCount++
        }
    }
    $AllPovOk = $PovCount -eq 4
    $Checks.Add((New-CuiCheckResult -Check 'Cross-POV search data available' -Pass $AllPovOk `
        -Detail "$PovCount/4 POVs loaded"))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-TAX-003' -Domain 'Taxonomy' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
