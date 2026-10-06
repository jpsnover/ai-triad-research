# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchSummaryFileStat {
    <#
    .SYNOPSIS
        Counts a written summary's key points (across the three camps), factual claims and
        unmapped concepts, for Invoke-BatchSummary's FIRE-path report (t/3910).
    .DESCRIPTION
        A missing summary file counts as zero everywhere. Returns
        @{ TotalPoints; FactualCount; UnmappedCount }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][string]$SummaryPath)

    if (Test-Path $SummaryPath) { $SumData = Get-Content -Raw $SummaryPath | ConvertFrom-Json } else { $SumData = $null }

    $TotalPts = 0
    foreach ($c in @('accelerationist','safetyist','skeptic')) {
        $TotalPts += @(Get-BatchCampKeyPoint -Summary $SumData -Camp $c).Count
    }
    if ($SumData -and $SumData.factual_claims) { $FcCount = @($SumData.factual_claims).Count } else { $FcCount = 0 }
    if ($SumData -and $SumData.unmapped_concepts) { $UcCount = @($SumData.unmapped_concepts).Count } else { $UcCount = 0 }

    return @{ TotalPoints = $TotalPts; FactualCount = $FcCount; UnmappedCount = $UcCount }
}
