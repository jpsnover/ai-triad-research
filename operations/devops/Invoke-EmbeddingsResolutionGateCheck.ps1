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

    WARN-ONLY: continue-on-error:true until both GV arms proven on the upgraded /readyz.
    Flip-to-blocking is a separate Gate-Promotion PR per Gate Promotion Discipline.

    GV FIRE arm:  resolves:false on a non-resolving revision → warm-gate blocks; this step
                  is skipped (if: warm == 'true'). FIRE arm is warm-gate's responsibility.
    GV CLEAN arm: resolves:true after warm-gate passes → logs PASS.
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
