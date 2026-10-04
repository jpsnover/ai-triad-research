# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-JsonNodePathContainer {
    <#
    .SYNOPSIS
        Update-JsonNodePath's -Upsert INSERT path (t/3438), extracted as part of
        its t/3878 decomposition -- no behavior change. Create Path[K..last] as
        nested OBJECT containers wrapping the scalar leaf, spliced into the
        current object.
    .DESCRIPTION
        Called when segment K is a missing key and -Upsert is set. Remaining
        segments (K+1..last) MUST be string keys -- a remaining array index
        fails closed (container-key create is object-only, TL cond 1). This is
        a terminal action: it always returns the patched text or throws via
        Fail; it never signals "continue" back to the caller's loop.
    .PARAMETER RawText
        The original raw JSON text.
    .PARAMETER NodeId
        The node id being edited (for the re-parse-verify expected baseline).
    .PARAMETER Path
        The full segment-array path.
    .PARAMETER PathDisplay
        Pre-rendered display form of Path, for error messages.
    .PARAMETER K
        Index into Path of the missing segment that triggered the insert.
    .PARAMETER Seg
        Path[K] (the missing key at this level).
    .PARAMETER Value
        The scalar leaf value.
    .PARAMETER Fail
        The caller's fail scriptblock.
    .PARAMETER CurStart
        Start index ('{' ) of the object this member is spliced into.
    .PARAMETER CurEnd
        End index ('}') of that object.
    .PARAMETER DeferVerify
        Skip the re-parse-verify step (caller verifies a whole batch once).
    .OUTPUTS
        [string] the patched raw JSON. Throws (via Fail) on failure.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][string]$NodeId,
        [Parameter(Mandatory)][object[]]$Path,
        [Parameter(Mandatory)][string]$PathDisplay,
        [Parameter(Mandatory)][int]$K,
        [Parameter(Mandatory)]$Seg,
        [AllowNull()]$Value,
        [Parameter(Mandatory)][scriptblock]$Fail,
        [Parameter(Mandatory)][int]$CurStart,
        [Parameter(Mandatory)][int]$CurEnd,
        [switch]$DeferVerify
    )

    Set-StrictMode -Version Latest
    $fail = $Fail
    $pathDisplay = $PathDisplay

    for ($m = $K; $m -lt $Path.Count; $m++) {
        if ($Path[$m] -is [int]) { & $fail "cannot -Upsert: remaining segment [$($Path[$m])] is an array index; container-key create is object-only" @('Insert only creates missing OBJECT containers + the scalar leaf') }
    }
    # Member value = remaining segments after K nested around the leaf.
    $insVal = $Value
    for ($m = $Path.Count - 1; $m -gt $K; $m--) { $insVal = [ordered]@{ ([string]$Path[$m]) = $insVal } }
    $memberJson = ([ordered]@{ ([string]$Seg) = $insVal } | ConvertTo-Json -Depth 100 -Compress)
    $memberText = $memberJson.Substring(1, $memberJson.Length - 2)   # strip the outer { }
    # Splice into the current object: empty {} → no comma; non-empty → prepend member + comma.
    $inner = $RawText.Substring($CurStart + 1, $CurEnd - $CurStart - 1)
    if ([string]::IsNullOrWhiteSpace($inner)) {
        $patched = $RawText.Substring(0, $CurStart + 1) + $memberText + $RawText.Substring($CurEnd)
    }
    else {
        $patched = $RawText.Substring(0, $CurStart + 1) + $memberText + ',' + $RawText.Substring($CurStart + 1)
    }
    if ($DeferVerify) { return $patched }   # caller verifies the whole batch once
    # Re-parse-VERIFY with an expected baseline that creates the SAME structure (safety net).
    try { $actual = $patched | ConvertFrom-Json } catch { & $fail "patched text is not valid JSON — writing nothing: $($_.Exception.Message)" @('Splice produced invalid JSON; -Upsert insert bug') }
    $expected = $RawText | ConvertFrom-Json
    $expNode = @($expected.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })[0]
    $curBase = $expNode
    for ($m = 0; $m -lt $K; $m++) { if ($Path[$m] -is [int]) { $curBase = $curBase[$Path[$m]] } else { $curBase = $curBase.($Path[$m]) } }
    $bv = $Value
    for ($m = $Path.Count - 1; $m -gt $K; $m--) { $bv = [pscustomobject]@{ ([string]$Path[$m]) = $bv } }
    $curBase | Add-Member -NotePropertyName ([string]$Seg) -NotePropertyValue $bv -Force
    if (-not (Test-JsonSemanticEqual -A $expected -B $actual)) {
        & $fail "re-parse-verify FAILED: the -Upsert splice changed more than the intended path '$pathDisplay' on '$NodeId' — writing nothing" @('Splice bug; the guard refused a corrupting write')
    }
    return $patched
}
