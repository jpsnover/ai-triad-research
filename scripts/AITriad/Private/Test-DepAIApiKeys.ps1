# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepAIApiKeys {
    <#
    .SYNOPSIS
        Section 3 of Invoke-DependencyCheck (t/3910): the 3 AI API key backend probes
        (Gemini/Anthropic/Groq) + the AI_API_KEY fallback + the final "no key" check.
        Builds the data-driven backend table and delegates each probe to
        Test-DepAIApiKeyBackend. Extracted verbatim (messages, status-code checks, Warn-vs-
        Skip severities on "not set" all unchanged).
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param([Parameter(Mandatory)][hashtable]$Ctx)

    Write-DepSection 'AI API KEYS (at least one required)'

    $Backends = @(
        @{
            EnvVar = 'GEMINI_API_KEY'
            Invoke = {
                param($Key)
                # fetch-allowlist: Gemini key-validation probe (generativelanguage.googleapis.com, a by-key provider API like the anthropic/groq literals below — not a user URL, not the WAF-fetch class; t/3314)
                $Uri = "https://generativelanguage.googleapis.com/v1beta/models?key=$Key"
                Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 10 -ErrorAction Stop
            }
            InvalidStatusCodes = @(400, 403)
            SuccessMessage = { param($Key, $R) "GEMINI_API_KEY valid ($(@($R.models).Count) models available)" }
            InvalidMessage = { param($SC) "GEMINI_API_KEY invalid (HTTP $SC)" }
            UnreachableMessage = 'GEMINI_API_KEY set but API unreachable'
            NotSetSeverity = 'Warn'
            NotSetMessage = 'GEMINI_API_KEY not set (primary backend)'
        }
        @{
            EnvVar = 'ANTHROPIC_API_KEY'
            Invoke = {
                param($Key)
                $Hdrs = @{ 'x-api-key' = $Key; 'anthropic-version' = '2023-06-01'; 'content-type' = 'application/json' }
                $Body = @{ model = 'claude-3-5-haiku-20241022'; max_tokens = 10; messages = @(@{ role = 'user'; content = 'Say OK' }) } | ConvertTo-Json -Depth 5  # model-lint:allow-pin raw Anthropic API liveness-probe id, intentionally not a registry backend
                Invoke-RestMethod -Uri 'https://api.anthropic.com/v1/messages' -Method Post -Headers $Hdrs -Body $Body -TimeoutSec 15 -ErrorAction Stop
            }
            InvalidStatusCodes = @(401)
            SuccessMessage = { param($Key, $R) 'ANTHROPIC_API_KEY valid' }
            InvalidMessage = { param($SC) 'ANTHROPIC_API_KEY invalid (HTTP 401)' }
            UnreachableMessage = 'ANTHROPIC_API_KEY set but smoke test failed'
            NotSetSeverity = 'Skip'
            NotSetMessage = 'ANTHROPIC_API_KEY not set (optional)'
        }
        @{
            EnvVar = 'GROQ_API_KEY'
            Invoke = {
                param($Key)
                $Hdrs = @{ 'Authorization' = "Bearer $Key"; 'Content-Type' = 'application/json' }
                Invoke-RestMethod -Uri 'https://api.groq.com/openai/v1/models' -Method Get -Headers $Hdrs -TimeoutSec 10 -ErrorAction Stop
            }
            InvalidStatusCodes = @(401)
            SuccessMessage = { param($Key, $R) 'GROQ_API_KEY valid' }
            InvalidMessage = { param($SC) 'GROQ_API_KEY invalid (HTTP 401)' }
            UnreachableMessage = 'GROQ_API_KEY set but smoke test failed'
            NotSetSeverity = 'Skip'
            NotSetMessage = 'GROQ_API_KEY not set (optional)'
        }
    )

    $HasAnyKey = $false
    foreach ($Backend in $Backends) {
        if (Test-DepAIApiKeyBackend -Ctx $Ctx -Backend $Backend) { $HasAnyKey = $true }
    }

    if (-not $HasAnyKey -and $env:AI_API_KEY) {
        Write-DepWarn -Ctx $Ctx -Message 'AI_API_KEY (fallback) set but cannot verify which backend it targets'
        $HasAnyKey = $true
    }
    if (-not $HasAnyKey) {
        Write-DepFail -Ctx $Ctx -Message 'No AI API key configured. Set GEMINI_API_KEY or run Register-AIBackend.'
    }
}
