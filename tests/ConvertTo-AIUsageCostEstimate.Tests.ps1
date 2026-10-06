# Tag: cost (t/3947, t/3951)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for ConvertTo-AIUsageCostEstimate.
.DESCRIPTION
    t/3947: a once-per-model WARN when cached tokens fall back to the full
    input rate (no cachedInputPer1M), and proof that an explicit
    cachedInputPer1M == inputPer1M ("no discount", registry.ts's convention,
    t/3945) computes the SAME cost as the fallback, without warning.

    t/3951: resolution-order tests (modelId exact match; legacy (backend,
    apiModelId) map; unresolved+WARN, never a guessed match or silent $0)
    live in Get-AICostReport.Tests.ps1 and Get-AICostPricing.Tests.ps1 since
    they need the real ApiModelIdMap shape. These t/3947 tests use a
    pass-through map ($map[backend][model] -> model) since they're testing
    the cache-rate fallback, not resolution itself. ApiModelIdMap is a
    NESTED map ($map[backend][apiModelId] -> id), never a joined-string key
    (TL review on #2834: same delimiter-collision class CodeQL flagged in
    #2826).
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
            $ApiModelIdMap = @{ test = @{ 'no-cache-rate-model' = 'no-cache-rate-model' } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningVariable w -WarningAction SilentlyContinue
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
            $ApiModelIdMap = @{ test = @{ 'model-a' = 'model-a'; 'model-b' = 'model-b' } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningVariable w -WarningAction SilentlyContinue
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
            $ApiModelIdMap = @{ test = @{ 'no-discount-model' = 'no-discount-model' } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningVariable w -WarningAction SilentlyContinue
            @($w).Count | Should -Be 0
        }
    }

    It 'an explicit cachedInputPer1M == inputPer1M produces the SAME cost as the fallback (no behavior change, just the warning)' {
        InModuleScope AITriad {
            $MakeEntry = { [PSCustomObject]@{ model = $args[0]; backend = 'test'; promptTokens = 1000; completionTokens = 100; cachedTokens = 200 } }

            $FallbackEntries = [System.Collections.Generic.List[PSObject]]::new()
            $FallbackEntries.Add((& $MakeEntry 'fallback-model'))
            $FallbackPricing = @{ 'fallback-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0 } }
            ConvertTo-AIUsageCostEstimate -Entries $FallbackEntries -Pricing $FallbackPricing -ApiModelIdMap @{ test = @{ 'fallback-model' = 'fallback-model' } } -WarningAction SilentlyContinue

            $ExplicitEntries = [System.Collections.Generic.List[PSObject]]::new()
            $ExplicitEntries.Add((& $MakeEntry 'explicit-model'))
            $ExplicitPricing = @{ 'explicit-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0; cachedInputPer1M = 1.0 } }
            ConvertTo-AIUsageCostEstimate -Entries $ExplicitEntries -Pricing $ExplicitPricing -ApiModelIdMap @{ test = @{ 'explicit-model' = 'explicit-model' } } -WarningAction SilentlyContinue

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

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap @{ test = @{ 'discount-model' = 'discount-model' } } -WarningAction SilentlyContinue
            $FallbackCost = (800 * 1.0 / 1000000) + (200 * 1.0 / 1000000) + (100 * 2.0 / 1000000)
            $Entries[0].estimatedCost | Should -BeLessThan $FallbackCost
        }
    }
}

Describe 'ConvertTo-AIUsageCostEstimate resolution order (t/3951)' -Tag 'cost' {

    It 'resolves via an exact modelId field, ignoring backend/apiModelId entirely' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            # backend/model here are deliberately WRONG/misleading -- modelId must win outright.
            $Entries.Add([PSCustomObject]@{ modelId = 'real-id'; model = 'not-the-real-id'; backend = 'wrong-backend'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            $Pricing = @{ 'real-id' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 2.0; cachedInputPer1M = 1.0 } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap @{} -WarningAction SilentlyContinue
            $Entries[0].hasPricing | Should -BeTrue
            [Math]::Round($Entries[0].estimatedCost, 10) | Should -Be ([Math]::Round((1000 * 1.0 + 100 * 2.0) / 1000000, 10))
        }
    }

    It 'resolves a legacy record (no modelId) via the nested (backend, apiModelId) map, not a bare apiModelId lookup' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'gpt-4o'; backend = 'azure'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            # Pricing is keyed by models[].id, NOT the bare apiModelId "gpt-4o" -- a
            # bare lookup would miss entirely (or, worse, collide with openai's entry).
            $Pricing = @{ 'azure-gpt-4o' = [PSCustomObject]@{ inputPer1M = 5.0; outputPer1M = 10.0; cachedInputPer1M = 5.0 } }
            $ApiModelIdMap = @{ azure = @{ 'gpt-4o' = 'azure-gpt-4o' }; openai = @{ 'gpt-4o' = 'openai-gpt-4o' } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningAction SilentlyContinue
            $Entries[0].hasPricing | Should -BeTrue
            $Entries[0].estimatedCost | Should -Be ((1000 * 5.0 + 100 * 10.0) / 1000000)
        }
    }

    It 'never resolves the OTHER backend''s price for a shared apiModelId (azure vs openai gpt-4o)' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'gpt-4o'; backend = 'openai'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            $Pricing = @{
                'azure-gpt-4o'  = [PSCustomObject]@{ inputPer1M = 999.0; outputPer1M = 999.0 }
                'openai-gpt-4o' = [PSCustomObject]@{ inputPer1M = 2.5;   outputPer1M = 10.0 }
            }
            $ApiModelIdMap = @{ azure = @{ 'gpt-4o' = 'azure-gpt-4o' }; openai = @{ 'gpt-4o' = 'openai-gpt-4o' } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningAction SilentlyContinue
            $Entries[0].estimatedCost | Should -Be ((1000 * 2.5 + 100 * 10.0) / 1000000) -Because 'the openai record must price at the openai rate, never azure''s'
        }
    }

    It 'SO condition e/248#4: no backend + an ambiguous apiModelId resolves UNRESOLVED and WARNs -- never a first-match guess, never a silent $0' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'gpt-4o'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            $Pricing = @{
                'azure-gpt-4o'  = [PSCustomObject]@{ inputPer1M = 999.0; outputPer1M = 999.0 }
                'openai-gpt-4o' = [PSCustomObject]@{ inputPer1M = 2.5;   outputPer1M = 10.0 }
            }
            $ApiModelIdMap = @{ azure = @{ 'gpt-4o' = 'azure-gpt-4o' }; openai = @{ 'gpt-4o' = 'openai-gpt-4o' } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningVariable w -WarningAction SilentlyContinue
            $Entries[0].hasPricing | Should -BeFalse
            $Entries[0].estimatedCost | Should -Be 0.0
            @($w) | Where-Object { $_ -match 'gpt-4o' -and $_ -match 'unresolved' } | Should -Not -BeNullOrEmpty -Because 'a $0 cost with no backend must be WARNed, not silent'
        }
    }

    It 'a legacy record whose (backend, apiModelId) has no map entry resolves UNRESOLVED and WARNs, never the old <backend>-<model> fallback' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'totally-unknown-model'; backend = 'unknownbackend'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            # Even if a key happens to exist at "unknownbackend-totally-unknown-model",
            # the old string-concat fallback must NOT be consulted anymore.
            $Pricing = @{ 'unknownbackend-totally-unknown-model' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 1.0 } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap @{} -WarningVariable w -WarningAction SilentlyContinue
            $Entries[0].hasPricing | Should -BeFalse -Because 'the <backend>-<model> string-concat fallback is dropped (t/3951)'
            @($w).Count | Should -BeGreaterThan 0
        }
    }

    It 'warns only ONCE for unresolved entries sharing the same model id' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'gpt-4o'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            $Entries.Add([PSCustomObject]@{ model = 'gpt-4o'; promptTokens = 500; completionTokens = 50; cachedTokens = 0 })
            $Pricing = @{ 'azure-gpt-4o' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 1.0 } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap @{ azure = @{ 'gpt-4o' = 'azure-gpt-4o' } } -WarningVariable w -WarningAction SilentlyContinue
            @($w).Count | Should -Be 1
        }
    }

    It 'a (backend, apiModelId) pair marked ambiguous by Get-AICostPricing resolves UNRESOLVED and WARNs distinctly, never last-write-wins' {
        InModuleScope AITriad {
            $Entries = [System.Collections.Generic.List[PSObject]]::new()
            $Entries.Add([PSCustomObject]@{ model = 'shared-api-id'; backend = 'groq'; promptTokens = 1000; completionTokens = 100; cachedTokens = 0 })
            # Pricing has a price for ONE of the two colliding models -- if the
            # ambiguity marker were ignored and the map held that model's id
            # instead (last-write-wins), this entry would silently price as it.
            $Pricing = @{ 'groq-model-two' = [PSCustomObject]@{ inputPer1M = 1.0; outputPer1M = 1.0 } }
            $ApiModelIdMap = @{ groq = @{ 'shared-api-id' = $script:AmbiguousPricingKeyMarker } }

            ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing -ApiModelIdMap $ApiModelIdMap -WarningVariable w -WarningAction SilentlyContinue
            $Entries[0].hasPricing | Should -BeFalse -Because 'an ambiguous pair must never resolve to either candidate model''s price'
            $Entries[0].estimatedCost | Should -Be 0.0
            @($w) | Where-Object { $_ -match 'shared-api-id' -and $_ -match 'ambiguous' } | Should -Not -BeNullOrEmpty
        }
    }
}
