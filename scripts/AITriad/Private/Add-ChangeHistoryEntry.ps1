# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Appends a change history entry to a taxonomy node, capped at 5 entries (FIFO).
.PARAMETER Node
    The taxonomy node PSObject (from ConvertFrom-Json).
.PARAMETER Action
    The action type: created, modified, deprecated.
.PARAMETER Fields
    Array of field names that changed (e.g., 'description', 'graph_attributes.confidence').
#>
function Add-ChangeHistoryEntry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Node,

        [Parameter(Mandatory)]
        [ValidateSet('created', 'modified', 'deprecated')]
        [string]$Action,

        [Parameter(Mandatory)]
        [string[]]$Fields
    )

    $Entry = [ordered]@{
        date   = (Get-Date).ToString('o')
        action = $Action
        fields = @($Fields)
    }

    if (-not $Node.PSObject.Properties['change_history']) {
        $Node | Add-Member -NotePropertyName 'change_history' -NotePropertyValue @($Entry) -Force
    } else {
        # Prepend new entry and cap at 5 (FIFO — newest first)
        $History = @($Entry) + @($Node.change_history)
        if ($History.Count -gt 5) {
            $History = $History[0..4]
        }
        $Node.change_history = $History
    }
}
