# Generates a URL-safe slug from arbitrary text.

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

    if ([string]::IsNullOrWhiteSpace($Slug)) { $Slug = 'document' }
    return $Slug
}
