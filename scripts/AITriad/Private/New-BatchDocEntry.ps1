# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-BatchDocEntry {
    <#
    .SYNOPSIS
        Builds Invoke-BatchSummary's per-document work item from a metadata.json
        (t/3910), or returns $null for a doc that is filtered out or unusable.
    .DESCRIPTION
        $null when a -DocId filter is active and excludes the doc, or (with a WARN) when
        snapshot.md is missing or empty. Otherwise a hashtable:
        @{ DocId; MetaFile; SnapshotFile; Meta; PovTags }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][System.IO.FileInfo]$MetaFile,
        [string[]]$DocIdFilter = @()
    )

    $Meta      = Get-Content $MetaFile.FullName -Raw | ConvertFrom-Json
    $ThisDocId = $Meta.id

    if ($DocIdFilter.Count -gt 0 -and $ThisDocId -notin $DocIdFilter) { return $null }

    $SnapshotFile = Join-Path $MetaFile.DirectoryName 'snapshot.md'
    if (-not (Test-Path $SnapshotFile)) {
        Write-Warn "  SKIP $ThisDocId — snapshot.md missing"
        return $null
    }
    if ((Get-Item $SnapshotFile).Length -eq 0) {
        Write-Warn "  SKIP $ThisDocId — snapshot.md is empty (broken ingestion?)"
        return $null
    }

    if ($null -ne $Meta.PSObject.Properties['pov_tags'] -and $null -ne $Meta.pov_tags) { $DocPovTags = @($Meta.pov_tags) } else { $DocPovTags = @() }

    return @{
        DocId        = $ThisDocId
        MetaFile     = $MetaFile.FullName
        SnapshotFile = $SnapshotFile
        Meta         = $Meta
        PovTags      = $DocPovTags
    }
}
