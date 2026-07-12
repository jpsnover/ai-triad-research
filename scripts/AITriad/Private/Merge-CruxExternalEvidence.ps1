# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Preserve reviewer-entered external_evidence entries across crux regeneration (t/1535, t/1540).
.DESCRIPTION
    Reviewers may attach external_evidence (URL + note + added_by + added_at) to a
    crux via the Taxonomy Editor. aggregated-cruxes.json is regenerated wholesale by
    Export-AggregatedCruxes.ps1 — without this helper, the next regeneration would
    silently destroy that reviewer input.

    Unlike question_form (regenerable via UsageID), external_evidence is
    IRREPLACEABLE — a human curator's citation cannot be reconstructed after
    loss. So this helper is preserve-only: no generation path.

    Preservation requires BOTH id AND statement (Trim-normalized, case-sensitive
    -ceq) to match the prior entry. Mismatched statements fall through — the
    dedup clustering may have reassigned an id to a materially different crux,
    and riding the old evidence along would silently misattach a citation.

    On read/parse failure of the previous file, emits a warning and returns
    zero-preservation stats — crux regeneration MUST NOT be blocked by
    preservation logic (AC #3, fail-open).

    Mutates the crux array in place. Returns { Preserved; Dropped }.
      - Preserved: number of cruxes where non-empty external_evidence carried forward.
      - Dropped:   number of cruxes whose id matched a prior evidence-bearing entry
                   but whose statement had changed — the evidence was intentionally
                   NOT preserved (visible cost of the statement-guard, so callers
                   can tell "no evidence found" from "found but dropped").
#>
function Merge-CruxExternalEvidence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Cruxes,

        [Parameter(Mandatory)]
        [string]$PreviousPath
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Build map: id -> @{ Statement (Trim'd); Evidence (array) }.
    # Only entries with a non-empty external_evidence array are indexed —
    # nothing else is worth preserving.
    $ExistingEv = @{}
    if (Test-Path $PreviousPath) {
        try {
            $Existing = Get-Content -Raw $PreviousPath | ConvertFrom-Json
            if ($Existing.PSObject.Properties['cruxes'] -and $Existing.cruxes) {
                foreach ($EC in @($Existing.cruxes)) {
                    if (-not $EC.PSObject.Properties['id']) { continue }
                    if (-not $EC.PSObject.Properties['statement']) { continue }
                    if (-not $EC.PSObject.Properties['external_evidence']) { continue }
                    $Ev = @($EC.external_evidence)
                    if (@($Ev).Count -eq 0) { continue }
                    $ExistingEv[[string]$EC.id] = [PSCustomObject]@{
                        Statement = ([string]$EC.statement).Trim()
                        Evidence  = $Ev
                    }
                }
            }
        } catch {
            # Fail-open: warn and proceed. AC #3 — regeneration must not be blocked
            # by preservation failure.
            Write-Warning "Merge-CruxExternalEvidence: could not read $PreviousPath for preservation: $($_.Exception.Message)"
            return [PSCustomObject]@{ Preserved = 0; Dropped = 0 }
        }
    }

    $Preserved = 0
    $Dropped   = 0
    foreach ($Crux in $Cruxes) {
        $CId = [string]$Crux.id
        if (-not $ExistingEv.ContainsKey($CId)) { continue }
        $Prev = $ExistingEv[$CId]
        $CurStmt = ([string]$Crux.statement).Trim()
        if ($Prev.Statement -ceq $CurStmt) {
            $Crux['external_evidence'] = $Prev.Evidence
            $Preserved++
        } else {
            Write-Verbose "Merge-CruxExternalEvidence: id ${CId} statement changed — evidence dropped to avoid misattachment"
            $Dropped++
        }
    }

    [PSCustomObject]@{
        Preserved = $Preserved
        Dropped   = $Dropped
    }
}
