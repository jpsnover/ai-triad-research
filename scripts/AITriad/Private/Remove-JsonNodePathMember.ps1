# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Remove-JsonNodePathMember {
    <#
    .SYNOPSIS
        Update-JsonNodePath's -Remove mode (t/3460), extracted as part of its
        t/3878 decomposition -- no behavior change. Delete the whole member at
        the final (object-key) path segment.
    .DESCRIPTION
        See Update-JsonNodePath's -Remove parameter help for the full contract
        (array-index final segment refusal, idempotency-is-strict, duplicate-key
        limitation, byte-preservation). This orchestrator composes three pieces,
        split out so none exceeds the complexity-ratchet threshold (t/3829):
        Find-JsonRemoveParentContainer (navigation), Get-JsonMemberRemovalSpan
        (final-segment validation + comma-trim span), and the splice +
        re-parse-verify kept here.
    .PARAMETER RawText
        The original raw JSON text (unmodified).
    .PARAMETER NodeId
        The node id being edited (for the re-parse-verify expected-baseline lookup
        and error messages).
    .PARAMETER Path
        The full segment-array path; the final segment is the member to remove.
    .PARAMETER PathDisplay
        Pre-rendered display form of Path (ConvertTo-JsonPathDisplay), for error
        messages.
    .PARAMETER Fail
        The caller's fail scriptblock (throws New-ActionableError and never
        returns). Closes over the caller's $pathDisplay/$NodeId for its OWN
        messages; PathDisplay/NodeId are passed here separately because this
        function also interpolates them directly into some messages.
    .PARAMETER CurStart
        Start index ('{' or '[') of the located node object's span in RawText.
    .PARAMETER CurEnd
        End index ('}' or ']') of the located node object's span in RawText.
    .PARAMETER DeferVerify
        Skip the re-parse-verify step (caller verifies a whole batch once).
    .OUTPUTS
        [string] the patched raw JSON. Throws (via Fail) on failure; never
        returns on failure.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][string]$NodeId,
        [Parameter(Mandatory)][object[]]$Path,
        [Parameter(Mandatory)][string]$PathDisplay,
        [Parameter(Mandatory)][scriptblock]$Fail,
        [Parameter(Mandatory)][int]$CurStart,
        [Parameter(Mandatory)][int]$CurEnd,
        [switch]$DeferVerify
    )

    Set-StrictMode -Version Latest

    $fail = $Fail
    $pathDisplay = $PathDisplay

    $parent = Find-JsonRemoveParentContainer -RawText $RawText -Path $Path -Fail $fail -CurStart $CurStart -CurEnd $CurEnd
    $finalSeg = $Path[$Path.Count - 1]
    $span = Get-JsonMemberRemovalSpan -RawText $RawText -FinalSeg $finalSeg -Fail $fail -ParentStart $parent.Start -ParentEnd $parent.End

    $patched = $RawText.Substring(0, $span.DelStart) + $RawText.Substring($span.DelEnd + 1)
    if ($DeferVerify) { return $patched }   # caller verifies the whole batch once

    # Re-parse-VERIFY: baseline = parsed clone with THIS key deleted at the located parent. Any
    # deviation beyond the intended member → abort, writing nothing (the safety net).
    try { $actual = $patched | ConvertFrom-Json } catch { & $fail "patched text is not valid JSON — writing nothing: $($_.Exception.Message)" @('Splice produced invalid JSON; -Remove splice bug') }
    $expected = $RawText | ConvertFrom-Json
    $expNode = @($expected.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })[0]
    $curBase = $expNode
    for ($m = 0; $m -lt $Path.Count - 1; $m++) { if ($Path[$m] -is [int]) { $curBase = $curBase[$Path[$m]] } else { $curBase = $curBase.($Path[$m]) } }
    $curBase.PSObject.Properties.Remove([string]$finalSeg)
    if (-not (Test-JsonSemanticEqual -A $expected -B $actual)) {
        & $fail "re-parse-verify FAILED: the -Remove splice changed more than the intended key '$pathDisplay' on '$NodeId' — writing nothing" `
            @('Splice bug; the guard refused a corrupting write', 'Report with the input file + node id + path')
    }
    return $patched
}
