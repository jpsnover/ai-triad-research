# Factory for the canonical metadata.json structure.

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
        source_type        = $SourceType
        pov_tags           = $PovTag
        topic_tags         = $TopicTag
        rolodex_author_ids = @()
        archive_status     = 'pending'
        summary_version    = $null
        summary_status     = 'pending'
    }
}
