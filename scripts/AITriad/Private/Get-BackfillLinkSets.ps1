# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BackfillLinkSets {
    <#
    .SYNOPSIS
        Repair-ResolvedBackfill sub-helper (t/3900, extracted to keep that
        cmdlet's complexity under the ratchet threshold, t/3829): build the
        per-POV dedupe sets used to decide whether a resolved concept is
        already represented.
    .DESCRIPTION
        Two sets per POV:
          - NodeIds: every non-null/non-empty taxonomy_node_id already present
            on a key_point in that POV (the original dedupe signal).
          - BackfillPoints: the `point` text of every key_point in that POV
            whose excerpt_context is 'unmapped_concept_backfill', REGARDLESS of
            its current taxonomy_node_id (null included). A t/3595-style
            cleanup nulls a backfilled key_point's taxonomy_node_id
            (intentionally unlinked) but leaves the ORIGIN
            unmapped_concepts[].resolved_node_id pointing at the now-dead id.
            The NodeIds-only set can't see that concept as already
            represented (null was never added to it), so without this second
            set the concept looks unlinked and gets re-appended with the dead
            id, every run.
    .PARAMETER PovSummaries
        The summary's `.pov_summaries` object.
    .PARAMETER ValidPovs
        The POV names to build sets for (accelerationist/safetyist/skeptic).
    .OUTPUTS
        [PSCustomObject] { NodeIds; BackfillPoints } -- each a hashtable keyed
        by POV name, valued HashSet[string].
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        $PovSummaries,

        [Parameter(Mandatory)]
        [string[]]$ValidPovs
    )

    Set-StrictMode -Version Latest

    $NodeIds = @{}
    $BackfillPoints = @{}
    foreach ($Pov in $ValidPovs) {
        $NodeIds[$Pov] = [System.Collections.Generic.HashSet[string]]::new()
        $BackfillPoints[$Pov] = [System.Collections.Generic.HashSet[string]]::new()
        if (-not $PovSummaries.PSObject.Properties[$Pov] -or -not $PovSummaries.$Pov) { continue }
        $PovSection = $PovSummaries.$Pov
        if (-not $PovSection.PSObject.Properties['key_points'] -or -not $PovSection.key_points) { continue }
        foreach ($Kp in @($PovSection.key_points)) {
            if ($Kp.PSObject.Properties['taxonomy_node_id'] -and $Kp.taxonomy_node_id) {
                $null = $NodeIds[$Pov].Add($Kp.taxonomy_node_id)
            }
            if ($Kp.PSObject.Properties['excerpt_context'] -and $Kp.excerpt_context -eq 'unmapped_concept_backfill' -and
                $Kp.PSObject.Properties['point']) {
                $null = $BackfillPoints[$Pov].Add([string]$Kp.point)
            }
        }
    }

    return [PSCustomObject]@{ NodeIds = $NodeIds; BackfillPoints = $BackfillPoints }
}
