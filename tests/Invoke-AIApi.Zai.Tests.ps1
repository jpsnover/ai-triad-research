# Tag: enrichment (t/1437)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    z.ai / GLM-5.2 dispatch regression tests (t/1437).
.DESCRIPTION
    Pure-PS assertions (parameter surface, EnvVarMap wiring, context window,
    Resolve-AIApiKey resolution) always run. Live round-trip tests self-skip
    with an ALARMING reason when $env:ZAI_API_KEY isn't set — mirroring the
    t/1409 Ollama pattern so a CI regression can't quietly pass-by-skip.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    $EnrichPath = Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1'
    Import-Module $EnrichPath -Force -WarningAction SilentlyContinue

    $script:HasZaiKey    = -not [string]::IsNullOrWhiteSpace($env:ZAI_API_KEY)
    $script:SkipReason   = 'ZAI_API_KEY not set — Z.AI LIVE GUARD NOT RUN (CI regression? owner-provisioned key needed)'
}

Describe 'z.ai wiring — pure-PS shape checks (t/1437)' -Tag 'enrichment' {

    It 'Test-AIApiKey ValidateSet includes zai' {
        $cmd = Get-Command Test-AIApiKey -Module AITriad
        $vs = $cmd.Parameters['Backend'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] }
        $vs.ValidValues | Should -Contain 'zai'
    }

    It 'AIEnrich ContextWindows registers zai at 1,000,000 tokens' {
        InModuleScope AIEnrich {
            $script:ContextWindows.ContainsKey('zai') | Should -Be $true
            $script:ContextWindows['zai']            | Should -Be 1000000
        }
    }

    It 'Resolve-AIApiKey -Backend zai reads $env:ZAI_API_KEY (or falls back to $env:AI_API_KEY)' {
        InModuleScope AIEnrich {
            $saved = @{
                ZAI = $env:ZAI_API_KEY
                AI  = $env:AI_API_KEY
            }
            try {
                $env:ZAI_API_KEY = 'z-test-key-marker-t1437'
                $env:AI_API_KEY  = $null
                $r = Resolve-AIApiKey -Backend 'zai'
                $r | Should -Be 'z-test-key-marker-t1437'
                $script:LastApiKeySource | Should -Be '$env:ZAI_API_KEY'
            } finally {
                $env:ZAI_API_KEY = $saved.ZAI
                $env:AI_API_KEY  = $saved.AI
            }
        }
    }

    It 'Resolve-AIApiKey -Backend zai returns $null when neither ZAI_API_KEY nor AI_API_KEY set' {
        InModuleScope AIEnrich {
            $saved = @{
                ZAI = $env:ZAI_API_KEY
                AI  = $env:AI_API_KEY
            }
            try {
                $env:ZAI_API_KEY = $null
                $env:AI_API_KEY  = $null
                $r = Resolve-AIApiKey -Backend 'zai'
                $r | Should -BeNullOrEmpty
            } finally {
                $env:ZAI_API_KEY = $saved.ZAI
                $env:AI_API_KEY  = $saved.AI
            }
        }
    }
}

Describe 'z.ai live round-trip — requires ZAI_API_KEY (t/1437 AC#4)' -Tag 'enrichment' {

    It 'Test-AIApiKey -Backend zai returns Functional=$true when the key authenticates' {
        if (-not $script:HasZaiKey) {
            Set-ItResult -Skipped -Because $script:SkipReason
            return
        }
        $r = Test-AIApiKey -Backend zai -TimeoutSec 15
        $r.Backend    | Should -Be 'zai'
        $r.Functional | Should -Be $true
        $r.StatusCode | Should -Be 200
        $r.KeySource  | Should -Match 'ZAI_API_KEY|AI_API_KEY'
    }

    It 'Invoke-AIApi -Model zai-glm-5.2 -Prompt returns non-empty Text + usage counters' {
        if (-not $script:HasZaiKey) {
            Set-ItResult -Skipped -Because $script:SkipReason
            return
        }
        $r = Invoke-AIApi -Model 'zai-glm-5.2' -Prompt 'Say hi in one short word.' -MaxTokens 20 -Temperature 0.1
        $r                    | Should -Not -BeNullOrEmpty
        $r.Backend            | Should -Be 'zai'
        $r.Text               | Should -Not -BeNullOrEmpty
        $r.Text.Trim().Length | Should -BeGreaterThan 0
        $r.Usage              | Should -Not -BeNullOrEmpty
        $r.Usage.InputTokens  | Should -BeGreaterThan 0
        $r.Usage.OutputTokens | Should -BeGreaterThan 0
        $r.Usage.TotalTokens  | Should -Be ($r.Usage.InputTokens + $r.Usage.OutputTokens)
    }
}
