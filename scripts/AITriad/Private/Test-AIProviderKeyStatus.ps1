# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AIProviderKeyStatus {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): probes each backend's API key
        (configured? valid? rate limit?) via a data-driven per-backend table,
        replacing a 4-arm switch.
    .DESCRIPTION
        Preserves current behavior exactly, bug-for-bug: each backend's probe
        result is a hashtable that only carries the rate-limit keys that
        backend's original switch arm set (gemini: none; claude/groq: all
        three; openai: RateLimit/RateRemaining but not RateReset). Reading a
        missing key via dot-access under Set-StrictMode throws, caught by the
        surrounding try/catch, which is why gemini (and openai, partially)
        currently report Valid=false even on a successful probe -- a known,
        separately-tracked bug (t/3926), NOT fixed here per t/3910's
        pure-refactor rule. t/3926 will update this function once it's safe
        to change that behavior.
    .OUTPUTS
        [System.Collections.Generic.List[PSObject]] -- one status object per
        backend (gemini, claude, groq, openai).
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param()

    Set-StrictMode -Version Latest

    $Dashboards = @{
        gemini = 'https://aistudio.google.com/apikey'
        claude = 'https://console.anthropic.com/settings/billing'
        groq   = 'https://console.groq.com/settings/usage'
        openai = 'https://platform.openai.com/usage'
    }

    # Per-backend probe config: how to build the URL/headers, and which
    # rate-limit fields this backend's result hashtable carries. RateFields
    # intentionally varies per backend to reproduce t/3926 bug-for-bug.
    $ProbeConfig = @{
        gemini = @{
            BuildUrl     = { param($Key) "https://generativelanguage.googleapis.com/v1beta/models?key=$Key&pageSize=1" }
            BuildHeaders = { param($Key) $null }
            RateFields   = @()
        }
        claude = @{
            BuildUrl     = { param($Key) 'https://api.anthropic.com/v1/models' }
            BuildHeaders = { param($Key) @{ 'x-api-key' = $Key; 'anthropic-version' = '2023-06-01' } }
            RateFields   = @('RateLimit', 'RateRemaining', 'RateReset')
        }
        groq = @{
            BuildUrl     = { param($Key) 'https://api.groq.com/openai/v1/models' }
            BuildHeaders = { param($Key) @{ 'Authorization' = "Bearer $Key" } }
            RateFields   = @('RateLimit', 'RateRemaining', 'RateReset')
        }
        openai = @{
            BuildUrl     = { param($Key) 'https://api.openai.com/v1/models' }
            BuildHeaders = { param($Key) @{ 'Authorization' = "Bearer $Key" } }
            RateFields   = @('RateLimit', 'RateRemaining')
        }
    }
    $RateHeaderNames = @{
        RateLimit     = 'x-ratelimit-limit-requests'
        RateRemaining = 'x-ratelimit-remaining-requests'
        RateReset     = 'x-ratelimit-reset-requests'
    }

    $ProviderStatus = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Bk in @('gemini', 'claude', 'groq', 'openai')) {
        $Key = Resolve-AIApiKey -ExplicitKey '' -Backend $Bk
        $KeySrc = $null
        try { $KeySrc = $script:LastApiKeySource } catch { }
        if (-not $KeySrc) {
            $EnvNames = @{ gemini = 'GEMINI_API_KEY'; claude = 'ANTHROPIC_API_KEY'; groq = 'GROQ_API_KEY'; openai = 'OPENAI_API_KEY' }
            if (-not [string]::IsNullOrWhiteSpace($Key)) {
                $BkEnv = $EnvNames[$Bk]
                if ($BkEnv -and [System.Environment]::GetEnvironmentVariable($BkEnv)) { $KeySrc = "`$env:$BkEnv" }
                elseif ($env:AI_API_KEY) { $KeySrc = '$env:AI_API_KEY' }
                else { $KeySrc = 'configured' }
            }
        }
        $Status = [PSCustomObject]@{
            Backend       = $Bk
            KeyConfigured = -not [string]::IsNullOrWhiteSpace($Key)
            KeySource     = $KeySrc
            Valid         = $null
            RateLimit     = $null
            RateRemaining = $null
            RateReset     = $null
            Dashboard     = $Dashboards[$Bk]
        }

        if ($Status.KeyConfigured) {
            try {
                $Cfg = $ProbeConfig[$Bk]
                $Url = & $Cfg.BuildUrl $Key
                $Headers = & $Cfg.BuildHeaders $Key
                if ($Headers) {
                    $Resp = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop -Headers $Headers
                } else {
                    $Resp = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
                }

                $ProbeResult = @{ Valid = $Resp.StatusCode -eq 200 }
                foreach ($Field in $Cfg.RateFields) {
                    $HeaderName = $RateHeaderNames[$Field]
                    $ProbeResult[$Field] = if ($Resp.Headers[$HeaderName]) { $Resp.Headers[$HeaderName] } else { $null }
                }

                $Status.Valid = $ProbeResult.Valid
                if ($ProbeResult.RateLimit)     { $Status.RateLimit = $ProbeResult.RateLimit }
                if ($ProbeResult.RateRemaining) { $Status.RateRemaining = $ProbeResult.RateRemaining }
                if ($ProbeResult.RateReset)     { $Status.RateReset = $ProbeResult.RateReset }
            }
            catch {
                $Status.Valid = $false
            }
        }
        $ProviderStatus.Add($Status)
    }

    Write-Output -NoEnumerate $ProviderStatus
}
