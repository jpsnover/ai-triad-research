# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# CLI convenience: fetch (via the shared Node fetch-CLI) → temp file → convert-only Get-OpEdSource,
# so `New-OpEd -Url` works from the command line after Get-OpEdSource became convert-only (t/3307).
# Migrated off PowerShell Invoke-WebRequest to Get-UrlViaSharedFetcher (t/3320) — Node's undici passes
# WAFs that block the .NET/PS client fingerprint (t/3306), and the fetch is SSRF-guarded, routed
# through the ONE shared PS-side external-URL fetch path (t/3312 class). Localized here (one entry
# point) so New-OpEd stays convert-only.
#
# Dot-sourced by AITriad.psm1 — do NOT export.

function Get-OpEdSourceFromUrl {
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateNotNullOrEmpty()]
        [string]$Url,

        [ValidateRange(1000, 100000)]
        [int]$MaxChars = 12000,

        [ValidateRange(1, 10000)]
        [int]$MinReadableWords = 100,

        [ValidateRange(0.0, 1.0)]
        [double]$MinAlphaDensity = 0.60
    )

    Set-StrictMode -Version Latest

    $Fetch = Get-UrlViaSharedFetcher -Url $Url -TimeoutMs 60000
    try {
        if ($Fetch.Status -ne 200 -or $Fetch.Error) {
            $code   = if ($null -ne $Fetch.Status) { $Fetch.Status } else { 'transport-failure' }
            $detail = if ($Fetch.Error) { "; $($Fetch.Error)" } else { '' }
            throw (New-ActionableError -PassThru -ErrorType 'FetchFailed' `
                -Goal 'Fetch source URL for op-ed generation' `
                -Problem "Could not fetch '$Url' (status: $code$detail)." `
                -Location 'Get-OpEdSourceFromUrl' `
                -NextSteps @(
                    'The shared fetcher (Node) already passes most WAFs; a persistent failure usually means the URL is unreachable, access-blocked, or SSRF-guarded',
                    'Supply -Topic text in New-OpEd instead'
                ))
        }

        # Content-Type is authoritative for the convert step; fall back to the URL extension only when
        # the server omitted it. Get-OpEdSource dispatches on ContentType (the temp path is advisory).
        $ContentType = [string]$Fetch.ContentType
        if ([string]::IsNullOrWhiteSpace($ContentType)) {
            $UrlExt = [System.IO.Path]::GetExtension(([uri]$Url).LocalPath).ToLowerInvariant()
            $ContentType = switch ($UrlExt) {
                '.pdf'  { 'application/pdf' }
                '.docx' { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
                default { 'text/html' }
            }
        }

        Get-OpEdSource -ContentPath $Fetch.OutPath -ContentType $ContentType -SourceUrl $Url `
            -MaxChars $MaxChars -MinReadableWords $MinReadableWords -MinAlphaDensity $MinAlphaDensity
    } finally {
        if ($Fetch -and $Fetch.OutPath -and (Test-Path -LiteralPath $Fetch.OutPath)) {
            Remove-Item -LiteralPath $Fetch.OutPath -Force -ErrorAction SilentlyContinue
        }
    }
}
