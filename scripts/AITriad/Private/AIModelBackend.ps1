# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── The one place a cmdlet learns a model's backend (t/4087) ──
# Cmdlets used to guess the backend from the model id's prefix ('^gemini' -> gemini, ... , else gemini),
# resolve a key for the guess, and pass that key EXPLICITLY to Invoke-AIApi. For any registered model
# whose prefix the guess didn't know (xai-, deepseek-, azure-, zai-, moonshot-) that sent GEMINI_API_KEY
# to the other provider. The backend now comes only from ai-models.json, an unknown id fails closed,
# and the resolved key is never handed back to the caller: callers forward only the user's -ApiKey and
# Invoke-AIApi resolves the key for the registry backend itself.

# Environment variable to name in a missing-key hint, per backend (mirrors Resolve-AIApiKey's map).
$script:AIBackendKeyEnvHint = @{
    gemini   = 'GEMINI_API_KEY'
    claude   = 'ANTHROPIC_API_KEY'
    groq     = 'GROQ_API_KEY'
    openai   = 'OPENAI_API_KEY'
    azure    = 'AZURE_OPENAI_API_KEY'
    zai      = 'ZAI_API_KEY'
    moonshot = 'MOONSHOT_API_KEY'
    xai      = 'XAI_API_KEY'
    deepseek = 'DEEPSEEK_API_KEY'
}

function Get-AIModelBackend {
    <#
    .SYNOPSIS
        The backend of a registered model id, read from ai-models.json. Never guessed, never defaulted:
        an unknown id or an entry without a backend throws an ActionableError (t/4087).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][string]$Model)

    $Entry = $null
    if ($script:AIModelConfig -and $script:AIModelConfig.PSObject.Properties['models']) {
        $Entry = $script:AIModelConfig.models | Where-Object { $_.id -eq $Model } | Select-Object -First 1
    }
    $Backend = if ($Entry -and $Entry.PSObject.Properties['backend']) { [string]$Entry.backend } else { '' }
    if ([string]::IsNullOrWhiteSpace($Backend)) {
        $Problem = if ($Entry) { "ai-models.json has no 'backend' for model '$Model'" } else { "'$Model' is not a model id registered in ai-models.json" }
        New-ActionableError -Goal "Resolve the AI backend for model '$Model'" `
            -Problem $Problem `
            -Location 'Get-AIModelBackend (AITriad/Private/AIModelBackend.ps1)' `
            -NextSteps @(
                'Use a model id registered in ai-models.json; the backend is never guessed from the id (t/4087)',
                'For a new model, add it to ai-models.json with its backend (see /add-ai-backend)'
            ) -Throw
    }
    $Backend
}

function Get-AIModelKeyStatus {
    <#
    .SYNOPSIS
        Early "is there a key?" check for a model, by its REGISTRY backend. Returns
        { Backend; HasKey; EnvHint }. The resolved key itself is deliberately not returned: callers pass
        only the user's -ApiKey to Invoke-AIApi, which resolves the key for the registry backend.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Model,
        [string]$ApiKey
    )
    $Backend = Get-AIModelBackend -Model $Model
    $EnvHint = if ($script:AIBackendKeyEnvHint.ContainsKey($Backend)) { $script:AIBackendKeyEnvHint[$Backend] } else { 'AI_API_KEY' }
    $HasKey = $true   # ollama is local and keyless
    if ($Backend -ne 'ollama') {
        # A status check reports the gemini-only $env:AI_API_KEY refusal as "no key", never throws on it
        # (t/4102, SO e/284#2 cond. 1); the caller's hint names this backend's own variable. Other refusals
        # (a key that is another backend's credential, t/4087) propagate.
        try {
            $HasKey = -not [string]::IsNullOrWhiteSpace((Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend))
        } catch {
            if ((Get-AIApiKeySource) -ne '(refused: $env:AI_API_KEY is gemini-only)') { throw }
            Write-Warning "No key for the '$Backend' backend: `$env:AI_API_KEY is set but applies to gemini only; set $EnvHint."
            $HasKey = $false
        }
    }
    [pscustomobject]@{ Backend = $Backend; HasKey = [bool]$HasKey; EnvHint = $EnvHint }
}
