# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EdgeIntegrityIssues {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Checks 4 + 4b (t/3879 decomposition -- extracted verbatim,
        no behavior change): dangling edge references and self-loop edges.
    .DESCRIPTION
        One pass over edges.json computes both counts (an edge can independently be dangling,
        self-loop, both describe different shapes of the same scan, so they are NOT split
        into two separate functions -- splitting the scan loop itself would be the actual
        redesign the decomposition is explicitly avoiding).

        Threads BadEdges/SelfLoopEdges back to the caller: Test-TaxonomyIntegrity's -Repair
        block (edge pruning + the Force-threshold check, t/3853) reads both counts downstream
        of this check, so they are explicit return fields, not dropped.
    .PARAMETER EdgesPath
        Path to edges.json.
    .PARAMETER AllNodeIds
        HashSet[string] of every node id across all POV files + situations (from the load
        phase).
    .PARAMETER Registry
        The policy registry object (or $null) from Check 1 -- policy ids are valid edge
        endpoints too.
    .OUTPUTS
        [PSCustomObject] { BadEdges; SelfLoopEdges; Passed (int, 0-2); Issues }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$EdgesPath,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$AllNodeIds,

        [AllowNull()]
        $Registry
    )

    Set-StrictMode -Version Latest

    $Issues = [System.Collections.Generic.List[PSCustomObject]]::new()
    $Passed = 0
    $BadEdges = 0
    $SelfLoopEdges = 0

    if (Test-Path $EdgesPath) {
        $EdgesData = Read-EdgesFile -Path $EdgesPath   # t/2974: coercion-free read (preserve discovered_at strings)
        $ValidIds = [System.Collections.Generic.HashSet[string]]::new($AllNodeIds)
        if ($Registry) { foreach ($Pol in $Registry.policies) { [void]$ValidIds.Add($Pol.id) } }

        foreach ($Edge in @($EdgesData.edges)) {
            $Src = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
            $Tgt = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
            if (-not $ValidIds.Contains($Src) -or -not $ValidIds.Contains($Tgt)) {
                $BadEdges++
            }
            # Self-loops (source == target) are malformed: Invoke-EdgeDiscovery and
            # Import-OrganizationEdge reject them at creation, so any in the stored
            # graph are legacy/hand-introduced (t/2682). Count non-null sources only.
            if ($null -ne $Src -and $Src -eq $Tgt) {
                $SelfLoopEdges++
            }
        }
    }

    if ($BadEdges -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'EdgeRef'; Severity = 'Error'; Count = $BadEdges; Detail = "$BadEdges edges reference non-existent nodes/policies" })
    } else { $Passed++ }

    if ($SelfLoopEdges -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'SelfLoopEdge'; Severity = 'Error'; Count = $SelfLoopEdges; Detail = "$SelfLoopEdges self-loop edge(s) where source == target (malformed; rejected at creation)" })
    } else { $Passed++ }

    return [PSCustomObject]@{
        BadEdges      = $BadEdges
        SelfLoopEdges = $SelfLoopEdges
        Passed        = $Passed
        Issues        = $Issues
    }
}
