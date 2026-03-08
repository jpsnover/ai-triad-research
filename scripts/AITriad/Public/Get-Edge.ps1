# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Edge {
    <#
    .SYNOPSIS
        Lists and filters edges in the taxonomy graph.
    .DESCRIPTION
        Reads edges.json and returns edges matching the specified criteria.
        All string filters support wildcards. Multiple filters are AND-combined.
        With no parameters, returns all edges sorted by confidence descending.
    .PARAMETER Source
        Wildcard pattern matched against the source node ID.
    .PARAMETER Target
        Wildcard pattern matched against the target node ID.
    .PARAMETER NodeId
        Wildcard pattern matched against either source or target node ID.
        Useful for finding all edges connected to a node regardless of direction.
    .PARAMETER Type
        Wildcard pattern matched against the edge type (e.g., SUPPORTS, 'TENS*').
    .PARAMETER Status
        Edge approval status: proposed, approved, or rejected.
    .PARAMETER MinConfidence
        Minimum confidence threshold (0.0-1.0). Default: 0.0.
    .PARAMETER MaxConfidence
        Maximum confidence threshold (0.0-1.0). Default: 1.0.
    .PARAMETER Bidirectional
        When specified, returns only bidirectional ($true) or directional ($false) edges.
    .PARAMETER CrossPov
        When specified, returns only cross-POV ($true) or same-POV ($false) edges.
    .PARAMETER Strength
        Wildcard pattern matched against the edge strength (strong, moderate, weak).
    .PARAMETER Model
        Wildcard pattern matched against the model that discovered the edge.
    .PARAMETER Rationale
        Wildcard pattern matched against the edge rationale text.
    .PARAMETER DiscoveredAfter
        Returns only edges discovered on or after this date (yyyy-MM-dd).
    .PARAMETER DiscoveredBefore
        Returns only edges discovered on or before this date (yyyy-MM-dd).
    .PARAMETER SourcePov
        Filter to edges whose source node belongs to this POV.
    .PARAMETER TargetPov
        Filter to edges whose target node belongs to this POV.
    .PARAMETER Index
        Return a specific edge by its zero-based index in edges.json.
    .PARAMETER First
        Return only the first N matching edges.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Get-Edge
        # Returns all edges.
    .EXAMPLE
        Get-Edge -Source 'acc-goals-*'
        # All edges from accelerationist goal nodes.
    .EXAMPLE
        Get-Edge -NodeId 'saf-goals-001'
        # All edges connected to saf-goals-001 (source or target).
    .EXAMPLE
        Get-Edge -Type CONTRADICTS -Status approved
        # Approved contradictions.
    .EXAMPLE
        Get-Edge -CrossPov -MinConfidence 0.9
        # High-confidence cross-POV edges.
    .EXAMPLE
        Get-Edge -Rationale '*existential*' -Type 'TENS*'
        # Tension edges mentioning existential risk.
    .EXAMPLE
        Get-Edge -SourcePov safetyist -TargetPov accelerationist -Status approved
        # Approved edges from safetyist to accelerationist nodes.
    .EXAMPLE
        Get-Edge -Index 42
        # Return edge at index 42.
    .EXAMPLE
        Get-Edge -Type SUPPORTS -First 10
        # First 10 SUPPORTS edges by confidence.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Source,

        [string]$Target,

        [string]$NodeId,

        [string]$Type,

        [ValidateSet('proposed', 'approved', 'rejected', '')]
        [string]$Status,

        [ValidateRange(0.0, 1.0)]
        [double]$MinConfidence = 0.0,

        [ValidateRange(0.0, 1.0)]
        [double]$MaxConfidence = 1.0,

        [Nullable[bool]]$Bidirectional,

        [Nullable[bool]]$CrossPov,

        [string]$Strength,

        [string]$Model,

        [string]$Rationale,

        [string]$DiscoveredAfter,

        [string]$DiscoveredBefore,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', '')]
        [string]$SourcePov,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', '')]
        [string]$TargetPov,

        [int]$Index = -1,

        [int]$First = 0,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest

    $TaxDir    = Join-Path $RepoRoot 'taxonomy' 'Origin'
    $EdgesPath = Join-Path $TaxDir 'edges.json'

    if (-not (Test-Path $EdgesPath)) {
        Write-Fail 'No edges.json found. Run Invoke-EdgeDiscovery first.'
        return
    }

    $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json

    # ------------------------------------------------------------------
    # Index mode — fast return of a single edge
    # ------------------------------------------------------------------
    if ($Index -ge 0) {
        if ($Index -ge $EdgesData.edges.Count) {
            Write-Fail "Edge index $Index out of range (0-$($EdgesData.edges.Count - 1))."
            return
        }
        $E = $EdgesData.edges[$Index]
        return [PSCustomObject]@{
            PSTypeName    = 'AITriad.Edge'
            Index         = $Index
            Source        = $E.source
            Target        = $E.target
            Type          = $E.type
            Bidirectional = [bool]$E.bidirectional
            Confidence    = $E.confidence
            Status        = $E.status
            Strength      = if ($E.PSObject.Properties['strength']) { $E.strength } else { $null }
            Rationale     = $E.rationale
            Notes         = if ($E.PSObject.Properties['notes']) { $E.notes } else { $null }
            DiscoveredAt  = $E.discovered_at
            Model         = $E.model
        }
    }

    # ------------------------------------------------------------------
    # Build node→POV map (only when POV-based filters are active)
    # ------------------------------------------------------------------
    $NodePovMap = $null
    if ($SourcePov -or $TargetPov -or $CrossPov -ne $null) {
        $NodePovMap = @{}
        foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')) {
            $FilePath = Join-Path $TaxDir "$PovKey.json"
            if (-not (Test-Path $FilePath)) { continue }
            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
            foreach ($Node in $FileData.nodes) {
                $NodePovMap[$Node.id] = $PovKey
            }
        }
    }

    # ------------------------------------------------------------------
    # Filter edges
    # ------------------------------------------------------------------
    $Results = [System.Collections.Generic.List[PSObject]]::new()
    $EdgeCount = $EdgesData.edges.Count

    for ($i = 0; $i -lt $EdgeCount; $i++) {
        $E = $EdgesData.edges[$i]

        # Source/Target/NodeId wildcard filters
        if ($Source -and $E.source -notlike $Source) { continue }
        if ($Target -and $E.target -notlike $Target) { continue }
        if ($NodeId -and ($E.source -notlike $NodeId) -and ($E.target -notlike $NodeId)) { continue }

        # Type wildcard
        if ($Type -and $E.type -notlike $Type) { continue }

        # Status exact
        if ($Status -and $E.status -ne $Status) { continue }

        # Confidence range
        if ($E.confidence -lt $MinConfidence) { continue }
        if ($E.confidence -gt $MaxConfidence) { continue }

        # Bidirectional filter
        if ($null -ne $Bidirectional) {
            $IsBidir = [bool]$E.bidirectional
            if ($IsBidir -ne $Bidirectional) { continue }
        }

        # Strength wildcard
        if ($Strength) {
            $EStrength = if ($E.PSObject.Properties['strength']) { $E.strength } else { '' }
            if ($EStrength -notlike $Strength) { continue }
        }

        # Model wildcard
        if ($Model -and $E.model -notlike $Model) { continue }

        # Rationale wildcard
        if ($Rationale -and $E.rationale -notlike $Rationale) { continue }

        # Date range filters
        if ($DiscoveredAfter -and $E.discovered_at -lt $DiscoveredAfter) { continue }
        if ($DiscoveredBefore -and $E.discovered_at -gt $DiscoveredBefore) { continue }

        # POV-based filters
        if ($NodePovMap) {
            $SPov = if ($NodePovMap.ContainsKey($E.source)) { $NodePovMap[$E.source] } else { 'unknown' }
            $TPov = if ($NodePovMap.ContainsKey($E.target)) { $NodePovMap[$E.target] } else { 'unknown' }

            if ($SourcePov -and $SPov -ne $SourcePov) { continue }
            if ($TargetPov -and $TPov -ne $TargetPov) { continue }

            if ($null -ne $CrossPov) {
                $IsCross = $SPov -ne $TPov
                if ($IsCross -ne $CrossPov) { continue }
            }
        }

        $Results.Add([PSCustomObject]@{
            PSTypeName    = 'AITriad.Edge'
            Index         = $i
            Source        = $E.source
            Target        = $E.target
            Type          = $E.type
            Bidirectional = [bool]$E.bidirectional
            Confidence    = $E.confidence
            Status        = $E.status
            Strength      = if ($E.PSObject.Properties['strength']) { $E.strength } else { $null }
            Rationale     = $E.rationale
            Notes         = if ($E.PSObject.Properties['notes']) { $E.notes } else { $null }
            DiscoveredAt  = $E.discovered_at
            Model         = $E.model
        })

        if ($First -gt 0 -and $Results.Count -ge $First) { break }
    }

    if ($Results.Count -eq 0) {
        Write-Warning 'No edges matched the specified filters.'
        return
    }

    $Results | Sort-Object Confidence -Descending
}
