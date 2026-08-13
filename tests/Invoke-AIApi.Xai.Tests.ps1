# Tag: enrichment (t/2583)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    xAI (Grok) dispatch regression tests (t/2583).
.DESCRIPTION
    Pure-PS assertions (parameter surface, EnvVarMap wiring, context window,
    Resolve-AIApiKey resolution) always run. Live round-trip tests self-skip
    with an ALARMING reason when $env:XAI_API_KEY isn't set — mirroring the
    t/1936 Moonshot / t/1437 z.ai pattern so a CI regression can't quietly
    pass-by-skip.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    $EnrichPath = Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1'
    Import-Module $EnrichPath -Force -WarningAction SilentlyContinue

    $script:HasXaiKey  = -not [string]::IsNullOrWhiteSpace($env:XAI_API_KEY)
    $script:SkipReason = 'XAI_API_KEY not set — XAI LIVE GUARD NOT RUN (CI regression? owner-provisioned key needed)'
}

Describe 'xAI wiring — pure-PS shape checks (t/2583)' -Tag 'enrichment' {

    It 'Test-AIApiKey ValidateSet includes xai' {
        $cmd = Get-Command Test-AIApiKey -Module AITriad
        $vs = $cmd.Parameters['Backend'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] }
        $vs.ValidValues | Should -Contain 'xai'
    }

    It 'AIEnrich ContextWindows registers xai at 500,000 tokens' {
        InModuleScope AIEnrich {
            $script:ContextWindows.ContainsKey('xai') | Should -Be $true
            $script:ContextWindows['xai']             | Should -Be 500000
        }
    }

    It 'Resolve-AIApiKey -Backend xai reads $env:XAI_API_KEY (or falls back to $env:AI_API_KEY)' {
        InModuleScope AIEnrich {
            $saved = @{
                XAI = $env:XAI_API_KEY
                AI  = $env:AI_API_KEY
            }
            try {
                $env:XAI_API_KEY = 'xai-test-key-marker-t2583'
                $env:AI_API_KEY  = $null
                $r = Resolve-AIApiKey -Backend 'xai'
                $r | Should -Be 'xai-test-key-marker-t2583'
                $script:LastApiKeySource | Should -Be '$env:XAI_API_KEY'
            } finally {
                $env:XAI_API_KEY = $saved.XAI
                $env:AI_API_KEY  = $saved.AI
            }
        }
    }

    It 'Resolve-AIApiKey -Backend xai returns $null when neither XAI_API_KEY nor AI_API_KEY set' {
        InModuleScope AIEnrich {
            $saved = @{
                XAI = $env:XAI_API_KEY
                AI  = $env:AI_API_KEY
            }
            try {
                $env:XAI_API_KEY = $null
                $env:AI_API_KEY  = $null
                $r = Resolve-AIApiKey -Backend 'xai'
                $r | Should -BeNullOrEmpty
            } finally {
                $env:XAI_API_KEY = $saved.XAI
                $env:AI_API_KEY  = $saved.AI
            }
        }
    }

    It 'xai-grok-4-6 resolves to the xai backend in the model registry' {
        InModuleScope AIEnrich {
            $script:ModelRegistry.ContainsKey('xai-grok-4-6') | Should -Be $true
            $script:ModelRegistry['xai-grok-4-6'].Backend     | Should -Be 'xai'
        }
    }
}

Describe 'xAI live round-trip — requires XAI_API_KEY (t/2583 AC)' -Tag 'enrichment' {

    It 'Test-AIApiKey -Backend xai returns Functional=$true when the key authenticates' {
        if (-not $script:HasXaiKey) {
            Set-ItResult -Skipped -Because $script:SkipReason
            return
        }
        $r = Test-AIApiKey -Backend xai -TimeoutSec 15
        $r.Backend    | Should -Be 'xai'
        $r.Functional | Should -Be $true
        $r.StatusCode | Should -Be 200
        $r.KeySource  | Should -Match 'XAI_API_KEY|AI_API_KEY'
    }

    It 'Invoke-AIApi -Model xai-grok-4-6 -Prompt returns non-empty Text + usage counters' {
        if (-not $script:HasXaiKey) {
            Set-ItResult -Skipped -Because $script:SkipReason
            return
        }
        $r = Invoke-AIApi -Model 'xai-grok-4-6' -Prompt 'Say hi in one short word.' -MaxTokens 200 -Temperature 0.1
        $r                    | Should -Not -BeNullOrEmpty
        $r.Backend            | Should -Be 'xai'
        $r.Text               | Should -Not -BeNullOrEmpty
        $r.Text.Trim().Length | Should -BeGreaterThan 0
        $r.Usage              | Should -Not -BeNullOrEmpty
        $r.Usage.InputTokens  | Should -BeGreaterThan 0
        $r.Usage.OutputTokens | Should -BeGreaterThan 0
        $r.Usage.TotalTokens  | Should -Be ($r.Usage.InputTokens + $r.Usage.OutputTokens)
    }
}
