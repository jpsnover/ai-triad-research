# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-PovLineage {
    <#
    .SYNOPSIS
        Traces the ancestry and/or descendants of a taxonomy node.
    .DESCRIPTION
        Given one or more taxonomy node IDs, walks the parent-child hierarchy
        to display the full lineage. By default shows ancestors (root → node).
        Use -Descendants to show the subtree below each node instead, or -Both
        to display the full connected tree.

        Output includes depth-indented labels for visual inspection and typed
        objects for pipeline use.
    .PARAMETER Id
        One or more taxonomy node ID patterns (supports wildcards).
    .PARAMETER Label
        One or more wildcard patterns matched against node labels.
    .PARAMETER POV
        Filter to a specific POV before resolving IDs/labels.
    .PARAMETER Descendants
        Show descendants (children, grandchildren, etc.) instead of ancestors.
    .PARAMETER Both
        Show both ancestors and descendants.
    .PARAMETER Depth
        Maximum depth for descendant traversal. Default: 10.
    .PARAMETER Raw
        Suppress the formatted tree display and emit only typed objects.
    .EXAMPLE
        Get-PovLineage acc-desires-001
        # Shows the ancestor chain from root to acc-desires-001.
    .EXAMPLE
        Get-PovLineage 'acc-desires-*' -Descendants
        # Lineage for all accelerationist desire nodes.
    .EXAMPLE
        Get-PovLineage -Label '*governance*'
        # Finds nodes by label, then shows their lineage.
    .EXAMPLE
        Get-PovLineage -POV skeptic -Label '*bias*' -Both
        # Skeptic nodes matching 'bias', showing full trees.
    .EXAMPLE
        Get-PovLineage acc-beliefs-039 -Both
        # Full lineage: ancestors above, descendants below.
    .EXAMPLE
        Get-Tax -POV skeptic -Id 'skp-beliefs-*' | Get-PovLineage -Raw
        # Pipeline: trace ancestors for all skeptic belief nodes.
    .LINK
        Show-AITriadHelp
    .LINK
        Get-IntellectualLineage
    .LINK
        Repair-PovLineage
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [string[]]$Id,

        [string[]]$Label,

        [ArgumentCompleter({ param($cmd, $param, $word) @('accelerationist','safetyist','skeptic','situations') | Where-Object { $_ -like "$word*" } })]
        [string]$POV = '*',

        [switch]$Descendants,

        [switch]$Both,

        [ValidateRange(1, 50)]
        [int]$Depth = 10,

        [switch]$Raw
    )

    begin {
        Set-StrictMode -Version Latest
        $ErrorActionPreference = 'Stop'
        $CollectedIds = [System.Collections.Generic.List[string]]::new()
    }

    process {
        foreach ($i in $Id) {
            if (-not [string]::IsNullOrWhiteSpace($i)) { $CollectedIds.Add($i) }
        }
    }

    end {
        Assert-TaxonomyCacheFresh

        # Build a lookup table: node ID → TaxonomyNode
        $NodeLookup = @{}
        foreach ($Key in $script:TaxonomyData.Keys) {
            if ($Key -notlike $POV.ToLower()) { continue }
            $Entry = $script:TaxonomyData[$Key]
            foreach ($Node in $Entry.nodes) {
                $NodeLookup[$Node.id] = @{ POV = $Key; Node = $Node }
            }
        }
        # Always include all POVs in the full lookup for ancestor/descendant traversal
        $FullLookup = @{}
        foreach ($Key in $script:TaxonomyData.Keys) {
            $Entry = $script:TaxonomyData[$Key]
            foreach ($Node in $Entry.nodes) {
                $FullLookup[$Node.id] = @{ POV = $Key; Node = $Node }
            }
        }

        # Resolve wildcards and labels into concrete node IDs
        $ResolvedIds = [System.Collections.Generic.List[string]]::new()
        $HasId    = $CollectedIds.Count -gt 0
        $HasLabel = ($null -ne $Label) -and ($Label.Length -gt 0)

        if (-not $HasId -and -not $HasLabel) {
            Write-Warning 'Specify -Id or -Label to select nodes.'
            return
        }

        foreach ($Entry in $NodeLookup.Values) {
            $Matched = $false
            if ($HasId) {
                foreach ($Pat in $CollectedIds) {
                    if ($Entry.Node.id -like $Pat) { $Matched = $true; break }
                }
            }
            if (-not $Matched -and $HasLabel) {
                foreach ($Pat in $Label) {
                    if ($Entry.Node.label -like $Pat) { $Matched = $true; break }
                }
            }
            if ($Matched -and -not $ResolvedIds.Contains($Entry.Node.id)) {
                $ResolvedIds.Add($Entry.Node.id)
            }
        }

        if ($ResolvedIds.Count -eq 0) {
            $SearchTerms = @()
            if ($HasId) { $SearchTerms += ($CollectedIds | ForEach-Object { "Id='$_'" }) }
            if ($HasLabel) { $SearchTerms += ($Label | ForEach-Object { "Label='$_'" }) }
            Write-Warning "No nodes matched: $($SearchTerms -join ', ')"
            return
        }

        foreach ($NodeId in $ResolvedIds) {
            $Info = $FullLookup[$NodeId]
            if (-not $Info) { continue }

            $ShowAncestors   = (-not $Descendants) -or $Both
            $ShowDescendants = $Descendants -or $Both

            $Results = [System.Collections.Generic.List[PSObject]]::new()

            # ── Ancestors: walk up via ParentId ──────────────────────────
            if ($ShowAncestors) {
                $AncestorStack = [System.Collections.Generic.List[PSObject]]::new()
                $Current = $Info
                $Visited = [System.Collections.Generic.HashSet[string]]::new(
                    [System.StringComparer]::OrdinalIgnoreCase)
                $null = $Visited.Add($NodeId)

                while ($Current.Node.PSObject.Properties['parent_id'] -and $Current.Node.parent_id -and $FullLookup.ContainsKey($Current.Node.parent_id)) {
                    $ParentId = $Current.Node.parent_id
                    if (-not $Visited.Add($ParentId)) { break }  # cycle guard
                    $Current = $FullLookup[$ParentId]
                    $AncestorStack.Add([PSCustomObject]@{
                        PSTypeName   = 'TaxonomyNode.Lineage'
                        Id           = $Current.Node.id
                        Label        = $Current.Node.label
                        Category     = if ($Current.Node.PSObject.Properties['category']) { $Current.Node.category } else { $null }
                        POV          = $Current.POV
                        Depth        = 0  # set below
                        Relationship = 'ancestor'
                        TargetId     = $NodeId
                    })
                }

                # Reverse so root is first, assign depths
                $AncestorStack.Reverse()
                for ($i = 0; $i -lt $AncestorStack.Count; $i++) {
                    $AncestorStack[$i].Depth = $i
                    $Results.Add($AncestorStack[$i])
                }

                # Add the target node itself
                $TargetDepth = $AncestorStack.Count
                $Results.Add([PSCustomObject]@{
                    PSTypeName   = 'TaxonomyNode.Lineage'
                    Id           = $Info.Node.id
                    Label        = $Info.Node.label
                    Category     = if ($Info.Node.PSObject.Properties['category']) { $Info.Node.category } else { $null }
                    POV          = $Info.POV
                    Depth        = $TargetDepth
                    Relationship = 'self'
                    TargetId     = $NodeId
                })
            } else {
                # Descendants-only: emit the root node at depth 0
                $TargetDepth = 0
                $Results.Add([PSCustomObject]@{
                    PSTypeName   = 'TaxonomyNode.Lineage'
                    Id           = $Info.Node.id
                    Label        = $Info.Node.label
                    Category     = if ($Info.Node.PSObject.Properties['category']) { $Info.Node.category } else { $null }
                    POV          = $Info.POV
                    Depth        = 0
                    Relationship = 'self'
                    TargetId     = $NodeId
                })
            }

            # ── Descendants: walk down via Children (BFS) ────────────────
            if ($ShowDescendants) {
                $Queue = [System.Collections.Generic.Queue[PSObject]]::new()
                $DescVisited = [System.Collections.Generic.HashSet[string]]::new(
                    [System.StringComparer]::OrdinalIgnoreCase)
                $null = $DescVisited.Add($NodeId)

                $ChildIds = @($Info.Node.children)
                foreach ($cid in $ChildIds) {
                    if ([string]::IsNullOrWhiteSpace($cid)) { continue }
                    $Queue.Enqueue([PSCustomObject]@{ Id = $cid; DepthOffset = 1 })
                }

                while ($Queue.Count -gt 0) {
                    $Item = $Queue.Dequeue()
                    if (-not $DescVisited.Add($Item.Id)) { continue }
                    if ($Item.DepthOffset -gt $Depth) { continue }

                    $ChildInfo = $FullLookup[$Item.Id]
                    if (-not $ChildInfo) { continue }

                    $Results.Add([PSCustomObject]@{
                        PSTypeName   = 'TaxonomyNode.Lineage'
                        Id           = $ChildInfo.Node.id
                        Label        = $ChildInfo.Node.label
                        Category     = if ($ChildInfo.Node.PSObject.Properties['category']) { $ChildInfo.Node.category } else { $null }
                        POV          = $ChildInfo.POV
                        Depth        = $TargetDepth + $Item.DepthOffset
                        Relationship = 'descendant'
                        TargetId     = $NodeId
                    })

                    $GrandChildren = @($ChildInfo.Node.children)
                    foreach ($gcid in $GrandChildren) {
                        if ([string]::IsNullOrWhiteSpace($gcid)) { continue }
                        $Queue.Enqueue([PSCustomObject]@{ Id = $gcid; DepthOffset = $Item.DepthOffset + 1 })
                    }
                }
            }

            # ── Output ───────────────────────────────────────────────────
            if (-not $Raw) {
                Write-Host ''
                Write-Host "  Lineage: $NodeId" -ForegroundColor Cyan
                Write-Host "  $('─' * 60)" -ForegroundColor DarkGray
                foreach ($R in $Results) {
                    $Indent = '  ' + ('  ' * $R.Depth)
                    $Prefix = switch ($R.Relationship) {
                        'self'       { '►' }
                        'ancestor'   { '│' }
                        'descendant' { '├' }
                    }
                    $Color = switch ($R.Relationship) {
                        'self'       { 'Green' }
                        'ancestor'   { 'White' }
                        'descendant' { 'Gray' }
                    }
                    $CatSuffix = if ($R.Category) { " [$($R.Category)]" } else { '' }
                    Write-Host "${Indent}${Prefix} $($R.Id)  $($R.Label)${CatSuffix}" -ForegroundColor $Color
                }
                Write-Host ''
            }

            foreach ($R in $Results) { $R }
        }
    }
}
