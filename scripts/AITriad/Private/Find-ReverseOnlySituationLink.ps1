# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-ReverseOnlySituationLink {
    <#
    .SYNOPSIS
        Check 10 sub-helper (t/3879 decomposition): finds node -> situation refs
        (situation_refs) missing their linked_nodes back-reference.
    .PARAMETER NodeSitRefs
        Hashtable: POV node id -> HashSet[string] of its situation refs.
    .PARAMETER SitLinked
        Hashtable: situation id -> HashSet[string] of its linked node ids.
    .PARAMETER SitIds
        HashSet[string] of every real situation id (from Check 8, Get-DanglingSitRefIssue).
    .OUTPUTS
        [System.Collections.Generic.List[string]] of "<nodeId> -> <sitId>" entries.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[string]])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$NodeSitRefs,

        [Parameter(Mandatory)]
        [hashtable]$SitLinked,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.HashSet[string]]$SitIds
    )

    Set-StrictMode -Version Latest

    # reverse-only: S in N.situation_refs (S a real situation) but N NOT in S.linked_nodes
    $ReverseOnly = [System.Collections.Generic.List[string]]::new()
    foreach ($N in $NodeSitRefs.Keys) {
        foreach ($SitId in $NodeSitRefs[$N]) {
            if (-not $SitIds.Contains($SitId)) { continue }   # dangling situation_ref -> Check 8
            $Linked = if ($SitLinked.ContainsKey($SitId)) { $SitLinked[$SitId] } else { $null }
            if ($null -eq $Linked -or -not $Linked.Contains($N)) { $ReverseOnly.Add("$N -> $SitId") }
        }
    }
    return , $ReverseOnly
}
