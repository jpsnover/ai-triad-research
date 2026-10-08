# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure duration-balanced shard assignment for test-powershell (t/4095). No I/O, no git, no
    Pester call -- callers pass in the file list and a duration map; unit-testable standalone
    (mirrors FlakeVerdict.ps1 / BranchStrandVerdict.ps1's pure-predicate convention).
.DESCRIPTION
    Replaces the old `file-index % shardTotal` modulo slicing (t/3668), which ignores duration
    entirely -- a shard full of slow files and a shard full of fast ones both get ~N/shardTotal
    files, so the slowest shard sets the critical path regardless of how many shards you add.

    Get-ShardAssignment runs a greedy LPT (Longest Processing Time first) bin-pack: sort files
    by duration descending (ties broken by path, for a deterministic, reproducible assignment),
    then repeatedly place the next file into whichever shard currently has the SMALLEST running
    total (ties broken by lowest shard index). This is the standard approximation algorithm for
    multiprocessor scheduling and is within 4/3 of optimal for any shard count.

    A file missing from the duration map (new test file, stale durations JSON) gets the MEDIAN
    duration of the files that ARE in the map -- never zero, never dropped. Using the median
    (not the mean) keeps one pathologically slow outlier file from skewing every unknown file's
    assumed cost.

    Test-ShardAssignmentCoverage is the union-equals-all guard (t/4095 acceptance criterion):
    every input file must appear in EXACTLY ONE shard's output. Used by both the unit tests
    below and ci.yml's own runtime check (each shard job computes the full assignment, not
    just its own slice, and validates coverage before selecting its slice -- so a slicing bug
    is caught by the shard that would otherwise silently run a stale/incomplete set).
#>

function Get-MedianDuration {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Durations)
    $values = @($Durations.Values | Sort-Object)
    if ($values.Count -eq 0) { return 0.0 }
    $mid = [int][math]::Floor(($values.Count - 1) / 2)
    if ($values.Count % 2 -eq 1) { return [double]$values[$mid] }
    return ([double]$values[$mid] + [double]$values[$mid + 1]) / 2.0
}

function Get-ShardAssignment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Files,
        [Parameter(Mandatory)][hashtable]$Durations,
        [Parameter(Mandatory)][int]$ShardTotal
    )
    if ($ShardTotal -lt 1) {
        throw "Get-ShardAssignment: ShardTotal must be >= 1, got $ShardTotal"
    }
    $median = Get-MedianDuration -Durations $Durations

    # Deterministic sort key: duration descending (LPT), path ascending as the tie-break so two
    # runs on the same inputs always produce the identical assignment.
    $decorated = @($Files | ForEach-Object {
        $d = if ($Durations.ContainsKey($_)) { [double]$Durations[$_] } else { $median }
        [PSCustomObject]@{ Path = $_; Duration = $d }
    })
    $sorted = @($decorated | Sort-Object -Property @{Expression = 'Duration'; Descending = $true }, @{Expression = 'Path'; Descending = $false })

    # NOTE: @(for (...) { [List[string]]::new() }) does NOT capture the for-loop body's output
    # the way @(foreach (...) {...}) or @(1..N | ForEach-Object {...}) would -- it silently
    # produces an EMPTY array (confirmed: Count=0), leaving every $shardFiles[$i] $null and the
    # first .Add() below throwing "cannot call a method on a null-valued expression". Build the
    # array by explicit index assignment instead.
    $shardFiles = [object[]]::new($ShardTotal)
    for ($i = 0; $i -lt $ShardTotal; $i++) { $shardFiles[$i] = [System.Collections.Generic.List[string]]::new() }
    $shardTotals = [double[]]::new($ShardTotal)

    foreach ($item in $sorted) {
        $minIdx = 0
        for ($i = 1; $i -lt $ShardTotal; $i++) {
            if ($shardTotals[$i] -lt $shardTotals[$minIdx]) { $minIdx = $i }
        }
        $shardFiles[$minIdx].Add($item.Path)
        $shardTotals[$minIdx] += $item.Duration
    }

    return [PSCustomObject]@{
        Shards         = @($shardFiles | ForEach-Object { , @($_.ToArray()) })
        ShardDurations = @($shardTotals)
    }
}

function Test-ShardAssignmentCoverage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Files,
        [Parameter(Mandatory)][object[]]$Shards
    )
    $counts = @{}
    foreach ($shard in $Shards) {
        foreach ($f in @($shard)) {
            if (-not $counts.ContainsKey($f)) { $counts[$f] = 0 }
            $counts[$f] = $counts[$f] + 1
        }
    }
    $missing = @($Files | Where-Object { -not $counts.ContainsKey($_) })
    $duplicated = @($counts.Keys | Where-Object { $counts[$_] -gt 1 })
    $fileSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$Files, [System.StringComparer]::Ordinal)
    $extra = @($counts.Keys | Where-Object { -not $fileSet.Contains($_) })
    return [PSCustomObject]@{
        Missing    = $missing
        Duplicated = $duplicated
        Extra      = $extra
        IsValid    = (($missing.Count -eq 0) -and ($duplicated.Count -eq 0) -and ($extra.Count -eq 0))
    }
}
