# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Compare-NodeSourceIndexKeySet {
    <#
    .SYNOPSIS
        Test-CitationLinkIntegrity leg (c) sub-helper (t/3896, CL predicate
        correction): compare the source_index's key SET to the live-node SET,
        not just the count.
    .DESCRIPTION
        A count-only comparison passes a swap (one POV node removed, a
        different one added) because the counts stay equal while the index
        carries a dead key and is missing the new node's key -- exactly where
        leg (c) is meant to catch a regen that didn't happen or went wrong.
        Factored out of Test-CitationLinkIntegrity so the branching here
        doesn't push that function over its complexity-ratchet baseline
        (t/3829).
    .PARAMETER IndexObject
        The source_index's `.index` property (a PSCustomObject whose property
        names are the index's keys).
    .PARAMETER LiveNodeIds
        HashSet[string] of every live POV node id.
    .OUTPUTS
        [System.Collections.Generic.List[pscustomobject]] 0-2 entries:
        { kind='dead-key'; keys; keyCount; liveNodes } for index keys with no
        live node, and/or { kind='missing-key'; nodes; keyCount; liveNodes }
        for live nodes with no index key.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[pscustomobject]])]
    param(
        [Parameter(Mandatory)]
        $IndexObject,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$LiveNodeIds
    )

    Set-StrictMode -Version Latest

    $indexKeys = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($p in $IndexObject.PSObject.Properties) { [void]$indexKeys.Add($p.Name) }
    $keyCount = $indexKeys.Count
    $liveCount = $LiveNodeIds.Count

    $deadKeys = [System.Collections.Generic.List[string]]::new()
    foreach ($k in $indexKeys) { if (-not $LiveNodeIds.Contains($k)) { $deadKeys.Add($k) } }
    $missingKeys = [System.Collections.Generic.List[string]]::new()
    foreach ($n in $LiveNodeIds) { if (-not $indexKeys.Contains($n)) { $missingKeys.Add($n) } }

    $offenders = [System.Collections.Generic.List[pscustomobject]]::new()
    if ($deadKeys.Count -gt 0) {
        $offenders.Add([pscustomobject]@{ kind = 'dead-key'; keys = @($deadKeys); keyCount = $keyCount; liveNodes = $liveCount })
    }
    if ($missingKeys.Count -gt 0) {
        $offenders.Add([pscustomobject]@{ kind = 'missing-key'; nodes = @($missingKeys); keyCount = $keyCount; liveNodes = $liveCount })
    }
    # Comma operator guards against pipeline enumeration unrolling a 0- or 1-item List into
    # $null or a bare scalar for the caller (confirmed gotcha, same class as t/3879's fix).
    return , $offenders
}
