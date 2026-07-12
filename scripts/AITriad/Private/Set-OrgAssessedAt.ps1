# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Set-OrgAssessedAt {
    <#
    .SYNOPSIS
        Applies the assessed_at preservation/refresh rule to an org record on upsert (t/1555).
    .DESCRIPTION
        Called from Import-Organization's update path. Given the record
        already on disk and the incoming record:

          - If pov_alignment values (score/rationale per camp) match, the
            existing assessed_at is carried through — unrelated updates
            (name, external_links, etc.) don't perturb the staleness signal.
          - If pov_alignment values differ, stamp today's ISO date so the
            change is dated.
          - If the incoming record supplies its OWN assessed_at, it wins
            (explicit caller override).

        Returns the incoming record with pov_alignment.assessed_at set as
        appropriate. Pure — never mutates $Existing.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Existing,

        [Parameter(Mandatory)]
        [object]$Incoming
    )

    Set-StrictMode -Version Latest

    if (-not $Incoming.PSObject.Properties['pov_alignment'] -or $null -eq $Incoming.pov_alignment) {
        return $Incoming
    }
    $incomingPov = $Incoming.pov_alignment

    # Caller-supplied assessed_at wins.
    if ($incomingPov.PSObject.Properties['assessed_at'] -and $incomingPov.assessed_at) {
        return $Incoming
    }

    $existingPov = $null
    if ($Existing.PSObject.Properties['pov_alignment']) { $existingPov = $Existing.pov_alignment }

    $existingAssessed = ''
    if ($existingPov -and $existingPov.PSObject.Properties['assessed_at'] -and $existingPov.assessed_at) {
        $existingAssessed = [string]$existingPov.assessed_at
    }

    $unchanged = Test-PovAlignmentUnchanged -A $existingPov -B $incomingPov
    if ($unchanged -and $existingAssessed) {
        # Preserve the existing date — no camp values changed.
        Add-Member -InputObject $incomingPov -MemberType NoteProperty -Name 'assessed_at' -Value $existingAssessed -Force
    } else {
        # Something changed — stamp today.
        $today = (Get-Date).ToString('yyyy-MM-dd')
        Add-Member -InputObject $incomingPov -MemberType NoteProperty -Name 'assessed_at' -Value $today -Force
    }

    $Incoming
}

function Test-PovAlignmentUnchanged {
    <#
    .SYNOPSIS
        True iff two pov_alignment blocks have matching per-camp score+rationale (t/1555).
    .DESCRIPTION
        Compares only the camp entries (accelerationist/safetyist/skeptic) —
        assessed_at itself is excluded from the diff so we don't chase our
        own tail.
    #>
    [CmdletBinding()]
    param(
        [Parameter()][object]$A,
        [Parameter()][object]$B
    )
    Set-StrictMode -Version Latest

    if ($null -eq $A -or $null -eq $B) { return $false }

    $camps = @('accelerationist', 'safetyist', 'skeptic')
    foreach ($camp in $camps) {
        $hasA = $A.PSObject.Properties[$camp] -and $null -ne $A.$camp
        $hasB = $B.PSObject.Properties[$camp] -and $null -ne $B.$camp
        if ($hasA -ne $hasB) { return $false }
        if (-not $hasA) { continue }

        $scoreA = if ($A.$camp.PSObject.Properties['score'])     { [double]$A.$camp.score }     else { $null }
        $scoreB = if ($B.$camp.PSObject.Properties['score'])     { [double]$B.$camp.score }     else { $null }
        $ratA   = if ($A.$camp.PSObject.Properties['rationale']) { [string]$A.$camp.rationale } else { '' }
        $ratB   = if ($B.$camp.PSObject.Properties['rationale']) { [string]$B.$camp.rationale } else { '' }

        if ($scoreA -ne $scoreB) { return $false }
        if ($ratA -ne $ratB)     { return $false }
    }
    $true
}
