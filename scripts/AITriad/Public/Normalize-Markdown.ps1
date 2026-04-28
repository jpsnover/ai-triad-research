# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Normalizes converted Markdown by fixing encoding artifacts and invisible characters.
.DESCRIPTION
    A single idempotent pass that cleans up issues commonly introduced by PDF
    extractors, HTML converters, and office-format tools:

    1. Unicode NFC normalization (decomposed to precomposed characters).
    2. Control character stripping (preserves newline, carriage return, tab).
    3. Zero-width / invisible character removal (ZWSP, ZWJ, ZWNJ, BOM, soft hyphen).
    4. Ligature expansion (fi, fl, ff, ffi, ffl ligatures to ASCII equivalents).
    5. Replacement character cleanup (U+FFFD runs to single space).
    6. Broken surrogate half removal.
    7. Box-drawing artifact removal (PDF table borders to space).
    8. Residual HTML entity decoding (catches entities left by pandoc/markitdown).
    9. Whitespace normalization (CRLF to LF, trailing spaces, blank line collapse).

    Called automatically during Import-AITriadDocument after conversion and before
    snapshot writing.  Can also be invoked standalone to re-normalize existing snapshots.
.PARAMETER Text
    The Markdown text to normalize.
.EXAMPLE
    $Clean = Normalize-Markdown -Text (ConvertFrom-Pdf -PdfPath doc.pdf)

    Cleans PDF-extracted Markdown before writing a snapshot.
.EXAMPLE
    $md = Get-Content snapshot.md -Raw; Normalize-Markdown -Text $md | Set-Content snapshot.md

    Re-normalizes an existing snapshot in-place.
#>
function Normalize-Markdown {
    param([Parameter(Mandatory)][string]$Text)

    # Unicode NFC normalization (e + combining accent -> precomposed e-acute)
    $Text = $Text.Normalize([System.Text.NormalizationForm]::FormC)

    # Strip control characters (keep \n \r \t)
    $Text = [regex]::Replace($Text, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '')

    # Remove zero-width / invisible characters
    $Text = [regex]::Replace($Text, "[​‌‍﻿­⁠]", '')

    # Expand common typographic ligatures (ffi/ffl before fi/fl to avoid partial matches)
    $Text = $Text.Replace([string][char]0xFB00, 'ff')
    $Text = $Text.Replace([string][char]0xFB03, 'ffi')
    $Text = $Text.Replace([string][char]0xFB04, 'ffl')
    $Text = $Text.Replace([string][char]0xFB01, 'fi')
    $Text = $Text.Replace([string][char]0xFB02, 'fl')

    # Replace U+FFFD runs (irrecoverable encoding losses) with single space
    $Text = [regex]::Replace($Text, '�+', ' ')

    # Strip broken surrogate halves
    $Text = [regex]::Replace($Text, '[\uD800-\uDFFF]', '')

    # Replace box-drawing characters (PDF layout artifacts) with space
    $Text = [regex]::Replace($Text, "[─-╿⌐]", ' ')

    # Decode residual HTML entities (from pandoc/markitdown paths)
    $Text = [System.Net.WebUtility]::HtmlDecode($Text)

    # Normalize whitespace
    $Text = $Text -replace '\r\n', "`n"
    $Text = [regex]::Replace($Text, ' {2,}', ' ')
    $Text = [regex]::Replace($Text, '(?m)[ \t]+$', '')
    $Text = [regex]::Replace($Text, '\n{3,}', "`n`n")

    return $Text.Trim()
}
