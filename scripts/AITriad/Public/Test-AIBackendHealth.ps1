# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Probes each AI backend with a minimal completion request and reports latency and status.
.DESCRIPTION
    Sends a 1-token completion probe ("ping") through the same Invoke-AIApi path used by all
    production cmdlets, using the default model for each backend from ai-models.json. Reports
    reachability, round-trip latency, and whether the completion succeeded.

    Unlike Test-AIApiKey (which hits an auth-only /models endpoint without consuming tokens),
    Test-AIBackendHealth exercises the full completion stack — key resolution, serialization,
    transport, and deserialization. A backend that passes Test-AIApiKey but fails here has a
    model-level or quota problem.

    Per-backend failure is returned as a row with status 'error' or 'timeout', not a thrown
    exception. Only unrecoverable setup failures (e.g., ai-models.json not found) throw.

.PARAMETER Backend
    Single backend to probe. One of: gemini, claude, groq, openai, deepseek, azure, zai,
    moonshot, ollama.

.PARAMETER All
    Probe every backend that has a default model in ai-models.json.

.PARAMETER TimeoutSec
    Per-probe timeout in seconds. Default 15.

.EXAMPLE
    Test-AIBackendHealth -Backend gemini
    # Returns one row: backend, model, status, latency_ms.

.EXAMPLE
    Test-AIBackendHealth -All | Format-Table Backend, Model, Status, LatencyMs, ErrorMessage

.EXAMPLE
    Test-AIBackendHealth -All | Where-Object Status -ne 'ok'
    # Surface only degraded backends before starting a debate run.

.LINK
    Test-AIApiKey
.LINK
    Show-AITriadHelp
#>
function Test-AIBackendHealth {
    [CmdletBinding(DefaultParameterSetName = 'One')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ParameterSetName = 'One', Position = 0)]
        [ValidateSet('gemini', 'claude', 'groq', 'openai', 'deepseek', 'azure', 'zai', 'moonshot', 'ollama')]
        [string]$Backend,

        [Parameter(Mandatory, ParameterSetName = 'All')]
        [switch]$All,

        [ValidateRange(1, 300)]
        [int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest

    # ── Load ai-models.json defaults ────────────────────────────────────
    $ConfigPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..' 'ai-models.json'))
    if (-not (Test-Path $ConfigPath)) {
        throw (New-ActionableError `
            -Goal     'Load AI backend defaults for health probe' `
            -Problem  "ai-models.json not found at: $ConfigPath" `
            -Location 'Test-AIBackendHealth' `
            -NextSteps 'Verify the repo root contains ai-models.json and that the module is loaded from its expected path.')
    }
    $Config  = Get-Content -Raw $ConfigPath | ConvertFrom-Json
    $Defaults = $Config.defaults

    # ── Inner probe ──────────────────────────────────────────────────────
    function _Probe-Backend {
        param([string]$B, [string]$ModelId, [int]$Timeout)

        $Row = [ordered]@{
            Backend      = $B
            Model        = $ModelId
            Status       = 'error'
            LatencyMs    = $null
            ErrorMessage = $null
            TestedAt     = [datetime]::UtcNow
        }

        if ([string]::IsNullOrEmpty($ModelId)) {
            $Row['ErrorMessage'] = "No default model configured for backend '$B' in ai-models.json."
            return [PSCustomObject]$Row
        }

        $Sw = [System.Diagnostics.Stopwatch]::StartNew()
        $AIResult = Invoke-AIApi `
            -Prompt         'ping' `
            -Model          $ModelId `
            -MaxTokens      5 `
            -TimeoutSec     $Timeout `
            -MaxRetries     0 `
            -Temperature    0.0 `
            -SkipTokenCheck `
            -WarningVariable WarnVar
        $Sw.Stop()

        $Row['LatencyMs'] = [int]$Sw.ElapsedMilliseconds

        if ($null -ne $AIResult -and $AIResult.PSObject.Properties['Text']) {
            $Row['Status'] = 'ok'
        } else {
            $WarnText = if (@($WarnVar).Count -gt 0) { "$($WarnVar[0])" } else { $null }
            $IsTimeout = ($Sw.ElapsedMilliseconds -ge ($Timeout * 1000 - 500)) -or
                         ($WarnText -match 'timeout|timed.out|TaskCanceled|OperationCanceled')
            $Row['Status']       = if ($IsTimeout) { 'timeout' } else { 'error' }
            $Row['ErrorMessage'] = if ($WarnText) { $WarnText } else {
                if ($IsTimeout) { "Backend '$B' did not respond within ${Timeout}s." }
                else            { "Invoke-AIApi returned null for backend '$B'." }
            }
        }

        return [PSCustomObject]$Row
    }

    # ── Dispatch ─────────────────────────────────────────────────────────
    if ($PSCmdlet.ParameterSetName -eq 'All') {
        foreach ($B in $Defaults.PSObject.Properties.Name) {
            $MId = $Defaults.$B
            _Probe-Backend -B $B -ModelId $MId -Timeout $TimeoutSec
        }
    } else {
        $MId = if ($Defaults.PSObject.Properties[$Backend]) { $Defaults.$Backend } else { $null }
        _Probe-Backend -B $Backend -ModelId $MId -Timeout $TimeoutSec
    }
}
