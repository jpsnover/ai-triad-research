# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-BatchDryRunPlan {
    <#
    .SYNOPSIS
        Prints Invoke-BatchSummary's -DryRun plan (t/3910): which docs would be
        reprocessed and which would only be marked current.
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][System.Collections.Generic.List[hashtable]]$DocsToProcess,
        [AllowEmptyCollection()][System.Collections.Generic.List[hashtable]]$DocsToSkip
    )

    Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
    Write-Host "  DRY RUN PLAN" -ForegroundColor Yellow
    Write-Host "$('─' * 72)" -ForegroundColor DarkGray

    Write-Host "`n  WOULD REPROCESS ($($DocsToProcess.Count) docs):" -ForegroundColor Cyan
    foreach ($Doc in $DocsToProcess) {
        Write-Host "    $($Doc.DocId)  [pov: $($Doc.PovTags -join ', ')]" -ForegroundColor White
    }

    Write-Host "`n  WOULD MARK CURRENT — no API call ($($DocsToSkip.Count) docs):" -ForegroundColor Gray
    foreach ($Doc in $DocsToSkip) {
        Write-Host "    $($Doc.DocId)  [pov: $($Doc.PovTags -join ', ')]" -ForegroundColor DarkGray
    }

    Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
    Write-Host "  DRY RUN complete. No API calls made. No files written." -ForegroundColor Yellow
    Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
}
