# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-OpEdSource {
    <#
    .SYNOPSIS
        Converts and validates pre-fetched source content for op-ed generation — once for all POVs.
    .DESCRIPTION
        CONVERT-ONLY (t/3306/t/3307). The bytes have already been fetched (by the Node
        fetchUrlForPromptBinary path for the Electron op-ed flow, or by Get-OpEdSourceFromUrl for
        the CLI) and written to a temp file. This cmdlet reads that file, dispatches on the
        authoritative Content-Type (NOT the file extension), routes to the appropriate converter
        (Invoke-PdfConversion / Invoke-DocxConversion / ConvertFrom-Html), applies a fail-loud
        readability gate, truncates to the prompt budget, and returns a prep object that New-OpEd
        (or the server) can pass to multiple per-POV drafts without re-converting.

        It never fetches — routing external URL fetches through one hardened Node fetcher is what
        fixes the WAF-fingerprint 403 that blocked the old PowerShell Invoke-WebRequest path (the
        senate.gov/Akamai case) and consolidates SSRF hardening in one place.

        On failure it throws an ActionableError whose TargetObject carries a structured
        { ErrorType, Goal, Problem, NextSteps } payload, so the Stage-A shim can serialize the real
        cause to the handler instead of collapsing to a generic exit-code-1 (t/3306). ErrorType is
        one of: ContentPathMissing, UnsupportedContentType, ConversionFailed, InsufficientReadableText.

        SourceBrief is populated by New-OpEd after the comprehension pass; it is null here.
    .PARAMETER ContentPath
        Path to the temp file holding the already-fetched source bytes. Read directly; never fetched.
    .PARAMETER ContentType
        The authoritative MIME type from the fetch (e.g. 'application/pdf', 'text/html'). Conversion
        dispatch keys off THIS, not the file extension — a content-type→extension guess can be wrong
        (a `.html`-named PDF would mis-convert), so the temp-file extension is advisory only.
    .PARAMETER SourceUrl
        Optional informational URL: used as the HTML base URL for resolving relative links and passed
        through onto the returned object's provenance field. Not fetched.
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

        [Parameter(Mandatory)]
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

    # Throws an ActionableError whose TargetObject carries the structured { ErrorType, Goal, Problem,
    # NextSteps } the Stage-A shim serializes to the handler (t/3306 contract). CLI callers still see
    # the human-rendered message on $_.Exception.Message.
    function New-ConvertError {
        param(
            [Parameter(Mandatory)][string]$ErrorType,
            [Parameter(Mandatory)][string]$Goal,
            [Parameter(Mandatory)][string]$Problem,
            [Parameter(Mandatory)][string[]]$NextSteps
        )
        $Rendered = New-ActionableError -PassThru -ErrorType $ErrorType `
            -Goal $Goal -Problem $Problem -Location 'Get-OpEdSource' -NextSteps $NextSteps
        $Payload = [PSCustomObject]@{
            ErrorType = $ErrorType
            Goal      = $Goal
            Problem   = $Problem
            NextSteps = [string[]]@($NextSteps)
        }
        $Record = [System.Management.Automation.ErrorRecord]::new(
            [System.Exception]::new($Rendered),
            "GetOpEdSource.$ErrorType",
            [System.Management.Automation.ErrorCategory]::InvalidData,
            $Payload)
        throw $Record
    }

    # ── Validate the pre-fetched content file ────────────────────────────────
    if (-not (Test-Path -LiteralPath $ContentPath -PathType Leaf)) {
        New-ConvertError -ErrorType 'ContentPathMissing' `
            -Goal 'Convert pre-fetched source content for op-ed generation' `
            -Problem "The content file was not found or is not readable: '$ContentPath'" `
            -NextSteps @(
                'This is an internal handoff error — the fetched bytes should have been written to a temp file before Get-OpEdSource ran',
                'Retry the op-ed source fetch, or supply material via -Topic text in New-OpEd instead'
            )
    }

    # ── Dispatch on Content-Type (authoritative; extension is advisory) ──────
    $Ct = $ContentType.ToLowerInvariant()
    if ($Ct -match 'application/pdf' -or $Ct -match '(^|[^a-z])pdf([^a-z]|$)') {
        $Format = 'pdf'; $ExtractionTool = 'ConvertFrom-Pdf'
    } elseif ($Ct -match 'wordprocessingml' -or $Ct -match 'application/msword') {
        $Format = 'docx'; $ExtractionTool = 'ConvertFrom-Docx'
    } elseif ($Ct -match 'html' -or $Ct -match 'xml' -or $Ct -match '^text/') {
        $Format = 'html'; $ExtractionTool = 'ConvertFrom-Html'
    } else {
        New-ConvertError -ErrorType 'UnsupportedContentType' `
            -Goal 'Convert pre-fetched source content for op-ed generation' `
            -Problem "Content-Type '$ContentType' is not a supported op-ed source format (expected PDF, DOCX, or HTML/text)." `
            -NextSteps @(
                'Supply a URL whose content is a PDF, DOCX, or HTML/text document',
                'Supply material via -Topic text in New-OpEd instead'
            )
    }

    Write-Verbose "Get-OpEdSource: contentType='$ContentType' format=$Format tool=$ExtractionTool"

    # ── Convert (read directly from the pre-fetched temp file) ───────────────
    $Markdown = ''
    try {
        switch ($Format) {
            'pdf'  { $Markdown = Invoke-PdfConversion -Path $ContentPath }
            'docx' { $Markdown = Invoke-DocxConversion -Path $ContentPath }
            default {
                $Html = Get-Content -LiteralPath $ContentPath -Raw -Encoding UTF8
                $Markdown = ConvertFrom-Html -Html ([string]$Html) -SourceUrl $SourceUrl
            }
        }
    } catch {
        New-ConvertError -ErrorType 'ConversionFailed' `
            -Goal "Extract readable text from the $Format source" `
            -Problem "The $ExtractionTool conversion failed: $($_.Exception.Message)" `
            -NextSteps @(
                'Install the required extraction tool (markitdown, pdftotext, or mutool for PDF; pandoc for HTML) and retry',
                'Confirm the source is a valid, non-corrupt document',
                'Supply material via -Topic text in New-OpEd instead'
            )
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
        New-ConvertError -ErrorType 'InsufficientReadableText' `
            -Goal 'Extract readable text from the op-ed source' `
            -Problem ("Source yielded only $ReadableWords readable word(s) " +
                "(alpha-token ratio $([Math]::Round($ReadableRatio, 2))). " +
                "Format detected: $Format. The content is not readable prose.") `
            -NextSteps @(
                'Install a PDF extraction tool (markitdown, pdftotext, or mutool) for PDF sources',
                'Confirm the URL points to a document with readable text content',
                'Supply material via -Topic text in New-OpEd instead, or pass -VoiceOnly to skip source grounding'
            )
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
