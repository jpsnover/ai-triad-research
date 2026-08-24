# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Field-surgical JSON writer (t/2916, TL ruling t/2916#3) ───────────────────
# Changes ONE field on ONE node[] entry by splicing only that field's bytes in the
# raw text — every other byte is preserved, so concurrent uncommitted WIP elsewhere
# in the file cannot ride into the write (the sit-477 sweep). This is the durable fix
# for the WARN-tier writers the dirty-tree guard can't Block (t/2909).
#
# Safety = parse-LOCATE + minimal-SPLICE + re-parse-VERIFY: after splicing we re-parse
# the result and assert (order-insensitively) that it equals the original with EXACTLY
# the intended field change — anything else throws New-ActionableError and writes
# nothing. That invariant is what makes byte-surgery safe regardless of splice edge cases.
#
# LIMITATION (scalar-only field values): the in-place splice locates the field's value
# token via a regex that matches only JSON SCALARS (string / number / bool / null). If
# the target field currently holds an OBJECT or ARRAY, the value token is not matched and
# the code falls to the absent-key insert branch — producing a DUPLICATE key. That is a
# safe failure, not a corrupting one: the re-parse-VERIFY step rejects it (PS7
# ConvertFrom-Json throws on duplicate keys) so the helper throws New-ActionableError and
# writes nothing. Callers needing to rewrite object/array-valued fields must use a
# different mechanism; this helper is for the scalar node-field backfills (t/2916 scope).
#
# SHARED INTERNALS (t/2921#2 Q3): ConvertTo-CanonicalForm, Test-JsonSemanticEqual, and
# Find-JsonObjectSpan were extracted to Private/JsonSurgeryCore.ps1 so this depth-1 writer
# and the nested-path writer (Update-JsonNodePath) share one re-parse-verify + span scanner.
# The depth-1 logic below is UNCHANGED (TL t/2921#2: don't touch the proven,
# situations.json-critical path); it just calls the extracted helpers, which the module
# dot-sources alongside it.

function Update-JsonNodeField {
    <#
    .SYNOPSIS
        Field-surgical update of ONE field on ONE nodes[] entry (t/2916). Byte-preserving
        everywhere except the target field; re-parse-verified before returning.
    .OUTPUTS
        [string] the patched raw JSON. Throws New-ActionableError (writes nothing) if the
        node is absent, the splice can't be located, the result isn't valid JSON, or the
        re-parse-verify detects any change beyond the intended field.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][string]$NodeId,
        [Parameter(Mandatory)][string]$Field,
        [Parameter(Mandatory)][AllowNull()]$Value
    )
    Set-StrictMode -Version Latest

    $fail = {
        param($problem, $steps)
        throw (New-ActionableError -Goal "Field-surgical update of '$Field' on node '$NodeId'" `
            -Problem $problem -Location 'Update-JsonNodeField' -NextSteps $steps -PassThru)
    }

    # --- Parse (locate + verification baseline) ---
    try { $original = $RawText | ConvertFrom-Json } catch { & $fail "Input is not valid JSON: $($_.Exception.Message)" @('Pass well-formed JSON text') }
    if (-not $original.PSObject.Properties['nodes']) { & $fail "No nodes[] array in the JSON" @('Expected a top-level nodes[] array') }
    $match = @($original.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })
    if ($match.Count -eq 0) { & $fail "Node id '$NodeId' not found in nodes[]" @("Verify the node id exists in the file") }

    # --- Locate the node object's span (parse-guided, string-aware) ---
    $idToken = [regex]::Match($RawText, '"id"\s*:\s*"' + [regex]::Escape($NodeId) + '"')
    if (-not $idToken.Success) { & $fail "id token for '$NodeId' not found in raw text" @('File text may not match the parsed structure') }
    $span = Find-JsonObjectSpan -Text $RawText -InnerIndex $idToken.Index
    if ($null -eq $span) { & $fail "could not locate the enclosing object span for '$NodeId'" @('Check the JSON is well-formed') }
    $objText = $RawText.Substring($span.Start, $span.End - $span.Start + 1)

    # --- Encode the new value as a JSON literal ---
    $encoded = $Value | ConvertTo-Json -Depth 100 -Compress

    # --- Splice: replace the field value if present within THIS object, else insert ---
    $fieldRx = '("' + [regex]::Escape($Field) + '"\s*:\s*)(' +
               '"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|null' + ')'
    $fm = [regex]::Match($objText, $fieldRx)
    if ($fm.Success) {
        $newObjText = $objText.Substring(0, $fm.Index) + $fm.Groups[1].Value + $encoded +
                      $objText.Substring($fm.Index + $fm.Length)
    } else {
        # Absent-key insert at a parse-located point: right after the opening '{'.
        $insertAt = 1   # just past '{'
        $newObjText = $objText.Substring(0, $insertAt) + " `"$Field`": $encoded," + $objText.Substring($insertAt)
    }
    $patched = $RawText.Substring(0, $span.Start) + $newObjText + $RawText.Substring($span.End + 1)

    # --- Re-parse-VERIFY invariant (the safety net) ---
    try { $actual = $patched | ConvertFrom-Json } catch { & $fail "patched text is not valid JSON — writing nothing: $($_.Exception.Message)" @('Splice produced invalid JSON; this is a bug in Update-JsonNodeField') }
    $expected = $RawText | ConvertFrom-Json
    $expNode = @($expected.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId })[0]
    if ($expNode.PSObject.Properties[$Field]) { $expNode.$Field = $Value }
    else { $expNode | Add-Member -NotePropertyName $Field -NotePropertyValue $Value -Force }
    if (-not (Test-JsonSemanticEqual -A $expected -B $actual)) {
        & $fail "re-parse-verify FAILED: the splice changed more than the intended field '$Field' on '$NodeId' — writing nothing" `
            @('This is a splice bug; the guard refused a corrupting write', 'Report with the input file + node id')
    }
    return $patched
}
