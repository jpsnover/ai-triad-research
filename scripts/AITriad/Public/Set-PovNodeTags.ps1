# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Set-PovNodeTags {
    <#
    .SYNOPSIS
        Batch writer for the POV-node `pov_tags` field (t/3969; TL t/3955#4 conditions 1/2/4). The
        t/3962 writer is required to go through this cmdlet, never a whole-file write.
    .DESCRIPTION
        Validates the WHOLE batch against the registry in ONE call to the blocking gate,
        lib/schema/pov-tags-cli.ts (t/3955), BEFORE writing anything — a bad tag anywhere in the
        batch refuses the entire batch, so a file is never left half-tagged (TL t/3969#2 cond B.2).
        Only after a clean validation does it make the surgical per-file writes, via
        Update-JsonNodePath's -ArrayValue (t/3969) through Save-JsonNodeFieldEdits.

        FAIL-CLOSED on the CLI result (TL cond B.3): exit 0 AND `checked` equal to the number of
        entries submitted is required to proceed. Exit 1 refuses, quoting the CLI's errors[]. Any
        other exit (including 0 with an unparseable/missing result or `checked` short of what was
        submitted — the empty-result trap) refuses with "could not run the check."

        EMPTY TAGS (TL cond B.6): `-Tags @()` writes `pov_tags: []`, not field removal. The schema
        treats an empty array the same as absent (untagged) for every reader, but writing `[]`
        keeps every batch entry on the same code path (replace-or-create via -ArrayValue -Upsert)
        and records that the node WAS checked and explicitly has no tags, vs. a node nobody has
        looked at yet (field truly absent).
    .PARAMETER Assignment
        One or more node/tags pairs (pipeline-friendly). Each is a PovTagAssignment: NodeId
        (string) + Tags (string[], may be empty — a bare string is bound as a one-element array,
        the same coercion a typed cmdlet parameter gets; TL cond B.1). Example:
            Set-PovNodeTags -Assignment @(
                @{ NodeId = 'skp-beliefs-001'; Tags = 'institutional-distrust' },
                @{ NodeId = 'skp-beliefs-002'; Tags = @('critical', 'rights-based') }
            )
    .PARAMETER TargetPath
        Directory holding the POV node files (accelerationist/safetyist/skeptic.json). Defaults to
        Get-TaxonomyDir. Pass a /data-mutation worktree's taxonomy dir so t/3962 never writes
        directly to the shared data checkout (TL cond B.4).
    .OUTPUTS
        [pscustomobject] { Checked; Applied; NotFound }. Checked is the CLI's own count (always
        equal to the number of assignments submitted, by the fail-closed guard above). NotFound
        lists NodeIds that passed validation but do not exist in their POV file (surfaced, per
        Save-JsonNodeFieldEdits, never silently dropped). Throws New-ActionableError (writing
        NOTHING) on any validation failure or CLI-run failure.
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline)]
        [PovTagAssignment[]]$Assignment,

        [string]$TargetPath
    )

    begin {
        Set-StrictMode -Version Latest
        $script:_PovNodeTagsBatch = [System.Collections.Generic.List[PovTagAssignment]]::new()
    }

    process {
        foreach ($a in $Assignment) { $script:_PovNodeTagsBatch.Add($a) }
    }

    end {
        $all = $script:_PovNodeTagsBatch
        Remove-Variable -Name _PovNodeTagsBatch -Scope Script -ErrorAction SilentlyContinue

        $fail = {
            param($problem, $steps)
            throw (New-ActionableError -Goal "Validate and write pov_tags for $($all.Count) node(s)" `
                -Problem $problem -Location 'Set-PovNodeTags' -NextSteps $steps -PassThru)
        }

        if ($all.Count -eq 0) {
            return [pscustomobject]@{ Checked = 0; Applied = 0; NotFound = @() }
        }

        # --- Build the batch validation request: one CLI call checks EVERY entry (TL cond B.2) ---
        # @() on the outer array AND -InputObject (never piped) on the encode: both guard the exact
        # one-element-array unroll hazard this ticket exists to fix (t/3948-class).
        $request = @($all | ForEach-Object { @{ id = $_.NodeId; pov_tags = @($_.Tags) } })
        $requestJson = ConvertTo-Json -InputObject $request -Depth 10 -Compress

        # Validation is non-destructive and must run under -WhatIf too (only the taxonomy-file
        # write below is gated on ShouldProcess) — -WhatIf:$false on every helper call here
        # overrides the ambient $WhatIfPreference these ShouldProcess-supporting cmdlets would
        # otherwise inherit from this function, which would silently no-op the temp-file write
        # and the CLI would see empty input (discovered via this cmdlet's own -WhatIf test).
        $Inv = Resolve-PovTagsCli
        $TmpIn = [System.IO.Path]::GetTempFileName()
        $StderrFile = [System.IO.Path]::GetTempFileName()
        try {
            Set-Content -LiteralPath $TmpIn -Value $requestJson -NoNewline -WhatIf:$false
            $AllArgs = @($Inv.ArgPrefix) + @('--input', $TmpIn)
            $Stdout = & $Inv.Exe @AllArgs 2> $StderrFile
            $Exit = $LASTEXITCODE
            $Stderr = if (Test-Path $StderrFile) { Get-Content -Raw -Path $StderrFile } else { '' }
        }
        finally {
            Remove-Item -Path $TmpIn, $StderrFile -Force -ErrorAction SilentlyContinue -WhatIf:$false
        }

        # The documented contract: stdout's LAST line is exactly one JSON object.
        $resultLine = @(@($Stdout) | Where-Object { $_ -match '^\s*\{' }) | Select-Object -Last 1

        if ($Exit -eq 1) {
            $errors = @()
            if ($resultLine) { try { $errors = @(($resultLine | ConvertFrom-Json).errors) } catch { } }
            & $fail "pov-tags-cli refused $(@($errors).Count) invalid entr$(if (@($errors).Count -eq 1) { 'y' } else { 'ies' }) — writing nothing" $errors
        }
        if ($Exit -ne 0) {
            & $fail "pov-tags-cli could not run the check (exit $Exit) — writing nothing: $($Stderr.Trim())" `
                @('Verify tsx and its runtime deps are installed (npm ci)', 'Check the CLI path Resolve-PovTagsCli resolved')
        }
        if (-not $resultLine) {
            & $fail 'pov-tags-cli exited 0 but produced no result line — treat as failure, not success (the empty-result trap)' `
                @('Report with the CLI stdout/stderr')
        }
        $checkResult = $resultLine | ConvertFrom-Json
        if ([int]$checkResult.checked -ne $all.Count) {
            & $fail "pov-tags-cli checked $($checkResult.checked) node(s) but $($all.Count) were submitted — writing nothing (the empty-result trap)" `
                @('This usually means the input was truncated or malformed', 'Report with the input and the CLI output')
        }

        # --- Validated. Group by owning POV file; only acc-/saf-/skp- prefixes can reach here —
        # anything else would already have been refused above by validatePovTags. ---
        $filesByPrefix = @{ acc = 'accelerationist.json'; saf = 'safetyist.json'; skp = 'skeptic.json' }
        $root = if ($TargetPath) { $TargetPath } else { Get-TaxonomyDir }
        $groups = [ordered]@{}
        foreach ($a in $all) {
            $prefix = ([regex]::Match($a.NodeId, '^([a-z]+)-')).Groups[1].Value
            $file = $filesByPrefix[$prefix]
            if (-not $file) {
                & $fail "node '$($a.NodeId)' has no recognized POV file prefix (acc-/saf-/skp-)" `
                    @('This indicates a bug: validatePovTags should already have refused this entry')
            }
            $filePath = Join-Path $root $file
            if (-not $groups.Contains($filePath)) { $groups[$filePath] = [System.Collections.Generic.List[hashtable]]::new() }
            # -Upsert: a never-tagged node has no pov_tags key yet. -ArrayValue: t/3969.
            $groups[$filePath].Add(@{ NodeId = $a.NodeId; Path = @('pov_tags'); Value = @($a.Tags); ArrayValue = $true; Upsert = $true })
        }

        $applied = 0
        $notFound = [System.Collections.Generic.List[string]]::new()
        if ($PSCmdlet.ShouldProcess("$($all.Count) node(s) across $($groups.Count) file(s) under '$root'", 'Write pov_tags')) {
            foreach ($filePath in $groups.Keys) {
                $result = Save-JsonNodeFieldEdits -Path $filePath -Edits $groups[$filePath].ToArray() -Confirm:$false
                $applied += $result.Applied
                foreach ($nf in @($result.NotFound)) { $notFound.Add($nf) }
            }
        }

        return [pscustomobject]@{
            Checked  = [int]$checkResult.checked
            Applied  = $applied
            NotFound = $notFound.ToArray()
        }
    }
}
