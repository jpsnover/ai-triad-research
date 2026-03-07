# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Fire-and-forget Wayback Machine archival submission.

function Submit-ToWaybackMachine {
    param([string]$TargetUrl)

    $SaveUrl = "https://web.archive.org/save/$TargetUrl"
    Write-Info "Submitting to Wayback Machine..."

    try {
        Invoke-RestMethod -Uri $SaveUrl -Method GET -TimeoutSec 15 -ErrorAction Stop | Out-Null
        Write-OK "Wayback: archive request sent"
    } catch {
        Write-Warn "Wayback: request failed (non-fatal) — $($_.Exception.Message)"
    }
}
