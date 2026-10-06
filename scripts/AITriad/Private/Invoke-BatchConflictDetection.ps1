# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-BatchConflictDetection {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 7 (t/3910): run QBAF conflict analysis for every
        successfully summarized doc. A per-doc failure only WARNs.
    #>
    [CmdletBinding()]
    param([AllowEmptyCollection()][object[]]$Result = @())

    Write-Step "Running conflict detection (QBAF)"

    foreach ($Item in @($Result | Where-Object { $_.Success })) {
        try {
            Invoke-QbafConflictAnalysis -DocId $Item.DocId
            Write-Info "  Conflict detection: $($Item.DocId)"
        } catch {
            Write-Warn "  Invoke-QbafConflictAnalysis failed for $($Item.DocId): $_"
        }
    }
}
