# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Invoke-AttributeExtraction sub-helpers (t/3964): merge a re-extraction's
# output into a node's existing graph_attributes instead of replacing it
# wholesale. A wholesale replace erased any field the extraction prompt
# doesn't regenerate -- registry policy_id's assigned by Update-PolicyRegistry,
# and fields other pipelines (debate harvest) write under graph_attributes.

function Get-NormalizedActionText {
    <#
    .SYNOPSIS
        Normalizes a policy action's text for cross-run identity matching.
    #>
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    return ($Text.Trim().ToLowerInvariant() -replace '\s+', ' ')
}

function Merge-PolicyActionsPreservingIds {
    <#
    .SYNOPSIS
        Carries an existing policy_id over to a regenerated policy action
        that matches on normalized action text.
    .DESCRIPTION
        t/3964 condition 2: WARNs, naming the registry id(s), whenever a
        previously-registered action has no matching text in the new set
        (the model dropped it).
        t/3964 condition 3: if two EXISTING actions share normalized text
        but carry different registry ids, that text is ambiguous -- any
        matching new action gets policy_id left null (never guesses), and
        this is WARNed separately from the "dropped" case.
    #>
    [CmdletBinding()]
    param(
        [AllowNull()] $ExistingActions,
        [AllowNull()] $NewActions,
        [string]$NodeId = '<unknown>'
    )

    Set-StrictMode -Version Latest

    $IdByText = @{}
    $AmbiguousText = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($A in @($ExistingActions)) {
        if (-not $A) { continue }
        $ExistingId = if ($A.PSObject.Properties['policy_id']) { $A.policy_id } else { $null }
        if (-not $ExistingId) { continue }
        $Key = Get-NormalizedActionText -Text $A.action
        if ($IdByText.ContainsKey($Key) -and $IdByText[$Key] -ne $ExistingId) {
            [void]$AmbiguousText.Add($Key)
        }
        else {
            $IdByText[$Key] = $ExistingId
        }
    }

    $UsedKeys = [System.Collections.Generic.HashSet[string]]::new()
    $Result = [System.Collections.Generic.List[object]]::new()
    foreach ($A in @($NewActions)) {
        $Key = Get-NormalizedActionText -Text $A.action
        if ($AmbiguousText.Contains($Key)) {
            Write-Warning "Merge-PolicyActionsPreservingIds: $NodeId -- action '$($A.action)' matches 2+ existing policy_actions with DIFFERENT registry ids; leaving policy_id null rather than guessing (t/3964)."
            $A | Add-Member -NotePropertyName 'policy_id' -NotePropertyValue $null -Force
        }
        elseif ($IdByText.ContainsKey($Key)) {
            $A | Add-Member -NotePropertyName 'policy_id' -NotePropertyValue $IdByText[$Key] -Force
            [void]$UsedKeys.Add($Key)
        }
        $Result.Add($A)
    }

    # Ambiguous existing ids are excluded here deliberately -- they already
    # got the "ambiguous match" WARN above (when a new action touched that
    # text) and reporting them as "dropped" too would double-warn on data
    # that was already inconsistent before this run, not newly lost by it.
    $DroppedIds = @(
        $IdByText.GetEnumerator() |
            Where-Object { -not $AmbiguousText.Contains($_.Key) -and -not $UsedKeys.Contains($_.Key) } |
            ForEach-Object { $_.Value }
    )
    if ($DroppedIds.Count -gt 0) {
        Write-Warning "Merge-PolicyActionsPreservingIds: $NodeId -- re-extraction dropped $($DroppedIds.Count) previously-registered policy action(s): $($DroppedIds -join ', ') (the model no longer returned a matching action text). Run Update-PolicyRegistry as its own deliberate data change if these should be cleaned up."
    }

    return @($Result)
}

function Merge-NodeGraphAttributes {
    <#
    .SYNOPSIS
        Merges a re-extraction's output into a node's existing
        graph_attributes instead of replacing it wholesale.
    .PARAMETER Existing
        The node's current graph_attributes ($null if the node has none yet).
    .PARAMETER New
        The model's extraction output for this node.
    .PARAMETER OwnedFields
        The single, shared list of fields extraction owns (mandatory --
        t/3964 condition 1: there is exactly one such list in the codebase,
        passed in by the caller, not redefined here). Any field on $New
        outside this list is WARNed and ignored for the merge.
    .PARAMETER NodeId
        Used only to make WARN messages actionable.
    #>
    [CmdletBinding()]
    param(
        [AllowNull()] $Existing,
        [Parameter(Mandatory)] $New,
        [Parameter(Mandatory)] [string[]]$OwnedFields,
        [string]$NodeId = '<unknown>'
    )

    Set-StrictMode -Version Latest

    $ExtraFields = @($New.PSObject.Properties.Name | Where-Object { $_ -notin $OwnedFields })
    if ($ExtraFields.Count -gt 0) {
        Write-Warning "Merge-NodeGraphAttributes: $NodeId -- model returned field(s) outside the owned-fields contract: $($ExtraFields -join ', ') (ignored for merge; check the extraction prompt/schema, t/3964)."
    }

    if ($null -eq $Existing) { return $New }

    $Merged = [ordered]@{}
    foreach ($P in $Existing.PSObject.Properties) { $Merged[$P.Name] = $P.Value }

    foreach ($Field in $OwnedFields) {
        if (-not $New.PSObject.Properties[$Field]) { continue }
        $Merged[$Field] = if ($Field -eq 'policy_actions') {
            Merge-PolicyActionsPreservingIds -ExistingActions $Existing.policy_actions -NewActions $New.policy_actions -NodeId $NodeId
        }
        else {
            $New.$Field
        }
    }

    return [PSCustomObject]$Merged
}
