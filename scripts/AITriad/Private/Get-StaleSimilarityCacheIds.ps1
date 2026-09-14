# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-StaleSimilarityCacheIds {
    <#
    .SYNOPSIS
        Returns similarity-cache ids (sources + targets) that resolve to no live
        taxonomy node — i.e. stale/retired keys such as cc-* left over from the
        t/1308 cc→sit migration.
    .DESCRIPTION
        The similarity cache is keyed by node id and was NOT rewritten by the
        cc→sit migration, so it can retain retired cc-NNN keys. Invoke-EdgeDiscovery
        silently drops any pair whose source/target id is not in the live corpus
        (a fallback path). This helper enumerates those unresolved ids so the caller
        can emit a diagnosable WARN (docs/error-handling.md Fallback-Path Logging,
        t/3473) instead of degrading silently.

        Pure and side-effect-free — accepts the parsed cache 'entries' map (as
        ConvertFrom-Json -AsHashtable produces: nodeId -> array of {id;sim}) and the
        set of valid live node ids. Handles both IDictionary and PSCustomObject entry
        shapes under StrictMode.
    .PARAMETER Entries
        The cache's 'entries' map: source-node-id -> array of neighbor entries,
        each exposing an 'id' (target node id). $null yields an empty result.
    .PARAMETER ValidNodeIds
        HashSet of live node ids to resolve against.
    .OUTPUTS
        [string[]] — distinct unresolved ids (sources and targets), in first-seen order.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        $Entries,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$ValidNodeIds
    )

    Set-StrictMode -Version Latest

    $Stale = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    if ($null -eq $Entries) { return @() }

    foreach ($Key in $Entries.Keys) {
        if (-not $ValidNodeIds.Contains($Key)) { [void]$Stale.Add($Key) }

        foreach ($Entry in @($Entries[$Key])) {
            if ($null -eq $Entry) { continue }
            $TargetId = $null
            if ($Entry -is [System.Collections.IDictionary]) {
                if ($Entry.Contains('id')) { $TargetId = $Entry['id'] }
            }
            elseif ($Entry.PSObject.Properties['id']) {
                $TargetId = $Entry.id
            }
            if ($TargetId -and -not $ValidNodeIds.Contains($TargetId)) { [void]$Stale.Add($TargetId) }
        }
    }

    return @($Stale)
}
