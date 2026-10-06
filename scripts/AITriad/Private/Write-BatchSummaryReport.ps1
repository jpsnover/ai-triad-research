# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-BatchSummaryReport {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 8 (t/3910): the final console report — counts, extraction
        totals, and each failed doc with the command to re-run it.
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][object[]]$Succeeded = @(),
        [AllowEmptyCollection()][object[]]$Failed = @(),
        [int]$ProcessCount,
        [int]$SkipCount,
        [string]$TaxonomyVersion,
        [string]$Model
    )

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  BATCH SUMMARY  —  taxonomy v$TaxonomyVersion  |  model: $Model" -ForegroundColor White
    Write-Host "$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Reprocessed   : $($Succeeded.Count) / $ProcessCount succeeded" -ForegroundColor $(if ($Failed.Count -eq 0) { 'Green' } else { 'Yellow' })
    Write-Host "  Marked current: $SkipCount (no reprocess needed)" -ForegroundColor Gray

    if ($Succeeded.Count -gt 0) {
        $TotalPts      = ($Succeeded | Measure-Object -Property TotalPoints   -Sum).Sum
        $TotalUnmapped = ($Succeeded | Measure-Object -Property UnmappedCount -Sum).Sum
        $TotalFacts    = ($Succeeded | Measure-Object -Property FactualCount  -Sum).Sum
        $TotalSecs     = ($Succeeded | Measure-Object -Property ElapsedSecs   -Sum).Sum
        $ChunkedDocs   = @($Succeeded | Where-Object { $_.ChunkCount -gt 0 })
        Write-Host "  Total points  : $TotalPts ($TotalUnmapped new concepts)" -ForegroundColor White
        Write-Host "  Factual claims: $TotalFacts" -ForegroundColor White
        if ($ChunkedDocs.Count -gt 0) {
            $TotalChunks = ($ChunkedDocs | Measure-Object -Property ChunkCount -Sum).Sum
            Write-Host "  Chunked docs  : $($ChunkedDocs.Count) ($TotalChunks total chunks)" -ForegroundColor Cyan
        }
        Write-Host "  Total API time: ${TotalSecs}s (~$([int]($TotalSecs / [Math]::Max(1,$Succeeded.Count)))s/doc avg)" -ForegroundColor Gray
    }

    if ($Failed.Count -gt 0) {
        Write-Host "`n  FAILED ($($Failed.Count)):" -ForegroundColor Red
        foreach ($F in $Failed) {
            Write-Host "    ✗ $($F.DocId)  — $($F.Error)" -ForegroundColor Red
        }
        Write-Host "`n  Re-run failed documents individually:" -ForegroundColor Yellow
        foreach ($F in $Failed) {
            Write-Host "    Invoke-BatchSummary -DocId '$($F.DocId)'" -ForegroundColor DarkYellow
        }
    }

    Write-Host "`n  Output: summaries/*.json  |  metadata updated in sources/*/metadata.json"
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
