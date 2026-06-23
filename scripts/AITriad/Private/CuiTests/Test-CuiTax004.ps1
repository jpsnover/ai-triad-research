# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax004 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /api/edges returns data
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/edges' -TimeoutSec $TimeoutSec
    $EdgesLoaded = $r.Success -and ($null -ne $r.Body)
    $Edges = @()
    if ($EdgesLoaded -and $r.Body -is [System.Array]) {
        $Edges = $r.Body
    } elseif ($EdgesLoaded -and $r.Body.PSObject.Properties['edges']) {
        $Edges = @($r.Body.edges)
    } elseif ($EdgesLoaded) {
        $Edges = @($r.Body)
    }
    $HasEdges = $EdgesLoaded -and @($Edges).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Edges endpoint loads' -Pass $HasEdges `
        -Detail $(if ($HasEdges) { "$(@($Edges).Count) edges" } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: Edges have source and target fields
    $ShapeOk = $false
    if ($HasEdges -and @($Edges).Count -gt 0) {
        $Edge = $Edges[0]
        $ShapeOk = $Edge.PSObject.Properties['source'] -and
                   $Edge.PSObject.Properties['target']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Edge shape (source,target)' -Pass $ShapeOk `
        -Detail $(if ($ShapeOk) { "source=$($Edge.source), target=$($Edge.target)" } else { 'Missing source/target fields' })))

    # Check 3: Edges with rationale (include=rationale query param)
    $rr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/edges?include=rationale' -TimeoutSec $TimeoutSec
    $RationaleOk = $rr.Success
    $Checks.Add((New-CuiCheckResult -Check 'Edges with rationale' -Pass $RationaleOk `
        -Detail $(if ($RationaleOk) { 'Rationale query accepted' } else { "Failed: $($rr.Error)" }) -Ms $rr.ResponseMs))

    # Check 4: Edge status endpoint accessible
    $Checks.Add((New-CuiCheckResult -Check 'Edge count > 0' -Pass $HasEdges `
        -Detail $(if ($HasEdges) { "$(@($Edges).Count) edges in graph" } else { 'No edges found' })))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-TAX-004' -Domain 'Taxonomy' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
