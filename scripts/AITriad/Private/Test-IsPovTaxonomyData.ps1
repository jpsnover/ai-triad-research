# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-IsPovTaxonomyData {
    <#
    .SYNOPSIS
        Returns $true when a parsed JSON object has the shape of a POV/taxonomy
        node file — a 'nodes' array whose entries carry an 'id' property.
    .DESCRIPTION
        Gates $script:TaxonomyData registration (both the module-import loader in
        AITriad.psm1 and the Assert-TaxonomyCacheFresh reload loop) against
        sidecar/log files that also live in taxonomy/Origin and happen to expose a
        top-level 'nodes[]' of a DIFFERENT shape.

        The motivating case is entity_extraction_log.json (t/1806): its nodes are
        keyed by 'node_id', not 'id'. A presence-of-'nodes' check alone passes it
        through, it gets registered as a fake POV, and Get-Tax then crashes when
        ConvertTo-TaxonomyNode reads $Node.id under Set-StrictMode (t/1834).

        A blanket '*.json' glob plus an ever-growing skip-list is fragile — new
        sidecars keep landing in the dir. Shape-gating on the taxonomy-node
        contract (nodes[].id) is self-maintaining: any file whose 'nodes' entries
        don't look like taxonomy nodes is skipped without touching a blocklist.

        Empty 'nodes' arrays are treated as valid POV data to preserve the prior
        registration behavior (an empty POV file is unusual but harmless — there
        is nothing to iterate, so no crash).
    .PARAMETER Json
        The deserialized JSON object (from ConvertFrom-Json), or $null.
    .OUTPUTS
        [bool]
    #>
    [OutputType([bool])]
    param(
        [AllowNull()]
        $Json
    )

    if (-not ($Json -and $Json.PSObject.Properties['nodes'])) { return $false }

    $Nodes = @($Json.nodes)
    # An empty POV file is unusual but valid — nothing to misread. Preserve the
    # pre-t/1834 behavior of registering it.
    if ($Nodes.Count -eq 0) { return $true }

    # Real POV/taxonomy nodes carry an 'id'; sidecar logs (entity_extraction_log)
    # use 'node_id' / other shapes and are rejected here.
    return [bool]$Nodes[0].PSObject.Properties['id']
}
