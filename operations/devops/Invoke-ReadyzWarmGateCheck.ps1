#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pre-traffic-shift deploy gate (t/3114): block the ACA traffic-shift until the new revision's
    embeddings.json cache is warm, by polling GET /readyz. Honors root constraint #1 (t/3090#11):
    no traffic to an un-warmed revision (which would re-embed ~3600 taxonomy texts per debate).
.DESCRIPTION
    Polls {BaseUrl}/readyz against the 0%-traffic revision (its own FQDN) every -PollIntervalSec,
    up to -TimeoutSec, and maps each poll's status via Get-ReadyzGateAction (pure predicate):
      proceed (200)  -> cache warm; exit 0 (deploy shifts traffic).
      skip    (404)  -> /readyz ABSENT (image predates the endpoint); warn + exit 0 so the deploy
                        that first introduces /readyz cannot deadlock on its own not-yet-present
                        route. ONLY 404/absent is skipped.
      wait    (else) -> present-but-503 (still warming) or any transient/ambiguous code (incl. a
                        connection error, treated as code 0): keep polling. A present-503 is NEVER
                        skipped — it is waited on.
    On sustained 'wait' past -TimeoutSec: in ENFORCING mode FAIL (exit 1) with an explicit ::error::
    so a genuinely hung/corrupt warm fails the deploy legibly (existing auto-rollback fires) rather
    than as a mystery timeout. In -ObserveOnly mode the timeout is a ::warning:: + exit 0 (see below).

    -ObserveOnly (t/2683 Gate Promotion, real-env-first): compute + LOG the warm outcome but NEVER
    fail — timeout downgrades ::error::->::warning:: and exits 0. Used to validate real-env warm
    detection (FQDN resolves, real 503->200, no false timeout) on ≥1 real deploy BEFORE the gate is
    promoted to blocking. In observe mode the caller also does NOT reference the warm output in its
    success/rollback conditions, so the gate is provably non-blocking.

    Exit codes: 0 = warm OR absent-skip (proceed) OR (-ObserveOnly) timeout;  1 = ENFORCING timeout.

    -TimeoutSec default 300s sizes the observed pre-warm cost: 63MB embeddings.json read from the
    AzureFiles mount + JSON.parse + cold ONNX warmup (t/3090#10). -PollIntervalSec default 10s.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $BaseUrl,
    [int] $TimeoutSec      = 300,
    [int] $PollIntervalSec = 10,
    [switch] $ObserveOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Pure decision predicate (dot-sourceable; no I/O)
. (Join-Path $PSScriptRoot 'ReadyzWarmGatePredicate.ps1')

$uri      = "$($BaseUrl.TrimEnd('/'))/readyz"
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
$poll     = 0

Write-Host "Warm-gate: polling $uri (timeout ${TimeoutSec}s, interval ${PollIntervalSec}s) until embeddings.json cache is ready..."

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

    $action = Get-ReadyzGateAction -StatusCode $status

    switch ($action) {
        'proceed' {
            Write-Host "Warm-gate PASSED after $poll poll(s): /readyz 200 ready — $body"
            exit 0
        }
        'skip' {
            Write-Host "::warning::Warm-gate SKIPPED: /readyz returned 404 (absent) — this revision's image predates the /readyz endpoint (t/3112/t/3114). Proceeding WITHOUT the embeddings warm-gate for this deploy only."
            exit 0
        }
        default {
            # 'wait' — present-but-503 (warming) or transient/ambiguous code.
            if ([DateTime]::UtcNow -ge $deadline) {
                if ($ObserveOnly) {
                    Write-Host "::warning::[OBSERVE-ONLY] embeddings pre-warm not ready (/readyz last status=$status) within ${TimeoutSec}s. In ENFORCING mode this would block the traffic-shift and roll back; observe-only logs and proceeds (exit 0) so real-env warm timing can be validated before the gate is promoted to blocking (t/2683). (t/3114)"
                    exit 0
                }
                Write-Host "::error::embeddings pre-warm not ready (/readyz last status=$status) within ${TimeoutSec}s — NOT shifting traffic (root constraint #1). A revision stuck warming past the pre-warm budget (63MB AzureFiles load + JSON.parse + cold ONNX) is failed legibly; rollback restores the previous revision. (t/3114)"
                exit 1
            }
            Write-Host "  poll #${poll}: /readyz status=$status (warming) — waiting ${PollIntervalSec}s..."
            Start-Sleep -Seconds $PollIntervalSec
        }
    }
}
