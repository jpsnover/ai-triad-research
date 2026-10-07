# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Builds the test-powershell "failed on both run 1 and the in-job rerun" verdict
    message (t/3546). Extracted from the inline ci.yml verdict (t/3530) so its CONTENT
    is asserted by tests/FlakeVerdict.Tests.ps1 — the exit-code GV arms (A/B/D) stay
    green even if someone strips the caveat, so the message needs its own regression guard.

.DESCRIPTION
    t/3546 precision gap: the t/3530 rerun is immediate + in the SAME job, so a
    resource-contention failure (a FIXED port held in TIME_WAIT, a parallel-shard bind
    of the same port, a lock, a temp file) is STILL contended when the rerun executes —
    both attempts fail identically and the old "FAILED (both runs)" wording read as a
    definitive real failure. A confidently-wrong verdict stops people looking further
    (a TL hold was placed on a PR whose code was fine).

    This message therefore claims only what an in-job rerun can prove: it names the
    contention classes it CANNOT clear, prints each failed test's duration (a sub-100ms
    fast-fail on a port-binding test is the contention signature), and directs the reader
    to verify with a FRESH run on the same head before treating the failure as definitive.
    The best-effort Start-Sleep in ci.yml only clears transient-releasing contention (a
    subprocess mid-teardown); a fixed-port TIME_WAIT (~60s on Linux) or a live parallel
    holder is NOT cleared by any short delay — the source fix is an ephemeral -Port 0
    bind (t/3547, PowerShell scope).
#>

function Format-FlakeVerdictMessage {
    <#
    .SYNOPSIS
        Returns the ::error:: verdict lines for tests that failed run 1 AND the rerun.
        Each -FailedTest entry is a hashtable/object with Name and (optional) DurationMs.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$FailedTest)

    # StrictMode is scoped to THIS function on purpose: FlakeVerdict.ps1 is dot-sourced
    # into ci.yml's verdict run block, and a file-scope Set-StrictMode would leak into
    # (and could change the behaviour of) the surrounding t/3530 logic. Keep it local.
    Set-StrictMode -Version Latest

    # Read a property from either a hashtable or a [pscustomobject] under StrictMode.
    function script:Get-Prop($obj, [string]$Name) {
        if ($obj -is [hashtable]) {
            if ($obj.ContainsKey($Name)) { return $obj[$Name] } else { return $null }
        }
        $p = $obj.PSObject.Properties[$Name]
        if ($p) { return $p.Value } else { return $null }
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($t in $FailedTest) {
        $name = script:Get-Prop $t 'Name'
        $ms   = script:Get-Prop $t 'DurationMs'
        $dur  = if ($null -ne $ms) { "$([int]$ms)ms" } else { 'unknown duration' }
        $lines.Add("::error::test-powershell: FAILED on run 1 AND an in-job rerun ($dur): $name")
    }
    # The claim-limit caveat — the load-bearing part (t/3546). Names the contention
    # classes an in-job rerun cannot clear, and directs to a fresh-run verify.
    $lines.Add("::error::test-powershell: NOTE — the rerun ran immediately in the SAME job, so it cannot clear resource contention held by the first attempt: a fixed/held port in TIME_WAIT, a parallel-shard bind of the same port, a lock, or a temp file. A sub-100ms fast-fail on a port-binding test is the contention signature, not proof of a real defect. Before treating this as definitively broken, verify with a FRESH run on the same head (t/3546).")
    return $lines.ToArray()
}

function Get-FlakeRerunVerdict {
    <#
    .SYNOPSIS
        t/4080: decide whether run-1 failures "self-healed" on the in-job rerun.
    .DESCRIPTION
        The old verdict (ci.yml, t/3530 R4) was `rerun.Result -eq 'Passed' -and rerun.TotalCount -ge
        failed.Count`. Both halves are blind to NotRun: a rerun whose Filter.FullName matched NOTHING
        (data-driven `It '... <Name>' -ForEach` tests) reports Result=Passed and TotalCount=<every test,
        all NotRun>. Real failures were laundered to green (main 696ea125, run 37668037103: 12 hidden).

        IDENTITY = File + ExpandedPath (SO e/279#6). ExpandedPath alone omits the file, so the same
        Describe/It names in two files, or two -ForEach rows expanding to the same string, would collide;
        a last-write-wins map then lets a co-named Passed entry erase a Failed one. Entries are therefore
        AGGREGATED per key, never overwritten.

        A key is HEALED iff the rerun has at least as many entries under it as run 1 had failures, and
        EVERY rerun entry under it is 'Passed'. Absent / NotRun / Skipped / Failed => not healed.
        PURE: takes plain objects with File, ExpandedPath (and Result for the rerun); no Pester call.
    .OUTPUTS
        [pscustomobject] Healed [bool]; NotRerun [string[]]; StillFailing [string[]]  (keys "<file> :: <path>")
    #>
    [CmdletBinding()]
    param(
        # Run-1 failed tests: objects with File and ExpandedPath.
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $FailedTests,
        # Rerun tests: objects with File, ExpandedPath and Result.
        [AllowNull()][object[]] $RerunTests
    )
    $key = { param($t) '{0} :: {1}' -f [string]$t.File, [string]$t.ExpandedPath }
    $need = @{}
    foreach ($f in @($FailedTests)) { if ($null -ne $f) { $k = & $key $f; $need[$k] = 1 + [int]$need[$k] } }
    $got = @{}
    foreach ($t in @($RerunTests)) {
        if ($null -eq $t) { continue }
        $k = & $key $t
        if (-not $got.ContainsKey($k)) { $got[$k] = [System.Collections.Generic.List[string]]::new() }
        $got[$k].Add([string]$t.Result)
    }
    $notRerun = [System.Collections.Generic.List[string]]::new()
    $stillFailing = [System.Collections.Generic.List[string]]::new()
    foreach ($k in $need.Keys) {
        if (-not $got.ContainsKey($k) -or $got[$k].Count -lt $need[$k]) { $notRerun.Add($k); continue }
        if (@($got[$k] | Where-Object { $_ -ne 'Passed' }).Count -gt 0) { $stillFailing.Add($k) }
    }
    [pscustomobject]@{
        Healed       = ($need.Count -gt 0 -and $notRerun.Count -eq 0 -and $stillFailing.Count -eq 0)
        NotRerun     = @($notRerun | Sort-Object)
        StillFailing = @($stillFailing | Sort-Object)
    }
}
