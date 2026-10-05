# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AICostPricing {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): loads per-model pricing from
        ai-models.json and builds the model-id -> backend lookup.
    .OUTPUTS
        [PSCustomObject] { Pricing; ModelBackend } -- Pricing is a hashtable
        keyed by model id (pricing rows); ModelBackend maps model id -> backend.
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
    if ($ModelsData.models) {
        foreach ($M in $ModelsData.models) {
            $ModelBackend[$M.id] = $M.backend
        }
    }

    [PSCustomObject]@{
        Pricing      = $Pricing
        ModelBackend = $ModelBackend
    }
}
