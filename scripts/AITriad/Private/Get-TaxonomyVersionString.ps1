# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyVersionString {
    <#
    .SYNOPSIS
        Reads TAXONOMY_VERSION from the version file, or 'unknown' if absent (t/3910
        extraction from Get-TaxonomyHealthData).
    .OUTPUTS
        [string]
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    Set-StrictMode -Version Latest

    $VersionFile = Get-VersionFile
    if (Test-Path $VersionFile) {
        return (Get-Content $VersionFile -Raw).Trim()
    }
    return 'unknown'
}
