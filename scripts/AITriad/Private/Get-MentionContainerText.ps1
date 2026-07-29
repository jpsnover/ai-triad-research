# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# The ONE production reconstruction of a mention container's exact analyzed text
# (t/1894 indexer; recipe pinned in lib/entities/mentionTypes.ts, t/1904). Extracted so the
# cross-runtime drift-guard test (lib/entities/mentionTextFixtures.json) asserts against the
# SAME code the indexer runs — a re-implementation in the test could itself drift.
#
# Recipe: join the present, non-empty fields IN ORDER with the kind's delimiter, then NFC the
# whole string. Field omission: null/absent/empty-string ("") are omitted entirely (no empty
# segment, no doubled/hanging delimiter); a whitespace-only field is KEPT (it is the offset/
# hash basis and must never be collapsed). NFC is applied LAST to the whole reconstructed
# string — never a per-field normalize, never a whitespace-collapse. Returns "" when nothing
# remains. Dot-sourced — do NOT export.
function Get-MentionContainerText {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('node', 'sei')]
        [string]$Kind,

        # Ordered raw field values (node: label, description, plain_description; sei: claims).
        # Absent fields pass as $null. Filtering/omission happens here, not at the call site.
        [Parameter()]
        [AllowNull()]
        [AllowEmptyCollection()]
        [object[]]$Fields
    )
    Set-StrictMode -Version Latest
    $LF = [string][char]0x0A
    $delim = if ($Kind -eq 'node') { $LF + $LF } else { $LF }

    $kept = foreach ($f in @($Fields)) {
        if ($null -ne $f -and [string]$f -ne '') { [string]$f }
    }
    $joined = (@($kept) -join $delim)
    if ($joined -eq '') { return '' }
    return $joined.Normalize([System.Text.NormalizationForm]::FormC)
}
