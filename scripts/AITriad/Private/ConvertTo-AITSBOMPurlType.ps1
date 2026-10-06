# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSBOMPurlType {
    <#
    .SYNOPSIS
        Maps an SBOM entry Type to its Package URL (purl) type, shared by the
        CycloneDX and SPDX converters (identical switch, previously
        duplicated). Extracted verbatim from Get-AITSBOM (t/3910) -- no
        behavior change.
    .PARAMETER Type
        The SBOM entry's Type field.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Type
    )

    Set-StrictMode -Version Latest

    switch ($Type) {
        'npm'       { 'npm' }
        'npm-dev'   { 'npm' }
        'python'    { 'pypi' }
        'ps-module' { 'nuget' }
        default     { 'generic' }
    }
}
