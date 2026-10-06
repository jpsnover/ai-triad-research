# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyWidthExpandSignals {
    <#
    .SYNOPSIS
        TaxoAdapt width_expand signal: a POV x category branch whose unmapped-concept
        frequency total is >= 5 (t/3910 extraction from Get-TaxonomyHealthData).
    .PARAMETER UnmappedConcepts
        Array of unmapped-concept objects (SuggestedPov/SuggestedCategory/Frequency).
    .OUTPUTS
        [object[]] density-signal objects (signal='width_expand').
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$UnmappedConcepts
    )

    Set-StrictMode -Version Latest

    $WidthExpandThreshold = 5
    $Signals = [System.Collections.Generic.List[PSObject]]::new()

    $UnmappedByBranch = @{}
    foreach ($UC in $UnmappedConcepts) {
        $Key = "$($UC.SuggestedPov)|$($UC.SuggestedCategory)"
        if (-not $UnmappedByBranch.ContainsKey($Key)) { $UnmappedByBranch[$Key] = 0 }
        $UnmappedByBranch[$Key] += $UC.Frequency
    }

    foreach ($Branch in $UnmappedByBranch.GetEnumerator()) {
        if ($Branch.Value -lt $WidthExpandThreshold) { continue }

        $Parts = $Branch.Key -split '\|'
        $BranchPov = $Parts[0]; $BranchCat = $Parts[1]
        $Signals.Add([PSCustomObject][ordered]@{
            signal   = 'width_expand'
            node_id  = $null
            pov      = $BranchPov
            category = $BranchCat
            label    = "$BranchPov/$BranchCat"
            metric   = $Branch.Value
            detail   = "$BranchPov/$BranchCat has $($Branch.Value) unmapped concept frequency (threshold: $WidthExpandThreshold)"
        })
    }

    return $Signals.ToArray()
}
