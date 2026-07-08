# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Tests whether an AI provider API key is present and authenticates successfully.
.DESCRIPTION
    Verifies that an API key for the given backend can reach the provider's
    auth-checked endpoint and be accepted. Uses each provider's cheapest
    auth-only surface (a models-list endpoint) — no completion/tokens are
    consumed, so this is safe to run against paid tiers.

    Distinguishes four outcomes:
      - Functional=$true, StatusCode=200        — key works
      - Functional=$false, StatusCode=401/403   — key present but rejected
      - Functional=$false, StatusCode=$null     — network/timeout error
      - Functional=$false, KeySource='(none)'   — no key found for this backend

    Key resolution order (delegated to Resolve-AIApiKey):
      1. -ApiKey parameter
      2. Backend-specific env var: GEMINI_API_KEY, ANTHROPIC_API_KEY / CLAUDE_API_KEY,
         GROQ_API_KEY, OPENAI_API_KEY, AZURE_OPENAI_API_KEY
      3. $env:AI_API_KEY fallback

    Supported backends: gemini, claude, groq, openai, azure.
    Azure requires -Endpoint (base URL, e.g. https://myrg.openai.azure.com).
.PARAMETER Backend
    Provider to test. One of: gemini, claude, groq, openai, azure.
.PARAMETER ApiKey
    Explicit key. If omitted, env vars are used (see key resolution order above).
.PARAMETER Endpoint
    Azure only: base endpoint URL (e.g. https://myresource.openai.azure.com).
    Ignored for other backends.
.PARAMETER All
    Tests every backend that has a key resolvable. Overrides -Backend.
    Azure is skipped by -All unless AZURE_OPENAI_ENDPOINT is also set.
.PARAMETER TimeoutSec
    HTTP timeout per request. Default 10 seconds.
.EXAMPLE
    Test-AIApiKey -Backend gemini
    # Uses $env:GEMINI_API_KEY (or $env:AI_API_KEY fallback), returns a status object.
.EXAMPLE
    Test-AIApiKey -Backend claude -ApiKey $mySecret
    # Tests a specific key explicitly.
.EXAMPLE
    Test-AIApiKey -All | Format-Table Backend, Functional, StatusCode, LatencyMs, KeySource
    # Sweep every provider that has a key on the machine.
.EXAMPLE
    Test-AIApiKey -Backend azure -Endpoint 'https://myrg.openai.azure.com'
#>
function Test-AIApiKey {
    [CmdletBinding(DefaultParameterSetName = 'One')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ParameterSetName = 'One', Position = 0)]
        [ValidateSet('gemini', 'claude', 'groq', 'openai', 'azure')]
        [string]$Backend,

        [Parameter(ParameterSetName = 'One')]
        [string]$ApiKey,

        [Parameter(ParameterSetName = 'One')]
        [string]$Endpoint,

        [Parameter(Mandatory, ParameterSetName = 'All')]
        [switch]$All,

        [ValidateRange(1, 300)]
        [int]$TimeoutSec = 10
    )

    Set-StrictMode -Version Latest

    # ── Internal probe: run one backend ──────────────────────────────
    function _Probe-Backend {
        param(
            [string]$B,
            [string]$ExplicitKey,
            [string]$AzureEndpoint,
            [int]$Timeout
        )

        $Result = [ordered]@{
            Backend      = $B
            KeySource    = '(none found)'
            Functional   = $false
            StatusCode   = $null
            ModelsFound  = $null
            LatencyMs    = $null
            ErrorMessage = $null
            TestedAt     = [datetime]::UtcNow
        }

        $Key = Resolve-AIApiKey -ExplicitKey $ExplicitKey -Backend $B
        # Resolve-AIApiKey records source in its own script scope; grab it via GetVariable
        # (avoids leaking a module-private into the caller). Falls back gracefully.
        $LastSource = try {
            & (Get-Module AIEnrich) { $script:LastApiKeySource }
        } catch { $null }
        if ($LastSource) { $Result['KeySource'] = $LastSource }

        if (-not $Key) {
            $Result['ErrorMessage'] = "No API key resolvable for backend '$B'."
            return [PSCustomObject]$Result
        }

        # Build probe URL + headers per backend
        $Uri     = $null
        $Headers = @{}
        switch ($B) {
            'gemini' {
                # ?key=<KEY> is Gemini's REST auth pattern; no header needed.
                $EncodedKey = [System.Uri]::EscapeDataString($Key)
                $Uri = "https://generativelanguage.googleapis.com/v1beta/models?key=$EncodedKey"
            }
            'claude' {
                $Uri = 'https://api.anthropic.com/v1/models'
                $Headers['x-api-key']         = $Key
                $Headers['anthropic-version'] = '2023-06-01'
            }
            'groq' {
                $Uri = 'https://api.groq.com/openai/v1/models'
                $Headers['Authorization'] = "Bearer $Key"
            }
            'openai' {
                $Uri = 'https://api.openai.com/v1/models'
                $Headers['Authorization'] = "Bearer $Key"
            }
            'azure' {
                $Ep = if ($AzureEndpoint) { $AzureEndpoint } else { $env:AZURE_OPENAI_ENDPOINT }
                if (-not $Ep) {
                    $Result['ErrorMessage'] = "Azure backend requires -Endpoint (or `$env:AZURE_OPENAI_ENDPOINT)."
                    return [PSCustomObject]$Result
                }
                $Ep = $Ep.TrimEnd('/')
                $Uri = "$Ep/openai/models?api-version=2023-05-15"
                $Headers['api-key'] = $Key
            }
        }

        # Probe the endpoint
        $Sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $Resp = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method GET -TimeoutSec $Timeout -ErrorAction Stop
            $Sw.Stop()
            $Result['StatusCode'] = 200
            $Result['Functional'] = $true
            $Result['LatencyMs']  = [int]$Sw.ElapsedMilliseconds
            # Best-effort model count — every supported provider returns a list.
            $ModelList = if ($Resp.PSObject.Properties['data']) { $Resp.data }
                         elseif ($Resp.PSObject.Properties['models']) { $Resp.models }
                         elseif ($Resp.PSObject.Properties['value']) { $Resp.value }
                         else { @() }
            $Result['ModelsFound'] = @($ModelList).Count
        } catch [Microsoft.PowerShell.Commands.HttpResponseException] {
            # PS7's Invoke-RestMethod raises this for any non-2xx response.
            # It carries the actual HTTP status; distinguish auth (401/403) from other 4xx/5xx.
            $Sw.Stop()
            $Result['LatencyMs'] = [int]$Sw.ElapsedMilliseconds
            $Ex = $_.Exception
            $Status = $null
            try { $Status = [int]$Ex.Response.StatusCode } catch { }
            $Result['StatusCode']   = $Status
            $Result['ErrorMessage'] = if ($Status -eq 401 -or $Status -eq 403) {
                "Auth rejected (HTTP ${Status}). Key is present but not accepted by $B."
            } elseif ($Status) {
                "HTTP ${Status}: $($Ex.Message)"
            } else {
                $Ex.Message
            }
        } catch [System.Net.Http.HttpRequestException] {
            # True network-layer failure (DNS, TCP, TLS) — no HTTP response ever arrived.
            $Sw.Stop()
            $Result['LatencyMs']    = [int]$Sw.ElapsedMilliseconds
            $Result['ErrorMessage'] = "Network error: $($_.Exception.Message)"
        } catch {
            $Sw.Stop()
            $Result['LatencyMs']    = [int]$Sw.ElapsedMilliseconds
            $Result['ErrorMessage'] = $_.Exception.Message
        }

        return [PSCustomObject]$Result
    }

    # ── Dispatch ─────────────────────────────────────────────────────
    if ($PSCmdlet.ParameterSetName -eq 'All') {
        # Sweep — pick backends known to Resolve-AIApiKey.
        $Backends = @('gemini', 'claude', 'groq', 'openai')
        # Include azure only when both endpoint AND key are visible.
        if ($env:AZURE_OPENAI_ENDPOINT -and $env:AZURE_OPENAI_API_KEY) {
            $Backends += 'azure'
        }
        foreach ($B in $Backends) {
            _Probe-Backend -B $B -ExplicitKey '' -AzureEndpoint $env:AZURE_OPENAI_ENDPOINT -Timeout $TimeoutSec
        }
    } else {
        _Probe-Backend -B $Backend -ExplicitKey $ApiKey -AzureEndpoint $Endpoint -Timeout $TimeoutSec
    }
}
