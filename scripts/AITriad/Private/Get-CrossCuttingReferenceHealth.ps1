# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-CrossCuttingReferenceHealth {
    <#
    .SYNOPSIS
        Referenced vs. orphaned situation (cross-cutting) nodes (t/3910 extraction from
        Get-TaxonomyHealthData).
    .OUTPUTS
        [hashtable] { TotalNodes; Referenced; ReferencedCount; Orphaned; OrphanedCount }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][object[]]$AllNodes
    )

    Set-StrictMode -Version Latest

    $CcNodes      = @($AllNodes | Where-Object { $_.POV -eq 'situations' })
    $CcReferenced = @($CcNodes | Where-Object { $_.Citations -gt 0 })
    $CcOrphaned   = @($CcNodes | Where-Object { $_.Citations -eq 0 })

    return @{
        TotalNodes      = $CcNodes.Count
        Referenced      = $CcReferenced
        ReferencedCount = $CcReferenced.Count
        Orphaned        = $CcOrphaned
        OrphanedCount   = $CcOrphaned.Count
    }
}
