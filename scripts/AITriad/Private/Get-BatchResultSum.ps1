# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchResultSum {
    <#
    .SYNOPSIS
        Integer sum of one numeric property across Invoke-BatchSummary results; 0 when
        there are none (t/3910).
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [AllowEmptyCollection()][object[]]$Result = @(),
        [Parameter(Mandatory)][string]$Property
    )

    if ($Result.Count -eq 0) { return 0 }
    return [int]($Result | Measure-Object -Property $Property -Sum).Sum
}
