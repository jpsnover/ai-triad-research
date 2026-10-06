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
        Surgical edit of ONE value at a NESTED path on ONE nodes[] entry (t/2921). Three modes:
        in-place scalar REPLACE (default), -Upsert (create scalar leaf + missing object containers,
        t/3438), and -Remove (delete the whole member, t/3460). Byte-preserving everywhere except the
        target; re-parse-verified — a splice that changes anything else aborts, writing nothing.
    .PARAMETER Path
        Segment array addressing the value relative to the node: object keys (string) and
        array indices (int), e.g. @('graph_attributes','policy_actions',2,'framing').
    .PARAMETER Value
        The scalar to write (REPLACE/-Upsert). Omit under -Remove (passing a Value with -Remove is
        ambiguous and REFUSES fail-closed).
    .PARAMETER Upsert
        Create the scalar leaf (and any missing OBJECT container along the path) instead of failing
        path-not-found. Container-key create ONLY; a missing/out-of-range array index still fails closed.
    .PARAMETER Remove
        Delete the member at the final path segment (t/3460). The final segment MUST be an object key —
        removing an array element would reflow sibling indices, so an array-index final segment REFUSES
        fail-closed (indices stay navigation-only). Unlike REPLACE/-Upsert (scalar-only), -Remove deletes
        the whole member regardless of value type (scalar OR object/array). Removing an object's last
        member leaves a valid empty object `{}`. Mutually exclusive with -Upsert.

        IDEMPOTENCY: -Remove is STRICT — an absent final key REFUSES fail-closed (it does not no-op). A
        batch/runner that may retry MUST re-derive its worklist from current state (only nodes still
        carrying the key) before each attempt; an absent-key refusal then genuinely signals a worklist
        bug, not a benign retry (t/3460#3, TL ruling).

        LIMITATION: duplicate sibling keys are OUTSIDE the verify contract — JSON objects are assumed to
        have unique keys (ConvertFrom-Json keeps one; the splice removes the first textual occurrence).
    .OUTPUTS
        [string] the patched raw JSON. Throws New-ActionableError (writes nothing) on:
        invalid JSON, node/path not found, an object/array-valued target (REPLACE/-Upsert scalar-only),
        an array-index final segment under -Remove, -Remove+-Upsert together, -Remove carrying a Value,
        or a re-parse-verify mismatch (any change beyond the intended edit).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][string]$NodeId,
        [Parameter(Mandatory)][object[]]$Path,
        # Non-mandatory so -Remove can omit it; REPLACE/-Upsert still require it (guarded below).
        [AllowNull()]$Value = $null,
        # t/3438: create the scalar leaf (and any missing OBJECT container along the path) instead of
        # failing path-not-found. Explicit opt-in (TL cond 1): container-key create ONLY — a missing or
        # out-of-range array-index segment still fails closed. Default OFF keeps the proven replace-only
        # behavior byte-identical (regression arm).
        [switch]$Upsert,
        # t/3460: delete the whole member at the final (object-key) segment. See .PARAMETER Remove.
        [switch]$Remove,
        # t/3969: opt-in widening of t/2921 Q2's scalar-only scope to a FLAT array of scalars (e.g.
        # pov_tags). Default OFF keeps the proven scalar-only behavior byte-identical (regression arm) —
        # an array Value without -ArrayValue is now rejected fail-closed up front (see guard below)
        # instead of falling through to the scalar-splice code unprotected.
        [switch]$ArrayValue,
        # Skip the per-call parse + re-parse-verify. ONLY for Save-JsonNodeFieldEdits, which
        # verifies the whole chained batch once against the fresh read (and replays with
        # per-call verify on mismatch). Never use it without a batch verify behind it.
        [switch]$DeferVerify
    )
    Set-StrictMode -Version Latest

    $pathDisplay = ConvertTo-JsonPathDisplay -Path $Path
    $fail = {
        param($problem, $steps)
        throw (New-ActionableError -Goal "Nested surgical update of '$pathDisplay' on node '$NodeId'" `
            -Problem $problem -Location 'Update-JsonNodePath' -NextSteps $steps -PassThru)
    }

    # t/3969: true iff every element of $v is itself a scalar (no nested object/array) — the only
    # array shape -ArrayValue permits. Not a pipe (`$v | Where-Object` would unroll a 1-element
    # array into the hazard it's meant to catch) — a plain foreach loop instead.
    $isFlatScalarArray = {
        param($v)
        if ($v -isnot [System.Collections.IEnumerable] -or $v -is [string]) { return $false }
        foreach ($el in $v) {
            if ($el -is [System.Collections.IDictionary] -or $el -is [System.Management.Automation.PSCustomObject] -or
                ($el -is [System.Collections.IEnumerable] -and $el -isnot [string])) { return $false }
        }
        return $true
    }

    if (@($Path).Count -eq 0) { & $fail 'Path is empty' @('Provide at least one path segment') }

    # --- Mode guards (t/3460) -------------------------------------------------
    if ($Remove -and $Upsert) {
        & $fail '-Remove and -Upsert are mutually exclusive' @('Pick exactly one mode: replace (default), -Upsert, or -Remove')
    }
    if ($Remove -and $ArrayValue) {
        & $fail '-Remove and -ArrayValue are mutually exclusive' @('-Remove deletes the member; -ArrayValue only shapes a written Value')
    }
    if ($Remove -and $PSBoundParameters.ContainsKey('Value')) {
        & $fail '-Remove must not carry a Value (ambiguous intent)' @('Call -Remove with NodeId + Path only')
    }
    if (-not $Remove -and -not $PSBoundParameters.ContainsKey('Value')) {
        & $fail 'Value is required for replace/-Upsert' @('Pass -Value, or use -Remove to delete the member')
    }

    # t/3969: an array/collection Value with NO -ArrayValue opt-in is rejected fail-closed here,
    # rather than falling through to the scalar-only guards below (which, pre-t/3969, would have let
    # it reach the encode line unprotected). Keeps the scalar-only default regression arm explicit.
    if (-not $Remove -and -not $ArrayValue -and $null -ne $Value -and
        $Value -is [System.Collections.IEnumerable] -and $Value -isnot [string] -and
        $Value -isnot [System.Collections.IDictionary]) {
        & $fail 'Value is an array/collection but -ArrayValue was not passed' @('Pass -ArrayValue to write an array leaf, or pass a scalar')
    }
    if ($ArrayValue -and $null -ne $Value -and -not (& $isFlatScalarArray $Value)) {
        & $fail '-ArrayValue requires a FLAT array of scalars (no nested object/array elements)' @('Flatten the array, or write nested structures through a different path')
    }

    # Under -Upsert the (possibly-inserted) leaf must be a SCALAR, or — with -ArrayValue — a flat
    # array of scalars. Created intermediates are always objects regardless of mode.
    if ($Upsert -and -not $ArrayValue -and $null -ne $Value -and (
            $Value -is [System.Collections.IDictionary] -or
            ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) -or
            $Value -is [System.Management.Automation.PSCustomObject])) {
        & $fail 'Upsert leaf value must be a scalar (string/number/bool/null)' @('Pass -ArrayValue for a flat array leaf, or pass a scalar')
    }

    # --- Parse (locate + verification baseline) ---
    if (-not $DeferVerify) {
        try { $original = $RawText | ConvertFrom-Json } catch { & $fail "Input is not valid JSON: $($_.Exception.Message)" @('Pass well-formed JSON text') }
        if (-not $original.PSObject.Properties['nodes']) { & $fail 'No nodes[] array in the JSON' @('Expected a top-level nodes[] array') }
        $match = @($original.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })
        if ($match.Count -eq 0) { & $fail "Node id '$NodeId' not found in nodes[]" @('Verify the node id exists in the file') }
    }

    # --- Locate the node object span, then descend the path to the target value span ---
    $idIndex = Find-JsonIdTokenIndex -Text $RawText -NodeId $NodeId
    if ($idIndex -lt 0) { & $fail "id token for '$NodeId' not found in raw text" @('File text may not match the parsed structure') }
    $nodeSpan = Find-JsonObjectSpan -Text $RawText -InnerIndex $idIndex
    if ($null -eq $nodeSpan) { & $fail "could not locate the enclosing object span for '$NodeId'" @('Check the JSON is well-formed') }

    $curStart = $nodeSpan.Start   # index of the current container's opening '{' or '['
    $curEnd   = $nodeSpan.End

    # ── REMOVE mode (t/3460): delete the whole member at the final object-key segment ──────────────
    # t/3878 decomposition: Remove-JsonNodePathMember (extracted verbatim, no behavior change).
    if ($Remove) {
        return Remove-JsonNodePathMember -RawText $RawText -NodeId $NodeId -Path $Path -PathDisplay $pathDisplay `
            -Fail $fail -CurStart $curStart -CurEnd $curEnd -DeferVerify:$DeferVerify
    }

    # t/3878 decomposition: Resolve-JsonNodePathTarget (extracted verbatim, no behavior change).
    $target = Resolve-JsonNodePathTarget -RawText $RawText -NodeId $NodeId -Path $Path -PathDisplay $pathDisplay `
        -Value $Value -Upsert:$Upsert -Fail $fail -CurStart $curStart -CurEnd $curEnd -DeferVerify:$DeferVerify
    if ($target.Handled) { return $target.Patched }
    $curStart = $target.Start; $curEnd = $target.End

    # --- Target must be a SCALAR (t/2921 Q2), or — with -ArrayValue (t/3969) — an existing array ---
    $targetChar = $RawText[$curStart]
    if ($targetChar -eq '{' -or (-not $ArrayValue -and $targetChar -eq '[')) {
        & $fail "target at '$pathDisplay' is an object/array; only in-place scalar replacement is supported" `
            @('Object/array-valued replacement is out of scope (t/2921 Q2)', 'Pass -ArrayValue to replace an existing array leaf')
    }
    if ($ArrayValue -and $targetChar -ne '[') {
        & $fail "-ArrayValue expects the existing target at '$pathDisplay' to be an array, but it is not" `
            @('Verify the path addresses an array leaf')
    }

    # --- Splice the target value span ---
    # t/3969: -InputObject, NEVER a pipe — `$Value | ConvertTo-Json` unrolls a one-element array into
    # its bare scalar element (the t/3948-class hazard), silently writing "tag1" instead of ["tag1"].
    $encoded = ConvertTo-Json -InputObject $Value -Depth 100 -Compress
    $patched = $RawText.Substring(0, $curStart) + $encoded + $RawText.Substring($curEnd + 1)

    # --- Re-parse-VERIFY invariant (the safety net) ---
    if ($DeferVerify) { return $patched }   # caller verifies the whole batch once
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
