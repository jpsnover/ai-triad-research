# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-OpEdSource {
    <#
    .SYNOPSIS
        Fetches, converts, and validates a source URL for op-ed generation — once for all POVs.
    .DESCRIPTION
        Fetches the URL, detects its format (PDF / DOCX / HTML) from the Content-Type header and
        URL extension, routes to the appropriate converter (ConvertFrom-Pdf, ConvertFrom-Docx, or
        ConvertFrom-Html), applies a fail-loud readability gate, truncates to the prompt budget,
        and returns a prep object that New-OpEd (or the server) can pass to multiple per-POV
        drafts without re-fetching or re-converting.

        SourceBrief is populated by New-OpEd after the comprehension pass; it is null here.
    .PARAMETER Url
        The URL to fetch. PDF and DOCX are written to a temp file before conversion; HTML is
        passed as a string.
    .PARAMETER MaxChars
        Maximum characters of extracted Markdown to retain for the prompt budget. Default 12000.
    .PARAMETER MinReadableWords
        Minimum alpha-word count (words with >=3 letters) required. Sources below this threshold
        fail loud — they are not usable as grounding. Default 100.
    .PARAMETER MinAlphaDensity
        Minimum ratio of alpha-words to total whitespace-split tokens. Default 0.60.
    .EXAMPLE
        $Prep = Get-OpEdSource -Url 'https://example.com/report.pdf'
        New-OpEd -SourcePrep $Prep -Pov safetyist
    .OUTPUTS
        PSCustomObject with: Url, SourceMarkdown, SourceFormat, SourceExtractionTool,
        ReadableWords, ReadableRatio, CharsTotal, CharsUsed, Truncated, Excerpt, SourceBrief.
    .LINK
        New-OpEd
    #>
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

    # ── Fetch ────────────────────────────────────────────────────────────────
    try {
        $Resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60
    } catch {
        throw (New-ActionableError -PassThru `
            -Goal "Fetch source URL for op-ed generation" `
            -Problem "Could not fetch '$Url': $($_.Exception.Message)" `
            -Location 'Get-OpEdSource' `
            -NextSteps @(
                'Confirm the URL is reachable and publicly accessible',
                'Supply material via -Topic text in New-OpEd instead'
            ))
    }

    # ── Detect format ────────────────────────────────────────────────────────
    $ContentType = [string]($Resp.Headers['Content-Type'] ?? '')
    $Extension   = [System.IO.Path]::GetExtension(([uri]$Url).LocalPath).ToLower()

    $Format        = 'html'
    $ExtractionTool = 'ConvertFrom-Html'
    if ($ContentType -match 'application/pdf' -or $Extension -eq '.pdf') {
        $Format        = 'pdf'
        $ExtractionTool = 'ConvertFrom-Pdf'
    } elseif ($ContentType -match 'vnd\.openxmlformats' -or $Extension -eq '.docx') {
        $Format        = 'docx'
        $ExtractionTool = 'ConvertFrom-Docx'
    }

    Write-Verbose "Get-OpEdSource: format=$Format tool=$ExtractionTool"

    # ── Convert ──────────────────────────────────────────────────────────────
    $Markdown = ''
    switch ($Format) {
        'pdf' {
            $TempFile = [System.IO.Path]::GetTempFileName() + '.pdf'
            try {
                [System.IO.File]::WriteAllBytes($TempFile, $Resp.Content)
                $Markdown = Invoke-PdfConversion -Path $TempFile
            } finally {
                Remove-Item $TempFile -Force -ErrorAction SilentlyContinue
            }
        }
        'docx' {
            $TempFile = [System.IO.Path]::GetTempFileName() + '.docx'
            try {
                [System.IO.File]::WriteAllBytes($TempFile, $Resp.Content)
                $Markdown = Invoke-DocxConversion -Path $TempFile
            } finally {
                Remove-Item $TempFile -Force -ErrorAction SilentlyContinue
            }
        }
        default {
            $Markdown = ConvertFrom-Html -Html ([string]$Resp.Content) -SourceUrl $Url
        }
    }
    $Markdown = [string]$Markdown

    # ── Readability gate ─────────────────────────────────────────────────────
    # Splits on whitespace; counts tokens with >=3 letters as "readable words".
    # A PDF piped through ConvertFrom-Html yields space-joined decimal byte values —
    # zero alpha tokens, caught here before the prompt is built.
    $Tokens      = @($Markdown -split '\s+' | Where-Object { $_ -ne '' })
    $AlphaTokens = @($Tokens   | Where-Object { ($_ -replace '[^a-zA-Z]', '').Length -ge 3 })
    $ReadableWords = $AlphaTokens.Count
    $ReadableRatio = if ($Tokens.Count -gt 0) { [double]$AlphaTokens.Count / $Tokens.Count } else { 0.0 }

    if ($ReadableWords -lt $MinReadableWords -or $ReadableRatio -lt $MinAlphaDensity) {
        throw (New-ActionableError -PassThru `
            -Goal "Extract readable text from '$Url'" `
            -Problem ("Source yielded only $ReadableWords readable word(s) " +
                "(alpha-token ratio $([Math]::Round($ReadableRatio, 2))). " +
                "Format detected: $Format. The content is not readable prose.") `
            -Location 'Get-OpEdSource' `
            -NextSteps @(
                'Install a PDF extraction tool (markitdown, pdftotext, or mutool) for PDF sources',
                'Confirm the URL points to a document with readable text content',
                'Pass -VoiceOnly to New-OpEd to skip source grounding and write from camp voice alone'
            ))
    }

    # ── Truncate to prompt budget ─────────────────────────────────────────────
    $CharsTotal     = $Markdown.Length
    $Truncated      = $CharsTotal -gt $MaxChars
    $CharsUsed      = [Math]::Min($CharsTotal, $MaxChars)
    $SourceMarkdown = if ($Truncated) {
        $Markdown.Substring(0, $MaxChars) + "`n`n[... source truncated ...]"
    } else {
        $Markdown
    }
    $Excerpt = $Markdown.Substring(0, [Math]::Min(500, $Markdown.Length))

    # ContentHash: sha256 of the full extracted text (before truncation).
    # Cheap to compute now; the only key needed for any future cross-run cache.
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $HashBytes = $Sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Markdown))
        $ContentHash = [System.BitConverter]::ToString($HashBytes).Replace('-', '').ToLowerInvariant()
    } finally {
        $Sha256.Dispose()
    }

    [PSCustomObject]@{
        Url                  = $Url
        SourceMarkdown       = $SourceMarkdown
        SourceFormat         = $Format
        SourceExtractionTool = $ExtractionTool
        ReadableWords        = $ReadableWords
        ReadableRatio        = $ReadableRatio
        CharsTotal           = $CharsTotal
        CharsUsed            = $CharsUsed
        Truncated            = $Truncated
        Excerpt              = $Excerpt
        ContentHash          = $ContentHash
        FetchedAt            = [System.DateTime]::UtcNow.ToString('o')
        SourceBrief          = $null  # populated by New-OpEd's source_brief comprehension pass
    }
}
