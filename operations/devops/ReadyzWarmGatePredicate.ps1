#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure decision predicate for the /readyz deploy warm-gate (t/3114, blocking flip t/3148).
    No I/O — dot-sourceable + unit-testable.
.DESCRIPTION
    Maps a single /readyz poll (HTTP status code + response body) to the deploy gate's per-poll
    action. The caller (Invoke-ReadyzWarmGateCheck.ps1) loops on 'wait' until 'proceed' or a
    bounded timeout, then emits warm=true/false for the deploy workflow's peer-blocking wiring.

    Contract (taxonomy-editor/src/server/routes/meta.ts, t/3112):
      200  {status:'ready',   nodeCount>0}  -> embeddings.json cache warm.
      503  {status:'warming', ...}          -> cache still loading.
      503  {status:'failed',  reason:...}   -> DEFINITIVE failure (e.g. data-root-failed, t/3309).
      404  (route ABSENT)                   -> image predates /readyz (old revision).

    Gate semantics (blocking flip, TL-decided mechanism B, p/542#108):
      - 'fail'     iff  the body parses as JSON with .status == 'failed' (ANY status code). A
                        DEFINITIVE, non-transient failure the server has already decided (t/3343):
                        the caller stops immediately with warm=false instead of polling the whole
                        TimeoutSec treating it as warm-up. Checked FIRST so it wins over the non-200
                        'wait' short-circuit. Fail-SAFE is identical to a timeout (no traffic shift);
                        this only fails FASTER and labels the outcome a hard failure, not "warming".
      - 'proceed'  iff  StatusCode == 200  AND  the body parses as JSON with
                        .status == 'ready' AND nodeCount > 0 (a real warm signal).
      - 'wait'     for EVERYTHING else, and the loop blocks on sustained 'wait':
          * non-200 (503 warming, 5xx, connection-error sentinel 0) -> wait.
          * 404 (route absent) -> wait. /readyz is live in prod now, so a dropped route must
            BLOCK, not skip (t/3148 dropped the old 404->'skip' short-circuit; the first-deploy
            deadlock rationale is gone — the introducing image already carries the route).
          * 200 with a non-'ready' status, OR an SPA-fallback HTML page (an unregistered /readyz
            served index.html — NON-JSON) -> wait. A bare 200 is NOT a warm signal; the body
            shape is load-bearing (ServerAPI p/542#74, confirmed real on run 33434586564).

    Parse the body as JSON and check .status — NEVER substring/regex the raw string (brittle to
    whitespace, field order, added fields). Deliberately conservative: only a proven-warm 200
    proceeds, so an un-warmed/anomalous/SPA revision blocks the traffic-shift rather than shipping
    a re-embed-storm revision (root constraint #1, t/3090#11).
#>

function Get-ReadyzGateAction {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [int] $StatusCode,
        [Parameter()] [AllowNull()] [AllowEmptyString()] [string] $Body
    )
    # DEFINITIVE failure first: the server signals a hard, non-transient failure (e.g.
    # data-root-failed) via {status:'failed'} on ANY status code (503 today). Detect it before the
    # non-200 'wait' short-circuit so the caller can fail FAST instead of polling the whole
    # TimeoutSec as warm-up (t/3343). StrictMode-safe: the parse + .status access stay inside try,
    # so a malformed/SPA/scalar body or a body with no .status yields $null → never a false 'fail'.
    $bodyStatus = $null
    if (-not [string]::IsNullOrWhiteSpace($Body)) {
        try { $bodyStatus = ($Body | ConvertFrom-Json -ErrorAction Stop).status } catch { $bodyStatus = $null }
    }
    if ($bodyStatus -eq 'failed') { return 'fail' }

    if ($StatusCode -ne 200) { return 'wait' }
    try {
        $parsed = $Body | ConvertFrom-Json -ErrorAction Stop
        # Property access is INSIDE the try so that under the caller's Set-StrictMode -Version
        # Latest a body missing the contract fields (e.g. {}, a JSON scalar/array, or the SPA
        # index.html fallback that isn't even JSON) raises a missing-property error that is
        # caught → 'wait'. Never a false 'proceed' on a malformed/SPA 200.
        if ($parsed.status -eq 'ready' -and [int]$parsed.nodeCount -gt 0) { return 'proceed' }
    } catch {
        return 'wait'
    }
    return 'wait'
}
