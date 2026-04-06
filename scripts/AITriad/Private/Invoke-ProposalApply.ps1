# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-ProposalApply {
    <#
    .SYNOPSIS
        Applies a single taxonomy proposal (NEW/SPLIT/MERGE/RELABEL) to the taxonomy files.
    .DESCRIPTION
        Internal helper called by Approve-TaxonomyProposal. Mutates the taxonomy
        JSON file on disk and returns a result object.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Proposal,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest

    $TaxDir = Get-TaxonomyDir

    $PovFileMap = @{
        accelerationist = 'accelerationist.json'
        safetyist       = 'safetyist.json'
        skeptic         = 'skeptic.json'
        'situations' = 'situations.json'
    }

    $FileName = $PovFileMap[$Proposal.pov]
    if (-not $FileName) {
        return [PSCustomObject]@{ Success = $false; Error = "Unknown POV: $($Proposal.pov)" }
    }

    $FilePath = Join-Path $TaxDir $FileName
    if (-not (Test-Path $FilePath)) {
        return [PSCustomObject]@{ Success = $false; Error = "Taxonomy file not found: $FileName" }
    }

    try {
        $Raw = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
    } catch {
        return [PSCustomObject]@{ Success = $false; Error = "Failed to parse $FileName`: $_" }
    }

    $IsCrossCutting = $Proposal.pov -eq 'situations'
    $Today = (Get-Date).ToString('yyyy-MM-dd')

    switch ($Proposal.action) {
        'NEW' {
            # Check for ID collision
            $Existing = $Raw.nodes | Where-Object { $_.id -eq $Proposal.suggested_id }
            if ($Existing) {
                return [PSCustomObject]@{ Success = $false; Error = "Node ID '$($Proposal.suggested_id)' already exists" }
            }

            if ($IsCrossCutting) {
                $NewNode = [ordered]@{
                    id              = $Proposal.suggested_id
                    label           = $Proposal.label
                    description     = $Proposal.description
                    interpretations = [ordered]@{
                        accelerationist = ''
                        safetyist       = ''
                        skeptic         = ''
                    }
                    linked_nodes    = @()
                    conflict_ids    = @()
                }
            } else {
                $NewNode = [ordered]@{
                    id                 = $Proposal.suggested_id
                    category           = $Proposal.category
                    label              = $Proposal.label
                    description        = $Proposal.description
                    parent_id          = $null
                    children           = @()
                    situation_refs = @()
                }
            }

            $Raw.nodes += $NewNode
        }

        'RELABEL' {
            $Target = $Raw.nodes | Where-Object { $_.id -eq $Proposal.target_node_id }
            if (-not $Target) {
                return [PSCustomObject]@{ Success = $false; Error = "Target node '$($Proposal.target_node_id)' not found" }
            }

            if ($Proposal.label) { $Target.label = $Proposal.label }
            if ($Proposal.description) { $Target.description = $Proposal.description }
        }

        'MERGE' {
            $SurvivorId = $Proposal.surviving_node_id
            $MergeIds   = @($Proposal.merge_node_ids)

            $Survivor = $Raw.nodes | Where-Object { $_.id -eq $SurvivorId }
            if (-not $Survivor) {
                return [PSCustomObject]@{ Success = $false; Error = "Surviving node '$SurvivorId' not found" }
            }

            # Update survivor label/description if proposal provides them
            if ($Proposal.label) { $Survivor.label = $Proposal.label }
            if ($Proposal.description) { $Survivor.description = $Proposal.description }

            # Remove merged nodes (except survivor)
            $RemoveIds = $MergeIds | Where-Object { $_ -ne $SurvivorId }
            $Raw.nodes = @($Raw.nodes | Where-Object { $_.id -notin $RemoveIds })

            # Update references in remaining nodes
            foreach ($Node in $Raw.nodes) {
                if ($Node.PSObject.Properties['children'] -and $Node.children) {
                    $Node.children = @($Node.children | ForEach-Object {
                        if ($_ -in $RemoveIds) { $SurvivorId } else { $_ }
                    } | Select-Object -Unique)
                }
                if ($Node.PSObject.Properties['situation_refs'] -and $Node.situation_refs) {
                    $Node.situation_refs = @($Node.situation_refs | ForEach-Object {
                        if ($_ -in $RemoveIds) { $SurvivorId } else { $_ }
                    } | Select-Object -Unique)
                }
                if ($Node.PSObject.Properties['parent_id'] -and $Node.parent_id -in $RemoveIds) {
                    $Node.parent_id = $SurvivorId
                }
            }

            Write-Warning "Merged nodes removed: $($RemoveIds -join ', '). Summaries and edges referencing these IDs may need updating."
        }

        'SPLIT' {
            $TargetId = $Proposal.target_node_id
            $Target = $Raw.nodes | Where-Object { $_.id -eq $TargetId }
            if (-not $Target) {
                return [PSCustomObject]@{ Success = $false; Error = "Target node '$TargetId' not found for SPLIT" }
            }

            $ChildProposals = @($Proposal.children)
            if ($ChildProposals.Count -eq 0) {
                return [PSCustomObject]@{ Success = $false; Error = "SPLIT proposal has no children" }
            }

            # Create child nodes
            foreach ($Child in $ChildProposals) {
                if ($Child.PSObject.Properties['category']) { $ChildCat = $Child.category } else { $ChildCat = $Target.category }
                if ($Target.PSObject.Properties['situation_refs']) { $ChildSitRefs = $Target.situation_refs } else { $ChildSitRefs = @() }
                $ChildNode = [ordered]@{
                    id                 = $Child.suggested_id
                    category           = $ChildCat
                    label              = $Child.label
                    description        = $Child.description
                    parent_id          = $TargetId
                    children           = @()
                    situation_refs = $ChildSitRefs
                }
                $Raw.nodes += $ChildNode
            }

            # Update parent to reference children
            $Target.children = @($ChildProposals | ForEach-Object { $_.suggested_id })

            Write-Warning "Split '$TargetId' into $($ChildProposals.Count) children. Summaries referencing '$TargetId' may need re-processing."
        }

        'REORDER' {
            $TargetId = $Proposal.target_node_id
            $NewParentId = $Proposal.new_parent_id

            $Target = $Raw.nodes | Where-Object { $_.id -eq $TargetId }
            if (-not $Target) {
                return [PSCustomObject]@{ Success = $false; Error = "Target node '$TargetId' not found for REORDER" }
            }

            $NewParent = $Raw.nodes | Where-Object { $_.id -eq $NewParentId }
            if (-not $NewParent) {
                return [PSCustomObject]@{ Success = $false; Error = "New parent '$NewParentId' not found — exact match required" }
            }

            # Remove from old parent's children array
            $OldParentId = $Target.parent_id
            if ($OldParentId) {
                $OldParent = $Raw.nodes | Where-Object { $_.id -eq $OldParentId }
                if ($OldParent -and $OldParent.PSObject.Properties['children']) {
                    $OldParent.children = @($OldParent.children | Where-Object { $_ -ne $TargetId })
                }
            }

            # Set new parent
            $Target.parent_id = $NewParentId

            # Add to new parent's children
            if ($NewParent.PSObject.Properties['children']) {
                if ($TargetId -notin @($NewParent.children)) {
                    $NewParent.children = @($NewParent.children) + @($TargetId)
                }
            }
            else {
                $NewParent | Add-Member -NotePropertyName 'children' -NotePropertyValue @($TargetId) -Force
            }
        }

        'DEPTH_EXPAND' {
            $TargetId = $Proposal.target_node_id
            $Target = $Raw.nodes | Where-Object { $_.id -eq $TargetId }
            if (-not $Target) {
                return [PSCustomObject]@{ Success = $false; Error = "Target node '$TargetId' not found for DEPTH_EXPAND" }
            }

            $SubGroups = @($Proposal.children)
            if ($SubGroups.Count -eq 0) {
                return [PSCustomObject]@{ Success = $false; Error = "DEPTH_EXPAND has no sub-group proposals" }
            }
            if ($SubGroups.Count -gt 3) {
                return [PSCustomObject]@{ Success = $false; Error = "DEPTH_EXPAND exceeds max 3 node changes per proposal" }
            }

            # Create intermediate parent nodes under the dense parent
            foreach ($SubGroup in $SubGroups) {
                if ($SubGroup.PSObject.Properties['category']) { $SubGrpCat = $SubGroup.category } else { $SubGrpCat = $Target.category }
                $IntNode = [ordered]@{
                    id          = $SubGroup.suggested_id
                    category    = $SubGrpCat
                    label       = $SubGroup.label
                    description = $SubGroup.description
                    parent_id   = $TargetId
                    children    = @()
                    situation_refs = @()
                }
                $Raw.nodes += [PSCustomObject]$IntNode

                # Move assigned children under the new intermediate node
                if ($SubGroup.PSObject.Properties['assigned_children']) {
                    foreach ($ChildId in @($SubGroup.assigned_children)) {
                        $Child = $Raw.nodes | Where-Object { $_.id -eq $ChildId }
                        if ($Child) {
                            $Child.parent_id = $SubGroup.suggested_id
                            $IntNode.children = @($IntNode.children) + @($ChildId)
                        }
                    }
                    # Remove moved children from original parent's children array
                    if ($Target.PSObject.Properties['children']) {
                        $Target.children = @($Target.children | Where-Object { $_ -notin @($SubGroup.assigned_children) })
                    }
                }
            }

            # Add new intermediate nodes to parent's children
            if ($Target.PSObject.Properties['children']) {
                $Target.children = @($Target.children) + @($SubGroups | ForEach-Object { $_.suggested_id })
            }
        }

        'WIDTH_EXPAND' {
            # Same as NEW but motivated by density signals
            if ($Raw.nodes | Where-Object { $_.id -eq $Proposal.suggested_id }) {
                return [PSCustomObject]@{ Success = $false; Error = "Node ID '$($Proposal.suggested_id)' already exists" }
            }

            $NewNode = [ordered]@{
                id          = $Proposal.suggested_id
                category    = $Proposal.category
                label       = $Proposal.label
                description = $Proposal.description
                parent_id   = $null
                children    = @()
                situation_refs = @()
            }
            $Raw.nodes += [PSCustomObject]$NewNode
        }

        default {
            return [PSCustomObject]@{ Success = $false; Error = "Unknown action: $($Proposal.action)" }
        }
    }

    $Raw.last_modified = $Today
    $Json = $Raw | ConvertTo-Json -Depth 20
    try {
        Set-Content -Path $FilePath -Value $Json -Encoding UTF8
    }
    catch {
        return [PSCustomObject]@{ Success = $false; Error = "Failed to write $FileName — $($_.Exception.Message)" }
    }

    return [PSCustomObject]@{ Success = $true; Error = $null }
}
