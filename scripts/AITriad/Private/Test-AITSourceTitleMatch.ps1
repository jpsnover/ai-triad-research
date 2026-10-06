# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AITSourceTitleMatch {
    <#
    .SYNOPSIS
        True if Meta's title matches ANY of the supplied wildcard patterns (t/3910
        decomposition of Get-AITSource's -Title filter, no behavior change).
    .OUTPUTS
        [bool]
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)][PSObject]$Meta,
        [Parameter(Mandatory)][string[]]$Title
    )
    Set-StrictMode -Version Latest
    $SrcTitle = Get-AITSourcePropValue -Object $Meta -Name 'title'
    if (-not $SrcTitle) { return $false }
    foreach ($Pattern in $Title) {
        if ($SrcTitle -like $Pattern) { return $true }
    }
    return $false
}
