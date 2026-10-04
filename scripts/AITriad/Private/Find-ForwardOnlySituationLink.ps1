# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-ForwardOnlySituationLink {
    <#
    .SYNOPSIS
        Check 10 sub-helper (t/3879 decomposition): finds situation -> node links
        (linked_nodes) missing their situation_refs back-reference.
    .PARAMETER SitLinked
        Hashtable: situation id -> HashSet[string] of its linked node ids.
    .PARAMETER NodeSitRefs
        Hashtable: POV node id -> HashSet[string] of its situation refs.
    .PARAMETER PovNodeIds
        HashSet[string] of every non-situation POV node id.
    .OUTPUTS
        [System.Collections.Generic.List[string]] of "<sitId> -> <nodeId>" entries.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[string]])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$SitLinked,

        [Parameter(Mandatory)]
        [hashtable]$NodeSitRefs,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.HashSet[string]]$PovNodeIds
    )

    Set-StrictMode -Version Latest

    # forward-only: N in S.linked_nodes (N a real POV node) but S NOT in N.situation_refs
    $ForwardOnly = [System.Collections.Generic.List[string]]::new()
    foreach ($SitId in $SitLinked.Keys) {
        foreach ($N in $SitLinked[$SitId]) {
            if (-not $PovNodeIds.Contains($N)) { continue }   # only POV nodes carry situation_refs
            $Refs = if ($NodeSitRefs.ContainsKey($N)) { $NodeSitRefs[$N] } else { $null }
            if ($null -eq $Refs -or -not $Refs.Contains($SitId)) { $ForwardOnly.Add("$SitId -> $N") }
        }
    }
    return , $ForwardOnly
}
