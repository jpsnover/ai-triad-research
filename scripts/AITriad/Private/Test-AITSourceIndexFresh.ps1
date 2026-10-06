# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AITSourceIndexFresh {
    <#
    .SYNOPSIS
        True if _index.json's mtime is at or after every metadata.json's mtime under
        SourcesDir (t/3910 decomposition of Get-AITSource, no behavior change).
    .OUTPUTS
        [bool]
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)][string]$SourcesDir,
        [Parameter(Mandatory)][string]$IndexPath
    )
    Set-StrictMode -Version Latest

    if (-not (Test-Path $IndexPath)) { return $false }

    $IndexMTime = (Get-Item $IndexPath).LastWriteTimeUtc
    $NewestMeta = Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse -Depth 1 -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1

    if ($null -eq $NewestMeta -or $IndexMTime -ge $NewestMeta.LastWriteTimeUtc) { return $true }
    Write-Verbose "Index is stale — falling back to folder scan"
    return $false
}
