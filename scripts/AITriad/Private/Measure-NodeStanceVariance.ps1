# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-NodeStanceVariance {
    <#
    .SYNOPSIS
        Per-node stance distribution and high-variance flag (t/3910 extraction from
        Get-TaxonomyHealthData). A node is HighVariance when it has been cited with at least
        one aligned-family stance ('strongly_aligned'/'aligned') AND at least one
        opposed-family stance ('strongly_opposed'/'opposed'). Nodes with no stances at all
        are excluded from the result (not just marked low-variance).
    .OUTPUTS
        [pscustomobject] { StanceVariance (hashtable, node id -> { Id; POV; Label;
        TotalStances; Distribution; HighVariance }); HighVarianceNodes (object[], the
        HighVariance subset) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][hashtable]$NodeIndex
    )

    Set-StrictMode -Version Latest

    $AlignedFamily = @('strongly_aligned', 'aligned')
    $OpposedFamily = @('strongly_opposed', 'opposed')

    $StanceVariance = @{}
    $HighVarianceNodes = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Entry in $NodeIndex.GetEnumerator()) {
        $Id      = $Entry.Key
        $Stances = $Entry.Value.Stances
        if ($Stances.Count -eq 0) { continue }

        $Distribution = @{}
        foreach ($S in $Stances) {
            if (-not $Distribution.ContainsKey($S)) { $Distribution[$S] = 0 }
            $Distribution[$S]++
        }

        $HasAligned = @($Stances | Where-Object { $_ -in $AlignedFamily }).Count -gt 0
        $HasOpposed = @($Stances | Where-Object { $_ -in $OpposedFamily }).Count -gt 0
        $HighVariance = $HasAligned -and $HasOpposed

        $Info = [PSCustomObject]@{
            Id           = $Id
            POV          = $Entry.Value.POV
            Label        = $Entry.Value.Label
            TotalStances = $Stances.Count
            Distribution = $Distribution
            HighVariance = $HighVariance
        }

        $StanceVariance[$Id] = $Info
        if ($HighVariance) { $HighVarianceNodes.Add($Info) }
    }

    return [PSCustomObject]@{ StanceVariance = $StanceVariance; HighVarianceNodes = $HighVarianceNodes.ToArray() }
}
