# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Add-BdiWeightToNode {
    <#
    .SYNOPSIS
        Write one BDI weight onto a node: the value, a one-entry <Field>_history, and a change_history
        entry. The single write-back shared by confidence/priority/operationality (t/3910; it was
        duplicated three times inline in Invoke-BDIWeightAssignment).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Node,
        [Parameter(Mandatory)][string]$Field,
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Reason,
        [Parameter(Mandatory)][string]$Today
    )

    $HistoryField = "${Field}_history"
    $Node | Add-Member -NotePropertyName $Field -NotePropertyValue $Value -Force
    $Node | Add-Member -NotePropertyName $HistoryField -NotePropertyValue @(
        [ordered]@{ date = $Today; value = $Value; delta = 0; reason = $Reason }
    ) -Force
    Add-ChangeHistoryEntry -Node $Node -Action 'modified' -Fields @($Field, $HistoryField)
}

function Invoke-BdiNodeWeight {
    <#
    .SYNOPSIS
        Compute one node's BDI weight by category and, unless -DryRun, write it onto the node.
        Extracted from Invoke-BDIWeightAssignment's per-node loop (t/3910).
    .OUTPUTS
        [string] 'Beliefs', 'Desires' or 'Intentions' when the node was weighted (for the caller's
        counts); $null when it was skipped (no id, no category, or another category).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][AllowNull()]$Node,
        [Parameter(Mandatory)][hashtable]$Context,
        [Parameter(Mandatory)][string]$Today,
        [switch]$DryRun
    )

    if (-not $Node -or -not $Node.PSObject.Properties['id']) { return $null }
    $Category = if ($Node.PSObject.Properties['category']) { $Node.category } else { $null }
    if (-not $Category) { return $null }

    if ($Category -eq 'Beliefs') {
        $Kind = 'Beliefs'; $Field = 'confidence'; $Reason = 'Initial multi-signal assignment'
        $Value = Get-BeliefConfidence -Node $Node -SourceDocCounts $Context.SourceDocCounts `
            -SupportsReceived $Context.Supports -AttacksReceived $Context.Attacks
    } elseif ($Category -eq 'Desires') {
        $Kind = 'Desires'; $Field = 'priority'
        $R = Get-DesirePriority -Node $Node -BoundarySet $Context.BoundarySet
        $Value = $R.Priority; $Reason = $R.Reason
    } elseif ($Category -eq 'Intentions') {
        $Kind = 'Intentions'; $Field = 'operationality'
        $R = Get-IntentionOperationality -Node $Node
        $Value = $R.Operationality; $Reason = $R.Reason
    } else {
        return $null
    }

    if (-not $DryRun) {
        Add-BdiWeightToNode -Node $Node -Field $Field -Value $Value -Reason $Reason -Today $Today
    }
    return $Kind
}
