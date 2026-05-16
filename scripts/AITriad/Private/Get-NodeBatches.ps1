# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Clusters taxonomy nodes into batches for batch edge discovery.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Get-NodeBatches {
    <#
    .SYNOPSIS
        Groups taxonomy nodes into batches for batch edge discovery, using embedding
        similarity clustering with cross-POV diversity enforcement.
    .PARAMETER Nodes
        Nodes to cluster (PSObject[] with .id property).
    .PARAMETER Embeddings
        Hashtable of node ID → [double[]] embedding vectors.
    .PARAMETER NodePovMap
        Hashtable of node ID → POV string.
    .PARAMETER BatchSize
        Target number of nodes per batch. Default: 10.
    .NOTES
        Uses a greedy nearest-neighbor approach: pick a seed node, find its nearest
        neighbors, ensure cross-POV diversity, then remove those nodes and repeat.
        Situation nodes are distributed across batches that contain their linked POV nodes.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSObject[]]$Nodes,
        [Parameter(Mandatory)][hashtable]$Embeddings,
        [Parameter(Mandatory)][hashtable]$NodePovMap,
        [int]$BatchSize = 10
    )

    Set-StrictMode -Version Latest

    if ($Nodes.Count -le $BatchSize) {
        return @(, $Nodes)
    }

    # Build a working set of node IDs
    $Remaining = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Node in $Nodes) { [void]$Remaining.Add($Node.id) }

    $NodeMap = @{}
    foreach ($Node in $Nodes) { $NodeMap[$Node.id] = $Node }

    $Batches = [System.Collections.Generic.List[PSObject[]]]::new()

    while ($Remaining.Count -gt 0) {
        # Pick the first remaining node as seed
        $SeedId = $Remaining | Select-Object -First 1

        if (-not $Embeddings.ContainsKey($SeedId)) {
            # No embedding — just take BatchSize remaining nodes
            $Batch = @($Remaining | Select-Object -First $BatchSize | ForEach-Object { $NodeMap[$_] })
            foreach ($N in $Batch) { [void]$Remaining.Remove($N.id) }
            [void]$Batches.Add($Batch)
            continue
        }

        $SeedVec = $Embeddings[$SeedId]
        $SeedPov = if ($NodePovMap.ContainsKey($SeedId)) { $NodePovMap[$SeedId] } else { '' }

        # Score remaining nodes by similarity to seed
        $Scored = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($NodeId in $Remaining) {
            if ($NodeId -eq $SeedId) { continue }
            if ($Embeddings.ContainsKey($NodeId)) {
                $Sim = Get-CosineSimilarity -A $SeedVec -B $Embeddings[$NodeId]
            } else {
                $Sim = -1.0
            }
            $Pov = if ($NodePovMap.ContainsKey($NodeId)) { $NodePovMap[$NodeId] } else { '' }
            [void]$Scored.Add([PSCustomObject]@{ Id = $NodeId; Sim = $Sim; Pov = $Pov })
        }

        $Sorted = @($Scored | Sort-Object -Property Sim -Descending)

        # Greedy selection: fill batch with nearest neighbors, ensuring cross-POV diversity
        $BatchIds = [System.Collections.Generic.List[string]]::new()
        [void]$BatchIds.Add($SeedId)
        $PovInBatch = @{ $SeedPov = 1 }
        $MaxPerPov = [Math]::Ceiling($BatchSize * 0.5)  # no POV dominates >50%

        foreach ($Entry in $Sorted) {
            if ($BatchIds.Count -ge $BatchSize) { break }
            $EntryPov = $Entry.Pov
            $PovCount = if ($PovInBatch.ContainsKey($EntryPov)) { $PovInBatch[$EntryPov] } else { 0 }
            if ($PovCount -ge $MaxPerPov) { continue }  # skip to ensure diversity
            [void]$BatchIds.Add($Entry.Id)
            $PovInBatch[$EntryPov] = $PovCount + 1
        }

        # If batch is underfull due to POV cap, backfill with any remaining
        if ($BatchIds.Count -lt $BatchSize) {
            foreach ($Entry in $Sorted) {
                if ($BatchIds.Count -ge $BatchSize) { break }
                if ($BatchIds.Contains($Entry.Id)) { continue }
                [void]$BatchIds.Add($Entry.Id)
            }
        }

        $Batch = @($BatchIds | ForEach-Object { $NodeMap[$_] })
        foreach ($Id in $BatchIds) { [void]$Remaining.Remove($Id) }
        [void]$Batches.Add($Batch)
    }

    return $Batches.ToArray()
}
