# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-BatchSourceIndex {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 8c (t/3910): rebuild the source index after a batch.
        Best-effort — a failure is reported on the Verbose stream and the batch continues.
    #>
    [CmdletBinding()]
    param()

    try { Update-AITSourceIndex -Quiet } catch { Write-Verbose "Index rebuild skipped: $_" }
}
