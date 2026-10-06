# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-DependencyPlatform {
    <#
    .SYNOPSIS
        Platform detection for Invoke-DependencyCheck (t/3910). Extracted verbatim.
    .DESCRIPTION
        PS 5.1 lacks $PSVersionTable.OS (added in PS 6); $IsWindows/$IsMacOS/$IsLinux are
        shimmed in AITriad.psm1 so they're safe to use directly.
    .OUTPUTS
        [string] one of 'macOS', 'Linux', 'Windows'.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    $HasOSProp = $PSVersionTable.PSObject.Properties.Match('OS').Count -gt 0
    $OnMac   = $IsMacOS -or ($HasOSProp -and ($PSVersionTable.OS -match 'Darwin'))
    $OnLinux = $IsLinux -or ($HasOSProp -and ($PSVersionTable.OS -match 'Linux'))
    if ($OnMac) { return 'macOS' }
    if ($OnLinux) { return 'Linux' }
    return 'Windows'
}
