# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSourcePropValue {
    <#
    .SYNOPSIS
        Presence-guarded property getter (t/3910 decomposition). Replaces the repeated
        `if ($Obj.PSObject.Properties['x']) { $Obj.x } else { $Default }` ternary that
        appeared ~30 times across Get-AITSource's object-construction code — each occurrence
        was its own +1 to that function's cyclomatic complexity.
    .PARAMETER Object
        The PSObject (index entry, metadata, or summary) to read from.
    .PARAMETER Name
        The property name.
    .PARAMETER Default
        Value to return when the property is absent. Defaults to $null.
    .OUTPUTS
        The property's value, or Default.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSObject]$Object,
        [Parameter(Mandatory)][string]$Name,
        $Default = $null
    )
    Set-StrictMode -Version Latest
    if ($Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $Default
}
