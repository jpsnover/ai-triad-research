# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-DoctrinalBoundaryIds {
    <#
    .SYNOPSIS
        Build pov -> case-insensitive HashSet of doctrinal-boundary Desire node ids from
        -DoctrinalBoundaryMap. Extracted from Invoke-BDIWeightAssignment (t/3910).
    .DESCRIPTION
        With no map, returns an empty hashtable: doctrinal boundaries then default to none and
        Desire priority comes from tree position only.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([hashtable]$Map)

    $Ids = @{}
    if (-not $Map) { return $Ids }
    foreach ($Pov in $Map.Keys) {
        $Ids[$Pov] = [System.Collections.Generic.HashSet[string]]::new(
            [string[]]@($Map[$Pov]), [System.StringComparer]::OrdinalIgnoreCase)
    }
    return $Ids
}
