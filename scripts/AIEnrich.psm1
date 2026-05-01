# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Version 5.1
<#
.SYNOPSIS
    Multi-backend AI API helper functions for AI Triad document enrichment.
.DESCRIPTION
    Supports Gemini (Google), Claude (Anthropic), and Groq backends with a
    unified Invoke-AIApi dispatcher.  Separated into a module to avoid AMSI
    false-positive detections triggered by REST API calls and safety-category
    strings.
#>

# ─────────────────────────────────────────────────────────────────────────────
# Model Registry — loaded from ai-models.json (single source of truth)
# Falls back to hardcoded defaults if the file is missing.
# ─────────────────────────────────────────────────────────────────────────────
$script:ModelRegistry = @{}
$script:FallbackChains = @{}
$script:ContextWindows = @{ gemini = 1048576; claude = 200000; groq = 131072; openai = 131072 }
$script:LastApiKeySource = ''
$script:AIApiLoggedThisSession = $false
$script:AIApiLastModel = ''

$_aiModelsPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'ai-models.json'
if (-not (Test-Path $_aiModelsPath)) {
    $_aiModelsPath = Join-Path $PSScriptRoot 'ai-models.json'
}
# Also try repo root (two levels up from scripts/)
if (-not (Test-Path $_aiModelsPath)) {
    $_aiModelsPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'ai-models.json'
}

if (Test-Path $_aiModelsPath) {
    try {
        $_aiConfig = Get-Content -Raw -Path $_aiModelsPath | ConvertFrom-Json
        foreach ($_m in $_aiConfig.models) {
            $script:ModelRegistry[$_m.id] = @{
                Backend    = $_m.backend
                ApiModelId = if ($_m.PSObject.Properties['apiModelId']) { $_m.apiModelId } else { $_m.id }
            }
        }
        if ($_aiConfig.PSObject.Properties['fallbackChains'] -and $_aiConfig.fallbackChains) {
            foreach ($_prop in $_aiConfig.fallbackChains.PSObject.Properties) {
                $script:FallbackChains[$_prop.Name] = @($_prop.Value)
            }
        }
        if ($_aiConfig.PSObject.Properties['contextWindows'] -and $_aiConfig.contextWindows) {
            foreach ($_prop in $_aiConfig.contextWindows.PSObject.Properties) {
                $script:ContextWindows[$_prop.Name] = [int]$_prop.Value
            }
        }
        Write-Verbose "AIEnrich: loaded $($script:ModelRegistry.Count) models, $($script:FallbackChains.Count) fallback chains from ai-models.json"
    }
    catch {
        Write-Warning "AIEnrich: failed to load ai-models.json — $($_.Exception.Message). Using hardcoded fallback."
    }
}

# Fallback if ai-models.json missing or empty
if ($script:ModelRegistry.Count -eq 0) {
    $script:ModelRegistry = @{
        'gemini-3.1-flash-lite-preview' = @{ Backend = 'gemini';  ApiModelId = 'gemini-3.1-flash-lite-preview' }
        'gemini-2.5-flash'      = @{ Backend = 'gemini';  ApiModelId = 'gemini-2.5-flash' }
        'gemini-2.5-flash-lite' = @{ Backend = 'gemini';  ApiModelId = 'gemini-2.5-flash-lite' }
        'gemini-2.5-pro'        = @{ Backend = 'gemini';  ApiModelId = 'gemini-2.5-pro' }
        'claude-opus-4'         = @{ Backend = 'claude';  ApiModelId = 'claude-opus-4-20250514' }
        'claude-sonnet-4-5'     = @{ Backend = 'claude';  ApiModelId = 'claude-sonnet-4-5-20250514' }
        'claude-haiku-3.5'      = @{ Backend = 'claude';  ApiModelId = 'claude-3-5-haiku-20241022' }
        'groq-llama-3.3-70b'    = @{ Backend = 'groq';    ApiModelId = 'llama-3.3-70b-versatile' }
        'groq-llama-4-scout'    = @{ Backend = 'groq';    ApiModelId = 'meta-llama/llama-4-scout-17b-16e-instruct' }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Resolve-AIApiKey
# Resolves the API key for a given backend using the priority:
#   explicit -ApiKey > backend-specific env var > AI_API_KEY fallback
# ─────────────────────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    Resolves the API key for a given AI backend.
.DESCRIPTION
    Determines the API key to use for an AI backend call using the following
    priority chain:

    1. Explicit key passed via -ExplicitKey parameter.
    2. Backend-specific environment variable (GEMINI_API_KEY, ANTHROPIC_API_KEY,
       or GROQ_API_KEY).
    3. Universal fallback: $env:AI_API_KEY.

    Returns $null if no key is found at any level.  The resolved source is
    tracked in $script:LastApiKeySource for diagnostic logging.
.PARAMETER ExplicitKey
    An API key passed directly by the caller.  Takes highest priority.
.PARAMETER Backend
    The AI backend name: 'gemini', 'claude', or 'groq'.  Determines which
    environment variable to check.
.EXAMPLE
    $Key = Resolve-AIApiKey -Backend 'gemini'

    Resolves the Gemini API key from $env:GEMINI_API_KEY or $env:AI_API_KEY.
.EXAMPLE
    $Key = Resolve-AIApiKey -ExplicitKey 'sk-abc123' -Backend 'claude'

    Returns the explicit key, ignoring environment variables.
#>
function Resolve-AIApiKey {
    [CmdletBinding()]
    param(
        [string]$ExplicitKey,
        [Parameter(Mandatory)][string]$Backend
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitKey)) {
        $script:LastApiKeySource = 'explicit parameter'
        return $ExplicitKey
    }

    $EnvVarMap = @{
        'gemini' = 'GEMINI_API_KEY'
        'claude' = 'ANTHROPIC_API_KEY'
        'groq'   = 'GROQ_API_KEY'
        'openai' = 'OPENAI_API_KEY'
    }

    $BackendEnvVar = $EnvVarMap[$Backend]
    if ($BackendEnvVar) {
        $BackendKey = [System.Environment]::GetEnvironmentVariable($BackendEnvVar)
        if (-not [string]::IsNullOrWhiteSpace($BackendKey)) {
            $script:LastApiKeySource = "`$env:$BackendEnvVar"
            return $BackendKey
        }
    }

    $Fallback = $env:AI_API_KEY
    if (-not [string]::IsNullOrWhiteSpace($Fallback)) {
        $script:LastApiKeySource = '$env:AI_API_KEY (fallback)'
        return $Fallback
    }

    $script:LastApiKeySource = '(none found)'
    return $null
}

# ─────────────────────────────────────────────────────────────────────────────
# Measure-PromptTokens — pre-flight token estimation
# ─────────────────────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    Estimates the token count of a prompt text.
.DESCRIPTION
    Uses Gemini's free countTokens API for accurate counts when a Gemini API
    key is available. Falls back to a character-based heuristic (~3.2 chars
    per token for prose, ~2.5 for JSON/code).
.PARAMETER Text
    The prompt text to measure.
.PARAMETER ApiKey
    Optional API key. If omitted, attempts to resolve a Gemini key from env.
.EXAMPLE
    $Tokens = Measure-PromptTokens -Text $MyPrompt
    $Tokens.TokenCount  # 1523
    $Tokens.Accurate    # $true (if Gemini countTokens was used)
#>
function Measure-PromptTokens {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Text,
        [string]$ApiKey = ''
    )

    $GeminiKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend 'gemini'
    if ($GeminiKey) {
        try {
            $CountUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:countTokens?key=$GeminiKey"
            $CountBody = @{
                contents = @(@{ parts = @(@{ text = $Text }) })
            } | ConvertTo-Json -Depth 5
            $BodyBytes = [System.Text.Encoding]::UTF8.GetBytes($CountBody)
            $CountResponse = Invoke-RestMethod -Uri $CountUrl -Method POST -ContentType 'application/json; charset=utf-8' -Body $BodyBytes -TimeoutSec 10
            return [PSCustomObject]@{
                TokenCount = [int]$CountResponse.totalTokens
                Method     = 'gemini-countTokens'
                Accurate   = $true
            }
        } catch {
            Write-Verbose "Measure-PromptTokens: Gemini countTokens failed — $($_.Exception.Message). Using heuristic."
        }
    }

    $JsonLike = $Text -match '^\s*[\[{]' -or ($Text.Length -gt 200 -and (($Text -split '[\{\}\[\]":]').Count * 1.0 / $Text.Length) -gt 0.01)
    $CharsPerToken = if ($JsonLike) { 2.5 } else { 3.2 }
    $EstTokens = [Math]::Ceiling($Text.Length / $CharsPerToken)
    return [PSCustomObject]@{
        TokenCount = $EstTokens
        Method     = "heuristic ($CharsPerToken chars/token)"
        Accurate   = $false
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Invoke-AIApi — central dispatcher
#
# Accepts a prompt and model name, looks up the backend, builds the
# backend-specific request, calls the API with retry logic, and returns a
# uniform result object.
# ─────────────────────────────────────────────────────────────────────────────

function ConvertTo-GeminiSchema {
    param([hashtable]$Schema)
    $TypeMap = @{
        'string'  = 'STRING'; 'number' = 'NUMBER'; 'integer' = 'INTEGER'
        'boolean' = 'BOOLEAN'; 'array' = 'ARRAY'; 'object' = 'OBJECT'
    }
    $result = @{}
    if ($Schema.ContainsKey('type')) {
        $result['type'] = $TypeMap[$Schema['type']] ?? $Schema['type'].ToString().ToUpper()
    }
    if ($Schema.ContainsKey('description')) { $result['description'] = $Schema['description'] }
    if ($Schema.ContainsKey('enum')) { $result['enum'] = $Schema['enum'] }
    if ($Schema.ContainsKey('nullable')) { $result['nullable'] = $Schema['nullable'] }
    if ($Schema.ContainsKey('required')) { $result['required'] = $Schema['required'] }
    if ($Schema.ContainsKey('items') -and $Schema['items'] -is [hashtable]) {
        $result['items'] = ConvertTo-GeminiSchema -Schema $Schema['items']
    }
    if ($Schema.ContainsKey('properties') -and $Schema['properties'] -is [hashtable]) {
        $props = @{}
        foreach ($key in $Schema['properties'].Keys) {
            $val = $Schema['properties'][$key]
            if ($val -is [hashtable]) { $props[$key] = ConvertTo-GeminiSchema -Schema $val }
            else { $props[$key] = $val }
        }
        $result['properties'] = $props
    }
    return $result
}

<#
.SYNOPSIS
    Calls an AI backend with a prompt and returns the generated text.
.DESCRIPTION
    Central dispatcher for all AI API calls in the AITriad module.  Accepts a
    prompt and model name, looks up the backend (Gemini, Claude, or Groq) from
    the model registry (ai-models.json), builds the backend-specific HTTP
    request, executes it with automatic retry on transient errors (HTTP 429,
    503, 529), and returns a uniform result object.

    The result object has six properties:
      Text        — the generated text content
      Backend     — 'gemini', 'claude', 'groq', or 'openai'
      Model       — the model ID that was used
      Truncated   — $true if the response was cut short by max_tokens
      Usage       — token counts (InputTokens, OutputTokens, TotalTokens) or $null
      RawResponse — the full deserialized API response

    Returns $null on failure (with warnings explaining the issue).
.PARAMETER Prompt
    The prompt text to send to the AI model.
.PARAMETER Model
    Model identifier from ai-models.json (e.g., 'gemini-2.5-flash',
    'claude-sonnet-4-5', 'groq-llama-3.3-70b').  Defaults to 'gemini-2.5-flash'.
.PARAMETER ApiKey
    Optional explicit API key.  If empty, resolved via Resolve-AIApiKey.
.PARAMETER Temperature
    Sampling temperature (0.0–2.0).  Lower = more deterministic.  Defaults to 0.1.
.PARAMETER MaxTokens
    Maximum tokens in the response.  Defaults to 1024.
.PARAMETER JsonMode
    When specified, requests JSON-formatted output from the backend.
.PARAMETER ResponseSchema
    Optional JSON Schema hashtable for structured output enforcement.
    When provided, implies -JsonMode. Gemini and Groq enforce the schema
    via constrained decoding; Claude injects the schema into the prompt.
.PARAMETER TimeoutSec
    HTTP request timeout in seconds.  Defaults to 120.
.PARAMETER MaxRetries
    Number of retry attempts on transient failures.  Defaults to 5.
.PARAMETER RetryDelays
    Array of delay durations (seconds) between retries.  Defaults to @(15, 45, 90, 120).
.PARAMETER FallbackModels
    Ordered list of models to try if the primary model fails permanently.
    If omitted, uses the fallback chain from ai-models.json (if defined for
    the primary model). Pass an empty array @() to disable fallback.
.PARAMETER SkipTokenCheck
    Skip the pre-flight token count check that warns when a prompt exceeds
    80% of the model's context window.
.EXAMPLE
    $Result = Invoke-AIApi -Prompt 'Summarize this document...' -Model 'gemini-2.5-flash'
    $Result.Text  # The generated summary

.EXAMPLE
    $Result = Invoke-AIApi -Prompt $Prompt -Model 'claude-sonnet-4-5' -JsonMode -MaxTokens 4096
    $Parsed = $Result.Text | ConvertFrom-Json

    Requests JSON output from Claude and parses it.
.EXAMPLE
    Invoke-AIApi -Prompt 'Hello' -Model 'groq-llama-3.3-70b' -Temperature 0.7

    Calls the Groq backend with higher creativity.
.EXAMPLE
    Invoke-AIApi -Prompt $P -Model 'gemini-2.5-flash' -FallbackModels @('groq-llama-3.3-70b-versatile')

    Falls back to Groq if Gemini fails.
#>
function Invoke-AIApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string]$SystemInstruction = '',
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ModelRegistry.Keys | Where-Object { $_ -like "$word*" } | Sort-Object })]
        [string]$Model       = 'gemini-2.5-flash',
        [string]$ApiKey      = '',
        [double]$Temperature = 0.1,
        [int]   $MaxTokens   = 1024,
        [switch]$JsonMode,
        [hashtable]$ResponseSchema,
        [int]   $TimeoutSec  = 120,
        [int]   $MaxRetries  = 5,
        [int[]] $RetryDelays = @(15, 45, 90, 120),
        [string[]]$FallbackModels,
        [switch]$SkipTokenCheck
    )

    # -- Resolve model info from registry -------------------------------------
    $ModelInfo = $script:ModelRegistry[$Model]
    if (-not $ModelInfo) {
        Write-Warning "Unknown model '$Model'. Valid models: $($script:ModelRegistry.Keys -join ', ')"
        return $null
    }

    $Backend    = $ModelInfo.Backend
    $ApiModelId = $ModelInfo.ApiModelId

    # -- Resolve API key ------------------------------------------------------
    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
    if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
        $EnvHint = switch ($Backend) {
            'gemini' { 'GEMINI_API_KEY' }
            'claude' { 'ANTHROPIC_API_KEY' }
            'groq'   { 'GROQ_API_KEY' }
            'openai' { 'OPENAI_API_KEY' }
        }
        Write-Warning "No API key found for $Backend backend. Set $EnvHint or AI_API_KEY."
        return $null
    }

    # -- Log AI configuration --------------------------------------------------
    Write-Verbose "[AI] Backend: $Backend | Model: $Model (API: $ApiModelId) | Key source: $($script:LastApiKeySource)"
    $modelChanged = $script:AIApiLastModel -and ($script:AIApiLastModel -ne $Model)
    if (-not $script:AIApiLoggedThisSession -or $modelChanged) {
        if ($modelChanged) {
            Write-Host "[AI] Model changed: $($script:AIApiLastModel) → $Model | Backend: $Backend | Key source: $($script:LastApiKeySource)" -ForegroundColor Yellow
        } else {
            Write-Host "[AI] Backend: $Backend | Model: $Model | Key source: $($script:LastApiKeySource)" -ForegroundColor DarkCyan
        }
        $script:AIApiLoggedThisSession = $true
    }
    $script:AIApiLastModel = $Model

    # -- Pre-flight token check ---------------------------------------------------
    if (-not $SkipTokenCheck) {
        $PromptLength = $Prompt.Length + $SystemInstruction.Length
        $EstTokens = [Math]::Ceiling($PromptLength / 3.2)
        $ContextLimit = if ($script:ContextWindows.ContainsKey($Backend)) { $script:ContextWindows[$Backend] } else { 131072 }
        if ($EstTokens -gt ($ContextLimit * 0.8)) {
            Write-Warning "$Model`: prompt is ~$EstTokens tokens (est.), which exceeds 80% of the $ContextLimit-token context window. Consider chunking or using a model with a larger context."
        }
    }

    # -- ResponseSchema implies JsonMode ----------------------------------------
    if ($ResponseSchema) { $JsonMode = [switch]::Present }

    # -- Build backend-specific request ---------------------------------------
    $Uri         = ''
    $Headers     = @{}
    $Body        = ''
    $ContentType = 'application/json; charset=utf-8'

    switch ($Backend) {
        'gemini' {
            $Uri = "https://generativelanguage.googleapis.com/v1beta/models/${ApiModelId}:generateContent?key=${ResolvedKey}"

            $Categories = @('HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT')
            $SafetyList = $Categories | ForEach-Object {
                @{ category = "HARM_CATEGORY_$_"; threshold = 'BLOCK_NONE' }
            }

            $GenConfig = @{
                temperature     = $Temperature
                maxOutputTokens = $MaxTokens
            }
            if ($JsonMode) {
                $GenConfig['responseMimeType'] = 'application/json'
                if ($ResponseSchema) {
                    $GenConfig['responseSchema'] = ConvertTo-GeminiSchema -Schema $ResponseSchema
                }
            }

            $GeminiBody = @{
                contents         = @(@{ parts = @(@{ text = $Prompt }) })
                generationConfig = $GenConfig
                safetySettings   = $SafetyList
            }
            if ($SystemInstruction) {
                $GeminiBody['systemInstruction'] = @{ parts = @(@{ text = $SystemInstruction }) }
            }
            $Body = $GeminiBody | ConvertTo-Json -Depth 10
        }

        'claude' {
            $Uri = 'https://api.anthropic.com/v1/messages'
            $Headers = @{
                'x-api-key'         = $ResolvedKey
                'anthropic-version' = '2023-06-01'
            }

            $ClaudePrompt = $Prompt
            if ($ResponseSchema) {
                $SchemaJson = $ResponseSchema | ConvertTo-Json -Depth 10
                $ClaudePrompt = $Prompt + "`n`nYou MUST respond with a JSON object conforming to this schema:`n$SchemaJson"
            }

            $ClaudeBody = @{
                model      = $ApiModelId
                max_tokens = $MaxTokens
                messages   = @(@{
                    role    = 'user'
                    content = $ClaudePrompt
                })
                temperature = $Temperature
            }
            if ($SystemInstruction) {
                $ClaudeBody['system'] = $SystemInstruction
            }
            $Body = $ClaudeBody | ConvertTo-Json -Depth 10
        }

        'groq' {
            $Uri = 'https://api.groq.com/openai/v1/chat/completions'
            $Headers = @{
                'Authorization' = "Bearer $ResolvedKey"
            }

            $GroqMessages = [System.Collections.Generic.List[object]]::new()
            if ($SystemInstruction) {
                $GroqMessages.Add(@{ role = 'system'; content = $SystemInstruction })
            }
            $GroqMessages.Add(@{ role = 'user'; content = $Prompt })

            $GroqBody = @{
                model       = $ApiModelId
                messages    = @($GroqMessages)
                temperature = $Temperature
                max_tokens  = $MaxTokens
            }
            if ($JsonMode) {
                if ($ResponseSchema) {
                    $GroqBody['response_format'] = @{
                        type        = 'json_schema'
                        json_schema = @{
                            name   = 'response'
                            schema = $ResponseSchema
                            strict = $true
                        }
                    }
                } else {
                    $GroqBody['response_format'] = @{ type = 'json_object' }
                }
            }

            $Body = $GroqBody | ConvertTo-Json -Depth 10
        }

        'openai' {
            $Uri = 'https://api.openai.com/v1/responses'
            $Headers = @{
                'Authorization' = "Bearer $ResolvedKey"
            }

            $OpenAIBody = @{
                model             = $ApiModelId
                max_output_tokens = $MaxTokens
            }
            if ($SystemInstruction) {
                $OpenAIBody['instructions'] = $SystemInstruction
                $OpenAIBody['input'] = $Prompt
            } else {
                $OpenAIBody['input'] = $Prompt
            }
            if ($JsonMode) {
                if ($ResponseSchema) {
                    $OpenAIBody['text'] = @{
                        format = @{
                            type        = 'json_schema'
                            json_schema = @{
                                name   = 'response'
                                schema = $ResponseSchema
                                strict = $true
                            }
                        }
                    }
                } else {
                    $OpenAIBody['text'] = @{ format = @{ type = 'json_object' } }
                }
            }

            $Body = $OpenAIBody | ConvertTo-Json -Depth 10
        }
    }

    # -- Call API with retry logic --------------------------------------------
    $Response  = $null
    $LastError = $null

    for ($Attempt = 0; $Attempt -lt $MaxRetries; $Attempt++) {
        try {
            # Encode body as UTF-8 bytes — PS 5.1's Invoke-RestMethod defaults to
            # Windows-1252, which mangles non-ASCII chars and produces invalid JSON.
            $BodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)

            $SplatParams = @{
                Uri         = $Uri
                Method      = 'POST'
                ContentType = $ContentType
                Body        = $BodyBytes
                TimeoutSec  = $TimeoutSec
                ErrorAction = 'Stop'
            }
            if ($Headers.Count -gt 0) {
                $SplatParams['Headers'] = $Headers
            }

            $Response  = Invoke-RestMethod @SplatParams
            $LastError = $null
            break
        } catch {
            $LastError  = $_
            $StatusCode = $_.Exception.Response.StatusCode.value__

            if ($StatusCode -in @(429, 503, 529) -and $Attempt -lt ($MaxRetries - 1)) {
                if ($Attempt -lt $RetryDelays.Count) { $Delay = $RetryDelays[$Attempt] } else { $Delay = $RetryDelays[-1] }
                Write-Warning "$($Backend): HTTP $StatusCode — retrying in ${Delay}s (attempt $($Attempt + 1)/$MaxRetries)"
                Start-Sleep -Seconds $Delay
            } else {
                break
            }
        }
    }

    if ($null -ne $LastError -or $null -eq $Response) {
        if ($LastError) { $StatusCode = $LastError.Exception.Response.StatusCode.value__ } else { $StatusCode = '?' }
        $Hint = switch ($StatusCode) {
            401     { 'Check your API key — it may be invalid or expired.' }
            403     { 'Access denied — verify your API key has the required permissions.' }
            429     { 'Rate limit exceeded — wait a moment and try again.' }
            { $_ -in 500, 502, 503 } { 'Server error — the API may be temporarily unavailable.' }
            default { '' }
        }
        Write-Warning "$($Backend): API call failed (HTTP $StatusCode) — $($LastError.Exception.Message)"
        if ($Hint) { Write-Warning "$($Backend): $Hint" }
        try {
            if ($LastError.Exception.Response) {
                $ErrStream = $LastError.Exception.Response.GetResponseStream()
                $ErrReader = [System.IO.StreamReader]::new($ErrStream)
                $ErrBody   = $ErrReader.ReadToEnd()
                $ErrReader.Close()
                Write-Warning "$($Backend): Response body: $ErrBody"
            }
        } catch { }

        # -- Model cascade: try fallback models ----------------------------------
        $CascadeModels = $FallbackModels
        if ($null -eq $CascadeModels -and $script:FallbackChains.ContainsKey($Model)) {
            $CascadeModels = $script:FallbackChains[$Model]
        }
        if ($CascadeModels -and $CascadeModels.Count -gt 0) {
            foreach ($FbModel in $CascadeModels) {
                $FbInfo = $script:ModelRegistry[$FbModel]
                if (-not $FbInfo) { continue }
                if ($StatusCode -in @(401, 403) -and $FbInfo.Backend -eq $Backend) { continue }
                $FbKey = Resolve-AIApiKey -ExplicitKey '' -Backend $FbInfo.Backend
                if ([string]::IsNullOrWhiteSpace($FbKey)) { continue }

                Write-Warning "Cascade: falling back to $FbModel ($($FbInfo.Backend))"
                $FbParams = @{
                    Prompt         = $Prompt
                    Model          = $FbModel
                    ApiKey         = $FbKey
                    Temperature    = $Temperature
                    MaxTokens      = $MaxTokens
                    TimeoutSec     = $TimeoutSec
                    MaxRetries     = 2
                    RetryDelays    = @(5, 15)
                    FallbackModels = @()
                    SkipTokenCheck = $true
                }
                if ($SystemInstruction) { $FbParams['SystemInstruction'] = $SystemInstruction }
                if ($JsonMode)          { $FbParams['JsonMode'] = $true }
                if ($ResponseSchema)    { $FbParams['ResponseSchema'] = $ResponseSchema }

                $FbResult = Invoke-AIApi @FbParams
                if ($null -ne $FbResult) { return $FbResult }
            }
        }

        return $null
    }

    # -- Extract text from backend-specific response envelope -----------------
    $Text      = $null
    $Truncated = $false
    $Usage     = $null

    switch ($Backend) {
        'gemini' {
            try {
                $Candidate = $Response.candidates[0]
                $FinishReason = $Candidate.finishReason
                if ($FinishReason -and $FinishReason -notin @('STOP', 'MAX_TOKENS')) {
                    Write-Warning "Gemini: generation stopped with finishReason=$FinishReason (content may have been blocked)"
                    return $null
                }
                $Truncated = ($FinishReason -eq 'MAX_TOKENS')
                $Text = $Candidate.content.parts[0].text
                $um = $Response.usageMetadata
                if ($um) {
                    $CachedCount = if ($um.PSObject.Properties['cachedContentTokenCount']) { [int]($um.cachedContentTokenCount) } else { 0 }
                    $Usage = [PSCustomObject]@{
                        InputTokens  = [int]($um.promptTokenCount)
                        OutputTokens = [int]($um.candidatesTokenCount)
                        CachedTokens = $CachedCount
                        TotalTokens  = [int]($um.totalTokenCount)
                    }
                }
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "Gemini: unexpected response shape (top-level keys: $TopKeys). Expected candidates[].content.parts[].text"
                return $null
            }
        }
        'claude' {
            try {
                $Text = ($Response.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text
                $Truncated = ($Response.stop_reason -eq 'max_tokens')
                $u = $Response.usage
                if ($u) {
                    $Usage = [PSCustomObject]@{
                        InputTokens  = [int]($u.input_tokens)
                        OutputTokens = [int]($u.output_tokens)
                        TotalTokens  = [int]($u.input_tokens) + [int]($u.output_tokens)
                    }
                }
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "Claude: unexpected response shape (top-level keys: $TopKeys). Expected content[].text"
                return $null
            }
        }
        'groq' {
            try {
                $Choice = $Response.choices[0]
                $Text = $Choice.message.content
                $Truncated = ($Choice.finish_reason -eq 'length')
                $u = $Response.usage
                if ($u) {
                    $Usage = [PSCustomObject]@{
                        InputTokens  = [int]($u.prompt_tokens)
                        OutputTokens = [int]($u.completion_tokens)
                        TotalTokens  = [int]($u.total_tokens)
                    }
                }
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "Groq: unexpected response shape (top-level keys: $TopKeys). Expected choices[].message.content"
                return $null
            }
        }
        'openai' {
            try {
                $MsgOutput = $Response.output | Where-Object { $_.type -eq 'message' } | Select-Object -First 1
                $Text = ($MsgOutput.content | Where-Object { $_.type -eq 'output_text' } | Select-Object -First 1).text
                $Truncated = ($Response.status -eq 'incomplete')
                $u = $Response.usage
                if ($u) {
                    $Usage = [PSCustomObject]@{
                        InputTokens  = [int]($u.input_tokens)
                        OutputTokens = [int]($u.output_tokens)
                        TotalTokens  = [int]($u.total_tokens)
                    }
                }
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "OpenAI: unexpected response shape (top-level keys: $TopKeys). Expected output[].content[].text"
                return $null
            }
        }
    }

    if ($Truncated) {
        Write-Warning "$($Backend): response was truncated (max_tokens reached). Output may be incomplete."
    }

    return [PSCustomObject]@{
        Text        = $Text
        Backend     = $Backend
        Model       = $Model
        Truncated   = $Truncated
        Usage       = $Usage
        RawResponse = $Response
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Get-AIMetadata — generalized metadata enrichment
#
# Sends the first ~6,000 words of the document to an AI backend and asks it
# to extract structured metadata.  Returns a hashtable with:
#   title, authors, date_published, pov_tags, topic_tags, one_liner
# On any failure returns $null.
# ─────────────────────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    Extracts structured metadata from a document using AI.
.DESCRIPTION
    Sends the first ~6,000 words of a Markdown document to an AI backend and
    asks it to extract structured metadata including title, authors, publication
    date, POV tags, topic tags, and a one-line summary.

    The metadata-extraction prompt is loaded from Prompts/metadata-extraction.prompt.
    POV tags are validated against the four canonical values (accelerationist,
    safetyist, skeptic, cross-cutting); unrecognized tags are rejected with a
    warning.  Topic tags are normalized to lowercase slugs.

    Returns a hashtable with: title, authors, date_published, pov_tags,
    topic_tags, one_liner.  Returns $null on any AI or parsing failure.
.PARAMETER MarkdownText
    The full Markdown text of the document.  Only the first ~6,000 words are
    sent to keep token costs low.
.PARAMETER SourceUrl
    Original URL for context (helps the AI identify the source).
.PARAMETER FallbackTitle
    A heuristic title extracted from HTML or filename, used if AI extraction
    fails.  Defaults to empty string.
.PARAMETER Model
    AI model to use for extraction.  Defaults to 'gemini-2.5-flash-lite' (fast
    and cheap for metadata tasks).
.PARAMETER ApiKey
    Optional explicit API key.  If empty, resolved via Resolve-AIApiKey.
.EXAMPLE
    $Meta = Get-AIMetadata -MarkdownText $Snapshot -SourceUrl 'https://example.com/paper'
    Write-Host "Title: $($Meta.title), POVs: $($Meta.pov_tags -join ', ')"

.EXAMPLE
    $Meta = Get-AIMetadata -MarkdownText $md -FallbackTitle 'Unknown Paper' -Model 'gemini-2.5-flash'

    Uses a faster model with a fallback title.
#>
function Get-AIMetadata {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$MarkdownText,
        [string]$SourceUrl     = '',
        [string]$FallbackTitle = '',
        [string]$Model         = 'gemini-2.5-flash-lite',
        [string]$ApiKey        = ''
    )

    $BackendLabel = $Model
    $ModelInfo = $script:ModelRegistry[$Model]
    if ($ModelInfo) { $BackendLabel = "$($ModelInfo.Backend)/$Model" }

    Write-Host "`n▶  Calling AI for metadata enrichment ($BackendLabel)" -ForegroundColor Cyan

    # Truncate to ~6,000 words to keep token cost low
    $Words   = $MarkdownText -split '\s+'
    if ($Words.Count -gt 6000) {
        $Excerpt = ($Words[0..5999] -join ' ') + "`n`n[... truncated for metadata extraction ...]"
    } else {
        $Excerpt = $MarkdownText
    }

    # Dev layout: scripts/AITriad/Prompts/; PSGallery: Prompts/ (flat)
    $PromptPath = Join-Path (Join-Path (Join-Path $PSScriptRoot 'AITriad') 'Prompts') 'metadata-extraction.prompt'
    if (-not (Test-Path $PromptPath)) {
        $PromptPath = Join-Path (Join-Path $PSScriptRoot 'Prompts') 'metadata-extraction.prompt'
    }
    $StaticPrompt = (Get-Content -Path $PromptPath -Raw).TrimEnd()

    $Prompt = @"
$StaticPrompt

SOURCE URL (for context): $SourceUrl
FALLBACK TITLE (from heuristics, improve if possible): $FallbackTitle

DOCUMENT EXCERPT:
$Excerpt
"@

    $AIResult = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ApiKey -Temperature 0.1 -MaxTokens 512 -JsonMode
    if ($null -eq $AIResult) { return $null }

    $RawText = $AIResult.Text

    # Strip markdown fences defensively
    $CleanJson = $RawText `
        -replace '(?s)^```json\s*', '' `
        -replace '(?s)\s*```$',     '' `
        | ForEach-Object { $_.Trim() }

    try {
        $Parsed = $CleanJson | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Write-Warning "$($AIResult.Backend): response was not valid JSON — metadata enrichment skipped"
        Write-Verbose "Raw AI response: $RawText"
        return $null
    }

    # Validate pov_tags
    $ValidPovs    = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations')
    $FilteredPovs = @()
    if ($Parsed.pov_tags) {
        $FilteredPovs = @($Parsed.pov_tags | Where-Object { $_ -in $ValidPovs })
        $Rejected = @($Parsed.pov_tags | Where-Object { $_ -notin $ValidPovs })
        if ($Rejected.Count -gt 0) {
            Write-Warning "AI returned unrecognised POV tags (ignored): $($Rejected -join ', ')"
        }
    }

    # Normalise topic_tags to lowercase slugs
    $NormTopics = @()
    if ($Parsed.topic_tags) {
        $NormTopics = @($Parsed.topic_tags | ForEach-Object {
            $_.ToLower() -replace '[^\w\-]', '-' -replace '-{2,}', '-' | ForEach-Object { $_.Trim('-') }
        } | Where-Object { $_ })
    }

    # Validate date_published format (gap 2.1): accept YYYY, YYYY-MM, YYYY-MM-DD
    $ValidDate = $null
    if ($Parsed.date_published) {
        $dp = "$($Parsed.date_published)".Trim()
        if ($dp -match '^\d{4}(-\d{2}(-\d{2})?)?$') {
            $ValidDate = $dp
        } else {
            [datetime]$parsedDt = [datetime]::MinValue
            $fmts = @('MMMM yyyy', 'MMM yyyy', 'MMMM d, yyyy', 'MMM d, yyyy',
                       'd MMMM yyyy', 'd MMM yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy',
                       'yyyy/MM/dd', 'MMMM dd, yyyy', 'MMM dd, yyyy')
            foreach ($fmt in $fmts) {
                if ([datetime]::TryParseExact($dp, $fmt,
                        [System.Globalization.CultureInfo]::InvariantCulture,
                        [System.Globalization.DateTimeStyles]::None, [ref]$parsedDt)) {
                    $ValidDate = $parsedDt.ToString('yyyy-MM-dd')
                    Write-Verbose "Normalized date_published '$dp' → '$ValidDate'"
                    break
                }
            }
            if (-not $ValidDate) {
                Write-Warning "AI returned unrecognised date_published format: '$dp' — field cleared"
            }
        }
    }

    # Enforce title/one_liner length limits (gap 2.2)
    $Title = if ($Parsed.title) { "$($Parsed.title)".Trim() } else { '' }
    if ($Title.Length -gt 200) {
        $Title = $Title.Substring(0, 197) + '...'
        Write-Warning "AI returned title exceeding 200 chars — truncated"
    }
    if (-not $Title -and $FallbackTitle) { $Title = $FallbackTitle }

    $OneLiner = if ($Parsed.one_liner) { "$($Parsed.one_liner)".Trim() } else { '' }
    if ($OneLiner.Length -gt 300) {
        $OneLiner = $OneLiner.Substring(0, 297) + '...'
        Write-Warning "AI returned one_liner exceeding 300 chars — truncated"
    }

    # Deduplicate authors on normalized lowercase (gap 2.3)
    $Authors = @()
    if ($Parsed.authors) {
        $seen = @{}
        foreach ($a in $Parsed.authors) {
            $key = "$a".Trim().ToLower()
            if ($key -and -not $seen.ContainsKey($key)) {
                $seen[$key] = $true
                $Authors += "$a".Trim()
            }
        }
        $dupeCount = @($Parsed.authors).Count - $Authors.Count
        if ($dupeCount -gt 0) {
            Write-Warning "AI returned $dupeCount duplicate author(s) — deduplicated"
        }
    }

    Write-Host "   ✓  AI metadata: title='$Title'  povs=[$($FilteredPovs -join ',')]  topics=[$($NormTopics -join ',')]" -ForegroundColor Green

    return @{
        title          = $Title
        authors        = $Authors
        date_published = $ValidDate
        pov_tags       = $FilteredPovs
        topic_tags     = $NormTopics
        one_liner      = $OneLiner
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Repair-TruncatedJson
#
# Attempts to salvage a JSON string that was truncated mid-output by closing
# any open strings, arrays, and objects.  Returns $null if repair fails.
# ─────────────────────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    Attempts to salvage truncated or malformed JSON from AI responses.
.DESCRIPTION
    AI models sometimes produce JSON that is cut off mid-output due to token
    limits.  This function attempts to repair such output using two strategies:

    Strategy 1 — Close the truncated tail.  If the text is mid-string, closes
    the quote.  Strips trailing commas, colons, and dangling keys.  Rescans for
    open brackets/braces and appends the necessary closing characters.

    Strategy 2 — Truncate back to the last position where the root JSON object
    was fully closed (a complete, valid document).

    Returns the repaired JSON string if either strategy produces valid JSON.
    Returns $null if repair is not possible.
.PARAMETER Text
    The raw (possibly truncated) JSON text to repair.  May include markdown
    code fences, which are stripped automatically.
.EXAMPLE
    $Fixed = Repair-TruncatedJson -Text '{"key": "value", "arr": [1, 2'
    # Returns: '{"key": "value", "arr": [1, 2]}'

.EXAMPLE
    $Fixed = Repair-TruncatedJson -Text $AIResult.Text
    if ($Fixed) { $Obj = $Fixed | ConvertFrom-Json }
#>
function Repair-TruncatedJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Text
    )

    $trimmed = $Text.Trim()

    # Already valid?
    try {
        $null = $trimmed | ConvertFrom-Json -ErrorAction Stop
        return $trimmed
    } catch { }

    # Strip markdown fences if present
    $trimmed = $trimmed -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $trimmed = $trimmed.Trim()

    # Fix trailing commas before } or ] (common LLM output issue)
    $commaFixed = $trimmed -replace ',\s*([\]\}])', '$1'
    if ($commaFixed -ne $trimmed) {
        try {
            $null = $commaFixed | ConvertFrom-Json -ErrorAction Stop
            return $commaFixed
        } catch { }
        $trimmed = $commaFixed   # keep the fix for subsequent strategies
    }

    # Walk the string tracking nesting depth
    $inString  = $false
    $escaped   = $false
    $stack     = [System.Collections.Generic.Stack[char]]::new()
    $lastGood  = -1   # index of last position where a value/element ended cleanly

    for ($i = 0; $i -lt $trimmed.Length; $i++) {
        $c = $trimmed[$i]

        if ($inString) {
            if ($escaped)       { $escaped = $false; continue }
            if ($c -eq '\')     { $escaped = $true;  continue }
            if ($c -eq '"')     { $inString = $false; continue }
            continue
        }

        switch ($c) {
            '"'  { $inString = $true }
            '{'  { $stack.Push('}') }
            '['  { $stack.Push(']') }
            '}'  {
                if ($stack.Count -gt 0 -and $stack.Peek() -eq '}') {
                    [void]$stack.Pop()
                    if ($stack.Count -eq 0) { $lastGood = $i }
                }
            }
            ']'  {
                if ($stack.Count -gt 0 -and $stack.Peek() -eq ']') {
                    [void]$stack.Pop()
                    if ($stack.Count -eq 0) { $lastGood = $i }
                }
            }
        }
    }

    # Strategy 1: close truncated tail then close all remaining open structures.
    # Try progressively stripping back to find a valid boundary.
    if ($stack.Count -gt 0) {
        $repaired = $trimmed
        # If truncated mid-string, close the string
        if ($inString) {
            $repaired += '"'
        }
        # Remove trailing whitespace/comma/colon, then dangling key or incomplete value
        $repaired = $repaired -replace '[,:\s]+$', ''
        # Strip dangling key ("key") left after removing colon
        $repaired = $repaired -replace ',\s*"[^"]*"\s*$', ''
        # Strip dangling key at start of an object: { "key" → {
        $repaired = $repaired -replace '(\{)\s*"[^"]*"\s*$', '$1'

        # Re-scan for open structures after trimming
        $reStack = [System.Collections.Generic.Stack[char]]::new()
        $reInStr = $false; $reEsc = $false
        for ($j = 0; $j -lt $repaired.Length; $j++) {
            $rc = $repaired[$j]
            if ($reInStr) {
                if ($reEsc) { $reEsc = $false; continue }
                if ($rc -eq '\') { $reEsc = $true; continue }
                if ($rc -eq '"') { $reInStr = $false }
                continue
            }
            switch ($rc) {
                '"' { $reInStr = $true }
                '{' { $reStack.Push('}') }
                '[' { $reStack.Push(']') }
                '}' { if ($reStack.Count -gt 0 -and $reStack.Peek() -eq '}') { [void]$reStack.Pop() } }
                ']' { if ($reStack.Count -gt 0 -and $reStack.Peek() -eq ']') { [void]$reStack.Pop() } }
            }
        }
        # Close all remaining open brackets/braces
        while ($reStack.Count -gt 0) {
            $repaired += $reStack.Pop()
        }
        try {
            $null = $repaired | ConvertFrom-Json -ErrorAction Stop
            return $repaired
        } catch { }
    }

    # Strategy 2: truncate back to the last position where the root object
    # was fully closed, if we found one
    if ($lastGood -gt 0) {
        $candidate = $trimmed.Substring(0, $lastGood + 1)
        try {
            $null = $candidate | ConvertFrom-Json -ErrorAction Stop
            return $candidate
        } catch { }
    }

    return $null
}

# ─────────────────────────────────────────────────────────────────────────────
# Backward-compatibility aliases
# ─────────────────────────────────────────────────────────────────────────────
Set-Alias -Name 'Invoke-GeminiApi'   -Value 'Invoke-AIApi'
Set-Alias -Name 'Get-GeminiMetadata' -Value 'Get-AIMetadata'

Export-ModuleMember -Function Invoke-AIApi, Get-AIMetadata, Resolve-AIApiKey, Repair-TruncatedJson, Measure-PromptTokens `
                    -Alias    Invoke-GeminiApi, Get-GeminiMetadata
