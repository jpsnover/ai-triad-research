# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyDensitySignals {
    <#
    .SYNOPSIS
        TaxoAdapt mapping-density signals, POV-normalized (t/3910 extraction from
        Get-TaxonomyHealthData). Builds the parent->children map from the raw taxonomy data,
        then concatenates the depth_expand, width_expand and pov_imbalance_* signals.
    .OUTPUTS
        [object[]] all density-signal objects, in that order.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][hashtable]$NodeIndex,
        [Parameter(Mandatory)][hashtable]$CoverageBalance,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$UnmappedConcepts
    )

    Set-StrictMode -Version Latest

    $ChildrenMap = @{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            if (-not ($Node.PSObject.Properties['parent_id'] -and $Node.parent_id)) { continue }
            if (-not $ChildrenMap.ContainsKey($Node.parent_id)) {
                $ChildrenMap[$Node.parent_id] = [System.Collections.Generic.List[string]]::new()
            }
            $ChildrenMap[$Node.parent_id].Add($Node.id)
        }
    }

    # Plain array concatenation, not List.AddRange: @(object[]) isn't assignable to
    # List[PSObject].AddRange's IEnumerable<PSObject> parameter (a generic-type mismatch,
    # confirmed empirically), and @() around each call still protects the separate hazard of
    # a zero-item callee return collapsing to $null (the t/3948-class hazard's zero-element
    # sibling) before it ever reaches the "+".
    return @() + @(Get-TaxonomyDepthExpandSignals -ChildrenMap $ChildrenMap -NodeIndex $NodeIndex) +
        @(Get-TaxonomyWidthExpandSignals -UnmappedConcepts $UnmappedConcepts) +
        @(Get-TaxonomyPovImbalanceSignals -CoverageBalance $CoverageBalance)
}
