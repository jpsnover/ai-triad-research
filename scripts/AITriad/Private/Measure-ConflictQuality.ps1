# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-ConflictQuality {
    <#
    .SYNOPSIS
        Metric 4 of Measure-TaxonomyBaseline (t/3910 decomposition; no behavior
        change): single/multi-instance and open/resolved conflict counts.
    .PARAMETER Conflicts
        The loaded conflicts array.
    .OUTPUTS
        [ordered hashtable] the conflicts report section.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)]
        [object[]]$Conflicts
    )

    Set-StrictMode -Version Latest

    $SingleInstance = @($Conflicts | Where-Object { @($_.instances).Count -le 1 }).Count
    $MultiInstance = @($Conflicts | Where-Object { @($_.instances).Count -gt 1 }).Count

    return [ordered]@{
        total_conflicts     = $Conflicts.Count
        single_instance     = $SingleInstance
        single_instance_pct = if ($Conflicts.Count -gt 0) { [Math]::Round($SingleInstance / $Conflicts.Count * 100, 1) } else { 0 }
        multi_instance      = $MultiInstance
        status_open         = @($Conflicts | Where-Object { $_.status -eq 'open' }).Count
        status_resolved     = @($Conflicts | Where-Object { $_.status -eq 'resolved' }).Count
    }
}
