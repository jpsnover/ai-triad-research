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
# NEAR-KEY NOTE (CL e/120#30, restore pre-flight t/2946#4): source|type|target is a NEAR-key;
# on the live 33,580-edge file 3 keys carry 2 genuinely distinct edges each. Benign for THIS
# guard today; twin-aware identity lives in the shared re-merge util + restore (t/2946 AC).
#
# EDGE SHAPE (t/2955): edge field reads go through Test-EdgeHasField / Get-EdgeField so a raw
# [hashtable]/[IDictionary] edge is CHECKED, not skipped — a hashtable's PSObject.Properties are
# Count/Keys/Values, not its entries, so a naive `$e.PSObject.Properties['source']` silently
# skipped hashtable edges and a rationale wipe delivered that way passed the gate. Symmetric with
# Get-EdgesArray's document-level IDictionary branch; Write-EdgesFile serializes both shapes (AC#4).
# t/2953: a committed-but-EMPTY `edges` baseline now emits its own distinguishable fail-open line.
# t/2951: (a) the derived hadRationale map is memoized under the same path@HEAD-sha key as the
# baseline array (the residual warm cost was rebuilding it every call); (b) the payload scan is
# per-element resilient — a $null or field-read-faulting element is skipped and COUNTED, no longer
# tripping the whole-body catch into a silent whole-file fail-open (raised in cost by the Block flip).
#
# GATE PROMOTION (t/2683): Phase 1 WARN landed (#1430 / 491c7554). Phase 2 hardening
# (fail-open + observability + caching) landed (#1433 / 21a69608). THIS is the promotion:
# default -> BLOCK, gated on CL's ba3128f5-as-HEAD positive real-data cycle + TL GV (t/2947).
# Mode still resolves from $env:AI_TRIAD_EDGE_RATIONALE_GATE (Off|Warn|Block); the DEFAULT
# (env unset) is now Block.
#
# FAIL-OPEN CONTRACT (CL e/120#30 Finding 1, TL #32): the guard NEVER throws except on a
# genuine Block-mode regression. Any inability to analyze the input (no HEAD baseline, an
# edges-less/odd-shaped payload, a parse error) returns 0 without throwing. Every fail-open
# AND every resolved-positive path emits a DISTINGUISHABLE Write-Verbose (CL #30 Finding 2 +
# e/120#43/#52 Finding 3): a healthy run positively reports "baseline resolved — N key(s)"
# and "payload scanned — checked N", so a dead gate is never inferred from mere absence, and
# a "no edges KEY" payload is never conflated with an "emptied edges array".

# Per-run HEAD-baseline cache (TL e/120#27(a)): `git show HEAD:edges.json` + parse of a ~19 MB
# file fires on every Write-EdgesFile call (~5/run in Invoke-EdgeDiscovery). Resolve once per
# (repo-relative path @ HEAD sha) and reuse in-process; keyed by HEAD sha so a new commit
# invalidates; $null (dead-lookup) results cached too.
$script:EdgeHeadBaselineCache = @{}

# t/2951: memoize the DERIVED hadRationale map (composite-key -> $true) under the SAME
# path@HEAD-sha key as the baseline array. After the array cache landed (warm 9.2s->2.2s,
# CL e/120#54), the residual ~2.2s per Write-EdgesFile call is rebuilding this map — a full
# 33k-edge walk — from the already-cached array on every call. The map is a PURE function of
# the cached baseline, so it shares the baseline's invalidation exactly (new commit -> new sha
# -> new key -> both caches miss together); no new invalidation surface. Get-EdgesFromHead
# publishes the key it resolved into $script:LastEdgeBaselineKey so the caller can memoize
# under it WITHOUT a second git round-trip. Only used when the baseline came from HEAD;
# injected-baseline callers/tests never touch either cache.
$script:EdgeHadRationaleCache = @{}
$script:LastEdgeBaselineKey = $null

function Get-EdgesFromHead {
    # Return the `edges` array from the committed (HEAD) version of $Path, or $null on any
    # failure (fail-open, with a distinguishable Write-Verbose per cause). git via PowerShell
    # (not the Bash tool) to avoid the MSYS colon-revspec path-mangling caveat.
    [OutputType([object[]])]
    param([string]$Path)
    $script:LastEdgeBaselineKey = $null   # t/2951: reset per call; set only once a real key is resolved
    if ([string]::IsNullOrWhiteSpace($Path)) { Write-Verbose 'edge-rationale baseline: no path supplied — fail-open.'; return $null }
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $dir  = Split-Path -Parent $full
        if (-not (Test-Path -LiteralPath $dir)) { Write-Verbose "edge-rationale baseline: directory '$dir' does not exist — fail-open."; return $null }
        $top = & git -C $dir rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($top)) { Write-Verbose "edge-rationale baseline: '$dir' is not inside a git work tree — fail-open."; return $null }
        $top = ([string]$top).Trim()
        $rel = ([System.IO.Path]::GetRelativePath($top, $full)) -replace '\\', '/'

        # Per-run cache keyed by path @ HEAD sha (TL e/120#27a).
        $headSha = & git -C $top rev-parse HEAD 2>$null
        $headSha = if ($LASTEXITCODE -eq 0) { ([string]$headSha).Trim() } else { '' }
        $cacheKey = "$top|$rel@$headSha"
        # t/2951: publish the resolved key (only when we have a HEAD sha to key on, matching the
        # array cache's own $headSha gate) so the caller can memoize the derived map under it.
        if ($headSha) { $script:LastEdgeBaselineKey = $cacheKey }
        if ($headSha -and $script:EdgeHeadBaselineCache.ContainsKey($cacheKey)) {
            # S-1 (CL e/120#43, TL #45): branch the cache-hit message on $null so a DEAD-lookup
            # (no committed baseline) is not reported identically to a RESOLVED one on calls 2..N.
            $cached = $script:EdgeHeadBaselineCache[$cacheKey]
            if ($null -eq $cached) { Write-Verbose "edge-rationale baseline: cache hit — NO committed baseline (dead-lookup) for '$rel'." }
            else { Write-Verbose "edge-rationale baseline: cache hit — $(@($cached).Count) committed baseline edge(s) for '$rel'." }
            return $cached
        }

        $result = $null
        $json = & git -C $top show "HEAD:$rel" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) {
            Write-Verbose "edge-rationale baseline: 'HEAD:$rel' not found in the repo (new file / not committed) — fail-open."
        }
        else {
            $parsed = ($json -join "`n") | ConvertFrom-Json
            if ($parsed.PSObject.Properties['edges']) {
                $result = @($parsed.edges)
                # t/2953: a committed-but-EMPTY `edges` array is a real read, not a lookup failure,
                # but @() unrolls to $null on return so the caller short-circuits at the `$null -eq
                # $BaselineEdges` check — previously with NO verbose (the only silent fail-open path
                # on the first/uncached resolution; the cache-hit path already annotates it). Emit a
                # DISTINGUISHABLE line naming the shape so a payload scan can classify it into exactly
                # one class, non-overlapping with 'has no edges array' (missing key) and 'not found'.
                if ($result.Count -eq 0) { Write-Verbose "edge-rationale baseline: HEAD '$rel' has an EMPTY edges array — no committed baseline to protect — fail-open." }
            }
            else { Write-Verbose 'edge-rationale baseline: HEAD edges.json has no edges array — fail-open.' }
        }
        if ($headSha) { $script:EdgeHeadBaselineCache[$cacheKey] = $result }
        return $result
    } catch {
        Write-Verbose "edge-rationale baseline: could not read/parse HEAD edges.json ($($_.Exception.Message)) — fail-open."
        return $null
    }
}

function Get-EdgesArray {
    # Extract the edges array from an edges document (PSCustomObject OR hashtable) without a
    # StrictMode deref. Returns @{ HasKey; Edges } so the caller can distinguish a MISSING
    # `edges` key from a present-but-EMPTY array (CL e/120#52/#53 — the two must not share a
    # scannable message, else (c)'s payload-scanned positive is not independently attributable).
    param($EdgesData)
    if ($null -eq $EdgesData) { return @{ HasKey = $false; Edges = @() } }
    if ($EdgesData -is [System.Collections.IDictionary]) {
        if ($EdgesData.Contains('edges')) { return @{ HasKey = $true; Edges = @($EdgesData['edges']) } }
        return @{ HasKey = $false; Edges = @() }
    }
    if ($EdgesData.PSObject -and $EdgesData.PSObject.Properties['edges']) { return @{ HasKey = $true; Edges = @($EdgesData.edges) } }
    return @{ HasKey = $false; Edges = @() }
}

function Test-EdgeHasField {
    # Is a named field present on an edge ELEMENT that may be a PSCustomObject (the common
    # ConvertFrom-Json shape) OR a raw [IDictionary]/[hashtable]? Element-level symmetry with
    # Get-EdgesArray's document-level IDictionary branch (t/2955): a hashtable's PSObject.Properties
    # are Count/Keys/Values — NOT its entries — so `$e.PSObject.Properties['source']` finds nothing
    # for a hashtable edge and the edge is wrongly bucketed as "missing key fields" and skipped.
    param($Edge, [string]$Name)
    if ($null -eq $Edge) { return $false }
    if ($Edge -is [System.Collections.IDictionary]) { return $Edge.Contains($Name) }
    return [bool]($Edge.PSObject -and $Edge.PSObject.Properties[$Name])
}

function Get-EdgeField {
    # Read a named field's value from an edge element (PSCustomObject OR [IDictionary]); $null when
    # absent. Paired with Test-EdgeHasField so field reads work uniformly across both shapes (t/2955).
    param($Edge, [string]$Name)
    if ($null -eq $Edge) { return $null }
    if ($Edge -is [System.Collections.IDictionary]) {
        if ($Edge.Contains($Name)) { return $Edge[$Name] }
        return $null
    }
    if ($Edge.PSObject -and $Edge.PSObject.Properties[$Name]) { return $Edge.PSObject.Properties[$Name].Value }
    return $null
}

function Test-EdgeRationaleRegression {
    <#
    .SYNOPSIS
        Arm 1 guard (t/2945). In Block mode (now the default) throws when a write to edges.json
        would drop `rationale` from an edge that carries one in HEAD; in Warn mode warns instead.
        Composite-keyed (source|type|target).
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
        $BaselineEdges = $null,
        [ValidateSet('', 'Off', 'Warn', 'Block')]
        [string]$Mode = ''
    )
    Set-StrictMode -Version Latest

    if (-not $Mode) {
        $envMode = [Environment]::GetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE')
        $Mode = switch -Regex ("$envMode") {
            '^(?i)off$'   { 'Off' }
            '^(?i)warn$'  { 'Warn' }
            '^(?i)block$' { 'Block' }
            default       { 'Block' }   # t/2947 Block flip: default is now Block (was Warn)
        }
    }
    if ($Mode -eq 'Off') { Write-Verbose 'edge-rationale guard: mode=Off — guard disabled, no check performed.'; return 0 }

    # ── Analyze (fail-OPEN): any error building the baseline map or scanning the write payload
    #    returns 0 without throwing. The intended Block-mode regression throw happens AFTER this
    #    block, so a genuine regression still blocks while an un-analyzable input never does.
    $lost = [System.Collections.Generic.List[string]]::new()
    try {
        $baselineFromHead = $false
        if ($null -eq $BaselineEdges) {
            $BaselineEdges = Get-EdgesFromHead -Path $Path
            if ($null -eq $BaselineEdges) { return 0 }   # Get-EdgesFromHead already Write-Verbose'd the cause
            $baselineFromHead = $true
        }

        # t/2951: memoize the derived hadRationale map under the same path@HEAD-sha key as the
        # baseline array — but ONLY when the baseline came from HEAD (an injected baseline has no
        # stable cache identity; those callers/tests rebuild every call, unchanged). The key was
        # published by Get-EdgesFromHead into $script:LastEdgeBaselineKey, so no extra git call.
        $mapKey = if ($baselineFromHead) { $script:LastEdgeBaselineKey } else { $null }
        if ($mapKey -and $script:EdgeHadRationaleCache.ContainsKey($mapKey)) {
            $hadRationale = $script:EdgeHadRationaleCache[$mapKey]
            Write-Verbose "edge-rationale guard: hadRationale map cache hit — $($hadRationale.Count) rationaled key(s) reused (memoized, t/2951)."
        }
        else {
            $hadRationale = @{}
            foreach ($e in @($BaselineEdges)) {
                if ($null -eq $e) { continue }
                if (-not ((Test-EdgeHasField $e 'source') -and (Test-EdgeHasField $e 'type') -and (Test-EdgeHasField $e 'target'))) { continue }
                $rv = Get-EdgeField $e 'rationale'
                $r  = if ($null -ne $rv) { [string]$rv } else { '' }
                if (-not [string]::IsNullOrWhiteSpace($r)) {
                    $hadRationale["$(Get-EdgeField $e 'source')|$(Get-EdgeField $e 'type')|$(Get-EdgeField $e 'target')"] = $true
                }
            }
            if ($mapKey) { $script:EdgeHadRationaleCache[$mapKey] = $hadRationale }
        }
        if ($hadRationale.Count -eq 0) { Write-Verbose 'edge-rationale guard: HEAD baseline carries no rationaled edges — nothing to protect.'; return 0 }
        # Finding 3 (CL e/120#43/#52): POSITIVE baseline-resolved signal — a healthy run must not
        # rely on the ABSENCE of a fail-open line to prove the baseline resolved.
        Write-Verbose "edge-rationale guard: HEAD baseline resolved — $($hadRationale.Count) rationaled key(s) protected."

        # Distinguish a MISSING edges key (fail-open) from a present-but-empty array (scan finds
        # nothing) — distinct, non-overlapping messages (CL e/120#52/#53 hard (c) precondition).
        $extract = Get-EdgesArray -EdgesData $EdgesData
        if (-not $extract.HasKey) { Write-Verbose 'edge-rationale guard: write payload has no edges KEY (missing) — fail-open (nothing to check).'; return 0 }
        $writeEdges = @($extract.Edges)

        $checked = 0; $skipped = 0; $skippedNull = 0; $skippedFault = 0
        foreach ($e in $writeEdges) {
            # t/2951: per-element resilience. Before, a $null element (or any element whose field
            # read threw) tripped the whole-body try/catch below into a SILENT whole-file fail-open
            # — the guard yielded NO regression signal for all 33k edges rather than skipping the one
            # bad element. After the Block flip the fail-open is the only thing standing between a
            # real rationale drop and a throw, so a single malformed element must not disable
            # detection for the whole file. Skip the offending element individually and COUNT it, so
            # the positive "payload scanned" line below stays honest instead of reading a clean 0.
            try {
                if ($null -eq $e) { $skippedNull++; continue }
                if (-not ((Test-EdgeHasField $e 'source') -and (Test-EdgeHasField $e 'type') -and (Test-EdgeHasField $e 'target'))) { $skipped++; continue }
                $checked++
                $key = "$(Get-EdgeField $e 'source')|$(Get-EdgeField $e 'type')|$(Get-EdgeField $e 'target')"
                if ($hadRationale.ContainsKey($key)) {
                    $rv = Get-EdgeField $e 'rationale'
                    $r  = if ($null -ne $rv) { [string]$rv } else { '' }
                    if ([string]::IsNullOrWhiteSpace($r)) { [void]$lost.Add($key) }
                }
            } catch {
                $skippedFault++
            }
        }
        # POSITIVE payload-scanned signal (CL e/120#44 Note 1 + #46 two-positive AC): reports the
        # edges actually examined + those skipped for missing key fields, so "0 regressions" is
        # never indistinguishable from "nothing was scanned". t/2951: null/faulted elements are
        # counted separately and only surfaced when non-zero — zero new noise on the all-valid path.
        $scanMsg = "edge-rationale guard: payload scanned — checked $checked edge(s), skipped $skipped (missing key fields)."
        if (($skippedNull + $skippedFault) -gt 0) {
            $scanMsg += " Skipped individually, scan continued (t/2951): $skippedNull null element(s), $skippedFault faulted element(s)."
        }
        Write-Verbose $scanMsg
    } catch {
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
    Write-Warning ("EDGE-RATIONALE REGRESSION (would-block; t/2945 Arm 1) — $problem Next steps: " + ($steps -join ' | '))
    return $lost.Count
}
