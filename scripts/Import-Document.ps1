<#
.SYNOPSIS
    AI Triad document ingestion script.

.DESCRIPTION
    Ingests a document into the AI Triad repository.

    What this script does:
        1. Generates a stable doc-id slug from the title/URL.
        2. Creates sources/<doc-id>/raw/ and saves the original file.
        3. Converts to Markdown snapshot (sources/<doc-id>/snapshot.md).
        4. Creates sources/<doc-id>/metadata.json with summary_status: pending.
        5. Optionally triggers Wayback Machine save (fire-and-forget).
        6. Prints the doc-id for use in follow-up commands.

.PARAMETER Url
    URL of web article to ingest.

.PARAMETER File
    Path to a local PDF/DOCX/HTML file to ingest.

.PARAMETER Inbox
    Process all files in sources/_inbox/.

.PARAMETER Pov
    One or more POV tags: accelerationist, safetyist, skeptic, cross-cutting.

.PARAMETER Topic
    One or more topic tags.

.EXAMPLE
    .\scripts\Import-Document.ps1 -Url 'https://example.com/article' -Pov accelerationist, skeptic

.EXAMPLE
    .\scripts\Import-Document.ps1 -Url 'https://example.com/article' -Pov safetyist -Topic alignment, governance

.EXAMPLE
    .\scripts\Import-Document.ps1 -Inbox

.EXAMPLE
    .\scripts\Import-Document.ps1 -File 'path/to/file.pdf' -Pov skeptic

.NOTES
    TODO: Implement fetch, convert, and write logic using:
        - Invoke-WebRequest / Invoke-RestMethod  for URL fetching
        - HTML-to-Markdown conversion module
        - PDF text extraction module
        - Wayback Machine submission
#>

#Requires -Version 7.0

[CmdletBinding(DefaultParameterSetName = 'ByUrl')]
param(
    [Parameter(ParameterSetName = 'ByUrl', Mandatory)]
    [string]$Url,

    [Parameter(ParameterSetName = 'ByFile', Mandatory)]
    [ValidateScript({ Test-Path $_ })]
    [string]$File,

    [Parameter(ParameterSetName = 'ByInbox', Mandatory)]
    [switch]$Inbox,

    [Parameter(ParameterSetName = 'ByUrl')]
    [Parameter(ParameterSetName = 'ByFile')]
    [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')]
    [string[]]$Pov = @(),

    [Parameter(ParameterSetName = 'ByUrl')]
    [Parameter(ParameterSetName = 'ByFile')]
    [string[]]$Topic = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SourcesDir = Join-Path $RepoRoot 'sources'
$InboxDir   = Join-Path $SourcesDir '_inbox'

function New-Slug {
    <#
    .SYNOPSIS
        Generate a URL-safe slug from text.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Text,

        [int]$MaxLength = 60
    )

    $Slug = $Text.ToLower()
    $Slug = [regex]::Replace($Slug, '[^\w\s\-]', '')
    $Slug = [regex]::Replace($Slug, '[\s_]+', '-')
    $Slug = $Slug.Trim('-')

    if ($Slug.Length -gt $MaxLength) {
        $Slug = $Slug.Substring(0, $MaxLength)
    }

    return $Slug
}

function New-Metadata {
    <#
    .SYNOPSIS
        Create a metadata object for a newly ingested document.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$DocId,
        [Parameter(Mandatory)][string]$Title,
        [string]$DocumentUrl,
        [string[]]$Author = @(),
        [string]$SourceType,
        [string[]]$PovTag = @(),
        [string[]]$TopicTag = @()
    )

    return [PSCustomObject]@{
        id                 = $DocId
        title              = $Title
        url                = $DocumentUrl
        authors            = $Author
        date_published     = $null
        date_ingested      = (Get-Date -Format 'yyyy-MM-dd')
        source_type        = $SourceType
        pov_tags           = $PovTag
        topic_tags         = $TopicTag
        rolodex_author_ids = @()
        archive_status     = 'pending'
        summary_version    = $null
        summary_status     = 'pending'
    }
}

Write-Output 'TODO: Import-Document.ps1 not yet implemented. Stub created by Initialize-AITriadRepo.ps1'
exit 0
