# Tag: enrichment (t/1409)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Ollama dispatch regression tests (t/1409) — key-required gate bypass,
    Test-AIApiKey ValidateSet, and live-server round-trip.
.DESCRIPTION
    Pure-PS assertions (parameter surface + keyless gate) always run.
    The live round-trip test self-skips with an ALARMING reason when
    Ollama is not reachable at http://localhost:11434 — so a CI runner
    regression can't quietly pass-by-skip (t/1355 pattern).

    Env var $env:OLLAMA_HOST overrides the default socket if set.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    $EnrichPath = Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1'
    Import-Module $EnrichPath -Force -WarningAction SilentlyContinue

    $script:OllamaHost = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST.TrimEnd('/') } else { 'http://localhost:11434' }

    # Preflight: is Ollama reachable?
    $script:OllamaReachable = $false
    $script:OllamaModelId = $null
    $script:OllamaSkipReason = "Ollama not reachable at $script:OllamaHost — OLLAMA GUARD NOT RUN (CI regression?)"
    try {
        $tags = Invoke-RestMethod -Uri "$script:OllamaHost/api/tags" -TimeoutSec 3 -ErrorAction Stop
        if ($tags -and $tags.PSObject.Properties['models'] -and @($tags.models).Count -gt 0) {
            $script:OllamaReachable = $true
            # Find a registered ai-models.json entry whose apiModelId matches a locally-installed tag
            $registry = Get-Content (Join-Path $PSScriptRoot '..' 'ai-models.json') -Raw | ConvertFrom-Json
            $ollamaModels = @($registry.models | Where-Object { $_.backend -eq 'ollama' })
            foreach ($m in $ollamaModels) {
                if (@($tags.models | Where-Object { $_.name -eq $m.apiModelId }).Count -gt 0) {
                    $script:OllamaModelId = $m.id
                    break
                }
            }
            if (-not $script:OllamaModelId) {
                $script:OllamaSkipReason = "Ollama reachable but no ai-models.json model matches installed tags — OLLAMA GUARD NOT RUN (registry drift?)"
                $script:OllamaReachable = $false
            }
        }
    } catch {
        $script:OllamaSkipReason = "Ollama /api/tags probe failed: $($_.Exception.Message) — OLLAMA GUARD NOT RUN (CI regression?)"
    }
}

Describe 'Test-AIApiKey — Ollama support (t/1409 AC#5)' -Tag 'enrichment' {

    It 'ValidateSet includes ollama' {
        $cmd = Get-Command Test-AIApiKey -Module AITriad
        $vs = $cmd.Parameters['Backend'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] }
        $vs.ValidValues | Should -Contain 'ollama'
    }

    It '-Backend ollama probes /api/tags and returns Functional=$true when reachable' {
        if (-not $script:OllamaReachable) {
            Set-ItResult -Skipped -Because $script:OllamaSkipReason
            return
        }
        $r = Test-AIApiKey -Backend ollama -TimeoutSec 5
        $r.Backend      | Should -Be 'ollama'
        $r.Functional   | Should -Be $true
        $r.StatusCode   | Should -Be 200
        $r.KeySource    | Should -Match 'keyless.*Ollama'
        $r.ModelsFound  | Should -BeGreaterOrEqual 0
    }
}

Describe 'Invoke-AIApi — Ollama dispatch (t/1409 AC#2/3/4/6)' -Tag 'enrichment' {

    It 'Skips key-required gate for backend=ollama (no warning, no null return path)' {
        # Even without any *_API_KEY set, an ollama call should NOT return $null
        # from the missing-key gate. It may fail later on network, but the gate
        # itself must not block. Exercise by clearing the process-level key envs
        # for this call only.
        if (-not $script:OllamaReachable) {
            Set-ItResult -Skipped -Because $script:OllamaSkipReason
            return
        }
        $saved = @{
            AI_API_KEY = $env:AI_API_KEY
            GEMINI_API_KEY = $env:GEMINI_API_KEY
            GROQ_API_KEY = $env:GROQ_API_KEY
            OPENAI_API_KEY = $env:OPENAI_API_KEY
            ANTHROPIC_API_KEY = $env:ANTHROPIC_API_KEY
        }
        try {
            $env:AI_API_KEY = $null
            $env:GEMINI_API_KEY = $null
            $env:GROQ_API_KEY = $null
            $env:OPENAI_API_KEY = $null
            $env:ANTHROPIC_API_KEY = $null
            $r = Invoke-AIApi -Model $script:OllamaModelId -Prompt 'Say hi in one short word.' -MaxTokens 20 -Temperature 0.1
            $r | Should -Not -BeNullOrEmpty
            $r.Backend | Should -Be 'ollama'
        } finally {
            foreach ($k in $saved.Keys) { Set-Item -Path "env:$k" -Value $saved[$k] -ErrorAction SilentlyContinue }
        }
    }

    It 'Live round-trip returns non-empty text, matching model, and populated usage counters' {
        if (-not $script:OllamaReachable) {
            Set-ItResult -Skipped -Because $script:OllamaSkipReason
            return
        }
        $r = Invoke-AIApi -Model $script:OllamaModelId -Prompt 'Say hi in one short word.' -MaxTokens 20 -Temperature 0.1
        $r                    | Should -Not -BeNullOrEmpty
        $r.Backend            | Should -Be 'ollama'
        $r.Model              | Should -Be $script:OllamaModelId
        $r.Text               | Should -Not -BeNullOrEmpty
        $r.Text.Trim().Length | Should -BeGreaterThan 0
        $r.Usage              | Should -Not -BeNullOrEmpty
        $r.Usage.InputTokens  | Should -BeGreaterThan 0
        $r.Usage.OutputTokens | Should -BeGreaterThan 0
        $r.Usage.TotalTokens  | Should -Be ($r.Usage.InputTokens + $r.Usage.OutputTokens)
    }
}
