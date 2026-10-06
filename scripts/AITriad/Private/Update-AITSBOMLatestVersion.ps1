# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMLatestVersion {
    <#
    .SYNOPSIS
        Fills LatestVersion/Status on ONE SBOM entry by querying its
        package registry (npm view / pip index versions / Find-Module),
        dispatched by Type via a lookup table. Extracted verbatim from
        Get-AITSBOM's -CheckUpdates loop (t/3910) -- no behavior change,
        including the asymmetry between the 'npm' arm (Invoke-WithRecovery,
        retried) and the 'npm-dev' arm (bare, unretried).
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

    switch ($Entry.Type) {
        'npm' { Update-AITSBOMNpmLatestVersion -Entry $Entry }
        'npm-dev' { Update-AITSBOMNpmDevLatestVersion -Entry $Entry }
        'python' { Update-AITSBOMPythonLatestVersion -Entry $Entry }
        'ps-module' { Update-AITSBOMModuleLatestVersion -Entry $Entry }
        default { $Entry.Status = 'n/a' }
    }
}
