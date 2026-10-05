# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AIProviderKeyStatus {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): probes each backend's API key
        (configured? valid? rate limit?) via a data-driven per-backend table,
        replacing a 4-arm switch.
    .DESCRIPTION
        Each backend's probe result is a hashtable that only carries the
        rate-limit keys that backend's probe can actually populate (gemini:
        none; claude/groq: all three; openai: RateLimit/RateRemaining but not
        RateReset). Read via bracket indexing (t/3926) -- dot-access on a
        hashtable key that was never set throws PropertyNotFoundException
        under Set-StrictMode, which used to get caught by the surrounding
        try/catch and silently flip Valid to $false even on a successful
        probe, for gemini and (partially) openai.
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
    # rate-limit fields this backend's probe response actually exposes.
    # RateFields intentionally varies per backend (gemini exposes none;
    # openai doesn't expose RateReset) -- read via bracket indexing below,
    # never dot-access, so an absent field returns $null instead of throwing.
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

                # t/3926: bracket indexing -- dot-access on a hashtable key never
                # set for this backend (see RateFields above) throws under
                # Set-StrictMode, wrongly flipping Valid to $false via the catch.
                $Status.Valid = $ProbeResult['Valid']
                if ($ProbeResult['RateLimit'])     { $Status.RateLimit = $ProbeResult['RateLimit'] }
                if ($ProbeResult['RateRemaining']) { $Status.RateRemaining = $ProbeResult['RateRemaining'] }
                if ($ProbeResult['RateReset'])     { $Status.RateReset = $ProbeResult['RateReset'] }
            }
            catch {
                $Status.Valid = $false
            }
        }
        $ProviderStatus.Add($Status)
    }

    Write-Output -NoEnumerate $ProviderStatus
}
