# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSourceSortDate {
    <#
    .SYNOPSIS
        Parses an AITSource's DatePublished for sorting, defaulting malformed/absent dates
        to [datetime]::MinValue so they sort last (t/3910 decomposition, no behavior change).
    .OUTPUTS
        [datetime]
    #>
    [CmdletBinding()]
    [OutputType([datetime])]
    param([Parameter(Mandatory)][AllowNull()][PSObject]$Source)
    Set-StrictMode -Version Latest

    [datetime]$d = [datetime]::MinValue
    if ($Source.DatePublished -and [datetime]::TryParse([string]$Source.DatePublished, [ref]$d)) { return $d }
    return [datetime]::MinValue
}
