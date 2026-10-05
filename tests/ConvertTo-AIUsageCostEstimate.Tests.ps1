# Tag: cost (t/3947)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for ConvertTo-AIUsageCostEstimate's t/3947 fix: a once-per-model
    WARN when cached tokens fall back to the full input rate (no cachedInputPer1M),
    and proof that an explicit cachedInputPer1M == inputPer1M ("no discount",
    registry.ts's convention, t/3945) computes the SAME cost as the fallback, without
    warning.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'ConvertTo-AIUsageCostEstimate (t/3947)' -Tag 'cost' {

    It 'warns ONCE per model when a pricing entry has no cachedInputPer1M, even across multiple entries for that model' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'no-cache-rate-model'; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 })
            $Entries.Add([PSCustomObject]@{ model = 'no-cache-rate-model'; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 300 })
            $Pricing = @{
                'no-cache-rate-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0 }
            }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -WarningVariable w -WarningAction SilentlyContinue
            @($w).Count | Should -Be 1 -Because 'two entries for the same model must warn only once, not per-entry'
            $w[0] | Should -Match "no-cache-rate-model.*no cachedInputPer1M"
        }
    }

    It 'warns separately for two DIFFERENT models that both lack cachedInputPer1M' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'model-a'; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 })
            $Entries.Add([PSCustomObject]@{ model = 'model-b'; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 })
            $Pricing = @{
                'model-a' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0 }
                'model-b' = [PSCustomObject]@{ inputPer1M = 3.0; outputPer1M = 4.0 }
            }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -WarningVariable w -WarningAction SilentlyContinue
            @($w).Count | Should -Be 2
        }
    }

    It 'does NOT warn when cachedInputPer1M is explicitly present, even if it equals inputPer1M (no-discount convention, t/3945)' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'no-discount-model'; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 })
            $Pricing = @{
                'no-discount-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0; cachedInputPer1M = 1.0 }
            }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -WarningVariable w -WarningAction SilentlyContinue
            @($w).Count | Should -Be 0
        }
    }

    It 'an explicit cachedInputPer1M == inputPer1M produces the SAME cost as the fallback (no behavior change, just the warning)' {
        InModuleScope AITriad {
            $MakeEntry = { [PSCustomObject]@{ model = $args[0]; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 } }

            $FallbackEntries = [System.Collections.Generic.List[PSObject]]::new()
            $FallbackEntries.Add((& $MakeEntry 'fallback-model'))
            $FallbackPricing = @{ 'fallback-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0 } }
            ConvertTo-AIUsageCostEstimate -Entries $FallbackEntries -Pricing $FallbackPricing -WarningAction SilentlyContinue

            $ExplicitEntries = [System.Collections.Generic.List[PSObject]]::new()
            $ExplicitEntries.Add((& $MakeEntry 'explicit-model'))
            $ExplicitPricing = @{ 'explicit-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0; cachedInputPer1M = 1.0 } }
            ConvertTo-AIUsageCostEstimate -Entries $ExplicitEntries -Pricing $ExplicitPricing -WarningAction SilentlyContinue

            $FallbackEntries[0].estimatedCost | Should -Be $ExplicitEntries[0].estimatedCost
            # Sanity: both equal the expected full-input-rate math for 1000/100/200 tokens.
            $Expected = (800 * 1.0 / 1000000) + (200 * 1.0 / 1000000) + (100 * 2.0 / 1000000)
            $FallbackEntries[0].estimatedCost | Should -Be $Expected
        }
    }

    It 'a genuine cache DISCOUNT (cachedInputPer1M < inputPer1M) still produces a lower cost than the fallback would' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'discount-model'; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 })
            $Pricing = @{ 'discount-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0; cachedInputPer1M = 0.25 } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -WarningAction SilentlyContinue
            $FallbackCost = (800 * 1.0 / 1000000) + (200 * 1.0 / 1000000) + (100 * 2.0 / 1000000)
            $Entries[0].estimatedCost | Should -BeLessThan $FallbackCost
        }
    }
}
