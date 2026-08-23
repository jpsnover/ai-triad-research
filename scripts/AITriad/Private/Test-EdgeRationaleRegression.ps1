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
# Gate Promotion / warn-first (t/2683): Phase 1 = WARN (loud, does not throw). Phase 2 =
# Block (throw New-ActionableError) after a real-data clean cycle + TL GV. Mode resolves from
# $env:AI_TRIAD_EDGE_RATIONALE_GATE (Off|Warn|Block); default Warn. Fail-OPEN on any
# baseline-resolution failure (not a git repo / path not in HEAD / parse error) — the guard
# must never block a legitimate write because it couldn't read the baseline.

function Get-EdgesFromHead {
    # Return the `edges` array from the committed (HEAD) version of $Path, or $null on any
    # failure (fail-open). git is invoked via PowerShell (not the Bash tool) to avoid the
    # MSYS colon-revspec path-mangling caveat (root AGENTS.md, Git Forensics).
    [OutputType([object[]])]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $dir  = Split-Path -Parent $full
        if (-not (Test-Path -LiteralPath $dir)) { return $null }
        $top = & git -C $dir rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($top)) { return $null }
        $top = ([string]$top).Trim()
        $rel = ([System.IO.Path]::GetRelativePath($top, $full)) -replace '\\', '/'
        $json = & git -C $top show "HEAD:$rel" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
        $parsed = ($json -join "`n") | ConvertFrom-Json
        if ($parsed.PSObject.Properties['edges']) { return @($parsed.edges) }
        return $null
    } catch { return $null }
}

function Test-EdgeRationaleRegression {
    <#
    .SYNOPSIS
        Arm 1 guard (t/2945). Warn (or in Block mode, throw) when a write to edges.json would
        drop `rationale` from an edge that carries one in HEAD. Composite-keyed (source|type|target).
    .OUTPUTS
        [int] the number of regressing edges (0 = clean). Never throws in Warn/Off mode.
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

    if ($null -eq $BaselineEdges) {
        $BaselineEdges = Get-EdgesFromHead -Path $Path
        if ($null -eq $BaselineEdges) { return 0 }   # no HEAD baseline -> fail-open
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
    if ($hadRationale.Count -eq 0) { return 0 }

    # Edges in this write that had rationale in HEAD but would be written without one.
    $lost = [System.Collections.Generic.List[string]]::new()
    foreach ($e in @($EdgesData.edges)) {
        if (-not ($e.PSObject.Properties['source'] -and $e.PSObject.Properties['type'] -and $e.PSObject.Properties['target'])) { continue }
        $key = "$($e.source)|$($e.type)|$($e.target)"
        if ($hadRationale.ContainsKey($key)) {
            $r = if ($e.PSObject.Properties['rationale']) { [string]$e.rationale } else { '' }
            if ([string]::IsNullOrWhiteSpace($r)) { [void]$lost.Add($key) }
        }
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
