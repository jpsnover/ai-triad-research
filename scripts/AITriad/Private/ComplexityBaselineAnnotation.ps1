# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3877: small PURE helpers for the optional `justifiedRaise` annotation a TL-authorized
# complexity-ratchet exemption carries IN the baseline file (t/3874#2/p/360#496). Extracted out
# of Update-ComplexityBaseline's own body -- adding this handling inline pushed that function's
# OWN complexity over its baseline (a meta-regression caught while fixing t/3877's regressions).
# Neither helper is read by Get-ComplexityBudgetVerdict (max/countOver only), so this annotation
# can never affect ratchet behavior -- it only prevents an exemption being silently dropped
# across regeneration.

function ConvertFrom-ComplexityBaselineEntry {
    <#
    .SYNOPSIS
        PURE. Parses one raw baseline JSON property value into the {max;countOver;justifiedRaise?}
        hashtable shape the generator and enforcer both build on read.
    .PARAMETER Value
        The JSON property's .Value (a PSCustomObject with .max/.countOver and optionally
        .justifiedRaise).
    .OUTPUTS
        [hashtable] with max/countOver always present, justifiedRaise only when the source had it.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        $Value
    )
    $entry = @{ max = [int]$Value.max; countOver = [int]$Value.countOver }
    if ($Value.PSObject.Properties['justifiedRaise']) { $entry['justifiedRaise'] = $Value.justifiedRaise }
    return $entry
}

function Copy-ComplexityBaselineAnnotation {
    <#
    .SYNOPSIS
        PURE. Forwards an existing entry's justifiedRaise annotation onto a newly-built output
        entry, if present. No-op otherwise.
    .PARAMETER Existing
        The baseline entry being carried forward from (read side).
    .PARAMETER Output
        The entry about to be written (mutated in place AND returned, for convenience at the
        call site).
    .OUTPUTS
        The same $Output reference, for chaining. Untyped (not [hashtable]): the caller's
        $Output may be a plain Hashtable OR an OrderedDictionary (Update-ComplexityBaseline
        builds entries both ways) -- both support .Keys and the indexer, which is all this
        needs, and OrderedDictionary doesn't coerce to [hashtable] (no Clone(), either --
        .NET Core's OrderedDictionary dropped its ICloneable implementation).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        $Existing,

        [Parameter(Mandatory)]
        $Output
    )
    if ($Existing.Keys -contains 'justifiedRaise') {
        $Output['justifiedRaise'] = $Existing['justifiedRaise']
    }
    return $Output
}
