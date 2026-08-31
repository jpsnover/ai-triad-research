#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pre-traffic-shift deploy warm-gate (t/3114, blocking flip t/3148): decide whether the new
    revision's embeddings.json cache is warm by polling GET /readyz, then emit warm=true/false for
    the deploy workflow's peer-blocking wiring. Honors root constraint #1 (t/3090#11): no traffic
    to an un-warmed revision (which would re-embed ~3600 taxonomy texts per debate).
.DESCRIPTION
    Polls {BaseUrl}/readyz against the 0%-traffic revision (its own FQDN) every -PollIntervalSec,
    up to -TimeoutSec, mapping each poll (status + body) via Get-ReadyzGateAction (pure predicate):
      proceed -> 200 with a JSON body {status:'ready', nodeCount>0} (cache warm).
      wait    -> everything else (503 warming, 404 absent, a non-'ready'/SPA-HTML 200, or a
                 connection error treated as code 0): keep polling to the deadline.

    Mechanism B (t/3148, TL-decided p/542#108) — the gate is OUTPUT-driven, not exit-code-driven:
    this script writes `warm=true` (proceed) or `warm=false` (timeout / any non-warm outcome) to
    $env:GITHUB_OUTPUT and ALWAYS exits 0. The deploy workflow shifts traffic iff warm=='true' and
    runs the full rollback path iff warm=='false' (peer of the acceptance/persona gates).

    FAIL-CLOSED: warm defaults to false and is only set true on a proven-warm 200, so a hung probe,
    an unexpected error, or a sustained-503 timeout all emit warm=false → the deploy blocks the
    traffic-shift and rolls back rather than silently shipping an un-warmed revision.

    -TimeoutSec default 300s sizes the observed pre-warm cost: 63MB embeddings.json read from the
    AzureFiles mount + JSON.parse + cold ONNX warmup (t/3090#10). -PollIntervalSec default 10s.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $BaseUrl,
    [int] $TimeoutSec      = 300,
    [int] $PollIntervalSec = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Pure decision predicate (dot-sourceable; no I/O)
. (Join-Path $PSScriptRoot 'ReadyzWarmGatePredicate.ps1')

# Emit the peer-gate output the deploy workflow keys on (mechanism B, t/3148/t/3114#3).
function Write-WarmOutput {
    param([bool] $Warm)
    if ($env:GITHUB_OUTPUT) {
        "warm=$($Warm.ToString().ToLowerInvariant())" | Add-Content -Path $env:GITHUB_OUTPUT
    }
}

$uri      = "$($BaseUrl.TrimEnd('/'))/readyz"
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
$poll     = 0
$warm     = $false   # fail-closed default

Write-Host "Warm-gate: polling $uri (timeout ${TimeoutSec}s, interval ${PollIntervalSec}s) until embeddings.json cache is ready..."

try {
    while ($true) {
        $poll++
        $status = 0
        $body   = ''
        try {
            $resp   = Invoke-WebRequest -Uri $uri -Method Get -SkipHttpErrorCheck -TimeoutSec 15
            $status = [int]$resp.StatusCode
            $body   = ($resp.Content | Out-String).Trim()
        } catch {
            # Connection-level failure (server not answering) — treat as 'wait' (transient); the
            # health_check step already confirmed server-up, so this should be rare and self-clears.
            $status = 0
            Write-Host "  poll #${poll}: request error ($($_.Exception.Message)) — treating as warming"
        }

        $action = Get-ReadyzGateAction -StatusCode $status -Body $body

        if ($action -eq 'proceed') {
            Write-Host "Warm-gate PASSED after $poll poll(s): /readyz 200 ready — $body"
            $warm = $true
            break
        }

        # 'wait' — 503 warming, 404 absent, a non-'ready'/SPA-HTML 200, or a transient/connection error.
        if ([DateTime]::UtcNow -ge $deadline) {
            Write-Host "::error::embeddings pre-warm not ready (/readyz last status=$status, body=$body) within ${TimeoutSec}s — warm=false: NOT shifting traffic (root constraint #1). The deploy rolls back to the previous revision. (t/3148)"
            $warm = $false
            break
        }
        Write-Host "  poll #${poll}: /readyz status=$status (warming) — waiting ${PollIntervalSec}s..."
        Start-Sleep -Seconds $PollIntervalSec
    }
} catch {
    # Any unexpected error → fail-closed (warm=false), so the gate blocks rather than shipping unverified.
    Write-Host "::error::warm-gate probe errored ($($_.Exception.Message)) — warm=false (fail-closed). (t/3148)"
    $warm = $false
} finally {
    Write-WarmOutput -Warm $warm
}

# Mechanism B: always exit 0 — the deploy workflow gates on the warm output, not this exit code.
exit 0
