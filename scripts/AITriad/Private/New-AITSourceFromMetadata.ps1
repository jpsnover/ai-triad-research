# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-AITSourceFromMetadata {
    <#
    .SYNOPSIS
        Builds one [AITSource] from a folder's metadata.json during the full-scan path
        (t/3910 decomposition of Get-AITSource, no behavior change).
    .PARAMETER Meta
        The parsed metadata.json object.
    .PARAMETER FolderPath
        The source folder's full path (becomes .Directory; snapshot.md is checked here).
    .PARAMETER SummariesDir
        Directory holding <id>.json summary files.
    .OUTPUTS
        [PSCustomObject] 'AITSource'
    #>
    [CmdletBinding()]
    [OutputType('AITSource')]
    param(
        [Parameter(Mandatory)][PSObject]$Meta,
        [Parameter(Mandatory)][string]$FolderPath,
        [Parameter(Mandatory)][string]$SummariesDir
    )
    Set-StrictMode -Version Latest

    $SnapshotPath = Join-Path $FolderPath 'snapshot.md'
    $MDPath = if (Test-Path $SnapshotPath) { $SnapshotPath } else { $null }

    $Summary     = $null
    $SummaryPath = Join-Path $SummariesDir "$($Meta.id).json"
    if (Test-Path $SummaryPath) {
        try {
            $Summary = Get-Content -Raw -Path $SummaryPath | ConvertFrom-Json
        }
        catch {
            Write-Verbose "Could not parse summary for $($Meta.id): $($_.Exception.Message)"
        }
    }

    $Stats = Resolve-AITSourceStats -Meta $Meta -Summary $Summary
    $MInfo = ConvertTo-AITSourceModelInfo -Summary $Summary
    $Get = { param($Name, $Default = $null) Get-AITSourcePropValue -Object $Meta -Name $Name -Default $Default }

    [PSCustomObject]@{
        PSTypeName     = 'AITSource'
        Id             = $Meta.id
        Title          = & $Get 'title'
        Url            = & $Get 'url'
        Authors        = & $Get 'authors' @()
        DatePublished  = & $Get 'date_published'
        DateIngested   = & $Get 'date_ingested'
        ImportTime     = & $Get 'import_time'
        SourceTime     = & $Get 'source_time'
        SourceType     = & $Get 'source_type'
        PovTags        = & $Get 'pov_tags' @()
        TopicTags      = & $Get 'topic_tags' @()
        RolodexAuthorIds = & $Get 'rolodex_author_ids' @()
        ArchiveStatus  = & $Get 'archive_status'
        SummaryVersion = & $Get 'summary_version'
        SummaryStatus  = & $Get 'summary_status'
        SummaryUpdated = & $Get 'summary_updated'
        OneLiner       = & $Get 'one_liner'
        Provenance     = @(& $Get 'provenance' @())
        ProvenanceStatus = & $Get 'provenance_status'
        ResolvedUrl    = & $Get 'resolved_url'
        MDPath         = $MDPath
        Directory      = $FolderPath
        TotalClaims    = $Stats.TotalClaims
        ClaimsByPov    = $Stats.ClaimsByPov
        TotalFacts     = $Stats.TotalFacts
        UnmappedConcepts = $Stats.UnmappedConcepts
        ModelInfo      = $MInfo
    }
}
