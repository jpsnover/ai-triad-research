# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AIUsageCostEstimate {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): computes per-entry estimated cost
        and attaches it to each entry in place (estimatedCost, hasPricing).
    .DESCRIPTION
        t/3947: when a pricing entry has no cachedInputPer1M, cached tokens are
        costed at the full input rate (the same fallback registry.ts's
        findPricingMissingCacheRate warns about on the TS side, t/3945). That
        fallback can overstate cost silently, so this now emits one WARN per
        model id per call (fallback-path logging, root AGENTS.md) the first
        time a model hits it -- not once per usage entry, to avoid a WARN
        flood on a report covering thousands of calls for the same model.
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

    $WarnedModels = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($E in $Entries) {
        $ModelId = if ($E.PSObject.Properties['model']) { $E.model } else { 'unknown' }
        $InputTok  = if ($E.PSObject.Properties['promptTokens']) { [long]$E.promptTokens } else { 0 }
        $OutputTok = if ($E.PSObject.Properties['completionTokens']) { [long]$E.completionTokens } else { 0 }
        $CachedTok = if ($E.PSObject.Properties['cachedTokens']) { [long]$E.cachedTokens } else { 0 }

        $Cost = 0.0
        $PriceInfo = $null
        $ResolvedId = $null

        if ($Pricing.ContainsKey($ModelId)) {
            $PriceInfo = $Pricing[$ModelId]
            $ResolvedId = $ModelId
        }
        else {
            $EBackend = if ($E.PSObject.Properties['backend']) { $E.backend } else { '' }
            $PrefixedId = "$EBackend-$ModelId"
            if ($Pricing.ContainsKey($PrefixedId)) {
                $PriceInfo = $Pricing[$PrefixedId]
                $ResolvedId = $PrefixedId
            }
        }

        if ($null -ne $PriceInfo) {
            $InputRate  = if ($PriceInfo.PSObject.Properties['inputPer1M'])  { $PriceInfo.inputPer1M }  else { 0 }
            $OutputRate = if ($PriceInfo.PSObject.Properties['outputPer1M']) { $PriceInfo.outputPer1M } else { 0 }
            if ($PriceInfo.PSObject.Properties['cachedInputPer1M']) {
                $CachedRate = $PriceInfo.cachedInputPer1M
            }
            else {
                $CachedRate = $InputRate
                if ($WarnedModels.Add($ResolvedId)) {
                    Write-Warning "ConvertTo-AIUsageCostEstimate: '$ResolvedId' has no cachedInputPer1M -- falling back to the full input rate ($InputRate/1M) for cached tokens, which may overstate cost (t/3947)."
                }
            }

            $UncachedInput = [Math]::Max(0, $InputTok - $CachedTok)
            $Cost = ($UncachedInput * $InputRate / 1000000) + ($CachedTok * $CachedRate / 1000000) + ($OutputTok * $OutputRate / 1000000)
        }

        $E | Add-Member -NotePropertyName 'estimatedCost' -NotePropertyValue $Cost -Force
        $E | Add-Member -NotePropertyName 'hasPricing' -NotePropertyValue ($null -ne $PriceInfo) -Force
    }
}
