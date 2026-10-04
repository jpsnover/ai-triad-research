# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-SituationReciprocityIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 10 (t/2979, t/3879 decomposition -- extracted
        verbatim, no behavior change): situation.linked_nodes and POV node.situation_refs
        must be mutual.
    .DESCRIPTION
        linked_nodes (situation -> POV node) and situation_refs (POV node -> situation) must
        be MUTUAL: N in S.linked_nodes <=> S in N.situation_refs. Reports BOTH asymmetry
        classes (forward-only, reverse-only). Only links whose BOTH endpoints exist are
        evaluated -- a ref to a non-existent node/situation is Checks 8/9's dangling-ref
        issue, not an asymmetry here (hence this check needs $SitIds from Check 8 and
        $PovNodeIds from the load phase, to exclude those cases).

        Complexity budget (t/3829): the map-build and the two asymmetry scans are each
        split into their own sub-helper (Get-SituationLinkMaps,
        Find-ForwardOnlySituationLink, Find-ReverseOnlySituationLink) so this orchestrator
        and each piece stay under threshold. Output is unchanged.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .PARAMETER PovNodeIds
        HashSet[string] of every non-situation POV node id.
    .PARAMETER SitIds
        HashSet[string] of every real situation id (from Check 8, Get-DanglingSitRefIssue).
    .OUTPUTS
        [PSCustomObject] { Passed (bool); Issue (PSCustomObject or $null) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.HashSet[string]]$PovNodeIds,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.HashSet[string]]$SitIds
    )

    Set-StrictMode -Version Latest

    $Maps = Get-SituationLinkMaps -LoadedFiles $LoadedFiles
    $ForwardOnly = Find-ForwardOnlySituationLink -SitLinked $Maps.SitLinked -NodeSitRefs $Maps.NodeSitRefs -PovNodeIds $PovNodeIds
    $ReverseOnly = Find-ReverseOnlySituationLink -NodeSitRefs $Maps.NodeSitRefs -SitLinked $Maps.SitLinked -SitIds $SitIds

    $AsymCount = $ForwardOnly.Count + $ReverseOnly.Count
    if ($AsymCount -gt 0) {
        $FwdPart = if ($ForwardOnly.Count -gt 0) { " forward-only (in linked_nodes, missing situation_refs back-ref) [$($ForwardOnly.Count)]: $((@($ForwardOnly) | Select-Object -First 5) -join '; ')$(if ($ForwardOnly.Count -gt 5) { ' ...' })" } else { '' }
        $RevPart = if ($ReverseOnly.Count -gt 0) { " reverse-only (in situation_refs, missing linked_nodes back-ref) [$($ReverseOnly.Count)]: $((@($ReverseOnly) | Select-Object -First 5) -join '; ')$(if ($ReverseOnly.Count -gt 5) { ' ...' })" } else { '' }
        return [PSCustomObject]@{
            Passed = $false
            Issue  = [PSCustomObject]@{ Check = 'SituationReciprocity'; Severity = 'Error'; Count = $AsymCount; Detail = "situation.linked_nodes and POV situation_refs are not mutual (t/2979) —$FwdPart$RevPart. Fix: run Repair-SituationReciprocity -DryRun to preview, then Repair-SituationReciprocity to reconcile both directions. The two directions must stay mutual." }
        }
    }
    return [PSCustomObject]@{ Passed = $true; Issue = $null }
}
