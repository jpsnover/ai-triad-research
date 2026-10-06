# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSBOMCycloneDXComponent {
    <#
    .SYNOPSIS
        Builds ONE CycloneDX `component` object from an SBOM entry.
        Extracted verbatim from Get-AITSBOM's -Format CycloneDX branch
        (t/3910) -- no behavior change.
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
    $Comp = [ordered]@{
        type    = 'library'
        name    = $Entry.Name
        version = $Entry.Version
        scope   = if ($Entry.Scope -eq 'development') { 'excluded' } else { 'required' }
        purl    = "pkg:$PurlType/$($Entry.Name)@$($Entry.Version)"
    }
    if ($Entry.Description) { $Comp['description'] = $Entry.Description }
    if ($Entry.Supplier)    { $Comp['supplier'] = [ordered]@{ name = $Entry.Supplier } }
    if ($Entry.License)     { $Comp['licenses'] = @( [ordered]@{ license = [ordered]@{ id = $Entry.License } } ) }
    if ($Entry.Hash) {
        $HashAlg = if ($Entry.Hash -match '^sha512-') { 'SHA-512' }
                   elseif ($Entry.Hash -match '^sha256-') { 'SHA-256' }
                   elseif ($Entry.Hash -match '^sha1-') { 'SHA-1' }
                   else { 'SHA-512' }
        $HashVal = $Entry.Hash -replace '^sha\d+-', ''
        $Comp['hashes'] = @( [ordered]@{ alg = $HashAlg; content = $HashVal } )
    }
    $ExtRefs = [System.Collections.Generic.List[hashtable]]::new()
    if ($Entry.SourceUrl) { $ExtRefs.Add([ordered]@{ type = 'distribution'; url = $Entry.SourceUrl }) }
    if ($ExtRefs.Count -gt 0) { $Comp['externalReferences'] = @($ExtRefs) }
    $Comp['properties'] = @(
        [ordered]@{ name = 'source'; value = $Entry.Source }
        [ordered]@{ name = 'component-type'; value = $Entry.Type }
    )
    return $Comp
}
