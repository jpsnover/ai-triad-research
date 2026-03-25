# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Embedding-based candidate pre-filtering for edge discovery.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Get-CosineSimilarity {
    param([double[]]$A, [double[]]$B)
    $Dot = 0.0; $NormA = 0.0; $NormB = 0.0
    for ($i = 0; $i -lt $A.Length; $i++) {
        $Dot   += $A[$i] * $B[$i]
        $NormA += $A[$i] * $A[$i]
        $NormB += $B[$i] * $B[$i]
    }
    $Denom = [Math]::Sqrt($NormA) * [Math]::Sqrt($NormB)
    if ($Denom -eq 0) { return 0.0 }
    return $Dot / $Denom
}

function Get-FilteredCandidates {
    <#
    .SYNOPSIS
        Returns the top-K candidate nodes for edge discovery, ranked by embedding cosine
        similarity to the source node, with a cross-POV diversity floor.
    .PARAMETER SourceId
        ID of the source node being processed.
    .PARAMETER Embeddings
        Hashtable of node ID → [double[]] embedding vectors.
    .PARAMETER AllNodes
        All taxonomy nodes (PSObject[]).
    .PARAMETER NodePovMap
        Hashtable of node ID → POV string.
    .PARAMETER TopK
        Maximum number of candidates to return. Default: 40.
    .PARAMETER MinPerOtherPov
        Minimum candidates from each non-source POV, regardless of similarity rank.
        Ensures cross-POV coverage. Default: 4.
    .NOTES
        If the source node has no embedding, returns all non-source nodes (fallback).
        Nodes without embeddings are included last (similarity = -1.0) to fill gaps.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourceId,
        [Parameter(Mandatory)][hashtable]$Embeddings,
        [Parameter(Mandatory)][PSObject[]]$AllNodes,
        [Parameter(Mandatory)][hashtable]$NodePovMap,
        [int]$TopK            = 40,
        [int]$MinPerOtherPov  = 4
    )

    Set-StrictMode -Version Latest

    # No embeddings available or source has none — return all non-source nodes unchanged
    if ($Embeddings.Count -eq 0 -or -not $Embeddings.ContainsKey($SourceId)) {
        return @($AllNodes | Where-Object { $_.id -ne $SourceId })
    }

    $SrcVec = $Embeddings[$SourceId]
    $SrcPov = if ($NodePovMap.ContainsKey($SourceId)) { $NodePovMap[$SourceId] } else { '' }

    # Score every candidate
    $Scored = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Node in $AllNodes) {
        if ($Node.id -eq $SourceId) { continue }
        $NodePov = if ($NodePovMap.ContainsKey($Node.id)) { $NodePovMap[$Node.id] } else { '' }
        $Sim = if ($Embeddings.ContainsKey($Node.id)) {
            Get-CosineSimilarity -A $SrcVec -B $Embeddings[$Node.id]
        } else {
            -1.0    # no embedding — lowest priority but not excluded
        }
        [void]$Scored.Add([PSCustomObject]@{ Node = $Node; Sim = $Sim; Pov = $NodePov })
    }

    # Sort descending by similarity
    $Sorted = @($Scored | Sort-Object -Property Sim -Descending)

    # Greedy top-K selection
    $Selected    = [System.Collections.Generic.List[PSObject]]::new()
    $SelectedIds = [System.Collections.Generic.HashSet[string]]::new()
    $PovCounts   = @{}

    foreach ($Entry in $Sorted) {
        if ($Selected.Count -ge $TopK) { break }
        [void]$Selected.Add($Entry.Node)
        [void]$SelectedIds.Add($Entry.Node.id)
        $PovCounts[$Entry.Pov] = ($PovCounts[$Entry.Pov] ?? 0) + 1
    }

    # Cross-POV diversity floor: guarantee MinPerOtherPov from every non-source POV
    $OtherPovs = @($NodePovMap.Values | Where-Object { $_ -ne $SrcPov } | Select-Object -Unique)
    foreach ($Pov in $OtherPovs) {
        $Have = if ($PovCounts.ContainsKey($Pov)) { $PovCounts[$Pov] } else { 0 }
        if ($Have -ge $MinPerOtherPov) { continue }

        $Need  = $MinPerOtherPov - $Have
        $Extra = @($Sorted |
            Where-Object { $_.Pov -eq $Pov -and -not $SelectedIds.Contains($_.Node.id) } |
            Select-Object -First $Need)

        foreach ($Entry in $Extra) {
            [void]$Selected.Add($Entry.Node)
            [void]$SelectedIds.Add($Entry.Node.id)
        }
    }

    return $Selected.ToArray()
}
