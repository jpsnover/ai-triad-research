function Get-Source {
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
    .PARAMETER Pov
        Filter to sources whose pov_tags contain this value.
    .PARAMETER Topic
        Filter to sources whose topic_tags contain this value.
    .PARAMETER Status
        Filter to sources with this exact summary_status.
    .PARAMETER SourceType
        Filter to sources with this exact source_type.
    .EXAMPLE
        Get-Source
        # Lists all sources sorted by date.
    .EXAMPLE
        Get-Source '*china*'
        # Sources whose ID matches *china*.
    .EXAMPLE
        Get-Source -Pov safetyist
        # Sources tagged with the safetyist POV.
    .EXAMPLE
        Get-Source -Status pending
        # Sources whose summary is pending.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$DocId,

        [string]$Pov,

        [string]$Topic,

        [string]$Status,

        [string]$SourceType
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SourcesDir = Join-Path $script:RepoRoot 'sources'

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
            $Meta = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json
        }
        catch {
            Write-Warning "Failed to parse ${MetaPath}: $_"
            continue
        }

        # Safe property accessor for metadata that may lack optional fields
        $Props = $Meta.PSObject.Properties

        # --- Filters ---
        if ($DocId -and $Meta.id -notlike $DocId) { continue }
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
        })
    }

    if ($Results.Count -eq 0) {
        Write-Warning 'No sources matched the specified filters.'
        return
    }

    $Results | Sort-Object { if ($_.DatePublished) { [datetime]$_.DatePublished } else { [datetime]::MinValue } } -Descending
}
