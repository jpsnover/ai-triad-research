# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# CLI convenience: best-effort PS fetch → temp file → convert-only Get-OpEdSource, so `New-OpEd -Url`
# keeps working from the command line after Get-OpEdSource became convert-only (t/3307).
#
# WAF-limited interim (t/3312): PowerShell's Invoke-WebRequest client fingerprint is blocked by some
# WAFs (Akamai .gov/news PDFs will 403 it) — the same WAF-fingerprint fetch class the Electron op-ed
# path already avoids by fetching via Node (fetchUrlForPromptBinary) and calling the convert-only
# shim. This helper is the ONE remaining PS-side external URL fetch; it migrates to the shared Node
# fetch-CLI entrypoint when that lands under t/3312. Kept for now so the CLI is not broken. Because it
# is a t/3312 class-member, it is intentionally localized here (one entry point) rather than inlined
# into New-OpEd, so the migration and any WAF-fetch prevention guard have a single site to target.
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

    try {
        $Resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60
    } catch {
        throw (New-ActionableError -PassThru `
            -ErrorType 'FetchFailed' `
            -Goal 'Fetch source URL for op-ed generation' `
            -Problem "Could not fetch '$Url': $($_.Exception.Message)" `
            -Location 'Get-OpEdSourceFromUrl' `
            -NextSteps @(
                'Confirm the URL is reachable and publicly accessible',
                'This CLI fetch is WAF-limited (Akamai .gov/news PDFs may 403 the PowerShell client); use the Electron op-ed path or supply -Topic text in New-OpEd instead'
            ))
    }

    # Content-Type is authoritative for the convert step; fall back to the URL extension only when the
    # server omitted it. Get-OpEdSource dispatches on ContentType, so the temp-file extension is advisory.
    $ContentType = [string]($Resp.Headers['Content-Type'] ?? '')
    if ([string]::IsNullOrWhiteSpace($ContentType)) {
        $UrlExt = [System.IO.Path]::GetExtension(([uri]$Url).LocalPath).ToLowerInvariant()
        $ContentType = switch ($UrlExt) {
            '.pdf'  { 'application/pdf' }
            '.docx' { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
            default { 'text/html' }
        }
    }

    $TempExt = if ($ContentType -match 'pdf') { '.pdf' } elseif ($ContentType -match 'wordprocessingml') { '.docx' } else { '.html' }
    $TempFile = [System.IO.Path]::GetTempFileName() + $TempExt
    try {
        # Persist RAW bytes so binary sources (PDF/DOCX) stay intact. Prefer RawContentStream — for a
        # binary body $Resp.Content is a decoded string that corrupts the bytes. Property-guarded for
        # StrictMode + test doubles that lack RawContentStream.
        $HasRaw = $Resp.PSObject.Properties['RawContentStream'] -and $null -ne $Resp.RawContentStream
        $Bytes = if ($HasRaw) {
            $Ms = [System.IO.MemoryStream]::new()
            try { $Resp.RawContentStream.Position = 0; $Resp.RawContentStream.CopyTo($Ms); $Ms.ToArray() }
            finally { $Ms.Dispose() }
        } elseif ($Resp.PSObject.Properties['Content'] -and ($Resp.Content -is [byte[]])) {
            $Resp.Content
        } else {
            [System.Text.Encoding]::UTF8.GetBytes([string]$Resp.Content)
        }
        [System.IO.File]::WriteAllBytes($TempFile, $Bytes)
        Get-OpEdSource -ContentPath $TempFile -ContentType $ContentType -SourceUrl $Url `
            -MaxChars $MaxChars -MinReadableWords $MinReadableWords -MinAlphaDensity $MinAlphaDensity
    } finally {
        Remove-Item -LiteralPath $TempFile -Force -ErrorAction SilentlyContinue
    }
}
