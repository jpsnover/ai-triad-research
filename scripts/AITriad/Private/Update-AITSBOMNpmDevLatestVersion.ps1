# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMNpmDevLatestVersion {
    <#
    .SYNOPSIS
        'npm-dev' arm of Get-AITSBOM's -CheckUpdates dispatch: bare, not
        retried (deliberately asymmetric with the 'npm' arm -- see
        Update-AITSBOMNpmLatestVersion). Extracted verbatim (t/3910) -- no
        behavior change.
    .PARAMETER Entry
        One SBOM entry (mutated in place: LatestVersion, Status).
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Entry
    )

    Set-StrictMode -Version Latest

    try {
        $Latest = (npm view $Entry.Name version 2>$null)
        if ($Latest) {
            $Entry.LatestVersion = $Latest.Trim()
            $Entry.Status = if ($Entry.Version -eq $Entry.LatestVersion) { 'up-to-date' } else { 'outdated' }
        }
        else { $Entry.Status = 'unknown' }
    }
    catch { $Entry.Status = 'unknown' }
}
