# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Generates a URL-safe slug from arbitrary text.
.DESCRIPTION
    Transforms a title or phrase into a lowercase, hyphen-separated slug suitable
    for use as a document ID or directory name.  Processing steps:

    1. Unicode normalization — decomposes accented characters to base + mark,
       then strips non-spacing marks (e.g., 'café' → 'cafe').
    2. Lowercasing and punctuation removal.
    3. Whitespace/underscore collapsing to single hyphens.
    4. Stop-word removal (the, a, an, and, of, in, to, for, with, on, at).
    5. Length truncation at a word boundary (default 60 chars).
    6. Fallback to 'document-<timestamp>' if the result is empty.
.PARAMETER Text
    The input text to slugify (typically a document title).
.PARAMETER MaxLength
    Maximum length of the output slug.  Truncation happens at the last hyphen
    before the limit to avoid splitting words.  Defaults to 60.
.EXAMPLE
    New-Slug -Text 'The Future of AI Governance: A Framework for 2026'
    # Returns: 'future-ai-governance-framework-2026'

.EXAMPLE
    New-Slug -Text 'Très Long Document Title With Many Words' -MaxLength 30
    # Returns: 'tres-long-document-title' (truncated at word boundary)

.EXAMPLE
    New-Slug -Text '!!!'
    # Returns: 'document-20260402-143022' (fallback for empty result)
#>
function New-Slug {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Text,
        [int]$MaxLength = 60
    )

    # Normalise Unicode -> ASCII approximation where possible
    $Normalized = $Text.Normalize([System.Text.NormalizationForm]::FormD)
    $AsciiOnly  = [System.Text.StringBuilder]::new()
    foreach ($c in $Normalized.ToCharArray()) {
        $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($c)
        if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$AsciiOnly.Append($c)
        }
    }

    $Slug = $AsciiOnly.ToString().ToLower()
    $Slug = [regex]::Replace($Slug, '[^\w\s\-]', '')   # keep word chars, spaces, hyphens
    $Slug = [regex]::Replace($Slug, '[\s_]+', '-')     # collapse whitespace to hyphens
    $Slug = $Slug.Trim('-')

    # Remove common stop-words that pad slugs without adding meaning
    $StopWords = @('\bthe\b', '\ba\b', '\ban\b', '\band\b', '\bof\b', '\bin\b',
                   '\bto\b', '\bfor\b', '\bwith\b', '\bon\b', '\bat\b')
    foreach ($sw in $StopWords) {
        $Slug = [regex]::Replace($Slug, $sw, '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    $Slug = [regex]::Replace($Slug, '-{2,}', '-').Trim('-')

    if ($Slug.Length -gt $MaxLength) {
        # Cut at last hyphen before limit so we don't split a word mid-stream
        $Slug = $Slug.Substring(0, $MaxLength)
        $lastHyphen = $Slug.LastIndexOf('-')
        if ($lastHyphen -gt 10) { $Slug = $Slug.Substring(0, $lastHyphen) }
    }

    if ([string]::IsNullOrWhiteSpace($Slug)) {
        $Slug = 'document-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    }
    return $Slug
}
