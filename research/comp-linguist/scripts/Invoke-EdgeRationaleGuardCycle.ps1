# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    t/2947 (c): the real-data positive clean cycle for the edge-rationale regression guard.

.DESCRIPTION
    Forensic harness for the CL-owned evidence half of the Block-flip GV package (t/2947,
    e/120#38). It exercises the LANDED guard (scripts/AITriad/Private/Test-EdgeRationaleRegression.ps1)
    against a REAL rationale-rich HEAD baseline — a throwaway worktree of the data repo pinned at
    -BaselineSha — and records four results.

    Why this shape (TL e/120#46, t/2947#6): a negative-only result is not evidence. "Zero warnings"
    is byte-identical to a silently-dead baseline lookup AND to a payload that was never scanned.
    So the cycle asserts TWO POSITIVES before it is allowed to read the clean green:

      P1  baseline RESOLVED   — the HEAD baseline yields hadRationale.Count > 0
      P2  payload SCANNED     — checked-edge count > 0 AND skipped-edge count = 0

    P1/P2 are established two independent ways, and the harness requires both to agree:
      * ANALYTIC  — the guard's keying rule (source|type|target, non-whitespace rationale) is
        replicated here over the same two documents and the counts recorded.
      * BEHAVIOURAL (the stronger arm) — a deliberate strip of exactly N edges, run against the
        REAL HEAD baseline with NO injected -BaselineEdges, must return exactly N. A guard whose
        baseline failed to resolve returns 0; a guard that scanned nothing returns 0. Returning
        exactly N is only possible if the baseline resolved AND the payload was scanned.

    The clean arm (zero warnings) is reported as PASS only when P1 and P2 both hold.

    This harness edits no PowerShell module file and writes nothing to the data repo — the
    baseline worktree is created under -WorkDir and removed on exit.

.PARAMETER BaselineSha
    Data-repo commit to pin as HEAD. Default ba3128f5 — empirically verified rationale-rich:
    33,454 edges / 33,448 with non-empty rationale / 33,454 fully keyed (CL probe, 2026-08-23).

.PARAMETER StripCount
    Number of rationale-bearing edges to strip in the deliberate-strip arm. Default 25.

.EXAMPLE
    ./Invoke-EdgeRationaleGuardCycle.ps1 -Verbose
#>
[CmdletBinding()]
param(
    [string]$BaselineSha = 'ba3128f5',
    # Resolved lazily below (an empty default keeps the derivation out of the param block, which
    # cannot see the repo layout when this script runs from inside a linked worktree).
    [string]$DataRepo,
    [string]$GuardPath   = (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'scripts/AITriad/Private/Test-EdgeRationaleRegression.ps1'),
    [string]$EdgesRelPath = 'taxonomy/Origin/edges.json',
    [int]$StripCount     = 25,
    [string]$WorkDir     = (Join-Path ([System.IO.Path]::GetTempPath()) "cl-t2947-c-$PID"),
    [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Harness {
    # Project convention: unrecoverable errors carry Goal / Problem / Location / Next Steps.
    # New-ActionableError lives in the AITriad module; this harness deliberately dot-sources only
    # the guard file (load-order independence), so fall back to the same four-field shape when the
    # module is not loaded rather than degrading to a bare throw.
    param([string]$Goal, [string]$Problem, [string]$Location, [string[]]$NextSteps)
    if (Get-Command New-ActionableError -ErrorAction SilentlyContinue) {
        throw (New-ActionableError -Goal $Goal -Problem $Problem -Location $Location -NextSteps $NextSteps -PassThru)
    }
    throw ("Goal: $Goal`nProblem: $Problem`nLocation: $Location`nNext Steps: " + ($NextSteps -join ' | '))
}

# The guard is a Private module file; New-ActionableError is only reached on the Block-mode
# throw, which this cycle does not exercise (mode stays Warn), so dot-sourcing the single file
# is sufficient and keeps the harness independent of module load order.
if ([string]::IsNullOrWhiteSpace($DataRepo)) {
    # Honour the documented precedence (env var > .aitriad.json > sibling fallback). `--git-common-dir`
    # resolves to the MAIN checkout's .git even when this script runs from a linked worktree, so the
    # data repo is found relative to the real repo root rather than the worktree's parent.
    if ($env:AI_TRIAD_DATA_ROOT) { $DataRepo = $env:AI_TRIAD_DATA_ROOT }
    else {
        $common = (& git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not $common) {
            Stop-Harness -Goal 'Locate the data repo holding the pinned edges.json baseline' `
                -Problem "'$PSScriptRoot' is not inside a git work tree, so the repo root cannot be resolved." `
                -Location 'Invoke-EdgeRationaleGuardCycle.ps1 (data-repo resolution)' `
                -NextSteps @('Pass -DataRepo explicitly.', 'Or set $env:AI_TRIAD_DATA_ROOT to the data repo path.')
        }
        $repoRoot = Split-Path -Parent ([string]$common).Trim()
        $cfgPath  = Join-Path $repoRoot '.aitriad.json'
        $dataRel  = if (Test-Path -LiteralPath $cfgPath) { (Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json).data_root } else { '../ai-triad-data' }
        $DataRepo = Join-Path $repoRoot $dataRel
    }
}
$DataRepo  = [System.IO.Path]::GetFullPath($DataRepo)
$GuardPath = [System.IO.Path]::GetFullPath($GuardPath)
if (-not (Test-Path -LiteralPath $GuardPath)) {
    Stop-Harness -Goal 'Run the t/2947 (c) real-data positive cycle against the landed guard' `
        -Problem "No guard file at '$GuardPath'." -Location 'Invoke-EdgeRationaleGuardCycle.ps1 (guard resolution)' `
        -NextSteps @("Confirm PowerShell's Phase-2 guard PR (#1433) has merged to main and the branch is up to date.",
                     'Or pass -GuardPath explicitly to point at the file under test.')
}
. $GuardPath

$results = [ordered]@{
    baseline_sha       = $BaselineSha
    guard_path         = $GuardPath
    guard_sha          = (& git -C (Split-Path -Parent $GuardPath) log -1 --format=%H -- $GuardPath 2>$null)
    edges_rel_path     = $EdgesRelPath
    ran_at             = (Get-Date).ToString('o')
}

function Get-EdgeKeyStats {
    # Replicate the guard's own keying rule verbatim so the analytic counts are comparable.
    param($Edges)
    $keyed = 0; $skipped = 0; $rationaled = @{}
    foreach ($e in @($Edges)) {
        if (-not ($e.PSObject.Properties['source'] -and $e.PSObject.Properties['type'] -and $e.PSObject.Properties['target'])) { $skipped++; continue }
        $keyed++
        $r = if ($e.PSObject.Properties['rationale']) { [string]$e.rationale } else { '' }
        if (-not [string]::IsNullOrWhiteSpace($r)) { $rationaled["$($e.source)|$($e.type)|$($e.target)"] = $true }
    }
    [pscustomobject]@{ Keyed = $keyed; Skipped = $skipped; Rationaled = $rationaled }
}

$wt = Join-Path $WorkDir 'baseline-wt'
try {
    Write-Verbose "Creating detached baseline worktree at '$wt' pinned to $BaselineSha..."
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
    & git -C $DataRepo worktree add --detach $wt $BaselineSha 2>&1 | Write-Verbose
    if ($LASTEXITCODE -ne 0) {
        Stop-Harness -Goal "Pin a throwaway baseline worktree at $BaselineSha" `
            -Problem "git worktree add --detach failed for '$BaselineSha' in '$DataRepo'." `
            -Location 'Invoke-EdgeRationaleGuardCycle.ps1 (baseline worktree setup)' `
            -NextSteps @("Confirm '$BaselineSha' exists: git -C '$DataRepo' cat-file -t $BaselineSha",
                         "Clear any stale worktree: git -C '$DataRepo' worktree prune")
    }

    $edgesPath = Join-Path $wt $EdgesRelPath
    if (-not (Test-Path -LiteralPath $edgesPath)) {
        Stop-Harness -Goal 'Read the rationale-rich baseline edges document' `
            -Problem "'$EdgesRelPath' is absent at $BaselineSha." `
            -Location 'Invoke-EdgeRationaleGuardCycle.ps1 (baseline edges lookup)' `
            -NextSteps @("List the tree: git -C '$DataRepo' ls-tree -r --name-only $BaselineSha | Select-String edges.json",
                         'Pass the correct -EdgesRelPath.')
    }

    # The write payload IS the checked-out tree content — i.e. a faithful re-emit of what a
    # Write-EdgesFile sink would hand the guard on a clean pipeline run.
    $doc = Get-Content -LiteralPath $edgesPath -Raw | ConvertFrom-Json
    if (-not ($doc.PSObject -and $doc.PSObject.Properties['edges'])) {
        # StrictMode would otherwise turn this into an opaque property-not-found error.
        Stop-Harness -Goal 'Scan the baseline write payload for rationale coverage' `
            -Problem "The document at '$EdgesRelPath' ($BaselineSha) has no top-level 'edges' array." `
            -Location 'Invoke-EdgeRationaleGuardCycle.ps1 (payload shape check)' `
            -NextSteps @('Confirm the pinned commit really carries the edges document (not an archived/renamed variant).',
                         'Pass -EdgesRelPath for the correct file.')
    }
    $stats = Get-EdgeKeyStats -Edges $doc.edges

    # ── P1 / P2 (ANALYTIC) ────────────────────────────────────────────────────────────────────
    $results['baseline_rationaled_keys'] = $stats.Rationaled.Count
    $results['payload_checked_edges']    = $stats.Keyed
    $results['payload_skipped_edges']    = $stats.Skipped
    $results['P1_baseline_resolved']     = ($stats.Rationaled.Count -gt 0)
    $results['P2_payload_scanned']       = ($stats.Keyed -gt 0 -and $stats.Skipped -eq 0)

    # ── Arm A: clean case is quiet (uncached, then cached — wall-clock for both) ───────────────
    $warn = $null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $cleanCount = Test-EdgeRationaleRegression -EdgesData $doc -Path $edgesPath -Mode 'Warn' -WarningVariable warn -Verbose:$false
    $sw.Stop()
    $results['clean_regressions']        = [int]$cleanCount
    $results['clean_warnings']           = @($warn).Count
    $results['cold_call_ms']             = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)

    $warn2 = $null
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    $null = Test-EdgeRationaleRegression -EdgesData $doc -Path $edgesPath -Mode 'Warn' -WarningVariable warn2 -Verbose:$false
    $sw2.Stop()
    $results['warm_call_ms']             = [math]::Round($sw2.Elapsed.TotalMilliseconds, 1)
    $results['ArmA_clean_quiet']         = ([int]$cleanCount -eq 0 -and @($warn).Count -eq 0)

    # ── Arm B: deliberate strip fires against that SAME real baseline ──────────────────────────
    # No -BaselineEdges: the guard must resolve HEAD itself. Strip N keys that carry rationale.
    $stripped = 0
    foreach ($e in @($doc.edges)) {
        if ($stripped -ge $StripCount) { break }
        if (-not ($e.PSObject.Properties['source'] -and $e.PSObject.Properties['type'] -and $e.PSObject.Properties['target'])) { continue }
        if (-not $e.PSObject.Properties['rationale']) { continue }
        if ([string]::IsNullOrWhiteSpace([string]$e.rationale)) { continue }
        $e.rationale = ''
        $stripped++
    }
    $warn3 = $null
    $stripCount = Test-EdgeRationaleRegression -EdgesData $doc -Path $edgesPath -Mode 'Warn' -WarningVariable warn3 -Verbose:$false
    $results['strip_injected']           = $stripped
    $results['strip_detected']           = [int]$stripCount
    $results['strip_warnings']           = @($warn3).Count
    $results['ArmB_strip_fires']         = ([int]$stripCount -eq $stripped -and $stripped -gt 0 -and @($warn3).Count -ge 1)

    # ── P1 / P2 (BEHAVIOURAL) — exactly-N is only reachable if baseline resolved AND payload scanned
    $results['P1_P2_behavioural']        = $results['ArmB_strip_fires']

    $results['VERDICT'] = if (
        $results['P1_baseline_resolved'] -and $results['P2_payload_scanned'] -and
        $results['P1_P2_behavioural']    -and $results['ArmA_clean_quiet']
    ) { 'PASS' } else { 'FAIL' }
}
finally {
    if (Test-Path -LiteralPath $wt) {
        & git -C $DataRepo worktree remove --force $wt 2>&1 | Write-Verbose
    }
    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

$obj = [pscustomobject]$results
$obj | Format-List | Out-String | Write-Host
if ($ReportPath) { $obj | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding utf8 }
if ($results['VERDICT'] -ne 'PASS') { exit 1 }
