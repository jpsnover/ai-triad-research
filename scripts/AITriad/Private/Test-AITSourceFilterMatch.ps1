# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AITSourceFilterMatch {
    <#
    .SYNOPSIS
        Shared Get-AITSource filter predicate (t/3910 decomposition, no behavior change).
    .DESCRIPTION
        The index entry and the full-scan metadata object use IDENTICAL field names
        (id, title, pov_tags, topic_tags, summary_status, source_type, date_ingested), so
        one predicate serves both of Get-AITSource's code paths — this was previously two
        copies of the same six-filter chain. Pov/Topic (array-contains) and Status/SourceType
        (exact-match) are data-driven to avoid repeating the same guarded-compare shape
        four times.
    .PARAMETER Meta
        The index entry OR the parsed metadata.json object.
    .PARAMETER TodayStr
        Pre-computed 'yyyy-MM-dd' string when -Today is set, else $null. Computed once by
        the caller rather than per-entry.
    .OUTPUTS
        [bool] $true if Meta passes every supplied filter.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)][PSObject]$Meta,
        [string]$DocId,
        [string[]]$Title,
        [string]$Pov,
        [string]$Topic,
        [string]$Status,
        [string]$SourceType,
        [switch]$Today,
        [string]$TodayStr
    )
    Set-StrictMode -Version Latest

    if ($DocId -and $Meta.id -notlike $DocId) { return $false }
    if ($Title -and -not (Test-AITSourceTitleMatch -Meta $Meta -Title $Title)) { return $false }

    $ContainsChecks = @(
        @{ Value = $Pov;   Field = 'pov_tags' }
        @{ Value = $Topic; Field = 'topic_tags' }
    )
    foreach ($Check in $ContainsChecks) {
        if (-not $Check.Value) { continue }
        $FieldArr = @(Get-AITSourcePropValue -Object $Meta -Name $Check.Field -Default @())
        if ($FieldArr -notcontains $Check.Value) { return $false }
    }

    $EqualsChecks = @(
        @{ Value = $Status;     Field = 'summary_status' }
        @{ Value = $SourceType; Field = 'source_type' }
    )
    foreach ($Check in $EqualsChecks) {
        if (-not $Check.Value) { continue }
        $FieldVal = Get-AITSourcePropValue -Object $Meta -Name $Check.Field
        if ($FieldVal -ne $Check.Value) { return $false }
    }

    if ($Today) {
        $Ingested = Get-AITSourcePropValue -Object $Meta -Name 'date_ingested'
        if ($Ingested -ne $TodayStr) { return $false }
    }

    return $true
}
