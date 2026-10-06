# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-PovCategoryCoverage {
    <#
    .SYNOPSIS
        Node counts per POV x category, over the 3 debating POVs and the Beliefs/Desires/
        Intentions categories (t/3910 extraction from Get-TaxonomyHealthData).
    .OUTPUTS
        [hashtable] POV -> (category -> count).
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][object[]]$AllNodes
    )

    Set-StrictMode -Version Latest

    $Categories = @('Beliefs', 'Desires', 'Intentions')
    $CoverageBalance = @{}

    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        $CoverageBalance[$PovKey] = @{}
        foreach ($Cat in $Categories) {
            $Count = @($AllNodes | Where-Object { $_.POV -eq $PovKey -and $_.Category -eq $Cat }).Count
            $CoverageBalance[$PovKey][$Cat] = $Count
        }
    }

    return $CoverageBalance
}
