# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyBaselineSummaries {
    <#
    .SYNOPSIS
        Loads summary JSON files into a BaseName -> summary lookup, optionally
        restricted to -SampleDocIds (t/3910 decomposition of Measure-TaxonomyBaseline's
        summary-load step; no behavior change, including the per-file WARN-and-skip
        on malformed JSON).
    .PARAMETER SummariesDir
        The summaries directory to scan.
    .PARAMETER SampleDocIds
        Optional doc-id allowlist. If omitted, every summary file is loaded.
    .OUTPUTS
        [hashtable] doc id (BaseName) -> summary object.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [string]$SummariesDir,

        [string[]]$SampleDocIds
    )

    Set-StrictMode -Version Latest

    $SummaryFiles = Get-ChildItem $SummariesDir -Filter '*.json' -ErrorAction SilentlyContinue
    if ($SampleDocIds) {
        $SummaryFiles = $SummaryFiles | Where-Object { $_.BaseName -in $SampleDocIds }
    }
    $Summaries = @{}
    foreach ($F in $SummaryFiles) {
        try {
            $Summaries[$F.BaseName] = Get-Content -Raw $F.FullName | ConvertFrom-Json
        } catch { Write-Warning "Bad JSON: $($F.Name)" }
    }
    return $Summaries
}
