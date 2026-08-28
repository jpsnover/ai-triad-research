#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure decision predicate for the /readyz deploy warm-gate (t/3114). No I/O — dot-sourceable + unit-testable.
.DESCRIPTION
    Maps a single /readyz poll's HTTP status code to the deploy gate's per-poll action. The
    caller (Invoke-ReadyzWarmGateCheck.ps1) loops on 'wait' until 200 or a bounded timeout.

    Contract (taxonomy-editor/src/server/routes/meta.ts, t/3112):
      200  {status:'ready',   nodeCount>0}  -> embeddings.json cache warm.
      503  {status:'warming', ...}          -> cache still loading.
      404  (route ABSENT)                   -> image predates /readyz (old revision).

    Gate semantics (TL GV-preview p/542#65):
      - 200            -> 'proceed'  (cache warm; shift traffic).
      - 404            -> 'skip'     (endpoint ABSENT; the deploy that first introduces
                                      /readyz must not deadlock on its own not-yet-present
                                      route — proceed WITHOUT the gate, warn).
      - anything else  -> 'wait'     (present-but-503, or any ambiguous/transient code; the
        (incl. 503)                   loop keeps polling and, on sustained 'wait' past the
                                      timeout, FAILS the deploy legibly). A present-503 is
                                      NEVER skipped — only an explicit 404/absent is.

    Deliberately conservative: ONLY 404 short-circuits to 'skip'. Every non-200/404 code
    waits, so an un-warmed (503) or anomalous revision blocks the traffic-shift rather than
    silently shipping a re-embed-storm revision (root constraint #1, t/3090#11).
#>

function Get-ReadyzGateAction {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [int] $StatusCode
    )
    switch ($StatusCode) {
        200     { 'proceed'; break }
        404     { 'skip';    break }
        default { 'wait' }
    }
}
