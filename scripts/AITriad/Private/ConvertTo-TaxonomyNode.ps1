# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Converts a raw JSON node into a typed [TaxonomyNode] object.
# The TaxonomyNode class is defined in AITriad.psm1.

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
        $Obj.CrossCuttingRefs = @($Node.cross_cutting_refs)

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
