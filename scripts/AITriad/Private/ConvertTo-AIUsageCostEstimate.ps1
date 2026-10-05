# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AIUsageCostEstimate {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): computes per-entry estimated cost
        and attaches it to each entry in place (estimatedCost, hasPricing).
    .PARAMETER Entries
        The parsed usage entries (as returned by Read-AIUsageEntries). Mutated
        in place -- each entry gains estimatedCost/hasPricing members.
    .PARAMETER Pricing
        Pricing lookup from Get-AICostPricing.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries,

        [Parameter(Mandatory)]
        [hashtable]$Pricing
    )

    Set-StrictMode -Version Latest

    foreach ($E in $Entries) {
        $ModelId = if ($E.PSObject.Properties['model']) { $E.model } else { 'unknown' }
        $InputTok  = if ($E.PSObject.Properties['promptTokens']) { [long]$E.promptTokens } else { 0 }
        $OutputTok = if ($E.PSObject.Properties['completionTokens']) { [long]$E.completionTokens } else { 0 }
        $CachedTok = if ($E.PSObject.Properties['cachedTokens']) { [long]$E.cachedTokens } else { 0 }

        $Cost = 0.0
        $PriceInfo = $null

        if ($Pricing.ContainsKey($ModelId)) {
            $PriceInfo = $Pricing[$ModelId]
        }
        else {
            $EBackend = if ($E.PSObject.Properties['backend']) { $E.backend } else { '' }
            $PrefixedId = "$EBackend-$ModelId"
            if ($Pricing.ContainsKey($PrefixedId)) {
                $PriceInfo = $Pricing[$PrefixedId]
            }
        }

        if ($null -ne $PriceInfo) {
            $InputRate  = if ($PriceInfo.PSObject.Properties['inputPer1M'])  { $PriceInfo.inputPer1M }  else { 0 }
            $OutputRate = if ($PriceInfo.PSObject.Properties['outputPer1M']) { $PriceInfo.outputPer1M } else { 0 }
            $CachedRate = if ($PriceInfo.PSObject.Properties['cachedInputPer1M']) { $PriceInfo.cachedInputPer1M } else { $InputRate }

            $UncachedInput = [Math]::Max(0, $InputTok - $CachedTok)
            $Cost = ($UncachedInput * $InputRate / 1000000) + ($CachedTok * $CachedRate / 1000000) + ($OutputTok * $OutputRate / 1000000)
        }

        $E | Add-Member -NotePropertyName 'estimatedCost' -NotePropertyValue $Cost -Force
        $E | Add-Member -NotePropertyName 'hasPricing' -NotePropertyValue ($null -ne $PriceInfo) -Force
    }
}
