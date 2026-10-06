# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSBOMSpdxPackage {
    <#
    .SYNOPSIS
        Builds ONE SPDX `package` object from an SBOM entry. Extracted
        verbatim from Get-AITSBOM's -Format SPDX branch (t/3910) -- no
        behavior change.
    .PARAMETER Entry
        One SBOM entry.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Entry
    )

    Set-StrictMode -Version Latest

    $PurlType = ConvertTo-AITSBOMPurlType -Type $Entry.Type
    $SpdxPkg = [ordered]@{
        SPDXID               = "SPDXRef-$($Entry.Name -replace '[^a-zA-Z0-9._-]', '-')"
        name                 = $Entry.Name
        versionInfo          = $Entry.Version
        downloadLocation     = if ($Entry.SourceUrl) { $Entry.SourceUrl } else { 'NOASSERTION' }
        filesAnalyzed        = $false
        supplier             = if ($Entry.Supplier) { "Organization: $($Entry.Supplier)" } else { 'NOASSERTION' }
        description          = if ($Entry.Description) { $Entry.Description } else { $null }
        primaryPackagePurpose = if ($Entry.Scope -eq 'development') { 'DOCUMENTATION' } else { 'LIBRARY' }
        externalRefs         = @(
            [ordered]@{
                referenceCategory = 'PACKAGE-MANAGER'
                referenceType     = 'purl'
                referenceLocator  = "pkg:$PurlType/$($Entry.Name)@$($Entry.Version)"
            }
        )
    }
    if ($Entry.License) {
        $SpdxPkg['licenseConcluded'] = $Entry.License
        $SpdxPkg['licenseDeclared']  = $Entry.License
    }
    else {
        $SpdxPkg['licenseConcluded'] = 'NOASSERTION'
        $SpdxPkg['licenseDeclared']  = 'NOASSERTION'
    }
    if ($Entry.Hash) {
        $HashAlg = if ($Entry.Hash -match '^sha512-') { 'SHA512' }
                   elseif ($Entry.Hash -match '^sha256-') { 'SHA256' }
                   elseif ($Entry.Hash -match '^sha1-') { 'SHA1' }
                   else { 'SHA512' }
        $HashVal = $Entry.Hash -replace '^sha\d+-', ''
        $SpdxPkg['checksums'] = @( [ordered]@{ algorithm = $HashAlg; checksumValue = $HashVal } )
    }
    return $SpdxPkg
}
