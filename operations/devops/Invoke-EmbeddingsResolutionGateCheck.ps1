#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Post-deploy gate (warn-only): confirm the embeddings cache resolved the canary key by
    reading the resolves field on GET /readyz (anon-exempt, no auth needed). t/3091.
.DESCRIPTION
    Calls GET /readyz and reads the `resolves` bool added by ServerAPI's /readyz upgrade
    (p/555#21-23). The warm-gate (#1689) already blocks on /readyz 503, so by the time this
    gate runs (if: warm_gate.outputs.warm == 'true'), /readyz is 200 with resolves:true.
    This step provides explicit log evidence of resolution state and degrades gracefully if
    the `resolves` field is absent (pre-upgrade revision).

    /readyz contract (ServerAPI p/555#23):
      200 { status:"ready",  nodeCount, resolves:true  }  — corpus loaded + canary resolves
      503 { status:"warming", present, nodeCount, resolves:false, reason } — not ready

    NOTE: The warm-gate's 200-gating already enforces resolution (non-resolving → 503 →
    warm-gate blocks, this step is skipped). This gate is a logging confirmation, not an
    independent guard. Kept separate for per-step observability in CI.

    WARN-ONLY BY DESIGN (t/3192): stays continue-on-error:true. The FIRE arm (resolves:false →
    BLOCK the traffic-shift) is the WARM-GATE's job (Invoke-ReadyzWarmGateCheck.ps1, peer-blocking
    t/3148); this step is a logging confirmation only. Flipping it to blocking would only catch an
    unhandled script crash — resolves:false is a handled exit-0 the warm-gate already blocks — so it
    adds a flaky surface with zero new signal coverage (TL, t/3192#5). Both GV arms are now REAL-ENV
    proven (t/3192#6):

    GV FIRE arm:  a real resolves:false rev (present:true, nodeCount>0; forced via READYZ_FORCE_RESOLVES_FALSE)
                  → /readyz 503 → warm-gate emits warm=false → deploy blocks the shift + rolls back.
    GV CLEAN arm: resolves:true → warm-gate warm=true → shift; a healthy rev never false-blocks.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $BaseUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Endpoint = "$($BaseUrl.TrimEnd('/'))/readyz"

Write-Host "Embeddings resolution gate: reading resolution state from $Endpoint ..."

try {
    $resp = Invoke-RestMethod `
        -Uri        $Endpoint `
        -Method     Get `
        -TimeoutSec 15 `
        -ErrorAction Stop

    $resolvesField   = $resp.PSObject.Properties['resolves']
    $nodeCountField  = $resp.PSObject.Properties['nodeCount']
    $reasonField     = $resp.PSObject.Properties['reason']

    if ($null -eq $resolvesField) {
        # resolves field absent — /readyz upgrade (p/555#21) not yet on this revision
        $keys = $resp.PSObject.Properties.Name -join ', '
        Write-Host ("::warning::Embeddings resolution gate: /readyz missing 'resolves' field — " +
            "ServerAPI /readyz upgrade (p/555#21) not yet on this revision. " +
            "Response keys: $keys. Resolution unconfirmed; warm-gate already proved nodeCount>0. (t/3091)")
        return
    }

    $resolves   = [bool]$resolvesField.Value
    $nodeCount  = [int]($null -ne $nodeCountField ? $nodeCountField.Value : -1)
    $reason     = if ($null -ne $reasonField) { $reasonField.Value } else { '' }

    if ($resolves) {
        Write-Host ("Embeddings resolution gate PASSED: /readyz reports resolves=true " +
            "(nodeCount=$nodeCount). Canary keyed lookup confirmed on this revision. (t/3091)")
    } else {
        # Shouldn't reach here (warm-gate blocks on 503 before this runs), but guard anyway.
        Write-Host ("::warning::Embeddings resolution gate UNEXPECTED: /readyz returned 200 " +
            "but resolves=false (nodeCount=$nodeCount, reason=$reason). " +
            "Warm-gate should have blocked — investigate gate sequencing. (t/3091)")
    }

} catch {
    Write-Host ("::warning::Embeddings resolution gate: GET $Endpoint failed — " +
        "$($_.Exception.Message). Skipping resolution check. (t/3091)")
}
