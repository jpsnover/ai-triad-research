# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# Citation-liveness check for POV intellectual-lineage URLs (used by Repair-PovLineage -FixUrls).
# Fetches via the shared Node fetch-CLI (Get-UrlViaSharedFetcher, t/3313) instead of Invoke-WebRequest:
# Node's undici passes WAFs that 403 the .NET/PowerShell client fingerprint (t/3306), so a live
# WAF-protected citation is no longer falsely marked dead (the data-integrity bug this fixes).
# GET + soft-404 body scan. Extracted from the Repair-PovLineage cmdlet body so the migration is
# unit-testable. Dot-sourced by AITriad.psm1 — do NOT export.

function Test-LineageUrl {
    [CmdletBinding()]
    [OutputType([bool])]
    param([string]$Url)

    Set-StrictMode -Version Latest

    if ([string]::IsNullOrWhiteSpace($Url) -or $Url -notmatch '^https?://') { return $false }

    $Fetch = $null
    try {
        $Fetch = Get-UrlViaSharedFetcher -Url $Url -TimeoutMs 8000
        if ($Fetch.Status -ne 200) { return $false }
        # Soft-404: some hosts return 200 for a "not found" page. Scan the CLI-provided body snippet.
        if ($Fetch.BodySnippet -match '(?i)(page not found|does not exist|no article|404 error|there is no page)') {
            return $false
        }
        return $true
    }
    catch {
        # Fallback-path logging (docs/error-handling.md): an environment failure (NodeMissing /
        # fetch-cli missing) or transport error means we could not verify — treated as not-live (same
        # as the pre-migration catch), but logged so a mass "dead" run is diagnosable, not silent.
        Write-Verbose "Test-LineageUrl: '$Url' treated as unreachable — $($_.Exception.Message)"
        return $false
    }
    finally {
        # Get-UrlViaSharedFetcher writes response bytes to a caller-owned temp file; liveness only
        # needs status + snippet, so clean it up.
        if ($null -ne $Fetch -and $Fetch.PSObject.Properties['OutPath'] -and $Fetch.OutPath) {
            Remove-Item -LiteralPath $Fetch.OutPath -Force -ErrorAction SilentlyContinue
        }
    }
}
