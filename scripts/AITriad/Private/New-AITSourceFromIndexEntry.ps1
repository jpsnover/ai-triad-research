# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-AITSourceFromIndexEntry {
    <#
    .SYNOPSIS
        Builds one [AITSource] from an _index.json entry (t/3910 decomposition of
        Get-AITSource's index fast-path, no behavior change).
    .PARAMETER Entry
        One element of the index's .sources array.
    .PARAMETER SourcesDir
        The sources directory, to compute the node's Directory path.
    .OUTPUTS
        [PSCustomObject] 'AITSource'
    #>
    [CmdletBinding()]
    [OutputType('AITSource')]
    param(
        [Parameter(Mandatory)][PSObject]$Entry,
        [Parameter(Mandatory)][string]$SourcesDir
    )
    Set-StrictMode -Version Latest

    $DocDir = Join-Path $SourcesDir $Entry.id
    $Get = { param($Name, $Default = $null) Get-AITSourcePropValue -Object $Entry -Name $Name -Default $Default }
    $TotalClaims      = [int](& $Get 'total_claims' 0)
    $TotalFacts       = [int](& $Get 'total_facts' 0)
    $UnmappedConcepts = [int](& $Get 'unmapped_concepts' 0)

    [PSCustomObject]@{
        PSTypeName       = 'AITSource'
        Id               = $Entry.id
        Title            = & $Get 'title'
        Url              = $null
        Authors          = @()
        DatePublished    = & $Get 'date_published'
        DateIngested     = & $Get 'date_ingested'
        ImportTime       = $null
        SourceTime       = $null
        SourceType       = & $Get 'source_type'
        PovTags          = @(& $Get 'pov_tags' @())
        TopicTags        = @(& $Get 'topic_tags' @())
        RolodexAuthorIds = @()
        ArchiveStatus    = $null
        SummaryVersion   = $null
        SummaryStatus    = & $Get 'summary_status'
        SummaryUpdated   = $null
        OneLiner         = & $Get 'one_liner'
        Provenance       = @()
        ProvenanceStatus = $null
        ResolvedUrl      = $null
        MDPath           = $null
        Directory        = $DocDir
        TotalClaims      = $TotalClaims
        ClaimsByPov      = ConvertTo-AITSourceClaimsByPov -Meta $Entry
        TotalFacts       = $TotalFacts
        UnmappedConcepts = $UnmappedConcepts
        ModelInfo        = $null
    }
}
