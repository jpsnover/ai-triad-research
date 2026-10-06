# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchDocumentMetric {
    <#
    .SYNOPSIS
        One successful doc's entry in the extraction-metrics line (t/3910): its counts,
        source word count, and claim density (parameter #15).
    .DESCRIPTION
        claims_per_1k = (key points + factual claims) per 1,000 source words, rounded to 2
        places; $null when the word count is unknown or zero.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$SourcesDir
    )

    $DocSource = Join-Path $SourcesDir "$($Result.DocId)/metadata.json"
    $WordCount = 0
    if (Test-Path $DocSource) {
        try { $WordCount = (Get-Content $DocSource -Raw | ConvertFrom-Json).word_count ?? 0 } catch {}
    }
    return @{
        doc_id         = $Result.DocId
        key_points     = $Result.TotalPoints
        factual_claims = $Result.FactualCount
        unmapped       = $Result.UnmappedCount
        word_count     = $WordCount
        claims_per_1k  = if ($WordCount -gt 0) { [Math]::Round(($Result.TotalPoints + $Result.FactualCount) / $WordCount * 1000, 2) } else { $null }
        elapsed_secs   = $Result.ElapsedSecs
        chunks         = $Result.ChunkCount
    }
}
