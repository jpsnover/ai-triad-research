# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AICostPricing {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): loads per-model pricing from
        ai-models.json and builds the model-id -> backend lookup.
    .OUTPUTS
        [PSCustomObject] { Pricing; ModelBackend; ApiModelIdMap } -- Pricing is a
        hashtable keyed by model id (pricing rows); ModelBackend maps model id ->
        backend; ApiModelIdMap is a NESTED map, $ApiModelIdMap[backend][apiModelId]
        -> model id (t/3951). Nested, not a "<backend>|<apiModelId>" joined-string
        key, to rule out a delimiter-collision class entirely -- the same reason
        CodeQL flagged a joined-string key high in #2826 (js/incomplete-sanitization;
        CodeQL doesn't scan PowerShell, so this must be caught by review instead).

        If two DIFFERENT models ever share a (backend, apiModelId) pair, that pair
        resolves to $script:AmbiguousPricingKeyMarker instead of either model's id
        -- never last-write-wins. (backend, apiModelId) is a function on today's
        ai-models.json (verified: the only 4 shared apiModelIds -- gpt-4o,
        gpt-4o-mini, gpt-4.1, gpt-4.1-mini -- are shared across DIFFERENT backends,
        azure vs openai, never the same backend twice), but the marker is the
        structural guard against that ever silently failing if it stops holding.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    Set-StrictMode -Version Latest

    $ModelsPath = Join-Path $script:RepoRoot 'ai-models.json'
    if (-not (Test-Path $ModelsPath)) {
        New-ActionableError -Goal 'load AI model pricing' `
            -Problem "ai-models.json not found at $ModelsPath" `
            -Location 'Get-AICostPricing' `
            -NextSteps @('Ensure ai-models.json exists in the repo root') -Throw
    }

    $ModelsData = Get-Content -Raw -Path $ModelsPath | ConvertFrom-Json
    $Pricing = @{}
    if ($ModelsData.PSObject.Properties['pricing']) {
        foreach ($Prop in $ModelsData.pricing.PSObject.Properties) {
            if ($Prop.Name -eq '_comment') { continue }
            $Pricing[$Prop.Name] = $Prop.Value
        }
    }

    $ModelBackend = @{}
    $ApiModelIdMap = @{}
    if ($ModelsData.models) {
        foreach ($M in $ModelsData.models) {
            $ModelBackend[$M.id] = $M.backend
            if ($M.PSObject.Properties['apiModelId'] -and $M.PSObject.Properties['backend']) {
                if (-not $ApiModelIdMap.ContainsKey($M.backend)) {
                    $ApiModelIdMap[$M.backend] = @{}
                }
                $BackendMap = $ApiModelIdMap[$M.backend]
                if ($BackendMap.ContainsKey($M.apiModelId) -and $BackendMap[$M.apiModelId] -ne $M.id) {
                    # Two different models share this (backend, apiModelId) pair --
                    # never last-write-wins. Mark ambiguous permanently (once marked,
                    # a 3rd/4th model sharing the pair keeps it ambiguous).
                    $BackendMap[$M.apiModelId] = $script:AmbiguousPricingKeyMarker
                }
                elseif (-not $BackendMap.ContainsKey($M.apiModelId)) {
                    $BackendMap[$M.apiModelId] = $M.id
                }
            }
        }
    }

    [PSCustomObject]@{
        Pricing       = $Pricing
        ModelBackend  = $ModelBackend
        ApiModelIdMap = $ApiModelIdMap
    }
}
