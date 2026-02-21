<#
.SYNOPSIS
    Smart batch POV summarization.

.DESCRIPTION
    Triggered by GitHub Actions when TAXONOMY_VERSION changes.
    Only re-summarizes documents whose pov_tags overlap with changed taxonomy files.

    Logic:
        1. Read TAXONOMY_VERSION from repo root.
        2. Determine which taxonomy/*.json files changed (via git diff or -ForceAll flag).
        3. Derive the affected POV camps from changed filenames.
        4. Find all sources/*/metadata.json where pov_tags intersects with affected camps.
        5. For each matched doc, call AI summarization API with current taxonomy as context.
        6. Write result to summaries/<doc-id>.json (replace).
        7. Update metadata.json: summary_version and summary_status: current.
        8. For unmatched docs, update summary_status: current (no reprocess needed).
        9. Call Find-Conflict.ps1 for each newly generated summary.

.PARAMETER ForceAll
    Reprocess every document regardless of POV.

.PARAMETER DocId
    Reprocess a single document by its ID.

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1
    # Smart mode (git diff)

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1 -ForceAll
    # Reprocess every doc regardless of POV

.EXAMPLE
    .\scripts\Invoke-BatchSummary.ps1 -DocId 'some-document-id'
    # Reprocess a single document

.NOTES
    Environment variables:
        AI_API_KEY      API key for the summarization model
        AI_MODEL        Model identifier (e.g. claude-sonnet-4-6)

    TODO: Implement using Anthropic API calls and git diff inspection.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$ForceAll,

    [Parameter()]
    [string]$DocId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot    = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SourcesDir  = Join-Path $RepoRoot 'sources'
$SummariesDir = Join-Path $RepoRoot 'summaries'
$TaxonomyDir = Join-Path $RepoRoot 'taxonomy'
$VersionFile = Join-Path $RepoRoot 'TAXONOMY_VERSION'

$PovFileMap = @{
    'accelerationist.json' = @('accelerationist')
    'safetyist.json'       = @('safetyist')
    'skeptic.json'         = @('skeptic')
    'cross-cutting.json'   = @('accelerationist', 'safetyist', 'skeptic')
}

function Get-Taxonomy {
    <#
    .SYNOPSIS
        Load all taxonomy JSON files into a single hashtable.
    #>
    $Taxonomy = @{}
    foreach ($FileName in $PovFileMap.Keys) {
        $FilePath = Join-Path $TaxonomyDir $FileName
        if (Test-Path $FilePath) {
            $Taxonomy[$FileName] = Get-Content -Path $FilePath -Raw | ConvertFrom-Json
        }
    }
    return $Taxonomy
}

$Version = (Get-Content -Path $VersionFile -Raw).Trim()
Write-Output "Taxonomy version: $Version"
Write-Output 'TODO: Invoke-BatchSummary.ps1 not yet implemented. Stub created by Initialize-AITriadRepo.ps1'
exit 0
