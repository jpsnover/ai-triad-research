# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AIUsageCacheSavings {
    <#
    .SYNOPSIS
        Get-AIUsageGroupStats sub-helper (t/3910): estimates the $ saved by
        cached-token pricing vs. full-rate pricing for one group, sampled from
        a single priced entry in that group.
    .PARAMETER Items
        The group's entries.
    .PARAMETER TotalCached
        Total cached tokens across the group (0 short-circuits to no savings).
    .PARAMETER Pricing
        Pricing lookup.
    .OUTPUTS
        [double]
    #>
    [CmdletBinding()]
    [OutputType([double])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Items,

        [Parameter(Mandatory)]
        [long]$TotalCached,

        [Parameter(Mandatory)]
        [hashtable]$Pricing
    )

    Set-StrictMode -Version Latest

    if ($TotalCached -le 0) { return 0.0 }

    $SampleEntry = $Items | Where-Object { $_.hasPricing } | Select-Object -First 1
    if (-not $SampleEntry) { return 0.0 }

    $SModelId = if ($SampleEntry.PSObject.Properties['model']) { $SampleEntry.model } else { '' }
    if (-not $Pricing.ContainsKey($SModelId)) { return 0.0 }

    $SPricing = $Pricing[$SModelId]
    $FullRate   = if ($SPricing.PSObject.Properties['inputPer1M']) { $SPricing.inputPer1M } else { 0 }
    $CachedRate = if ($SPricing.PSObject.Properties['cachedInputPer1M']) { $SPricing.cachedInputPer1M } else { $FullRate }

    return $TotalCached * ($FullRate - $CachedRate) / 1000000
}
