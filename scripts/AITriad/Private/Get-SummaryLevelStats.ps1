# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-SummaryLevelStats {
    <#
    .SYNOPSIS
        Aggregate statistics across all parsed summaries (t/3910 extraction from
        Get-TaxonomyHealthData).
    .OUTPUTS
        [hashtable] { TotalDocs; TotalKeyPoints; TotalClaims; TotalUnmapped; AvgKeyPoints;
        MaxKeyPointsDoc; MinKeyPointsDoc; PerDoc }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][System.Collections.Generic.List[PSObject]]$SummaryStats
    )

    Set-StrictMode -Version Latest

    $TotalKeyPoints = ($SummaryStats | Measure-Object -Property KeyPoints -Sum).Sum
    $TotalClaims    = ($SummaryStats | Measure-Object -Property FactualClaims -Sum).Sum
    $TotalUnmapped  = ($SummaryStats | Measure-Object -Property UnmappedCount -Sum).Sum
    if ($SummaryStats.Count -gt 0) {
        $AvgKeyPoints = [math]::Round($TotalKeyPoints / $SummaryStats.Count, 1)
    } else {
        $AvgKeyPoints = 0
    }

    $MaxDoc = $SummaryStats | Sort-Object { $_.KeyPoints } -Descending | Select-Object -First 1
    $MinDoc = $SummaryStats | Sort-Object { $_.KeyPoints } | Select-Object -First 1

    return @{
        TotalDocs       = $SummaryStats.Count
        TotalKeyPoints  = $TotalKeyPoints
        TotalClaims     = $TotalClaims
        TotalUnmapped   = $TotalUnmapped
        AvgKeyPoints    = $AvgKeyPoints
        MaxKeyPointsDoc = $MaxDoc
        MinKeyPointsDoc = $MinDoc
        PerDoc          = $SummaryStats.ToArray()
    }
}
