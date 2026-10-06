# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-HubConcentration {
    <#
    .SYNOPSIS
        Degree-distribution concentration (Gini coefficient) across all POV nodes, plus max
        and median degree (t/3910 extraction from Get-TaxonomyHealthData's GraphMode
        metrics). Nodes with zero edges are included at degree 0.
    .OUTPUTS
        [hashtable] [ordered]{ GiniCoefficient; MaxDegree; MedianDegree }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ApprovedEdges,
        [Parameter(Mandatory)][hashtable]$NodePovLookup
    )

    Set-StrictMode -Version Latest

    $DegreeMap = @{}
    foreach ($NId in $NodePovLookup.Keys) { $DegreeMap[$NId] = 0 }
    foreach ($Edge in $ApprovedEdges) {
        if ($DegreeMap.ContainsKey($Edge.source)) { $DegreeMap[$Edge.source]++ }
        if ($DegreeMap.ContainsKey($Edge.target)) { $DegreeMap[$Edge.target]++ }
    }

    $Degrees = @($DegreeMap.Values | Sort-Object)
    $N = $Degrees.Count
    $GiniCoeff = 0.0
    if ($N -gt 0) {
        $SumDiff = 0.0
        $SumAll  = 0.0
        for ($i = 0; $i -lt $N; $i++) {
            $SumAll += $Degrees[$i]
            for ($j = 0; $j -lt $N; $j++) {
                $SumDiff += [Math]::Abs($Degrees[$i] - $Degrees[$j])
            }
        }
        if ($SumAll -gt 0) { $GiniCoeff = [Math]::Round($SumDiff / (2 * $N * $SumAll), 4) }
    }

    if ($Degrees.Count -gt 0) { $MaxDeg = $Degrees[-1] } else { $MaxDeg = 0 }
    if ($Degrees.Count -gt 0) { $MedDeg = $Degrees[[Math]::Floor($Degrees.Count / 2)] } else { $MedDeg = 0 }

    return [ordered]@{
        GiniCoefficient = $GiniCoeff
        MaxDegree       = $MaxDeg
        MedianDegree    = $MedDeg
    }
}
