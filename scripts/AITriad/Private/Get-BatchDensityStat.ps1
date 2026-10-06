# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchDensityStat {
    <#
    .SYNOPSIS
        Mean, quartiles, min and max of the per-document claims_per_1k values in an
        extraction-metrics line (t/3910). Every field is $null when no doc has a density.
    .DESCRIPTION
        Percentiles are nearest-rank on the sorted values: index floor(n * p).
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([AllowEmptyCollection()][object[]]$PerDocument = @())

    $Densities = @($PerDocument | Where-Object { $_.claims_per_1k -ne $null } | ForEach-Object { $_.claims_per_1k })
    if ($Densities.Count -eq 0) {
        return @{ mean = $null; p25 = $null; p50 = $null; p75 = $null; min = $null; max = $null }
    }

    $Sorted = $Densities | Sort-Object
    return @{
        mean = [Math]::Round(($Densities | Measure-Object -Average).Average, 2)
        p25  = [Math]::Round($Sorted[[Math]::Floor($Sorted.Count * 0.25)], 2)
        p50  = [Math]::Round($Sorted[[Math]::Floor($Sorted.Count * 0.50)], 2)
        p75  = [Math]::Round($Sorted[[Math]::Floor($Sorted.Count * 0.75)], 2)
        min  = [Math]::Round($Sorted[0], 2)
        max  = [Math]::Round($Sorted[-1], 2)
    }
}
