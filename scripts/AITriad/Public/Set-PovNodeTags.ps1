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

        # --- Validate the WHOLE batch in one CLI call before writing anything (TL cond B.2) ---
        # Shared with Invoke-ProposalApply (t/3971) — the t/3957#7 point D same-helper rule.
        # Throws (writing nothing) on any invalid entry, a could-not-run exit, or the
        # empty-result trap (checked != submitted). -WhatIf:$false inside the helper: this
        # check is non-destructive and must still run when THIS cmdlet is called under -WhatIf.
        $entries = @($all | ForEach-Object { @{ NodeId = $_.NodeId; Tags = @($_.Tags) } })
        Invoke-PovTagsValidation -Entries $entries -Goal "Validate and write pov_tags for $($all.Count) node(s)"

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
            # Invoke-PovTagsValidation already proved checked == $all.Count, or this line
            # would never be reached (it throws, writing nothing).
            Checked  = $all.Count
            Applied  = $applied
            NotFound = $notFound.ToArray()
        }
    }
}
