# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax005 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: GET /api/policy-registry returns data
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/policy-registry' -TimeoutSec $TimeoutSec
    $RegistryOk = $r.Success -and ($null -ne $r.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Policy registry loads' -Pass $RegistryOk `
        -Detail $(if ($RegistryOk) { 'Registry loaded' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: GET /api/lineage-categories returns data
    $lr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/lineage-categories' -TimeoutSec $TimeoutSec
    $LineageOk = $lr.Success -and ($null -ne $lr.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Lineage categories load' -Pass $LineageOk `
        -Detail $(if ($LineageOk) { 'Categories loaded' } else { "Failed: $($lr.Error)" }) -Ms $lr.ResponseMs))

    # Check 3: GET /api/lineage-info returns enrichment data
    $li = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/lineage-info' -TimeoutSec $TimeoutSec
    $EnrichOk = $li.Success -and ($null -ne $li.Body)
    $Checks.Add((New-CuiCheckResult -Check 'Lineage enrichments load' -Pass $EnrichOk `
        -Detail $(if ($EnrichOk) { 'Enrichments loaded' } else { "Failed: $($li.Error)" }) -Ms $li.ResponseMs))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-TAX-005' -Domain 'Taxonomy' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
