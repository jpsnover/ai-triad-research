# Tag: cost (t/3968)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for Get-AIUsageCacheSavings (t/3968).
.DESCRIPTION
    Previously re-resolved pricing by the sample entry's bare model
    (apiModelId) field, independent of ConvertTo-AIUsageCostEstimate's
    resolution order (t/3951). For a legacy record whose apiModelId differs
    from its resolved pricing key id -- e.g. groq's apiModelId
    "openai/gpt-oss-120b" resolving to pricing key "groq-openai-gpt-oss-120b"
    -- that independent lookup missed even though hasPricing was correctly
    true, so cache savings silently came out $0 for an entry that does have
    a real cache discount. Now uses resolvedPricingId, set by
    ConvertTo-AIUsageCostEstimate on each entry, so it can never diverge.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Get-AIUsageCacheSavings' -Tag 'cost' {

    It 'returns 0.0 when there are no cached tokens' {
        InModuleScope AITriad {
            $Items = [System.Collections.Generic.List[PSObject]]::new()
            $Items.Add([PSCustomObject]@{ hasPricing = $true; resolvedPricingId = 'model-a' })
            Get-AIUsageCacheSavings -Items $Items -TotalCached 0 -Pricing @{ 'model-a' = [PSCustomObject]@{ inputPer1M = 1.0; cachedInputPer1M = 0.5 } } | Should -Be 0.0
        }
    }

    It 'returns 0.0 when no entry in the group has pricing' {
        InModuleScope AITriad {
            $Items = [System.Collections.Generic.List[PSObject]]::new()
            $Items.Add([PSCustomObject]@{ hasPricing = $false; resolvedPricingId = $null })
            Get-AIUsageCacheSavings -Items $Items -TotalCached 100 -Pricing @{} | Should -Be 0.0
        }
    }

    It 'computes savings using resolvedPricingId -- the EXACT key ConvertTo-AIUsageCostEstimate resolved, not a re-derived bare model id' {
        InModuleScope AITriad {
            $Items = [System.Collections.Generic.List[PSObject]]::new()
            # model is the bare apiModelId (groq's convention: "openai/gpt-oss-120b"),
            # deliberately DIFFERENT from resolvedPricingId -- the old code looked up
            # Pricing[model] and would miss this entirely.
            $Items.Add([PSCustomObject]@{
                hasPricing        = $true
                model             = 'openai/gpt-oss-120b'
                resolvedPricingId = 'groq-openai-gpt-oss-120b'
            })
            $Pricing = @{ 'groq-openai-gpt-oss-120b' = [PSCustomObject]@{ inputPer1M = 1.0; cachedInputPer1M = 0.25 } }

            $Savings = Get-AIUsageCacheSavings -Items $Items -TotalCached 1000 -Pricing $Pricing
            $Savings | Should -Be ((1.0 - 0.25) * 1000 / 1000000) -Because 'must resolve via resolvedPricingId, not the bare model/apiModelId field'
        }
    }

    It 'returns 0.0 when cachedInputPer1M equals inputPer1M (no discount)' {
        InModuleScope AITriad {
            $Items = [System.Collections.Generic.List[PSObject]]::new()
            $Items.Add([PSCustomObject]@{ hasPricing = $true; resolvedPricingId = 'model-a' })
            $Pricing = @{ 'model-a' = [PSCustomObject]@{ inputPer1M = 1.0; cachedInputPer1M = 1.0 } }

            Get-AIUsageCacheSavings -Items $Items -TotalCached 500 -Pricing $Pricing | Should -Be 0.0
        }
    }

    It 'falls back to 0.0 (not a crash) when resolvedPricingId is missing from Pricing' {
        InModuleScope AITriad {
            $Items = [System.Collections.Generic.List[PSObject]]::new()
            $Items.Add([PSCustomObject]@{ hasPricing = $true; resolvedPricingId = 'not-in-pricing' })
            Get-AIUsageCacheSavings -Items $Items -TotalCached 100 -Pricing @{} | Should -Be 0.0
        }
    }
}
