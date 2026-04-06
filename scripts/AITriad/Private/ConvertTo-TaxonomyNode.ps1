# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Converts a raw JSON node object into a typed [TaxonomyNode] instance.
.DESCRIPTION
    Takes a deserialized JSON node (from a POV or cross-cutting taxonomy file)
    and maps its properties onto the TaxonomyNode class defined in AITriad.psm1.
    Handles both POV nodes (which have category, parent_id, children,
    cross_cutting_refs) and cross-cutting nodes (which have interpretations and
    linked_nodes).  Graph attributes from Invoke-AttributeExtraction are carried
    through when present.
.PARAMETER PovKey
    The POV key this node belongs to: 'accelerationist', 'safetyist', 'skeptic',
    or 'cross-cutting'.
.PARAMETER Node
    The raw PSObject deserialized from the taxonomy JSON file.  Must have at
    minimum 'id', 'label', and 'description' properties.
.PARAMETER Score
    Optional relevance score (0.0–1.0) assigned during search or embedding
    similarity operations.  Defaults to 0.
.EXAMPLE
    $Json = Get-Content accelerationist.json | ConvertFrom-Json
    $Nodes = $Json.nodes | ForEach-Object { ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node $_ }

    Converts all nodes from the accelerationist taxonomy file into typed objects.
.EXAMPLE
    ConvertTo-TaxonomyNode -PovKey 'cross-cutting' -Node $CcNode -Score 0.87

    Converts a cross-cutting node with a similarity score from an embedding search.
#>
function ConvertTo-TaxonomyNode {
    param(
        [string]$PovKey,
        [PSObject]$Node,
        [double]$Score = 0
    )

    $Obj = [TaxonomyNode]::new()
    $Obj.POV         = $PovKey
    $Obj.Id          = $Node.id
    $Obj.Label       = $Node.label
    $Obj.Description = $Node.description
    $Obj.Score       = $Score

    # POV files (accelerationist, safetyist, skeptic) have category/parent/children
    if ($null -ne $Node.PSObject.Properties['category']) {
        $Obj.Category         = $Node.category
        $Obj.ParentId         = $Node.parent_id
        $Obj.Children         = @($Node.children)
        # Accept both cross_cutting_refs and situation_refs (Phase 1D shim)
        $Refs = @()
        if ($null -ne $Node.PSObject.Properties['situation_refs']) {
            $Refs = @($Node.situation_refs)
        }
        elseif ($null -ne $Node.PSObject.Properties['cross_cutting_refs']) {
            $Refs = @($Node.cross_cutting_refs)
        }
        $Obj.CrossCuttingRefs = $Refs
        $Obj.SituationRefs    = $Refs

        if ($null -ne $Node.PSObject.Properties['parent_relationship']) {
            $Obj.ParentRelationship = $Node.parent_relationship
        }
        if ($null -ne $Node.PSObject.Properties['parent_rationale']) {
            $Obj.ParentRationale = $Node.parent_rationale
        }
    }

    # Cross-cutting file has interpretations and linked_nodes
    if ($null -ne $Node.PSObject.Properties['interpretations']) {
        $Obj.Interpretations = $Node.interpretations
        $Obj.LinkedNodes     = @($Node.linked_nodes)
    }

    # Graph attributes (from Invoke-AttributeExtraction)
    if ($null -ne $Node.PSObject.Properties['graph_attributes']) {
        $Obj.GraphAttributes = $Node.graph_attributes
    }

    $Obj
}
