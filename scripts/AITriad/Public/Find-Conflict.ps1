function Find-Conflict {
    <#
    .SYNOPSIS
        Factual conflict detection and deduplication.
    .DESCRIPTION
        Called by Invoke-BatchSummary after each summary is generated.
        Groups conflicts by Claim ID to prevent duplicate entries.

        Logic:
            1. Read the newly generated summary JSON.
            2. For each factual_claim in the summary:
               a. Check if a conflict file with that claim_id already exists in conflicts/.
               b. If YES: append a new instance entry to the existing file.
               c. If NO:  create a new conflict file with a generated claim_id.
            3. Never delete or overwrite conflict files — append only.
    .PARAMETER DocId
        The document ID whose summary should be checked for conflicts.
    .EXAMPLE
        Find-Conflict -DocId 'some-document-id'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$DocId
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $ConflictsDir = Join-Path $script:RepoRoot 'conflicts'
    $SummariesDir = Join-Path $script:RepoRoot 'summaries'

    Write-Output "TODO: Find-Conflict not yet implemented for doc $DocId"
}
