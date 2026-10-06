# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchCampKeyPoint {
    <#
    .SYNOPSIS
        One camp's key_points from a parsed summary, or nothing when the summary, the
        camp or its key_points are absent or empty (t/3910).
    .DESCRIPTION
        Shared by Invoke-BatchSummary's FIRE-path stats and its near-duplicate metric,
        which each had an inline copy of this StrictMode-safe lookup. Callers wrap in @().
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [AllowNull()][object]$Summary,
        [Parameter(Mandatory)][string]$Camp
    )

    $CampData = if ($Summary -and $Summary.PSObject.Properties['pov_summaries'] -and $Summary.pov_summaries.PSObject.Properties[$Camp]) { $Summary.pov_summaries.$Camp } else { $null }
    if ($CampData -and $CampData.PSObject.Properties['key_points'] -and $CampData.key_points) {
        return @($CampData.key_points)
    }
}
