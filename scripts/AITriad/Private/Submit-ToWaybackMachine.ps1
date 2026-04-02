# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Submits a URL to the Internet Archive's Wayback Machine for archival.
.DESCRIPTION
    Makes a fire-and-forget HTTP GET request to the Wayback Machine's /save/
    endpoint to request archival of the given URL.  Failures are logged as
    warnings but do not terminate the pipeline — archival is best-effort.

    Called by Save-WaybackUrl and Import-AITriadDocument when a source URL is
    provided during ingestion.
.PARAMETER TargetUrl
    The URL to submit for archival (e.g., 'https://example.com/paper.pdf').
.EXAMPLE
    Submit-ToWaybackMachine -TargetUrl 'https://example.com/ai-report.html'

    Requests the Wayback Machine to archive the given page.
#>
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
