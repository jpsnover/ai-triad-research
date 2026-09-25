# Tag: config (t/3564)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-AITierModel — drift-proof model-tier resolver over ai-models.json
    debateTiers (t/3564).
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'TestModuleBootstrap.ps1'); Enter-AITriadTestModule
    # Truth values read straight from the same in-memory config the cmdlet uses.
    $script:ExpectedBasicGemini    = InModuleScope AITriad { $script:AIModelConfig.debateTiers.basic.gemini }
    $script:ExpectedAdvancedClaude = InModuleScope AITriad { $script:AIModelConfig.debateTiers.advanced.claude }
    $script:RegisteredIds          = @(InModuleScope AITriad { $script:ValidModelIds })
}

Describe 'Get-AITierModel' -Tag 'config' {

    It 'is exported by the module' {
        Get-Command Get-AITierModel -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'resolves -Tier basic to the registered fast/cheap gemini model' {
        $m = Get-AITierModel -Tier basic
        $m | Should -Be $script:ExpectedBasicGemini
        $m | Should -BeIn $script:RegisteredIds
    }

    It 'defaults to basic + gemini with no arguments' {
        Get-AITierModel | Should -Be $script:ExpectedBasicGemini
    }

    It 'resolves -Tier advanced -Backend claude to the registered frontier claude model' {
        $m = Get-AITierModel -Tier advanced -Backend claude
        $m | Should -Be $script:ExpectedAdvancedClaude
        $m | Should -BeIn $script:RegisteredIds
    }

    It 'falls back to gemini with a WARNING when the tier has no entry for the backend' {
        # 'moonshot' is in ai-models.json defaults but NOT in debateTiers -> fallback path.
        $m = Get-AITierModel -Tier basic -Backend moonshot -WarningVariable warn -WarningAction SilentlyContinue
        $m | Should -Be $script:ExpectedBasicGemini
        @($warn).Count | Should -BeGreaterThan 0
        [string]$warn | Should -Match 'falling back to gemini'
    }

    It 'rejects an invalid tier via ValidateSet' {
        { Get-AITierModel -Tier 'frontier' } | Should -Throw
    }

    It 'throws an ActionableError when the model registry is unavailable' {
        InModuleScope AITriad {
            $saved = $script:AIModelConfig
            try {
                $script:AIModelConfig = $null
                { Get-AITierModel -Tier basic } | Should -Throw -ExpectedMessage '*registry*'
            } finally {
                $script:AIModelConfig = $saved
            }
        }
    }

    It 'throws an ActionableError when the tier lacks the backend and no gemini fallback exists' {
        InModuleScope AITriad {
            $saved = $script:AIModelConfig
            try {
                # A config whose 'basic' tier has only a non-gemini backend -> no fallback.
                $script:AIModelConfig = [PSCustomObject]@{
                    debateTiers = [PSCustomObject]@{
                        basic = [PSCustomObject]@{ claude = 'claude-haiku-4-5' }
                    }
                }
                { Get-AITierModel -Tier basic -Backend openai } | Should -Throw -ExpectedMessage '*no*gemini*fallback*'
            } finally {
                $script:AIModelConfig = $saved
            }
        }
    }
}
