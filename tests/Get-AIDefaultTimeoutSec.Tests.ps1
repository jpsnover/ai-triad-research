# Tag: enrichment
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-AIDefaultTimeoutSec (private) and the Invoke-AIApi default-timeout path (t/2496).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Helper: call the private function via the module's script scope
    function Invoke-DefaultTimeout { param([string]$Model)
        & (Get-Module AIEnrich) { param($m) Get-AIDefaultTimeoutSec -Model $m } -m $Model
    }
}

Describe 'Get-AIDefaultTimeoutSec — base timeouts' -Tag 'enrichment' {

    It 'Returns 180 for a claude basic-tier model' {
        Invoke-DefaultTimeout 'claude-haiku-4-5' | Should -Be 180
    }

    It 'Returns 120 for a gemini basic-tier model' {
        Invoke-DefaultTimeout 'gemini-3.5-flash-lite' | Should -Be 120
    }

    It 'Returns 120 for groq backend' {
        Invoke-DefaultTimeout 'groq-llama-3.1-8b-instant' | Should -Be 120
    }

    It 'Returns 180 for openai backend' {
        Invoke-DefaultTimeout 'openai-gpt-4.1-mini' | Should -Be 180
    }

    It 'Returns 180 for azure backend' {
        Invoke-DefaultTimeout 'azure-gpt-4o-mini' | Should -Be 180
    }

    It 'Returns 180 for deepseek backend' {
        Invoke-DefaultTimeout 'deepseek-deepseek-v4-flash' | Should -Be 180
    }

    It 'Returns 300 for ollama backend' {
        Invoke-DefaultTimeout 'ollama-gemma4-e4b-it-q4-k-m' | Should -Be 300
    }

    It 'Returns 240 for zai backend' {
        Invoke-DefaultTimeout 'zai-glm-5-2' | Should -Be 240
    }

    It 'Returns 240 for moonshot backend' {
        Invoke-DefaultTimeout 'moonshot-v1-128k' | Should -Be 240
    }

    It 'Returns 120 for unknown / gemini-default model' {
        Invoke-DefaultTimeout 'unknown-future-model' | Should -Be 120
    }
}

Describe 'Get-AIDefaultTimeoutSec — frontier 2x tier (requires ai-models.json debateTiers)' -Tag 'enrichment' {

    It 'Returns 360 for the claude advanced-tier model (2x base)' {
        # claude advanced = claude-sonnet-4-6 (from ai-models.json debateTiers.advanced.claude)
        # claude basic    = claude-haiku-4-5  — different, so 2x applies
        $result = Invoke-DefaultTimeout 'claude-sonnet-4-6'
        $result | Should -Be 360
    }

    It 'Returns 240 for the gemini advanced-tier model (2x base)' {
        # gemini advanced = gemini-3.1-pro-preview; basic = gemini-3.5-flash-lite — different
        $result = Invoke-DefaultTimeout 'gemini-3.1-pro-preview'
        $result | Should -Be 240
    }

    It 'Returns 120 for groq advanced-tier (2x base)' {
        # groq advanced = groq-llama-3.3-70b-versatile; basic = groq-llama-3.1-8b-instant
        $result = Invoke-DefaultTimeout 'groq-llama-3.3-70b-versatile'
        $result | Should -Be 240
    }

    It 'Returns base (300) for ollama — same model in both tiers, no 2x' {
        Invoke-DefaultTimeout 'ollama-gemma4-e4b-it-q4-k-m' | Should -Be 300
    }

    It 'Returns base (240) for zai — same model in both tiers, no 2x' {
        Invoke-DefaultTimeout 'zai-glm-5-2' | Should -Be 240
    }
}

Describe 'Invoke-AIApi — TimeoutSec default path' -Tag 'enrichment' {

    It 'Uses model-derived timeout when -TimeoutSec is not supplied (sentinel resolves via helper)' {
        InModuleScope AIEnrich {
            $script:capturedTimeout = $null
            Mock Invoke-RestMethod { $script:capturedTimeout = $TimeoutSec; throw 'sentinel-stop' }
            try {
                Invoke-AIApi -Prompt 'x' -Model 'claude-sonnet-4-6' -ApiKey 'fake' -MaxRetries 0 3>$null 2>$null
            } catch {}
            $script:capturedTimeout | Should -BeGreaterThan 120
        }
    }

    It 'Respects an explicit -TimeoutSec override' {
        InModuleScope AIEnrich {
            $script:capturedTimeout = $null
            Mock Invoke-RestMethod { $script:capturedTimeout = $TimeoutSec; throw 'sentinel-stop' }
            try {
                Invoke-AIApi -Prompt 'x' -Model 'claude-sonnet-4-6' -ApiKey 'fake' -TimeoutSec 60 -MaxRetries 0 3>$null 2>$null
            } catch {}
            $script:capturedTimeout | Should -Be 60
        }
    }
}
