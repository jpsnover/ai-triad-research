# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-SituationLinkMaps {
    <#
    .SYNOPSIS
        Check 10 sub-helper (t/3879 decomposition): builds the two id-set maps
        Get-SituationReciprocityIssue compares (situation -> linked node ids,
        and POV node -> situation_refs ids).
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .OUTPUTS
        [PSCustomObject] { SitLinked (hashtable: situation id -> HashSet[string]);
        NodeSitRefs (hashtable: POV node id -> HashSet[string]) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles
    )

    Set-StrictMode -Version Latest

    $SitLinked = @{}    # situation id -> HashSet of its linked node ids
    if ($LoadedFiles.ContainsKey('situations')) {
        foreach ($Node in $LoadedFiles['situations'].Data.nodes) {
            $Set = [System.Collections.Generic.HashSet[string]]::new()
            if ($Node.PSObject.Properties['linked_nodes'] -and $null -ne $Node.linked_nodes) {
                foreach ($L in @($Node.linked_nodes)) { [void]$Set.Add($L) }
            }
            $SitLinked[$Node.id] = $Set
        }
    }
    $NodeSitRefs = @{}  # POV node id -> HashSet of its situation refs
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            $Set = [System.Collections.Generic.HashSet[string]]::new()
            if ($Node.PSObject.Properties['situation_refs'] -and $null -ne $Node.situation_refs) {
                foreach ($R in @($Node.situation_refs)) { [void]$Set.Add($R) }
            }
            $NodeSitRefs[$Node.id] = $Set
        }
    }

    return [PSCustomObject]@{ SitLinked = $SitLinked; NodeSitRefs = $NodeSitRefs }
}
