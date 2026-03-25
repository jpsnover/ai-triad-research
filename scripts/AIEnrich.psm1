# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Version 7.0
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
        Write-Verbose "AIEnrich: loaded $($script:ModelRegistry.Count) models from ai-models.json"
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
function Resolve-AIApiKey {
    [CmdletBinding()]
    param(
        [string]$ExplicitKey,
        [Parameter(Mandatory)][string]$Backend
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitKey)) {
        return $ExplicitKey
    }

    $EnvVarMap = @{
        'gemini' = 'GEMINI_API_KEY'
        'claude' = 'ANTHROPIC_API_KEY'
        'groq'   = 'GROQ_API_KEY'
    }

    $BackendEnvVar = $EnvVarMap[$Backend]
    if ($BackendEnvVar) {
        $BackendKey = [System.Environment]::GetEnvironmentVariable($BackendEnvVar)
        if (-not [string]::IsNullOrWhiteSpace($BackendKey)) {
            return $BackendKey
        }
    }

    $Fallback = $env:AI_API_KEY
    if (-not [string]::IsNullOrWhiteSpace($Fallback)) {
        return $Fallback
    }

    return $null
}

# ─────────────────────────────────────────────────────────────────────────────
# Invoke-AIApi — central dispatcher
#
# Accepts a prompt and model name, looks up the backend, builds the
# backend-specific request, calls the API with retry logic, and returns a
# uniform result object.
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-AIApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string]$Model       = 'gemini-2.5-flash',
        [string]$ApiKey      = '',
        [double]$Temperature = 0.1,
        [int]   $MaxTokens   = 1024,
        [switch]$JsonMode,
        [int]   $TimeoutSec  = 120,
        [int]   $MaxRetries  = 3,
        [int[]] $RetryDelays = @(5, 15, 45)
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
        }
        Write-Warning "No API key found for $Backend backend. Set $EnvHint or AI_API_KEY."
        return $null
    }

    # -- Build backend-specific request ---------------------------------------
    $Uri         = ''
    $Headers     = @{}
    $Body        = ''
    $ContentType = 'application/json'

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
            }

            $Body = @{
                contents         = @(@{ parts = @(@{ text = $Prompt }) })
                generationConfig = $GenConfig
                safetySettings   = $SafetyList
            } | ConvertTo-Json -Depth 10
        }

        'claude' {
            $Uri = 'https://api.anthropic.com/v1/messages'
            $Headers = @{
                'x-api-key'         = $ResolvedKey
                'anthropic-version' = '2023-06-01'
            }

            $Body = @{
                model      = $ApiModelId
                max_tokens = $MaxTokens
                messages   = @(@{
                    role    = 'user'
                    content = $Prompt
                })
                temperature = $Temperature
            } | ConvertTo-Json -Depth 10
        }

        'groq' {
            $Uri = 'https://api.groq.com/openai/v1/chat/completions'
            $Headers = @{
                'Authorization' = "Bearer $ResolvedKey"
            }

            $GroqBody = @{
                model       = $ApiModelId
                messages    = @(@{
                    role    = 'user'
                    content = $Prompt
                })
                temperature = $Temperature
                max_tokens  = $MaxTokens
            }
            if ($JsonMode) {
                $GroqBody['response_format'] = @{ type = 'json_object' }
            }

            $Body = $GroqBody | ConvertTo-Json -Depth 10
        }
    }

    # -- Call API with retry logic --------------------------------------------
    $Response  = $null
    $LastError = $null

    for ($Attempt = 0; $Attempt -lt $MaxRetries; $Attempt++) {
        try {
            $SplatParams = @{
                Uri         = $Uri
                Method      = 'POST'
                ContentType = $ContentType
                Body        = $Body
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
                $Delay = if ($Attempt -lt $RetryDelays.Count) { $RetryDelays[$Attempt] } else { $RetryDelays[-1] }
                Write-Warning "$($Backend): HTTP $StatusCode — retrying in ${Delay}s (attempt $($Attempt + 1)/$MaxRetries)"
                Start-Sleep -Seconds $Delay
            } else {
                break
            }
        }
    }

    if ($null -ne $LastError -or $null -eq $Response) {
        $StatusCode = if ($LastError) { $LastError.Exception.Response.StatusCode.value__ } else { '?' }
        $Hint = switch ($StatusCode) {
            401     { 'Check your API key — it may be invalid or expired.' }
            403     { 'Access denied — verify your API key has the required permissions.' }
            429     { 'Rate limit exceeded — wait a moment and try again.' }
            { $_ -in 500, 502, 503 } { 'Server error — the API may be temporarily unavailable.' }
            default { '' }
        }
        Write-Warning "$($Backend): API call failed (HTTP $StatusCode) — $($LastError.Exception.Message)"
        if ($Hint) { Write-Warning "$($Backend): $Hint" }
        return $null
    }

    # -- Extract text from backend-specific response envelope -----------------
    $Text = $null

    switch ($Backend) {
        'gemini' {
            try {
                $Text = $Response.candidates[0].content.parts[0].text
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "Gemini: unexpected response shape (top-level keys: $TopKeys). Expected candidates[].content.parts[].text"
                return $null
            }
        }
        'claude' {
            try {
                $Text = ($Response.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "Claude: unexpected response shape (top-level keys: $TopKeys). Expected content[].text"
                return $null
            }
        }
        'groq' {
            try {
                $Text = $Response.choices[0].message.content
            } catch {
                $TopKeys = ($Response.PSObject.Properties.Name | Select-Object -First 5) -join ', '
                Write-Warning "Groq: unexpected response shape (top-level keys: $TopKeys). Expected choices[].message.content"
                return $null
            }
        }
    }

    return [PSCustomObject]@{
        Text        = $Text
        Backend     = $Backend
        Model       = $Model
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

    Write-Host "`n`u{25B6}  Calling AI for metadata enrichment ($BackendLabel)" -ForegroundColor Cyan

    # Truncate to ~6,000 words to keep token cost low
    $Words   = $MarkdownText -split '\s+'
    $Excerpt = if ($Words.Count -gt 6000) {
        ($Words[0..5999] -join ' ') + "`n`n[... truncated for metadata extraction ...]"
    } else {
        $MarkdownText
    }

    $PromptPath = Join-Path $PSScriptRoot 'AITriad' 'Prompts' 'metadata-extraction.prompt'
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
    $ValidPovs    = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
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

    Write-Host "   `u{2713}  AI metadata: title='$($Parsed.title)'  povs=[$($FilteredPovs -join ',')]  topics=[$($NormTopics -join ',')]" -ForegroundColor Green

    return @{
        title          = if ($Parsed.title)          { $Parsed.title }           else { $FallbackTitle }
        authors        = if ($Parsed.authors)        { @($Parsed.authors) }      else { @() }
        date_published = if ($Parsed.date_published) { $Parsed.date_published }  else { $null }
        pov_tags       = $FilteredPovs
        topic_tags     = $NormTopics
        one_liner      = if ($Parsed.one_liner)      { $Parsed.one_liner }       else { '' }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Repair-TruncatedJson
#
# Attempts to salvage a JSON string that was truncated mid-output by closing
# any open strings, arrays, and objects.  Returns $null if repair fails.
# ─────────────────────────────────────────────────────────────────────────────
function Repair-TruncatedJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Text
    )

    $trimmed = $Text.Trim()

    # Already valid?
    try {
        $null = $trimmed | ConvertFrom-Json -Depth 20 -ErrorAction Stop
        return $trimmed
    } catch { }

    # Strip markdown fences if present
    $trimmed = $trimmed -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $trimmed = $trimmed.Trim()

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
            $null = $repaired | ConvertFrom-Json -Depth 20 -ErrorAction Stop
            return $repaired
        } catch { }
    }

    # Strategy 2: truncate back to the last position where the root object
    # was fully closed, if we found one
    if ($lastGood -gt 0) {
        $candidate = $trimmed.Substring(0, $lastGood + 1)
        try {
            $null = $candidate | ConvertFrom-Json -Depth 20 -ErrorAction Stop
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

Export-ModuleMember -Function Invoke-AIApi, Get-AIMetadata, Resolve-AIApiKey, Repair-TruncatedJson `
                    -Alias    Invoke-GeminiApi, Get-GeminiMetadata
