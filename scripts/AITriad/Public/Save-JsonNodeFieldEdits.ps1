# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Save-JsonNodeFieldEdits {
    <#
    .SYNOPSIS
        Durable batch writer for scalar node-field edits (t/2916, TL ruling t/2916#8).
        The single public entry every WARN/BLOCK-tier field-backfill writer calls instead
        of a whole-file `ConvertFrom-Json | ConvertTo-Json` round-trip.
    .DESCRIPTION
        Reads the target FRESH from disk (so any WIP that landed during a long, AI-bound
        pass is preserved), applies each edit via the Private field-surgical primitives
        (Update-JsonNodeField / Update-JsonNodePath) — chaining each call's output as the next
        call's RawText — re-parse-verifies the whole batch ONCE against the fresh read with every
        edit applied, then writes ONCE through the guarded sink (Write-Utf8NoBom) with the
        surgical exemption. If the batch verify fails, the edits are replayed with per-edit
        verify to name the faulty edit, and nothing is written.
        Because every splice preserves untouched bytes, a write cannot sweep concurrent WIP
        elsewhere in the file regardless of tree state (the sit-477 sweep, t/2896).

        SWEEP PREVENTION IS TWO HALVES (TL t/2916#3): this keeps foreign WIP separable
        (a minimal per-field diff vs distinct WIP hunks); the OTHER half is explicit-path /
        hunk staging at commit — NEVER `git add -A`, or a stray `git add <file>` re-sweeps
        the WIP into the commit.

        The surgical exemption to the BLOCK-tier dirty-tree guard is claimed ONLY here
        (Assert-DataWriteAllowed -SurgicalWrite, forwarded via Write-Utf8NoBom). It is
        earned because every write through this path is verified surgical by
        Update-JsonNodeField's re-parse-verify invariant + byte-identical preservation
        (proven in Update-JsonNodeField tests 5/7 and SurgicalWriteExemption.Tests.ps1).

    .PARAMETER Path
        The target JSON file (a nodes[] document) to edit in place.
    .PARAMETER Edits
        One or more edit hashtables. Each edit targets a single node and is EITHER a depth-1 field or a
        nested path (exactly one of Field / Path):
          - @{ NodeId=<id>; Field=<name>; Value=<scalar> } → depth-1 (Update-JsonNodeField).
          - @{ NodeId=<id>; Path=@('graph_attributes','debate_grounding'); Value=<scalar>; Upsert=$true }
            → nested set/insert (Update-JsonNodePath). Path is a segment array (string keys / int indices).
            With Upsert, a missing scalar leaf and any missing OBJECT container along the path are created
            (t/3438; container-key create only — a missing array index fails closed). Default replace-only.
          - @{ NodeId=<id>; Path=@('graph_attributes','synthetic_phrases'); Remove=$true } → delete the
            whole member (t/3460). Path-only: a Remove edit must NOT carry Value (ambiguous → refuse) and
            must not set Field or Upsert. The final segment must be an object key (array-index removal
            refuses fail-closed); the value may be scalar OR object/array. -Remove is STRICT — an absent
            key refuses fail-closed, so a retrying runner must re-derive its worklist to current carriers.
          - @{ NodeId=<id>; Path=@('pov_tags'); Value=<string[]>; ArrayValue=$true[; Upsert=$true] } →
            array-leaf set/insert (t/3969; Update-JsonNodePath -ArrayValue). Path-only, Value must be a
            FLAT array of scalars (no nested object/array elements), and mutually exclusive with Remove.
        Applied in order. REPLACE/Upsert object VALUES are unsupported and safe-abort via the primitives'
        verify; array leaf VALUES require ArrayValue=$true; -Remove deletes members of any value type.
    .OUTPUTS
        [pscustomobject] result summary: Applied (int), NotFound (string[] — NodeIds not
        present in the file, surfaced not silently dropped), Path. Throws New-ActionableError
        (writing NOTHING) if the file is missing, an edit is malformed, or any surgical
        splice fails its re-parse-verify (the batch is atomic on unexpected failure).
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [hashtable[]]$Edits
    )
    Set-StrictMode -Version Latest

    $fail = {
        param($problem, $steps)
        throw (New-ActionableError -Goal "Apply $(@($Edits).Count) field-surgical edit(s) to '$Path'" `
            -Problem $problem -Location 'Save-JsonNodeFieldEdits' -NextSteps $steps -PassThru)
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        & $fail "Target file not found: $Path" @('Verify the path exists before calling Save-JsonNodeFieldEdits')
    }

    # --- Read FRESH (read-fresh-at-write timing, TL t/2916#8) ---
    $raw = Get-Content -Raw -LiteralPath $Path
    try { $parsed = $raw | ConvertFrom-Json } catch {
        & $fail "Target is not valid JSON: $($_.Exception.Message)" @('The file must be a well-formed nodes[] document')
    }
    if (-not $parsed.PSObject.Properties['nodes']) {
        & $fail 'Target has no top-level nodes[] array' @('Expected a { "nodes": [ ... ] } document')
    }
    # Stable id set: surgical edits change field VALUES / insert absent keys — never add or
    # remove nodes — so the id membership computed from the fresh read holds for the batch.
    $existingIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($n in @($parsed.nodes)) {
        if ($n.PSObject.Properties['id']) { [void]$existingIds.Add([string]$n.id) }
    }

    $originalRaw = $raw
    $applied  = 0
    $appliedEdits = [System.Collections.Generic.List[hashtable]]::new()
    $notFound = [System.Collections.Generic.List[string]]::new()

    # One splice per edit. $verifyEach=$false (the normal path) chains with -DeferVerify and
    # re-parse-verifies the WHOLE batch once below; $true replays with each primitive's own
    # per-edit verify, used only to name the faulty edit after a batch-verify failure.
    $applyChain = {
        param([string]$text, [bool]$verifyEach)
        $defer = -not $verifyEach
        foreach ($e in $appliedEdits) {
            $id = [string]$e['NodeId']
            if ($e.ContainsKey('Field')) {
                $text = Update-JsonNodeField -RawText $text -NodeId $id -Field $e['Field'] -Value $e['Value'] -DeferVerify:$defer
            }
            elseif ([bool]$e['Remove']) {
                $text = Update-JsonNodePath -RawText $text -NodeId $id -Path @($e['Path']) -Remove -DeferVerify:$defer
            }
            else {
                $text = Update-JsonNodePath -RawText $text -NodeId $id -Path @($e['Path']) -Value $e['Value'] `
                    -Upsert:([bool]$e['Upsert']) -ArrayValue:([bool]$e['ArrayValue']) -DeferVerify:$defer
            }
        }
        return $text
    }

    foreach ($edit in @($Edits)) {
        # t/3877: shape validation extracted to Private/Test-FieldEditShape.ps1 (pure, same
        # checks/order/messages) to bring this function's complexity back under its
        # complexity-ratchet baseline. $fail still throws here so the New-ActionableError
        # -Goal/-Location context stays this function's, not the validator's.
        $shapeError = Test-FieldEditShape -Edit $edit
        if ($shapeError) { & $fail $shapeError.Problem $shapeError.Steps }

        $nodeId = [string]$edit['NodeId']
        if (-not $existingIds.Contains($nodeId)) {
            # Surface, never silently drop (the observability half of the sweep-class lesson).
            $notFound.Add($nodeId)
            Write-Warning "Save-JsonNodeFieldEdits: node '$nodeId' not found in $Path — skipped (not written)."
            continue
        }
        $appliedEdits.Add($edit)
        $applied++
    }

    if ($applied -gt 0) {
        # Chain: each surgical splice consumes the prior result. Any throw (a locate failure in a
        # primitive, or the batch verify below) aborts before the write — the batch is atomic and
        # the file is left untouched.
        $raw = & $applyChain $originalRaw $false

        # --- Batch re-parse-VERIFY (the safety net, once per file) ---
        # Expected = the fresh read with every edit applied to the parsed model; actual = the
        # spliced text re-parsed. Equal ⇒ the splices changed exactly the intended values and
        # nothing else. Verifying per edit instead re-parsed + compared the whole file 2–3× per
        # edit (~4s each on a 7 MB taxonomy file — hours for a full Invoke-VernacularBatch run).
        $verifyProblem = $null
        try {
            $actual = $raw | ConvertFrom-Json
            foreach ($e in $appliedEdits) { Set-JsonExpectedEdit -Root $parsed -Edit $e }
            if (-not (Test-JsonSemanticEqual -A $parsed -B $actual)) {
                $verifyProblem = 'the spliced file differs from the expected result beyond the intended edits'
            }
        }
        catch { $verifyProblem = $_.Exception.Message }

        if ($verifyProblem) {
            # Fallback: replay with per-edit verify so the error names the faulty edit. Either way
            # nothing is written.
            Write-Warning "Save-JsonNodeFieldEdits: batch re-parse-verify failed for $Path ($verifyProblem) — replaying $applied edit(s) with per-edit verify to locate the faulty edit; nothing will be written."
            $null = & $applyChain $originalRaw $true
            & $fail "batch re-parse-verify FAILED ($verifyProblem), but no single edit failed its own verify — writing nothing" `
                @('Splice/expected-model bug; the guard refused a corrupting write', 'Report with the input file + edit list')
        }

        if ($PSCmdlet.ShouldProcess($Path, "Apply $applied field-surgical edit(s)")) {
            # Surgical exemption claimed HERE ONLY (t/2916#8): sweep-proof by construction,
            # so it proceeds even on a dirty BLOCK-tier target. Forwarded through the sink.
            Write-Utf8NoBom -Path $Path -Value $raw -NoNewline -SurgicalWrite
        }
    }

    return [pscustomobject]@{
        Applied  = $applied
        NotFound = $notFound.ToArray()
        Path     = $Path
    }
}
