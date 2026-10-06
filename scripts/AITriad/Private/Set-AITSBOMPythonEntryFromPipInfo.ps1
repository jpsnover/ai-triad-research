# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Set-AITSBOMPythonEntryFromPipInfo {
    <#
    .SYNOPSIS
        Applies one `pip show` block to one python SBOM entry (License,
        Supplier, Description, Version), skipping pip's literal 'UNKNOWN'
        placeholder. Split out of Update-AITSBOMPythonMetadata (t/3910) to
        bring both functions under the complexity ratchet -- no behavior
        change.
    .PARAMETER Entry
        One python SBOM entry (mutated in place).
    .PARAMETER Info
        The matching {field -> value} block from ConvertFrom-PipShowOutput.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Entry,

        [Parameter(Mandatory)]
        [hashtable]$Info
    )

    Set-StrictMode -Version Latest

    if ($Info.ContainsKey('License') -and $Info.License -and $Info.License -ne 'UNKNOWN') {
        $Entry.License = $Info.License
    }
    if ($Info.ContainsKey('Author') -and $Info.Author -and $Info.Author -ne 'UNKNOWN') {
        $Entry.Supplier = $Info.Author
    }
    if ($Info.ContainsKey('Summary') -and $Info.Summary -and $Info.Summary -ne 'UNKNOWN') {
        $Entry.Description = $Info.Summary
    }
    if ($Info.ContainsKey('Version') -and $Info.Version) {
        $Entry.Version = $Info.Version
    }
}
