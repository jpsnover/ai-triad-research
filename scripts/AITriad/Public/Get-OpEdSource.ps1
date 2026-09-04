# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-OpEdSource {
    <#
    .SYNOPSIS
        Converts and validates PRE-FETCHED source content for op-ed generation — once for all POVs.
    .DESCRIPTION
        Convert-only (t/3307). The URL fetch moved to the shared SSRF-guarded Node fetcher
        (lib/url-fetch) after the .NET/PowerShell HTTP client fingerprint was WAF-blocked (403) on
        hosts Node fetches at 200 (t/3306). The caller (the op-ed Node orchestrator, or New-OpEd's
        CLI path) fetches the bytes, writes them to a temp file, and passes the path + content-type
        here. This cmdlet reads the file, routes to the converter keyed on -ContentType (authoritative,
        never the filename extension — a .html-named PDF must still convert as a PDF, t/3306#4),
        applies a fail-loud readability gate, truncates to the prompt budget, and returns a prep
        object that New-OpEd (or the server) reuses across per-POV drafts without re-converting.

        The caller owns the temp file lifecycle (creates + deletes it); this cmdlet never fetches,
        writes, or deletes it. SourceBrief is populated by New-OpEd after the comprehension pass.
    .PARAMETER ContentPath
        Path to the pre-fetched source bytes on disk (a temp file the caller owns).
    .PARAMETER ContentType
        The source Content-Type (authoritative dispatch): 'application/pdf' → PDF,
        '…wordprocessingml…' → DOCX, text/* or empty → HTML.
    .PARAMETER SourceUrl
        Optional originating URL — used as the HTML base for relative-link resolution and recorded
        on the returned object for provenance. Not fetched.
    .PARAMETER MaxChars
        Maximum characters of extracted Markdown to retain for the prompt budget. Default 12000.
    .PARAMETER MinReadableWords
        Minimum alpha-word count (words with >=3 letters) required. Sources below this threshold
        fail loud — they are not usable as grounding. Default 100.
    .PARAMETER MinAlphaDensity
        Minimum ratio of alpha-words to total whitespace-split tokens. Default 0.60.
    .EXAMPLE
        $Prep = Get-OpEdSource -ContentPath $Temp -ContentType 'application/pdf' -SourceUrl $Url
        New-OpEd -SourcePrep $Prep -Pov safetyist
    .OUTPUTS
        PSCustomObject with: SourceUrl, ContentType, SourceMarkdown, SourceFormat,
        SourceExtractionTool, ReadableWords, ReadableRatio, CharsTotal, CharsUsed, Truncated,
        Excerpt, ContentHash, FetchedAt, SourceBrief.
    .LINK
        New-OpEd
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateNotNullOrEmpty()]
        [string]$ContentPath,

        [Parameter(Mandatory, Position = 1)]
        [ValidateNotNullOrEmpty()]
        [string]$ContentType,

        [string]$SourceUrl = '',

        [ValidateRange(1000, 100000)]
        [int]$MaxChars = 12000,

        [ValidateRange(1, 10000)]
        [int]$MinReadableWords = 100,

        [ValidateRange(0.0, 1.0)]
        [double]$MinAlphaDensity = 0.60
    )

    Set-StrictMode -Version Latest

    # ── Validate the pre-fetched content file ─────────────────────────────────
    if (-not (Test-Path -LiteralPath $ContentPath -PathType Leaf)) {
        throw (New-ActionableError -AsErrorRecord -ErrorType 'ContentPathMissing' `
            -Goal 'Convert pre-fetched source content for op-ed generation' `
            -Problem "Content file not found: '$ContentPath'. Get-OpEdSource is convert-only — the caller must fetch the source and write it to this path first." `
            -Location 'Get-OpEdSource' `
            -NextSteps @(
                'Confirm the Node fetcher wrote the temp file before invoking the converter',
                'Supply material via -Topic text in New-OpEd instead'
            ))
    }

    # ── Detect format from ContentType (authoritative — NOT the file extension) ─
    $Format         = 'html'
    $ExtractionTool = 'ConvertFrom-Html'
    if ($ContentType -match 'application/pdf') {
        $Format         = 'pdf'
        $ExtractionTool = 'ConvertFrom-Pdf'
    } elseif ($ContentType -match 'vnd\.openxmlformats' -or $ContentType -match 'msword') {
        $Format         = 'docx'
        $ExtractionTool = 'ConvertFrom-Docx'
    } elseif ($ContentType -match '^(image|audio|video)/' -or $ContentType -match 'application/octet-stream') {
        # Clearly-binary, non-document content — fail with a precise cause rather than letting the
        # readability gate report a misleading "not readable prose" for e.g. a PNG.
        throw (New-ActionableError -AsErrorRecord -ErrorType 'UnsupportedContentType' `
            -Goal 'Convert pre-fetched source content for op-ed generation' `
            -Problem "Content-Type '$ContentType' is not a supported document format (PDF, DOCX, or HTML/text)." `
            -Location 'Get-OpEdSource' `
            -NextSteps @(
                'Provide a PDF, DOCX, or HTML/text source',
                'Supply material via -Topic text in New-OpEd instead'
            ))
    }

    Write-Verbose "Get-OpEdSource: contentType=$ContentType format=$Format tool=$ExtractionTool"

    # ── Convert (reads the caller-owned temp file; never deletes it) ───────────
    $Markdown = ''
    try {
        switch ($Format) {
            'pdf'  { $Markdown = Invoke-PdfConversion  -Path $ContentPath }
            'docx' { $Markdown = Invoke-DocxConversion -Path $ContentPath }
            default {
                $Html     = [System.IO.File]::ReadAllText($ContentPath)
                $HtmlArgs = @{ Html = $Html }
                if ($SourceUrl) { $HtmlArgs['SourceUrl'] = $SourceUrl }
                $Markdown = ConvertFrom-Html @HtmlArgs
            }
        }
    } catch {
        throw (New-ActionableError -AsErrorRecord -ErrorType 'ConversionFailed' `
            -Goal "Extract text from the $Format source" `
            -Problem "The $ExtractionTool converter failed: $($_.Exception.Message)" `
            -Location 'Get-OpEdSource' `
            -NextSteps @(
                'Install a PDF extraction tool (markitdown, pdftotext, or mutool) for PDF sources',
                'Confirm the fetched bytes are a valid document of the declared Content-Type',
                'Supply material via -Topic text in New-OpEd instead'
            ))
    }
    $Markdown = [string]$Markdown

    # ── Readability gate ──────────────────────────────────────────────────────
    # Splits on whitespace; counts tokens with >=3 letters as "readable words". A PDF whose bytes
    # were mis-converted yields space-joined decimal byte values — zero alpha tokens, caught here.
    $Tokens        = @($Markdown -split '\s+' | Where-Object { $_ -ne '' })
    $AlphaTokens   = @($Tokens   | Where-Object { ($_ -replace '[^a-zA-Z]', '').Length -ge 3 })
    $ReadableWords = $AlphaTokens.Count
    $ReadableRatio = if ($Tokens.Count -gt 0) { [double]$AlphaTokens.Count / $Tokens.Count } else { 0.0 }

    if ($ReadableWords -lt $MinReadableWords -or $ReadableRatio -lt $MinAlphaDensity) {
        throw (New-ActionableError -AsErrorRecord -ErrorType 'InsufficientReadableText' `
            -Goal 'Extract readable text from the source' `
            -Problem ("Source yielded only $ReadableWords readable word(s) " +
                "(alpha-token ratio $([Math]::Round($ReadableRatio, 2))). " +
                "Format detected: $Format. The content is not readable prose.") `
            -Location 'Get-OpEdSource' `
            -NextSteps @(
                'Confirm the source is a document with readable text content',
                'Install a PDF extraction tool (markitdown, pdftotext, or mutool) for PDF sources',
                'Supply material via -Topic text in New-OpEd instead'
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

    # ContentHash: sha256 of the full extracted text (before truncation). The only key needed for
    # any future cross-run cache.
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $HashBytes   = $Sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Markdown))
        $ContentHash = [System.BitConverter]::ToString($HashBytes).Replace('-', '').ToLowerInvariant()
    } finally {
        $Sha256.Dispose()
    }

    [PSCustomObject]@{
        SourceUrl            = $SourceUrl
        ContentType          = $ContentType
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
