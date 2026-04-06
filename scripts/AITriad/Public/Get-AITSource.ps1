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
    [OutputType('AITSource')]
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

    $SummariesDir = Get-SummariesDir
    $Results = [System.Collections.Generic.List[AITSource]]::new()

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
        if ($Title) {
            if ($Props['title']) { $SrcTitle = $Meta.title } else { $SrcTitle = $null }
            if (-not $SrcTitle) { continue }
            $TitleMatch = $false
            foreach ($Pattern in $Title) {
                if ($SrcTitle -like $Pattern) { $TitleMatch = $true; break }
            }
            if (-not $TitleMatch) { continue }
        }
        if ($Pov) {
            if ($Props['pov_tags']) { $PovArr = $Meta.pov_tags } else { $PovArr = @() }
            if ($PovArr -notcontains $Pov) { continue }
        }
        if ($Topic) {
            if ($Props['topic_tags']) { $TopicArr = $Meta.topic_tags } else { $TopicArr = @() }
            if ($TopicArr -notcontains $Topic) { continue }
        }
        if ($Status) {
            if ($Props['summary_status']) { $SumStatus = $Meta.summary_status } else { $SumStatus = $null }
            if ($SumStatus -ne $Status) { continue }
        }
        if ($SourceType) {
            if ($Props['source_type']) { $SrcType = $Meta.source_type } else { $SrcType = $null }
            if ($SrcType -ne $SourceType) { continue }
        }

        # Build snapshot.md path
        $SnapshotPath = Join-Path $Folder.FullName 'snapshot.md'
        if (Test-Path $SnapshotPath) { $MDPath = $SnapshotPath } else { $MDPath = $null }

        # Load summary file (needed for ModelInfo and fallback stats)
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

        # Load summary statistics — prefer cached values in metadata, fall back to summary file
        $TotalClaims      = 0
        $ClaimsPov        = [ClaimsByPov]::new()
        $TotalFacts       = 0
        $UnmappedConcepts = 0

        if ($Props['total_claims']) {
            # Stats cached in metadata (written by Invoke-POVSummary)
            $TotalClaims      = [int]$Meta.total_claims
            if ($Props['total_facts']) { $TotalFacts = [int]$Meta.total_facts } else { $TotalFacts = 0 }
            if ($Props['unmapped_concepts'] -and $Meta.unmapped_concepts -is [int]) { $UnmappedConcepts = [int]$Meta.unmapped_concepts } else { $UnmappedConcepts = 0 }
            if ($Props['claims_by_pov'] -and $Meta.claims_by_pov) {
                $Cbp = $Meta.claims_by_pov
                $CbpProps = $Cbp.PSObject.Properties
                $ClaimsPov.Accelerationist = if ($CbpProps['accelerationist']) { [int]$Cbp.accelerationist } else { 0 }
                $ClaimsPov.Safetyist       = if ($CbpProps['safetyist'])       { [int]$Cbp.safetyist }       else { 0 }
                $ClaimsPov.Skeptic         = if ($CbpProps['skeptic'])         { [int]$Cbp.skeptic }         else { 0 }
                $ClaimsPov.Situations      = if ($CbpProps['situations'])      { [int]$Cbp.situations }      else { 0 }
            }
        }
        elseif ($null -ne $Summary) {
            # Fall back to computing from summary file
            if ($Summary.factual_claims) {
                $TotalClaims = @($Summary.factual_claims).Count
            }

            foreach ($Claim in @($Summary.factual_claims)) {
                if (-not $Claim.PSObject.Properties['linked_taxonomy_nodes']) { continue }
                $Nodes = @($Claim.linked_taxonomy_nodes)
                if ($Nodes.Count -eq 0) { continue }
                foreach ($NodeId in $Nodes) {
                    if     ($NodeId -like 'acc-*') { $ClaimsPov.Accelerationist++ }
                    elseif ($NodeId -like 'saf-*') { $ClaimsPov.Safetyist++ }
                    elseif ($NodeId -like 'skp-*') { $ClaimsPov.Skeptic++ }
                    elseif ($NodeId -like 'sit-*') { $ClaimsPov.Situations++ }
                }
            }

            foreach ($Pov_ in @('accelerationist', 'safetyist', 'skeptic')) {
                $PovData = $Summary.pov_summaries.$Pov_
                if ($PovData -and $PovData.key_points) {
                    $TotalFacts += @($PovData.key_points).Count
                }
            }

            if ($Summary.unmapped_concepts) {
                $UnmappedConcepts = @($Summary.unmapped_concepts).Count
            }
        }

        # Hydrate ModelInfo from summary's model_info or legacy ai_model field
        $MInfo = $null
        if ($null -ne $Summary) {
            $MInfo = [AITModelInfo]::new()
            $SP = $Summary.PSObject.Properties
            if ($SP['model_info']) {
                $Mi = $Summary.model_info
                $Mp = $Mi.PSObject.Properties
                $MInfo.Model                  = if ($Mp['model'])                    { $Mi.model }                    else { $null }
                $MInfo.Temperature            = if ($Mp['temperature'])              { $Mi.temperature }              else { 0 }
                $MInfo.MaxTokens              = if ($Mp['max_tokens'])               { $Mi.max_tokens }               else { 0 }
                $MInfo.ExtractionMode         = if ($Mp['extraction_mode'])          { $Mi.extraction_mode }          else { $null }
                $MInfo.TaxonomyFilter         = if ($Mp['taxonomy_filter'])          { $Mi.taxonomy_filter }          else { $null }
                $MInfo.TaxonomyNodes          = if ($Mp['taxonomy_nodes'])           { $Mi.taxonomy_nodes }           else { 0 }
                $MInfo.FireConfidenceThreshold = if ($Mp['fire_confidence_threshold']) { $Mi.fire_confidence_threshold } else { 0 }
                $MInfo.Chunked                = if ($Mp['chunked'])                  { $Mi.chunked }                  else { $false }
                $MInfo.ChunkCount             = if ($Mp['chunk_count'])              { $Mi.chunk_count }              else { 0 }
                $MInfo.FireStats              = if ($Mp['fire_stats'])               { $Mi.fire_stats }               else { $null }
            }
            elseif ($SP['ai_model']) {
                # Legacy format
                $MInfo.Model       = $Summary.ai_model
                $MInfo.Temperature = if ($SP['temperature']) { $Summary.temperature } else { 0 }
            }
        }

        $Src                   = [AITSource]::new()
        $Src.Id                = $Meta.id
        $Src.Title             = if ($Props['title'])            { $Meta.title }            else { $null }
        $Src.Url               = if ($Props['url'])              { $Meta.url }              else { $null }
        $Src.Authors           = if ($Props['authors'])          { $Meta.authors }          else { @() }
        $Src.DatePublished     = if ($Props['date_published'])   { $Meta.date_published }   else { $null }
        $Src.DateIngested      = if ($Props['date_ingested'])    { $Meta.date_ingested }    else { $null }
        $Src.ImportTime        = if ($Props['import_time'])      { $Meta.import_time }      else { $null }
        $Src.SourceTime        = if ($Props['source_time'])      { $Meta.source_time }      else { $null }
        $Src.SourceType        = if ($Props['source_type'])      { $Meta.source_type }      else { $null }
        $Src.PovTags           = if ($Props['pov_tags'])         { $Meta.pov_tags }         else { @() }
        $Src.TopicTags         = if ($Props['topic_tags'])       { $Meta.topic_tags }       else { @() }
        $Src.RolodexAuthorIds  = if ($Props['rolodex_author_ids']) { $Meta.rolodex_author_ids } else { @() }
        $Src.ArchiveStatus     = if ($Props['archive_status'])   { $Meta.archive_status }   else { $null }
        $Src.SummaryVersion    = if ($Props['summary_version'])  { $Meta.summary_version }  else { $null }
        $Src.SummaryStatus     = if ($Props['summary_status'])   { $Meta.summary_status }   else { $null }
        $Src.SummaryUpdated    = if ($Props['summary_updated'])  { $Meta.summary_updated }  else { $null }
        $Src.OneLiner          = if ($Props['one_liner'])        { $Meta.one_liner }        else { $null }
        $Src.MDPath            = $MDPath
        $Src.Directory         = $Folder.FullName
        $Src.TotalClaims       = $TotalClaims
        $Src.ClaimsByPov       = $ClaimsPov
        $Src.TotalFacts        = $TotalFacts
        $Src.UnmappedConcepts  = $UnmappedConcepts
        $Src.ModelInfo         = $MInfo

        $Results.Add($Src)
    }

    if ($Results.Count -eq 0) {
        Write-Warning 'No sources matched the specified filters.'
        return
    }

    $Results | Sort-Object { if ($_.DatePublished) { [datetime]$_.DatePublished } else { [datetime]::MinValue } } -Descending
}
