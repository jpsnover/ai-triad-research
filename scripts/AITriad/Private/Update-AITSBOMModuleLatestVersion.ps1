# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMModuleLatestVersion {
    <#
    .SYNOPSIS
        'ps-module' arm of Get-AITSBOM's -CheckUpdates dispatch
        (Find-Module). Extracted verbatim (t/3910) -- no behavior change.
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
        $Found = Find-Module -Name $Entry.Name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Found) {
            $Entry.LatestVersion = $Found.Version.ToString()
            $Entry.Status = if ($Entry.Version -eq $Entry.LatestVersion) { 'up-to-date' } else { 'outdated' }
        }
        else { $Entry.Status = 'unknown' }
    }
    catch { $Entry.Status = 'unknown' }
}
