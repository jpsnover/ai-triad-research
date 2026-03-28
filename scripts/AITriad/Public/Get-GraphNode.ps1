# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-GraphNode {
    <#
    .SYNOPSIS
        Retrieves a taxonomy node with its edges and graph attributes.
    .DESCRIPTION
        Loads a node by ID and returns it enriched with all inbound and outbound
        edges from edges.json. Optionally traverses the graph to a given depth.
    .PARAMETER Id
        The node ID to retrieve (e.g., "acc-goals-001").
    .PARAMETER Depth
        How many hops of edges to include. Default: 1 (direct neighbors only).
    .PARAMETER EdgeType
        Filter to only show edges of this type (e.g., TENSION_WITH, ASSUMES).
    .PARAMETER Status
        Filter edges by approval status. Default: all statuses.
        Valid values: proposed, approved, rejected.
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .EXAMPLE
        Get-GraphNode -Id "saf-goals-001"
    .EXAMPLE
        Get-GraphNode -Id "acc-goals-001" -Depth 2 -EdgeType TENSION_WITH
    .EXAMPLE
        Get-GraphNode -Id "cc-001" -Status approved
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Id,

        [ValidateRange(0, 5)]
        [int]$Depth = 1,

        [string]$EdgeType = '',

        [ValidateSet('proposed', 'approved', 'rejected', '')]
        [string]$Status = '',

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir

    # Load all nodes
    $AllNodes = @{}
    $NodePovMap = @{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        try {
            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warn "Failed to load $PovKey.json — $($_.Exception.Message)"
            continue
        }
        foreach ($Node in $FileData.nodes) {
            $AllNodes[$Node.id] = $Node
            $NodePovMap[$Node.id] = $PovKey
        }
    }

    if (-not $AllNodes.ContainsKey($Id)) {
        Write-Fail "Node not found: $Id"
        return
    }

    # Load edges
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $Edges = @()
    if (Test-Path $EdgesPath) {
        try {
            $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json -Depth 20
            $Edges = @($EdgesData.edges)
        }
        catch {
            Write-Warn "Failed to load edges.json — $($_.Exception.Message)"
        }
    }

    # BFS traversal
    $Visited = [System.Collections.Generic.HashSet[string]]::new()
    $Queue = [System.Collections.Generic.Queue[PSObject]]::new()
    $Queue.Enqueue([PSCustomObject]@{ Id = $Id; CurrentDepth = 0 })
    [void]$Visited.Add($Id)

    $ResultNodes = [System.Collections.Generic.List[PSObject]]::new()
    $ResultEdges = [System.Collections.Generic.List[PSObject]]::new()

    while ($Queue.Count -gt 0) {
        $Current = $Queue.Dequeue()
        $CurrentId = $Current.Id
        $CurrentDepth = $Current.CurrentDepth

        # Add node to results
        $Node = $AllNodes[$CurrentId]
        $NodeResult = [PSCustomObject]@{
            id               = $Node.id
            pov              = $NodePovMap[$CurrentId]
            label            = $Node.label
            description      = $Node.description
            graph_attributes = if ($Node.PSObject.Properties['graph_attributes']) { $Node.graph_attributes } else { $null }
            depth            = $CurrentDepth
        }
        $ResultNodes.Add($NodeResult)

        if ($CurrentDepth -ge $Depth) { continue }

        # Find connected edges
        foreach ($Edge in $Edges) {
            $IsOutbound = $Edge.source -eq $CurrentId
            $IsInbound  = $Edge.target -eq $CurrentId
            $IsBidir    = $Edge.PSObject.Properties['bidirectional'] -and $Edge.bidirectional

            if (-not ($IsOutbound -or ($IsInbound -and $IsBidir))) { continue }

            # Apply filters
            if ($EdgeType -and $Edge.type -ne $EdgeType) { continue }
            if ($Status -and $Edge.status -ne $Status) { continue }

            $NeighborId = if ($IsOutbound) { $Edge.target } else { $Edge.source }

            $ResultEdges.Add($Edge)

            if (-not $Visited.Contains($NeighborId) -and $AllNodes.ContainsKey($NeighborId)) {
                [void]$Visited.Add($NeighborId)
                $Queue.Enqueue([PSCustomObject]@{ Id = $NeighborId; CurrentDepth = $CurrentDepth + 1 })
            }
        }
    }

    [PSCustomObject]@{
        root_node = $Id
        nodes     = $ResultNodes
        edges     = $ResultEdges
        stats     = [PSCustomObject]@{
            node_count = $ResultNodes.Count
            edge_count = $ResultEdges.Count
            max_depth  = $Depth
        }
    }
}
