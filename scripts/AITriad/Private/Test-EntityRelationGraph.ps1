# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure invariant checker for the entity relation DAG (t/3170): target well-formedness +
    existence, acyclicity, and depth<=3. Returns a list of violation objects (empty list = clean).
    No IO — both-arms testable (Guard Testability, t/2971).
.DESCRIPTION
    Write-side gate for Entity.relations[] (EntityRelation { type: instance_of|subclass_of|part_of,
    target: 'ent-*'|'term:<slug>' }). TL-approved design t/3170#2.

    DEPTH DEFINITION (pinned — t/3170 GV cond 2): depth = number of EDGES on the longest directed
    path. `-MaxDepth 3` means at most 3 edges (a 4-node chain); a 4-edge chain is over-depth.

    DAG SEMANTICS (pinned — t/3170 GV cond 3): cycle + depth are computed over the COMBINED graph
    of all three relation types (conservative default). A cycle that crosses mixed edge types
    (e.g. instance_of + subclass_of) is still a cycle. The `part_of`-misuse predicate is a SEPARATE
    audit soft-flag (Q2, CL) and is intentionally NOT enforced here.

    Checks (each independent; ALL violations are collected, not fail-fast):
      1. malformed-target — target is neither `^ent-\d+$` nor `^term:<slug>$`.
      2. missing-target   — well-formed but not present in -KnownEntityId / -KnownTermRef.
      3. cycle            — the combined directed graph contains a back-edge.
      4. over-depth       — longest directed path from a node exceeds -MaxDepth edges.
.PARAMETER Edge
    Edge records, each an object/hashtable with Source, Type, Target. Empty = trivially clean.
.PARAMETER KnownEntityId
    ent-* ids that exist (existence check for `ent-*` targets).
.PARAMETER KnownTermRef
    term:* refs that exist (existence check for `term:*` targets).
.PARAMETER MaxDepth
    Max path length in EDGES. Default 3 (R4.3 shallow-DAG cap).
.OUTPUTS
    [System.Collections.Generic.List[object]] of violation records
    ({ Kind; ... }); empty list when the graph is clean.
#>
function Test-EntityRelationGraph {
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[object]])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Edge,

        [Parameter()]
        [string[]]$KnownEntityId = @(),

        [Parameter()]
        [string[]]$KnownTermRef = @(),

        [Parameter()]
        [ValidateRange(1, 100)]
        [int]$MaxDepth = 3
    )

    Set-StrictMode -Version Latest

    $violations = [System.Collections.Generic.List[object]]::new()
    $entSet = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($i in @($KnownEntityId)) { [void]$entSet.Add([string]$i) }
    $termSet = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($t in @($KnownTermRef)) { [void]$termSet.Add([string]$t) }

    $edges = @($Edge)

    # ── Checks 1 & 2: target well-formedness + existence ──────────────────
    foreach ($e in $edges) {
        $src = [string]$e.Source
        $typ = [string]$e.Type
        $tgt = [string]$e.Target
        if ($tgt -match '^ent-\d+$') {
            if (-not $entSet.Contains($tgt)) {
                $violations.Add([pscustomobject]@{ Kind = 'missing-target'; Source = $src; Type = $typ; Target = $tgt })
            }
        }
        elseif ($tgt -match '^term:[a-z0-9]+(-[a-z0-9]+)*$') {
            if (-not $termSet.Contains($tgt)) {
                $violations.Add([pscustomobject]@{ Kind = 'missing-target'; Source = $src; Type = $typ; Target = $tgt })
            }
        }
        else {
            $violations.Add([pscustomobject]@{ Kind = 'malformed-target'; Source = $src; Type = $typ; Target = $tgt })
        }
    }

    # ── Build combined adjacency ──────────────────────────────────────────
    $adj = @{}
    $nodes = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($e in $edges) {
        $s = [string]$e.Source
        $t = [string]$e.Target
        [void]$nodes.Add($s); [void]$nodes.Add($t)
        if (-not $adj.ContainsKey($s)) { $adj[$s] = [System.Collections.Generic.List[string]]::new() }
        $adj[$s].Add($t)
    }

    # ── Check 3: cycle (iterative DFS 3-colour; grey = on the current stack) ──
    # Iterative to avoid deep-recursion runspace limits and StrictMode closure snags.
    $color = @{}   # absent/0 = white, 1 = grey (on stack), 2 = black (done)
    $cycleNodes = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($start in @($nodes)) {
        $cStart = if ($color.ContainsKey($start)) { $color[$start] } else { 0 }
        if ($cStart -ne 0) { continue }
        # stack frames: [node, childIndex]
        $stack = [System.Collections.Generic.List[object]]::new()
        $stack.Add([pscustomobject]@{ Node = $start; Idx = 0 })
        $color[$start] = 1
        while ($stack.Count -gt 0) {
            $frame = $stack[$stack.Count - 1]
            $n = $frame.Node
            # Direct assignment (NOT `$kids = if (...) { $adj[$n] }`) — an if-EXPRESSION enumerates
            # a List output, collapsing a 1-element List to a bare scalar with no .Count (StrictMode).
            if ($adj.ContainsKey($n)) { $kids = $adj[$n] } else { $kids = [System.Collections.Generic.List[string]]::new() }
            if ($frame.Idx -lt $kids.Count) {
                $m = $kids[$frame.Idx]
                $frame.Idx++
                $cm = if ($color.ContainsKey($m)) { $color[$m] } else { 0 }
                if ($cm -eq 1) {
                    [void]$cycleNodes.Add($m)          # back-edge into the current stack → cycle
                }
                elseif ($cm -eq 0) {
                    $color[$m] = 1
                    $stack.Add([pscustomobject]@{ Node = $m; Idx = 0 })
                }
            }
            else {
                $color[$n] = 2
                $stack.RemoveAt($stack.Count - 1)
            }
        }
    }
    foreach ($cn in @($cycleNodes)) {
        $violations.Add([pscustomobject]@{ Kind = 'cycle'; Node = $cn })
    }

    # ── Check 4: depth (longest path in EDGES) — only when acyclic ────────
    # A cycle makes longest-path unbounded; the cycle violation already fails the gate, so skip
    # depth to avoid non-termination.
    if ($cycleNodes.Count -eq 0) {
        $memo = @{}
        # Post-order longest-path via an explicit stack (DAG guaranteed here).
        foreach ($start in @($nodes)) {
            if ($memo.ContainsKey($start)) { continue }
            $stack = [System.Collections.Generic.List[string]]::new()
            $stack.Add($start)
            while ($stack.Count -gt 0) {
                $n = $stack[$stack.Count - 1]
                if ($memo.ContainsKey($n)) { $stack.RemoveAt($stack.Count - 1); continue }
                # Direct assignment (NOT `$kids = if (...) { $adj[$n] }`) — an if-EXPRESSION enumerates
            # a List output, collapsing a 1-element List to a bare scalar with no .Count (StrictMode).
            if ($adj.ContainsKey($n)) { $kids = $adj[$n] } else { $kids = [System.Collections.Generic.List[string]]::new() }
                $pending = @($kids | Where-Object { -not $memo.ContainsKey($_) })
                if ($pending.Count -gt 0) {
                    foreach ($p in $pending) { $stack.Add($p) }
                }
                else {
                    $best = 0
                    foreach ($k in $kids) { $d = 1 + $memo[$k]; if ($d -gt $best) { $best = $d } }
                    $memo[$n] = $best
                    $stack.RemoveAt($stack.Count - 1)
                }
            }
        }
        foreach ($n in @($nodes)) {
            if ($memo.ContainsKey($n) -and $memo[$n] -gt $MaxDepth) {
                $violations.Add([pscustomobject]@{ Kind = 'over-depth'; Node = $n; Depth = $memo[$n] })
            }
        }
    }

    return $violations
}
