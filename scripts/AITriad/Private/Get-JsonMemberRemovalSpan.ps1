# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-JsonMemberRemovalSpan {
    <#
    .SYNOPSIS
        Remove-JsonNodePathMember sub-helper (t/3878 decomposition, extracted
        verbatim): validate the final segment and compute the exact byte span to
        delete, including at most one adjacent comma.
    .DESCRIPTION
        The final segment MUST be an object key (an array-index final segment
        reflows sibling indices -> refuses fail-closed, t/3460#2 Q1). The
        comma-trim calculation itself is Get-JsonAdjacentCommaSpan (split out,
        complexity-ratchet, t/3829).
    .PARAMETER RawText
        The raw JSON text.
    .PARAMETER FinalSeg
        The final path segment (must be a string key, not an int).
    .PARAMETER Fail
        The caller's fail scriptblock.
    .PARAMETER ParentStart
        Start index of the parent container's span ('{').
    .PARAMETER ParentEnd
        End index of the parent container's span ('}').
    .OUTPUTS
        [PSCustomObject] { DelStart; DelEnd; Member } -- Member is the raw
        Find-JsonMemberSpan result (KeyStart/ValueEnd), needed by the caller to
        rebuild the re-parse-verify expected baseline.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)]$FinalSeg,
        [Parameter(Mandatory)][scriptblock]$Fail,
        [Parameter(Mandatory)][int]$ParentStart,
        [Parameter(Mandatory)][int]$ParentEnd
    )

    Set-StrictMode -Version Latest
    $fail = $Fail

    if ($FinalSeg -is [int]) {
        & $fail "cannot -Remove an array element [$FinalSeg]: element removal reflows sibling indices (would orphan addressing)" `
            @('Removal targets object keys only; array indices are navigation-only segments')
    }
    if ($RawText[$ParentStart] -ne '{') {
        & $fail "segment '$FinalSeg' expects an object but the container at that level is not an object" @('Check the path matches the document shape')
    }
    $member = Find-JsonMemberSpan -Text $RawText -ObjStart $ParentStart -ObjEnd $ParentEnd -Key ([string]$FinalSeg)
    if ($null -eq $member) {
        & $fail "key '$FinalSeg' not found at this level (path-not-found) — nothing removed" `
            @('Verify the key exists; -Remove refuses fail-closed on an absent key (re-derive the worklist to carriers before retry)')
    }

    $commaSpan = Get-JsonAdjacentCommaSpan -RawText $RawText -Member $member -ParentStart $ParentStart -ParentEnd $ParentEnd
    return [PSCustomObject]@{ DelStart = $commaSpan.DelStart; DelEnd = $commaSpan.DelEnd; Member = $member }
}
