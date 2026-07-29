# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Name-normalization parity contract (t/1894#3, Main-TL condition t/1896#2 cond.1).
# MUST stay byte-for-byte identical to D1's normalizeName() in lib/entities/nameResolver.ts:
# B (this indexer) and D1 (query-time resolver) have to normalize the same way, or a name
# B indexes won't match what D1 resolves and mentions silently fail to link.
#
# Exact rule, in order — apply to BOTH sides of every comparison (surface token AND alias):
#   1. Unicode NFC
#   2. ToLowerInvariant (locale-independent; == JS toLowerCase for Latin script)
#   3. Collapse each maximal run of the PINNED whitespace set to a single U+0020:
#      {U+0009 TAB, U+000A LF, U+000B VT, U+000C FF, U+000D CR, U+0020 SPACE, U+00A0 NBSP}.
#      Pinned explicitly — do NOT use \s / \p{White_Space}; the PS and JS engines differ at
#      the edges.
#   4. Trim.
# Then compare with exact string equality. NO stemming, NO diacritic/accent folding, NO
# punctuation stripping (widening breaks §5 refusal discipline). Dot-sourced — do NOT export.

# The pinned whitespace code points, as an explicit numeric set. The regex character class
# is built from these so source never embeds literal control chars (which corrupt silently).
# Exposed module-scoped so the indexer's in-text separator pattern references the SAME set.
$script:PinnedWhitespaceCodes = @(0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0)
$script:PinnedWhitespaceClass = '[' + ( ($script:PinnedWhitespaceCodes | ForEach-Object { '\u{0:X4}' -f $_ }) -join '' ) + ']'

function Get-NormalizedName {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Name
    )
    Set-StrictMode -Version Latest
    $s = $Name.Normalize([System.Text.NormalizationForm]::FormC).ToLowerInvariant()
    $s = [regex]::Replace($s, "$script:PinnedWhitespaceClass+", ' ')
    return $s.Trim()
}
