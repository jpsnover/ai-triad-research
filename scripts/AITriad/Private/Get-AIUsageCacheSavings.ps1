# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AIUsageCacheSavings {
    <#
    .SYNOPSIS
        Get-AIUsageGroupStats sub-helper (t/3910): estimates the $ saved by
        cached-token pricing vs. full-rate pricing for one group, sampled from
        a single priced entry in that group.
    .DESCRIPTION
        t/3968: uses the sample entry's resolvedPricingId (set by
        ConvertTo-AIUsageCostEstimate, t/3951) rather than re-resolving by the
        entry's bare model/apiModelId field. Re-resolving independently is how
        this helper and the cost estimator drifted before t/3951 existed to
        fix exactly that class of bug for the main cost figure -- reusing the
        already-resolved id means this can never diverge from it again.
    .PARAMETER Items
        The group's entries. Each must already have been through
        ConvertTo-AIUsageCostEstimate (hasPricing/resolvedPricingId set).
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

    $SResolvedId = if ($SampleEntry.PSObject.Properties['resolvedPricingId']) { $SampleEntry.resolvedPricingId } else { $null }
    if (-not $SResolvedId -or -not $Pricing.ContainsKey($SResolvedId)) { return 0.0 }

    $SPricing = $Pricing[$SResolvedId]
    $FullRate   = if ($SPricing.PSObject.Properties['inputPer1M']) { $SPricing.inputPer1M } else { 0 }
    $CachedRate = if ($SPricing.PSObject.Properties['cachedInputPer1M']) { $SPricing.cachedInputPer1M } else { $FullRate }

    return $TotalCached * ($FullRate - $CachedRate) / 1000000
}
