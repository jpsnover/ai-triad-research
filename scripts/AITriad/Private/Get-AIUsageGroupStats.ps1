# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AIUsageGroupStats {
    <#
    .SYNOPSIS
        Group-AIUsageEntries sub-helper (t/3910): computes the aggregate row
        (tokens, cost, cache savings, avg latency) for one group's entries.
    .PARAMETER Items
        The cost-estimated entries belonging to one group.
    .PARAMETER Pricing
        Pricing lookup, used to estimate the cache-savings delta.
    .OUTPUTS
        [PSCustomObject] { InputTokens; OutputTokens; CachedTokens; TotalCost;
        AvgLatency; CacheSavings }
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Items,

        [Parameter(Mandatory)]
        [hashtable]$Pricing
    )

    Set-StrictMode -Version Latest

    $TotalInput   = ($Items | ForEach-Object { if ($_.PSObject.Properties['promptTokens']) { [long]$_.promptTokens } else { 0 } } | Measure-Object -Sum).Sum
    $TotalOutput  = ($Items | ForEach-Object { if ($_.PSObject.Properties['completionTokens']) { [long]$_.completionTokens } else { 0 } } | Measure-Object -Sum).Sum
    $TotalCached  = ($Items | ForEach-Object { if ($_.PSObject.Properties['cachedTokens']) { [long]$_.cachedTokens } else { 0 } } | Measure-Object -Sum).Sum
    $TotalCost    = ($Items | ForEach-Object { $_.estimatedCost } | Measure-Object -Sum).Sum
    $TotalLatency = ($Items | ForEach-Object { if ($_.PSObject.Properties['latencyMs']) { [long]$_.latencyMs } else { 0 } } | Measure-Object -Sum).Sum
    $AvgLatency   = if ($Items.Count -gt 0) { [int]($TotalLatency / $Items.Count) } else { 0 }

    $CacheSavings = Get-AIUsageCacheSavings -Items $Items -TotalCached $TotalCached -Pricing $Pricing

    [PSCustomObject]@{
        InputTokens  = $TotalInput
        OutputTokens = $TotalOutput
        CachedTokens = $TotalCached
        TotalCost    = $TotalCost
        AvgLatency   = $AvgLatency
        CacheSavings = $CacheSavings
    }
}
