# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSource {
    <#
    .SYNOPSIS
        Lists and filters source documents in the repository.
    .DESCRIPTION
        Enumerates all source folders under sources/ by reading each
        metadata.json file. Supports filtering by document ID (wildcard),
        POV tag, topic tag, summary status, and source type.

        Default output (no parameters) lists all sources sorted by
        DatePublished descending.
    .PARAMETER DocId
        Wildcard pattern matched against the source document ID.
    .PARAMETER Title
        One or more wildcard patterns matched against the source title.
        A source matches if its title matches any of the supplied patterns.
    .PARAMETER Pov
        Filter to sources whose pov_tags contain this value.
    .PARAMETER Topic
        Filter to sources whose topic_tags contain this value.
    .PARAMETER Status
        Filter to sources with this exact summary_status.
    .PARAMETER SourceType
        Filter to sources with this exact source_type.
    .EXAMPLE
        Get-AITSource
        # Lists all sources sorted by date.
    .EXAMPLE
        Get-AITSource '*china*'
        # Sources whose ID matches *china*.
    .EXAMPLE
        Get-AITSource -Pov safetyist
        # Sources tagged with the safetyist POV.
    .EXAMPLE
        Get-AITSource -Title '*alignment*'
        # Sources whose title matches *alignment*.
    .EXAMPLE
        Get-AITSource -Title '*safety*', '*risk*'
        # Sources whose title matches either pattern.
    .EXAMPLE
        Get-AITSource -Status pending
        # Sources whose summary is pending.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$DocId,

        [string[]]$Title,

        [string]$Pov,

        [string]$Topic,

        [string]$Status,

        [string]$SourceType
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SourcesDir = Get-SourcesDir

    if (-not (Test-Path $SourcesDir)) {
        Write-Warning "Sources directory not found: $SourcesDir"
        return
    }

    $Folders = Get-ChildItem -Path $SourcesDir -Directory
    if ($Folders.Count -eq 0) {
        Write-Warning "No source folders found in $SourcesDir"
        return
    }

    $Results = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Folder in $Folders) {
        $MetaPath = Join-Path $Folder.FullName 'metadata.json'
        if (-not (Test-Path $MetaPath)) { continue }

        try {
            $Meta = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warning "Failed to parse ${MetaPath}: $_"
            continue
        }

        # Safe property accessor for metadata that may lack optional fields
        $Props = $Meta.PSObject.Properties

        # --- Filters ---
        if ($DocId -and $Meta.id -notlike $DocId) { continue }
        if ($Title) {
            $SrcTitle = if ($Props['title']) { $Meta.title } else { $null }
            if (-not $SrcTitle) { continue }
            $TitleMatch = $false
            foreach ($Pattern in $Title) {
                if ($SrcTitle -like $Pattern) { $TitleMatch = $true; break }
            }
            if (-not $TitleMatch) { continue }
        }
        if ($Pov) {
            $PovArr = if ($Props['pov_tags']) { $Meta.pov_tags } else { @() }
            if ($PovArr -notcontains $Pov) { continue }
        }
        if ($Topic) {
            $TopicArr = if ($Props['topic_tags']) { $Meta.topic_tags } else { @() }
            if ($TopicArr -notcontains $Topic) { continue }
        }
        if ($Status) {
            $SumStatus = if ($Props['summary_status']) { $Meta.summary_status } else { $null }
            if ($SumStatus -ne $Status) { continue }
        }
        if ($SourceType) {
            $SrcType = if ($Props['source_type']) { $Meta.source_type } else { $null }
            if ($SrcType -ne $SourceType) { continue }
        }

        $Results.Add([PSCustomObject]@{
            PSTypeName    = 'AITriad.Source'
            DocId         = $Meta.id
            Title         = if ($Props['title'])          { $Meta.title }          else { $null }
            Authors       = if ($Props['authors'])        { $Meta.authors }        else { @() }
            DatePublished = if ($Props['date_published']) { $Meta.date_published } else { $null }
            SourceType    = if ($Props['source_type'])    { $Meta.source_type }    else { $null }
            SummaryStatus = if ($Props['summary_status']) { $Meta.summary_status } else { $null }
            PovTags       = if ($Props['pov_tags'])       { $Meta.pov_tags }       else { @() }
            TopicTags     = if ($Props['topic_tags'])     { $Meta.topic_tags }     else { @() }
            OneLiner      = if ($Props['one_liner'])      { $Meta.one_liner }      else { $null }
            DateImported  = if ($Props['import_time'])    { $Meta.import_time }    else { if ($Props['date_ingested']) { $Meta.date_ingested } else { $null } }
            Directory     = $Folder.FullName
        })
    }

    if ($Results.Count -eq 0) {
        Write-Warning 'No sources matched the specified filters.'
        return
    }

    $Results | Sort-Object { if ($_.DatePublished) { [datetime]$_.DatePublished } else { [datetime]::MinValue } } -Descending
}
