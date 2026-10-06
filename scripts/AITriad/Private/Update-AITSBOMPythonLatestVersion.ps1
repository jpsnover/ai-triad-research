# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMPythonLatestVersion {
    <#
    .SYNOPSIS
        'python' arm of Get-AITSBOM's -CheckUpdates dispatch (pip index
        versions). Extracted verbatim (t/3910) -- no behavior change.
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
        $PkgName = $Entry.Name -replace '\[.*\]', ''
        if (Get-Command pip -EA SilentlyContinue) { $PyCmd = 'pip' } else { $PyCmd = 'pip3' }
        $Info = & $PyCmd index versions $PkgName 2>$null
        if ($Info -match 'Available versions:\s*(.+)') {
            $Latest = ($Matches[1] -split ',\s*')[0].Trim()
            $Entry.LatestVersion = $Latest
            $Entry.Status = if ($Entry.Version -ge $Latest) { 'up-to-date' } else { 'outdated' }
        }
        else { $Entry.Status = 'unknown' }
    }
    catch { $Entry.Status = 'unknown' }
}
