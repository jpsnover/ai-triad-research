# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3877: small helpers for the optional `justifiedRaise` annotation a TL-authorized
# complexity-ratchet exemption carries IN the baseline file (t/3874#2/p/360#496). Extracted out
# of Update-ComplexityBaseline's own body -- adding this handling inline pushed that function's
# OWN complexity over its baseline (a meta-regression caught while fixing t/3877's regressions).
# Neither helper is read by Get-ComplexityBudgetVerdict (max/countOver only), so this annotation
# can never affect ratchet behavior -- it only prevents an exemption being silently dropped
# across regeneration, and (Copy-ComplexityBaselineAnnotation) auto-lapses it once the file no
# longer needs it (TL's p/360#498 follow-up: without this, the justification would outlive its
# own reason -- it would keep being forwarded forever even after t/3878/t/3879 bring the
# decomposed file's complexity back down, with nothing to end it).

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
        Forwards an existing entry's justifiedRaise annotation onto a newly-built output entry,
        UNLESS it has lapsed (t/3877, TL's p/360#498 follow-up).
    .DESCRIPTION
        A justifiedRaise records `preRaiseMax` -- the file's max complexity BEFORE it was
        raised. If $Output's max has returned to at or below that value (the decomposition
        ticket succeeded, or the file was rewritten some other way), the reason for the raise
        no longer holds: WITHOUT this check, the annotation would be forwarded forever by the
        no-op-regen path above, outliving its own justification with nothing to end it. On
        lapse: drop the annotation (judge the file on its own merits from here on) and
        Write-Warning so the lapse is visible, not silent.

        A justifiedRaise with no `preRaiseMax` (e.g. hand-authored without it) is forwarded
        unconditionally -- there's nothing to compare against, so it never auto-lapses; that
        matches the pre-this-change behavior for such an entry.
    .PARAMETER Existing
        The baseline entry being carried forward from (read side).
    .PARAMETER Output
        The entry about to be written (mutated in place AND returned, for convenience at the
        call site). Its 'max' key is read to decide lapse.
    .PARAMETER File
        The baseline key, for the lapse warning only.
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
        $Output,

        [Parameter(Mandatory)]
        [string]$File
    )
    if ($Existing.Keys -contains 'justifiedRaise') {
        $raise = $Existing['justifiedRaise']
        $hasPreRaiseMax = $raise.PSObject.Properties['preRaiseMax']
        $lapsed = $hasPreRaiseMax -and ([int]$Output['max'] -le [int]$raise.preRaiseMax)
        if ($lapsed) {
            Write-Warning "Update-ComplexityBaseline: '$File' justifiedRaise LAPSED -- regenerated at max=$($Output['max']), at or below its pre-raise value ($($raise.preRaiseMax)). Dropping the exemption; judged on its own merits from here on."
        } else {
            $Output['justifiedRaise'] = $raise
        }
    }
    return $Output
}
