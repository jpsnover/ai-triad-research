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
