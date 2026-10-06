# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-NodeAttributeCoverage {
    <#
    .SYNOPSIS
        Part of Measure-TaxonomyBaseline's ontology-coverage metric (t/3910
        decomposition; no behavior change): node_scope, parent_relationship, and
        fallacy-tier coverage, all scanned over $AllNodes.
    .PARAMETER AllNodes
        Node id -> node lookup.
    .OUTPUTS
        [PSCustomObject] { NodeScopeCount; ParentRelCount; FallacyWithTier }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$AllNodes
    )

    Set-StrictMode -Version Latest

    $NodeScopeCount = 0
    $ParentRelCount = 0
    foreach ($Node in $AllNodes.Values) {
        if ($Node.PSObject.Properties['graph_attributes']) { $GA = $Node.graph_attributes } else { $GA = $null }
        if ($GA -and $GA.PSObject.Properties['node_scope'] -and $GA.node_scope) { $NodeScopeCount++ }
        if ($Node.PSObject.Properties['parent_id'] -and $Node.parent_id) { $ParentRelCount++ }
    }

    $FallacyWithTier = 0
    foreach ($Node in $AllNodes.Values) {
        if ($Node.PSObject.Properties['graph_attributes']) { $GA = $Node.graph_attributes } else { $GA = $null }
        if (-not ($GA -and $GA.PSObject.Properties['possible_fallacies'] -and $GA.possible_fallacies)) { continue }
        foreach ($F in @($GA.possible_fallacies)) {
            if ($F.PSObject.Properties['type'] -and $F.type) { $FallacyWithTier++ }
        }
    }

    return [PSCustomObject]@{
        NodeScopeCount  = $NodeScopeCount
        ParentRelCount  = $ParentRelCount
        FallacyWithTier = $FallacyWithTier
    }
}
