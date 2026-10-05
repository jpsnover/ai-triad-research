# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Group-AIUsageEntries {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): groups cost-estimated entries by
        the requested key and aggregates per-group totals.
    .PARAMETER Entries
        Cost-estimated entries (post ConvertTo-AIUsageCostEstimate).
    .PARAMETER GroupBy
        Model, Session, Date, or Backend.
    .PARAMETER Pricing
        Pricing lookup, used for the cache-savings estimate per group.
    .OUTPUTS
        [System.Collections.Generic.List[PSObject]] -- one row per group.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries,

        [Parameter(Mandatory)]
        [ValidateSet('Model', 'Session', 'Date', 'Backend')]
        [string]$GroupBy,

        [Parameter(Mandatory)]
        [hashtable]$Pricing
    )

    Set-StrictMode -Version Latest

    # Data-driven group-key extractors, replacing a switch ladder (t/3910).
    $GroupKeyExtractors = @{
        Model   = { param($e) if ($e.PSObject.Properties['model']) { $e.model } else { 'unknown' } }
        Session = { param($e) if ($e.PSObject.Properties['session']) { $e.session } else { 'unknown' } }
        Date    = { param($e) if ($e.parsedTs) { $e.parsedTs.ToString('yyyy-MM-dd') } else { 'unknown' } }
        Backend = { param($e) if ($e.PSObject.Properties['backend']) { $e.backend } else { 'unknown' } }
    }
    $GroupKey = $GroupKeyExtractors[$GroupBy]

    $Groups = @{}
    foreach ($E in $Entries) {
        $Key = & $GroupKey $E
        if (-not $Groups.ContainsKey($Key)) {
            $Groups[$Key] = [System.Collections.Generic.List[PSObject]]::new()
        }
        $Groups[$Key].Add($E)
    }

    $Aggregated = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Key in ($Groups.Keys | Sort-Object)) {
        $Items = $Groups[$Key]
        $Stats = Get-AIUsageGroupStats -Items $Items -Pricing $Pricing

        $Aggregated.Add([PSCustomObject]@{
            Group         = $Key
            Calls         = $Items.Count
            InputTokens   = $Stats.InputTokens
            OutputTokens  = $Stats.OutputTokens
            CachedTokens  = $Stats.CachedTokens
            TotalTokens   = $Stats.InputTokens + $Stats.OutputTokens
            EstimatedCost = [Math]::Round($Stats.TotalCost, 4)
            CacheSavings  = [Math]::Round($Stats.CacheSavings, 4)
            AvgLatencyMs  = $Stats.AvgLatency
        })
    }

    # -NoEnumerate: see Read-AIUsageEntries for why a bare `return` here would
    # risk losing the List on enumeration for 0/1-element results.
    Write-Output -NoEnumerate $Aggregated
}
