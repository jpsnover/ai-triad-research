# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Nested-path surgical JSON writer (t/2921, TL ruling t/2921#2) ──────────────
# Sibling to Update-JsonNodeField (t/2916). Where that writer edits a depth-1 scalar
# field (and can INSERT an absent key), this one does IN-PLACE SCALAR REPLACEMENT at a
# NESTED path addressed as a segment array: object keys (string) and array indices (int),
# anchored on the stable node id. Same guarantees: parse-LOCATE (recursive, span-scoped) +
# minimal-SPLICE + re-parse-VERIFY invariant. Every untouched byte is preserved, so a write
# cannot sweep concurrent WIP elsewhere (the sit-477 class), regardless of tree state.
#
# SCOPE (t/2921#2 Q2, in-place-only): replaces an EXISTING scalar value at the path.
# NOT supported (safe-throw, writes nothing): path-not-found (no insert-at-depth), an
# object/array-valued target, or structural add/remove. The re-parse-verify backstops any
# locate error — a bad splice degrades to a safe abort, never a corrupt write.
#
# Addressing is a SEGMENT ARRAY, never a dotted string (t/2921#2 Q1): a dotted parser breaks
# on keys containing '.'/'['/']'. Segment type distinguishes key (string) vs index (int)
# with zero ambiguity and is trivially lockstep with the Python mirror. A dotted/bracket
# form is rendered for ERROR/LOG display only — never parsed.
#
# Shared internals (Find-JsonObjectSpan, Get-JsonValueSpan, Find-JsonMemberValueStart,
# Find-JsonArrayElementStart, Test-JsonSemanticEqual) live in Private/JsonSurgeryCore.ps1.

function ConvertTo-JsonPathDisplay {
    # Human-readable rendering of a segment-array path for error/log messages ONLY.
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Path)
    $s = ''
    foreach ($seg in $Path) {
        if ($seg -is [int]) { $s += "[$seg]" }
        else { if ($s.Length -gt 0) { $s += '.' }; $s += [string]$seg }
    }
    return $s
}

function Set-JsonValueAtPath {
    # Navigate a ConvertFrom-Json clone by the segment path and set the final scalar — used
    # ONLY to build the re-parse-verify EXPECTED baseline (never touches the file). Assumes
    # the path was already located in the raw text, so every segment resolves.
    param(
        [Parameter(Mandatory)]$Root,
        [Parameter(Mandatory)][object[]]$Path,
        [Parameter(Mandatory)][AllowNull()]$Value,
        [Parameter(Mandatory)][scriptblock]$Fail
    )
    $cur = $Root
    for ($k = 0; $k -lt $Path.Count - 1; $k++) {
        $seg = $Path[$k]
        if ($seg -is [int]) { $cur = $cur[$seg] }
        else { $cur = $cur.$seg }
        if ($null -eq $cur) { & $Fail "verify baseline could not descend segment '$seg'" @('internal: path/parse mismatch') }
    }
    $last = $Path[$Path.Count - 1]
    if ($last -is [int]) { $cur[$last] = $Value }
    elseif ($cur.PSObject.Properties[$last]) { $cur.$last = $Value }
    else { & $Fail "verify baseline expected key '$last' present" @('internal: path/parse mismatch') }
}

function Update-JsonNodePath {
    <#
    .SYNOPSIS
        In-place surgical replacement of ONE scalar value at a NESTED path on ONE nodes[]
        entry (t/2921). Byte-preserving everywhere except the target value; re-parse-verified.
    .PARAMETER Path
        Segment array addressing the value relative to the node: object keys (string) and
        array indices (int), e.g. @('graph_attributes','policy_actions',2,'framing').
    .OUTPUTS
        [string] the patched raw JSON. Throws New-ActionableError (writes nothing) on:
        invalid JSON, node/path not found, an object/array-valued target (scalar-only), or a
        re-parse-verify mismatch (any change beyond the intended value).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][string]$NodeId,
        [Parameter(Mandatory)][object[]]$Path,
        [Parameter(Mandatory)][AllowNull()]$Value
    )
    Set-StrictMode -Version Latest

    $pathDisplay = ConvertTo-JsonPathDisplay -Path $Path
    $fail = {
        param($problem, $steps)
        throw (New-ActionableError -Goal "Nested surgical update of '$pathDisplay' on node '$NodeId'" `
            -Problem $problem -Location 'Update-JsonNodePath' -NextSteps $steps -PassThru)
    }

    if (@($Path).Count -eq 0) { & $fail 'Path is empty' @('Provide at least one path segment') }

    # --- Parse (locate + verification baseline) ---
    try { $original = $RawText | ConvertFrom-Json } catch { & $fail "Input is not valid JSON: $($_.Exception.Message)" @('Pass well-formed JSON text') }
    if (-not $original.PSObject.Properties['nodes']) { & $fail 'No nodes[] array in the JSON' @('Expected a top-level nodes[] array') }
    $match = @($original.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })
    if ($match.Count -eq 0) { & $fail "Node id '$NodeId' not found in nodes[]" @('Verify the node id exists in the file') }

    # --- Locate the node object span, then descend the path to the target value span ---
    $idToken = [regex]::Match($RawText, '"id"\s*:\s*"' + [regex]::Escape($NodeId) + '"')
    if (-not $idToken.Success) { & $fail "id token for '$NodeId' not found in raw text" @('File text may not match the parsed structure') }
    $nodeSpan = Find-JsonObjectSpan -Text $RawText -InnerIndex $idToken.Index
    if ($null -eq $nodeSpan) { & $fail "could not locate the enclosing object span for '$NodeId'" @('Check the JSON is well-formed') }

    $curStart = $nodeSpan.Start   # index of the current container's opening '{' or '['
    $curEnd   = $nodeSpan.End
    for ($k = 0; $k -lt $Path.Count; $k++) {
        $seg = $Path[$k]
        $curChar = $RawText[$curStart]
        if ($seg -is [int]) {
            if ($curChar -ne '[') { & $fail "segment [$seg] expects an array but the container at that level is not an array" @('Check the path matches the document shape') }
            $vStart = Find-JsonArrayElementStart -Text $RawText -ArrStart $curStart -ArrEnd $curEnd -Index $seg
            if ($vStart -lt 0) { & $fail "array index [$seg] is out of range (path-not-found)" @('Verify the index exists; no insert-at-depth in this phase (t/2921 Q2)') }
        }
        else {
            if ($curChar -ne '{') { & $fail "segment '$seg' expects an object but the container at that level is not an object" @('Check the path matches the document shape') }
            $vStart = Find-JsonMemberValueStart -Text $RawText -ObjStart $curStart -ObjEnd $curEnd -Key ([string]$seg)
            if ($vStart -lt 0) { & $fail "key '$seg' not found at this level (path-not-found)" @('Verify the key exists; no insert-at-depth in this phase (t/2921 Q2)') }
        }
        $vSpan = Get-JsonValueSpan -Text $RawText -Start $vStart
        if ($null -eq $vSpan) { & $fail "could not span-scan the value at segment '$seg'" @('Report with the input file + path') }
        $curStart = $vSpan.Start; $curEnd = $vSpan.End
    }

    # --- Target must be a SCALAR (in-place scalar replacement only, t/2921 Q2) ---
    $targetChar = $RawText[$curStart]
    if ($targetChar -eq '{' -or $targetChar -eq '[') {
        & $fail "target at '$pathDisplay' is an object/array; only in-place scalar replacement is supported" `
            @('Object/array-valued replacement is out of scope (t/2921 Q2)')
    }

    # --- Splice the target value span ---
    $encoded = $Value | ConvertTo-Json -Depth 100 -Compress
    $patched = $RawText.Substring(0, $curStart) + $encoded + $RawText.Substring($curEnd + 1)

    # --- Re-parse-VERIFY invariant (the safety net) ---
    try { $actual = $patched | ConvertFrom-Json } catch { & $fail "patched text is not valid JSON — writing nothing: $($_.Exception.Message)" @('Splice produced invalid JSON; this is a bug in Update-JsonNodePath') }
    $expected = $RawText | ConvertFrom-Json
    $expNode = @($expected.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })[0]
    Set-JsonValueAtPath -Root $expNode -Path $Path -Value $Value -Fail $fail
    if (-not (Test-JsonSemanticEqual -A $expected -B $actual)) {
        & $fail "re-parse-verify FAILED: the splice changed more than the intended value at '$pathDisplay' on '$NodeId' — writing nothing" `
            @('This is a splice bug; the guard refused a corrupting write', 'Report with the input file + node id + path')
    }
    return $patched
}
