# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-JsonAdjacentCommaSpan {
    <#
    .SYNOPSIS
        Get-JsonMemberRemovalSpan sub-helper (t/3878 decomposition, extracted
        verbatim): extend a member's [KeyStart..ValueEnd] span to absorb EXACTLY
        ONE adjacent comma.
    .DESCRIPTION
        Prefer the trailing comma (member not last); else absorb the leading
        comma (member is last, has predecessors); else no comma (only member ->
        object collapses to a valid `{}`, t/3460#2 Q2). When absorbing the
        trailing comma, also absorbs the preceding newline+indent so no orphan
        blank line is left.
    .PARAMETER RawText
        The raw JSON text.
    .PARAMETER Member
        The Find-JsonMemberSpan result for the member being removed
        (KeyStart/ValueEnd).
    .PARAMETER ParentStart
        Start index of the parent container's span ('{').
    .PARAMETER ParentEnd
        End index of the parent container's span ('}').
    .OUTPUTS
        [PSCustomObject] { DelStart; DelEnd } -- the final deletion span.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)]$Member,
        [Parameter(Mandatory)][int]$ParentStart,
        [Parameter(Mandatory)][int]$ParentEnd
    )

    Set-StrictMode -Version Latest

    $delStart = $Member.KeyStart
    $delEnd   = $Member.ValueEnd
    $t = $Member.ValueEnd + 1
    while ($t -lt $ParentEnd -and [char]::IsWhiteSpace($RawText[$t])) { $t++ }
    if ($t -lt $ParentEnd -and $RawText[$t] -eq ',') {
        $delEnd = $t   # include the trailing comma
        # Absorb the preceding newline+indent so no orphan blank line is left (symmetric with
        # the leading-comma branch below).
        $delStart = Get-JsonTrailingCommaBackIndent -RawText $RawText -DelStart $delStart -ParentStart $ParentStart
    }
    else {
        $p = $Member.KeyStart - 1
        while ($p -gt $ParentStart -and [char]::IsWhiteSpace($RawText[$p])) { $p-- }
        if ($p -gt $ParentStart -and $RawText[$p] -eq ',') { $delStart = $p }   # include the leading comma
    }

    return [PSCustomObject]@{ DelStart = $delStart; DelEnd = $delEnd }
}
