# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Creates a canonical metadata.json object for a new source document.
.DESCRIPTION
    Factory function that produces the standard ordered hashtable used as
    sources/<doc-id>/metadata.json.  Sets default values for ingestion timestamps,
    archive status ('pending'), and summary status ('pending').  Called by
    Import-AITriadDocument during document ingestion.
.PARAMETER DocId
    The slug-format document identifier (e.g., 'ai-safety-report-2026').
.PARAMETER Title
    Human-readable document title.
.PARAMETER DocumentUrl
    Original URL where the document was obtained.  Defaults to empty string.
.PARAMETER Author
    Array of author names.  Defaults to empty array.
.PARAMETER SourceType
    Document format: 'pdf', 'html', 'docx', etc.  Defaults to 'unknown'.
.PARAMETER PovTag
    Array of POV classifications: 'accelerationist', 'safetyist', 'skeptic',
    and/or 'situations'.  Defaults to empty array.
.PARAMETER TopicTag
    Array of topic slugs (e.g., 'governance', 'alignment').  Defaults to empty
    array.
.EXAMPLE
    $Meta = New-Metadata -DocId 'ai-governance-2026' -Title 'AI Governance Framework' `
        -DocumentUrl 'https://example.com/paper.pdf' -SourceType 'pdf' `
        -PovTag @('safetyist','situations') -TopicTag @('governance','regulation')

    Creates a metadata object for a newly ingested PDF with POV and topic tags.
.EXAMPLE
    $Meta = New-Metadata -DocId 'blog-post-2026' -Title 'Why AI Will Be Fine'
    $Meta | ConvertTo-Json | Set-Content metadata.json

    Creates minimal metadata and writes it to disk.
#>
function New-Metadata {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$DocId,
        [Parameter(Mandatory)][string]$Title,
        [string]  $DocumentUrl  = '',
        [string[]]$Author       = @(),
        [string]  $SourceType   = 'unknown',
        [string[]]$PovTag       = @(),
        [string[]]$TopicTag     = @()
    )

    return [ordered]@{
        id                 = $DocId
        title              = $Title
        url                = $DocumentUrl
        authors            = $Author
        date_published     = $null
        date_ingested      = (Get-Date -Format 'yyyy-MM-dd')
        import_time        = (Get-Date -Format 'o')
        source_time        = $null
        source_type        = $SourceType
        pov_tags           = $PovTag
        topic_tags         = $TopicTag
        rolodex_author_ids = @()
        archive_status     = 'pending'
        summary_version    = $null
        summary_status     = 'pending'
    }
}
