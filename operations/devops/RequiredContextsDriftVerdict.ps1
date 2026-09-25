# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure comparator for t/3646: does the committed required-contexts SSOT match the live
    branch-protection required status checks? No network — unit-testable.
.DESCRIPTION
    The SSOT (.github/ci/required-contexts.json) is a MIRROR; branch protection is authoritative.
    workflow-lint enforces its required-context rules against the workflows named in the SSOT, so
    an SSOT that has drifted from branch protection makes the lint enforce the wrong set — blocking
    correct changes or passing incorrect ones. This comparator is the guard that must be green on
    main BEFORE the lint is promoted to blocking (TL t/3646 ruling 1).

    Compares as SETS (order-insensitive, deduped). Returns:
      InSync         — bool, true iff the two sets are identical
      MissingFromApi — contexts in the SSOT but NOT required by branch protection (SSOT over-claims)
      MissingFromSsot— contexts required by branch protection but NOT in the SSOT (SSOT under-claims)
    Both difference lists empty <=> InSync.

    Split into its own dot-sourceable file (mirrors FlakeVerdict.ps1 / BranchStrandVerdict.ps1) so
    both arms are testable without a live API call.
#>

function Get-RequiredContextsDriftVerdict {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Ssot,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Api
    )
    $ssotSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($Ssot | Where-Object { $_ } | ForEach-Object { $_.Trim() }))
    $apiSet  = [System.Collections.Generic.HashSet[string]]::new([string[]]@($Api  | Where-Object { $_ } | ForEach-Object { $_.Trim() }))
    $missingFromApi  = @($ssotSet  | Where-Object { -not $apiSet.Contains($_) }  | Sort-Object)
    $missingFromSsot = @($apiSet   | Where-Object { -not $ssotSet.Contains($_) } | Sort-Object)
    return [PSCustomObject]@{
        InSync          = ($missingFromApi.Count -eq 0 -and $missingFromSsot.Count -eq 0)
        MissingFromApi  = $missingFromApi
        MissingFromSsot = $missingFromSsot
    }
}
