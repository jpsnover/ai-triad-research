# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyPovImbalanceSignals {
    <#
    .SYNOPSIS
        TaxoAdapt POV-normalized coverage-imbalance signal: for each category, compares each
        POV's node count against the MEAN across the 3 POVs (t/3910 extraction from
        Get-TaxonomyHealthData). A POV below 60% of the mean is under-represented; above 160%
        is over-represented (flagged as a caution against further expansion there).
    .OUTPUTS
        [object[]] density-signal objects (signal='pov_imbalance_under'|'pov_imbalance_over').
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][hashtable]$CoverageBalance
    )

    Set-StrictMode -Version Latest

    $Categories = @('Beliefs', 'Desires', 'Intentions')
    $PovKeys    = @('accelerationist', 'safetyist', 'skeptic')
    $Signals = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Cat in $Categories) {
        $Counts = @($PovKeys | ForEach-Object { $CoverageBalance[$_][$Cat] })
        $Mean = ($Counts | Measure-Object -Average).Average
        if ($Mean -eq 0) { continue }

        foreach ($Pov in $PovKeys) {
            $Count = $CoverageBalance[$Pov][$Cat]
            $Ratio = $Count / $Mean

            if ($Ratio -lt 0.6) {
                $Signals.Add([PSCustomObject][ordered]@{
                    signal   = 'pov_imbalance_under'
                    node_id  = $null
                    pov      = $Pov
                    category = $Cat
                    label    = "$Pov/$Cat"
                    metric   = [Math]::Round($Ratio, 2)
                    detail   = "$Pov has $Count nodes in $Cat vs mean $([Math]::Round($Mean, 1)) ($([Math]::Round($Ratio * 100))% of mean)"
                })
            }
            elseif ($Ratio -gt 1.6) {
                $Signals.Add([PSCustomObject][ordered]@{
                    signal   = 'pov_imbalance_over'
                    node_id  = $null
                    pov      = $Pov
                    category = $Cat
                    label    = "$Pov/$Cat"
                    metric   = [Math]::Round($Ratio, 2)
                    detail   = "$Pov has $Count nodes in $Cat vs mean $([Math]::Round($Mean, 1)) ($([Math]::Round($Ratio * 100))% of mean) — expansion here would INCREASE imbalance"
                })
            }
        }
    }

    return $Signals.ToArray()
}
