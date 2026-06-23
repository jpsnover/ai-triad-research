# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Add-TextHistoryEntry {
    <#
    .SYNOPSIS
        Appends a label_history or description_history entry to a taxonomy node.
    .PARAMETER Node
        The taxonomy node PSObject.
    .PARAMETER Field
        Which field changed: 'label' or 'description'.
    .PARAMETER Previous
        The previous value (before modification). Omit for 'initial' source.
    .PARAMETER Value
        The new value (after modification).
    .PARAMETER Source
        Edit source: 'interactive', 'debate_reflection', 'batch_audit', 'initial'.
    .PARAMETER Reason
        Optional reason string for the change.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Node,

        [Parameter(Mandatory)]
        [ValidateSet('label', 'description')]
        [string]$Field,

        [Parameter()]
        [string]$Previous,

        [Parameter(Mandatory)]
        [string]$Value,

        [Parameter(Mandatory)]
        [ValidateSet('interactive', 'debate_reflection', 'batch_audit', 'initial')]
        [string]$Source,

        [Parameter()]
        [string]$Reason
    )

    $HistoryProp = "${Field}_history"
    $Entry = [ordered]@{
        date   = (Get-Date).ToString('yyyy-MM-dd')
        value  = $Value
        source = $Source
    }
    if ($Previous) { $Entry['previous'] = $Previous }
    if ($Reason)   { $Entry['reason'] = $Reason }

    if (-not $Node.PSObject.Properties[$HistoryProp]) {
        $Node | Add-Member -NotePropertyName $HistoryProp -NotePropertyValue @([PSCustomObject]$Entry) -Force
    } else {
        $Node.$HistoryProp = @($Node.$HistoryProp) + @([PSCustomObject]$Entry)
    }
}
