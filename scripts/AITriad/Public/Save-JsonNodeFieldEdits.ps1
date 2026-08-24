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
        pass is preserved), applies each edit via the Private field-surgical primitive
        Update-JsonNodeField — chaining each call's output as the next call's RawText — then
        writes ONCE through the guarded sink (Write-Utf8NoBom) with the surgical exemption.
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
        One or more edit hashtables, each @{ NodeId=<id>; Field=<name>; Value=<scalar> }.
        Applied in order; each is a single scalar field on a single node. Object/array
        values are unsupported and safe-abort via Update-JsonNodeField's verify.
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

    $applied  = 0
    $notFound = [System.Collections.Generic.List[string]]::new()

    foreach ($edit in @($Edits)) {
        foreach ($key in @('NodeId', 'Field', 'Value')) {
            if (-not $edit.ContainsKey($key)) {
                & $fail "An edit hashtable is missing required key '$key'" @('Each edit must be @{ NodeId=..; Field=..; Value=.. }')
            }
        }
        $nodeId = [string]$edit['NodeId']
        if (-not $existingIds.Contains($nodeId)) {
            # Surface, never silently drop (the observability half of the sweep-class lesson).
            $notFound.Add($nodeId)
            Write-Warning "Save-JsonNodeFieldEdits: node '$nodeId' not found in $Path — skipped (not written)."
            continue
        }
        # Chain: each surgical splice consumes the prior result. A verify failure THROWS
        # (writes nothing yet) → the whole batch aborts atomically, leaving the file untouched.
        $raw = Update-JsonNodeField -RawText $raw -NodeId $nodeId -Field $edit['Field'] -Value $edit['Value']
        $applied++
    }

    if ($applied -gt 0) {
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
