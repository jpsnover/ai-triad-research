# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Set-OrgPreserveDerived {
    <#
    .SYNOPSIS
        Preserves an existing pov_alignment_derived block across a partial
        Import-Organization upsert (t/1560, TL condition 2 at t/1560#4).
    .DESCRIPTION
        Called from Import-Organization's update path. Import-Organization
        replaces the whole record on upsert, so a caller who edits an
        unrelated field (name, topic_engagement, external_links, etc.)
        without also carrying forward the derived block would silently
        wipe it out. Set-OrgPreserveDerived carries the block through
        unchanged when the incoming record omits it.

        Rules:
          - Incoming has no pov_alignment_derived + existing has one → copy
            the existing block onto incoming byte-for-byte.
          - Incoming supplies its own pov_alignment_derived (even null or
            empty) → caller's value wins; nothing to preserve. This is how
            Invoke-OrgDerivedCampScores WRITES a new derived block —
            explicit intent.
          - Neither has one → return incoming unchanged.

        Same class of preservation as Merge-CruxExternalEvidence (t/1540)
        and Set-OrgAssessedAt (t/1555). Pure — never mutates $Existing.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Existing,

        [Parameter(Mandatory)]
        [object]$Incoming
    )

    Set-StrictMode -Version Latest

    if ($Incoming.PSObject.Properties['pov_alignment_derived']) {
        return $Incoming
    }
    if (-not $Existing.PSObject.Properties['pov_alignment_derived']) {
        return $Incoming
    }

    Add-Member -InputObject $Incoming -MemberType NoteProperty `
        -Name 'pov_alignment_derived' -Value $Existing.pov_alignment_derived -Force
    $Incoming
}
