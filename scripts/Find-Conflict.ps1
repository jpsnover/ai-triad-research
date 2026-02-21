<#
.SYNOPSIS
    Factual conflict detection and deduplication.

.DESCRIPTION
    Called by Invoke-BatchSummary.ps1 after each summary is generated.
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
    .\scripts\Find-Conflict.ps1 -DocId 'some-document-id'

.NOTES
    TODO: Implement conflict detection logic.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$DocId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConflictsDir = Join-Path $RepoRoot 'conflicts'
$SummariesDir = Join-Path $RepoRoot 'summaries'

Write-Output "TODO: Find-Conflict.ps1 not yet implemented for doc $DocId"
exit 0
