# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Arm 1: edge-rationale-regression guard (t/2945, TL design e/120#19) ────────
# Incident: a whole-file edges.json save dropped `rationale` from ~33k edges that had it
# (a rationale-only field projection; every other field byte-identical) — the taxonomy-editor
# load-list-then-save round-trip (CL.Investigate1 e/120#20). This guard funnels at the PS
# serialization sink (Write-EdgesFile), so it fires on the pipeline RE-EMIT (Invoke-EdgeDiscovery
# append-preserves the already-stripped set and re-writes it here) and on every in-repo PS
# edge writer. NOTE (coverage, CL.Investigate1 e/120#22/#23): the editor/server saves write
# through the TS `writeEdgesFile` twin + server PUT, NOT this PS sink — those need the TS-side
# guard / Arm 2 (CI diff vs HEAD). This is the PS-writer arm only.
#
# Rule: an edge that carries a non-empty `rationale` in the HEAD/committed edges.json must not
# be written rationale-less (composite key source|type|target). Baseline is HEAD (committed),
# NOT on-disk — an intra-run checkpoint write can poison an on-disk baseline (CL Main e/120#13).
#
# NEAR-KEY NOTE (CL e/120#30, restore pre-flight t/2946#4): source|type|target is a NEAR-key,
# not a strict key — on the live 33,580-edge file 3 keys carry 2 genuinely distinct edges each
# (differing discovered_at/model/confidence). Benign for THIS guard today (0 of the 3 have
# mixed rationale presence), but it is set semantics: if two edges share a key and only one had
# rationale, the guard reasons over the key, not the specific edge. The twin-aware identity
# (disambiguate on discovered_at+model, else refuse-and-log) lives in the shared re-merge util
# + restore (TL e/120#37, t/2946 AC) — this presence guard can't see cross-attribution.
#
# Gate Promotion / warn-first (t/2683): Phase 1 = WARN (landed, PR #1430 / 491c7554). Phase 2
# (this) = fail-open hardening + observability + baseline caching; Block (throw) flips default
# only after the positive real-data cycle + TL GV (t/2947). Mode resolves from
# $env:AI_TRIAD_EDGE_RATIONALE_GATE (Off|Warn|Block); default Warn.
#
# FAIL-OPEN CONTRACT (CL e/120#30 Finding 1, TL #32): the guard must NEVER throw except on a
# genuine Block-mode regression. Any inability to analyze the input (no HEAD baseline, an
# edges-less/odd-shaped payload, a parse error) returns 0 without throwing — a guard that cannot
# read its baseline must not block a legitimate write. Every fail-open branch emits a
# DISTINGUISHABLE Write-Verbose (CL #30 Finding 2) so a permanently-dead gate is not
# byte-identical to a clean pass; the promotion evidence asserts the baseline RESOLVED
# (positive), not merely that nothing warned.

# Per-run HEAD-baseline cache (TL e/120#27 (a) / #34): `git show HEAD:edges.json` + parse of a
# ~19 MB file fires on EVERY Write-EdgesFile call, and Invoke-EdgeDiscovery has ~5 sink calls
# per run. Resolve once per (repo-relative path @ HEAD sha) and reuse within the process. Keyed
# by HEAD sha so a new commit mid-process invalidates; $null (fail-open) results are cached too
# to avoid re-running a failing lookup every call.
$script:EdgeHeadBaselineCache = @{}

function Get-EdgesFromHead {
    # Return the `edges` array from the committed (HEAD) version of $Path, or $null on any
    # failure (fail-open, with a distinguishable Write-Verbose per cause). git is invoked via
    # PowerShell (not the Bash tool) to avoid the MSYS colon-revspec path-mangling caveat.
    [OutputType([object[]])]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { Write-Verbose 'edge-rationale baseline: no path supplied — fail-open.'; return $null }
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $dir  = Split-Path -Parent $full
        if (-not (Test-Path -LiteralPath $dir)) { Write-Verbose "edge-rationale baseline: directory '$dir' does not exist — fail-open."; return $null }
        $top = & git -C $dir rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($top)) { Write-Verbose "edge-rationale baseline: '$dir' is not inside a git work tree — fail-open."; return $null }
        $top = ([string]$top).Trim()
        $rel = ([System.IO.Path]::GetRelativePath($top, $full)) -replace '\\', '/'

        # Per-run cache keyed by path @ HEAD sha (TL e/120#27(a)).
        $headSha = & git -C $top rev-parse HEAD 2>$null
        $headSha = if ($LASTEXITCODE -eq 0) { ([string]$headSha).Trim() } else { '' }
        $cacheKey = "$top|$rel@$headSha"
        if ($headSha -and $script:EdgeHeadBaselineCache.ContainsKey($cacheKey)) {
            Write-Verbose "edge-rationale baseline: cache hit for '$rel@$($headSha.Substring(0,[Math]::Min(8,$headSha.Length)))'."
            return $script:EdgeHeadBaselineCache[$cacheKey]
        }

        $result = $null
        $json = & git -C $top show "HEAD:$rel" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) {
            Write-Verbose "edge-rationale baseline: 'HEAD:$rel' not found in the repo (new file / not committed) — fail-open."
        }
        else {
            $parsed = ($json -join "`n") | ConvertFrom-Json
            if ($parsed.PSObject.Properties['edges']) { $result = @($parsed.edges) }
            else { Write-Verbose 'edge-rationale baseline: HEAD edges.json has no edges array — fail-open.' }
        }
        if ($headSha) { $script:EdgeHeadBaselineCache[$cacheKey] = $result }   # cache incl. $null (dead-lookup) results
        return $result
    } catch {
        Write-Verbose "edge-rationale baseline: could not read/parse HEAD edges.json ($($_.Exception.Message)) — fail-open."
        return $null
    }
}

function Get-EdgesArray {
    # Robustly extract the edges array from an edges document that may be a PSCustomObject
    # (the common ConvertFrom-Json shape) OR a hashtable, without throwing under StrictMode.
    # Returns $null when there is no edges array (an edges-less doc is a legitimate write that
    # Write-EdgesFile handles — it is generic over top-level keys).
    param($EdgesData)
    if ($null -eq $EdgesData) { return $null }
    if ($EdgesData -is [System.Collections.IDictionary]) {
        if ($EdgesData.Contains('edges')) { return $EdgesData['edges'] }
        return $null
    }
    if ($EdgesData.PSObject -and $EdgesData.PSObject.Properties['edges']) { return $EdgesData.edges }
    return $null
}

function Test-EdgeRationaleRegression {
    <#
    .SYNOPSIS
        Arm 1 guard (t/2945). Warn (or in Block mode, throw) when a write to edges.json would
        drop `rationale` from an edge that carries one in HEAD. Composite-keyed (source|type|target).
    .OUTPUTS
        [int] the number of regressing edges (0 = clean). NEVER throws in Warn/Off mode, and in
        Block mode throws ONLY on a genuine rationale regression — any inability to analyze the
        input fails open (returns 0, with a Write-Verbose) and never blocks a legitimate write.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)] $EdgesData,
        [string]$Path = '',
        # Injectable baseline (array of edge objects) — for tests/callers with a known baseline.
        # When $null, the baseline is resolved from HEAD:$Path.
        $BaselineEdges = $null,
        [ValidateSet('', 'Off', 'Warn', 'Block')]
        [string]$Mode = ''
    )
    Set-StrictMode -Version Latest

    if (-not $Mode) {
        $envMode = [Environment]::GetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE')
        $Mode = switch -Regex ("$envMode") {
            '^(?i)off$'   { 'Off' }
            '^(?i)block$' { 'Block' }
            default       { 'Warn' }
        }
    }
    if ($Mode -eq 'Off') { return 0 }

    # ── Analyze (fail-OPEN): any error building the baseline map or scanning the write payload
    #    returns 0 without throwing. The intended Block-mode regression throw happens AFTER this
    #    block, so a genuine regression still blocks while an un-analyzable input never does.
    $lost = [System.Collections.Generic.List[string]]::new()
    try {
        if ($null -eq $BaselineEdges) {
            $BaselineEdges = Get-EdgesFromHead -Path $Path
            if ($null -eq $BaselineEdges) { return 0 }   # Get-EdgesFromHead already Write-Verbose'd the cause
        }

        # Composite keys that carry a non-empty rationale in the baseline.
        $hadRationale = @{}
        foreach ($e in @($BaselineEdges)) {
            if (-not ($e.PSObject.Properties['source'] -and $e.PSObject.Properties['type'] -and $e.PSObject.Properties['target'])) { continue }
            $r = if ($e.PSObject.Properties['rationale']) { [string]$e.rationale } else { '' }
            if (-not [string]::IsNullOrWhiteSpace($r)) {
                $hadRationale["$($e.source)|$($e.type)|$($e.target)"] = $true
            }
        }
        if ($hadRationale.Count -eq 0) { Write-Verbose 'edge-rationale guard: HEAD baseline carries no rationaled edges — nothing to protect.'; return 0 }

        # Robustly extract the write payload's edges (edges-less / odd-shaped doc -> fail-open).
        $writeEdges = Get-EdgesArray -EdgesData $EdgesData
        if ($null -eq $writeEdges) { Write-Verbose 'edge-rationale guard: write payload has no edges array — fail-open (nothing to check).'; return 0 }

        foreach ($e in @($writeEdges)) {
            if (-not ($e.PSObject.Properties['source'] -and $e.PSObject.Properties['type'] -and $e.PSObject.Properties['target'])) { continue }
            $key = "$($e.source)|$($e.type)|$($e.target)"
            if ($hadRationale.ContainsKey($key)) {
                $r = if ($e.PSObject.Properties['rationale']) { [string]$e.rationale } else { '' }
                if ([string]::IsNullOrWhiteSpace($r)) { [void]$lost.Add($key) }
            }
        }
    } catch {
        # Belt-and-suspenders (TL #32): a guard that cannot analyze the input MUST NOT block a
        # legitimate write, in any mode. Distinguishable so a dead gate isn't silent.
        Write-Verbose "edge-rationale guard: unexpected error analyzing the write, fail-open (no throw): $($_.Exception.Message)"
        return 0
    }

    if ($lost.Count -eq 0) { return 0 }

    $sample  = (@($lost) | Select-Object -First 3) -join ', '
    $leaf    = if ($Path) { [System.IO.Path]::GetFileName($Path) } else { 'edges.json' }
    $problem = "$($lost.Count) edge(s) carrying a rationale in HEAD would be written WITHOUT one " +
               "(composite key source|type|target). Sample: $sample. This is the edge-rationale wipe class (t/2945)."
    $steps   = @(
        'A whole-file edges save MUST re-merge rationale from HEAD/on-disk by composite key before writing — never persist a rationale-stripped list payload (the taxonomy-editor load-list->save round-trip, t/2945).',
        'If this removal is intentional, set $env:AI_TRIAD_EDGE_RATIONALE_GATE=Off for the run.'
    )

    if ($Mode -eq 'Block') {
        throw (New-ActionableError -Goal "Preserve edge rationale on write to '$leaf'" `
            -Problem $problem -Location 'Write-EdgesFile / Test-EdgeRationaleRegression' -NextSteps $steps -PassThru)
    }
    # Phase 1 — WARN (loud, does not throw).
    Write-Warning ("EDGE-RATIONALE REGRESSION (would-block; t/2945 Arm 1, warn-first) — $problem Next steps: " + ($steps -join ' | '))
    return $lost.Count
}
