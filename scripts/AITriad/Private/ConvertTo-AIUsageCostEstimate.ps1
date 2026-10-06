# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AIUsageCostEstimate {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): computes per-entry estimated cost
        and attaches it to each entry in place (estimatedCost, hasPricing).
    .DESCRIPTION
        t/3951 (binding design t/3946#5, SO e/248): resolves each entry's
        pricing key in this order, matching the TS reader:
          1. An exact `modelId` field on the record (set by DebateTool,
             t/3950) -> pricing[modelId] directly. No further fallback --
             modelId is authoritative; if pricing lacks it, unresolved.
          2. Legacy records (no modelId): (backend, apiModelId) ->
             models[].id via Get-AICostPricing's ApiModelIdMap, then
             pricing[id]. Never looks up a bare apiModelId directly --
             `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini` are each
             shared by 2 backends (azure/openai) on origin/main, so a bare
             lookup could silently pick the wrong backend's price.
          3. No backend, or (backend, apiModelId) not in the map: UNRESOLVED
             -- never a first-match guess, never priced at $0 silently (SO
             condition e/248#4). WARNs once per model id per call.
        The old `<backend>-<model>` string-concat fallback is dropped: it
        resolves 0 pricing keys on origin/main and only caused PS to
        diverge from the TS reader's resolution.

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
    .PARAMETER ApiModelIdMap
        "<backend>|<apiModelId>" -> models[].id map from Get-AICostPricing.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries,

        [Parameter(Mandatory)]
        [hashtable]$Pricing,

        [Parameter(Mandatory)]
        [hashtable]$ApiModelIdMap
    )

    Set-StrictMode -Version Latest

    $WarnedModels = [System.Collections.Generic.HashSet[string]]::new()
    $UnresolvedWarned = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($E in $Entries) {
        $ModelId = if ($E.PSObject.Properties['model']) { $E.model } else { 'unknown' }
        $InputTok  = if ($E.PSObject.Properties['promptTokens']) { [long]$E.promptTokens } else { 0 }
        $OutputTok = if ($E.PSObject.Properties['completionTokens']) { [long]$E.completionTokens } else { 0 }
        $CachedTok = if ($E.PSObject.Properties['cachedTokens']) { [long]$E.cachedTokens } else { 0 }

        $Cost = 0.0
        $PriceInfo = $null
        $ResolvedId = $null

        $RecordModelId = if ($E.PSObject.Properties['modelId']) { $E.modelId } else { $null }
        if ($RecordModelId) {
            $ResolvedId = $RecordModelId
        }
        else {
            $EBackend = if ($E.PSObject.Properties['backend']) { $E.backend } else { $null }
            if ($EBackend) {
                $MapKey = "$EBackend|$ModelId"
                if ($ApiModelIdMap.ContainsKey($MapKey)) {
                    $ResolvedId = $ApiModelIdMap[$MapKey]
                }
            }
        }

        if ($ResolvedId -and $Pricing.ContainsKey($ResolvedId)) {
            $PriceInfo = $Pricing[$ResolvedId]
        }
        elseif ($UnresolvedWarned.Add($ModelId)) {
            Write-Warning "ConvertTo-AIUsageCostEstimate: '$ModelId' (backend: $(if ($E.PSObject.Properties['backend']) { $E.backend } else { '<none>' })) could not be resolved to a pricing key -- reporting as unresolved (estimatedCost=0, hasPricing=false), never a guessed match (t/3951)."
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
