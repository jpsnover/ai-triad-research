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

    $TaxDir = Join-Path $RepoRoot 'taxonomy' 'Origin'

    $PovFileMap = @{
        accelerationist = 'accelerationist.json'
        safetyist       = 'safetyist.json'
        skeptic         = 'skeptic.json'
        'cross-cutting' = 'cross-cutting.json'
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

    $IsCrossCutting = $Proposal.pov -eq 'cross-cutting'
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
                    cross_cutting_refs = @()
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
                if ($Node.PSObject.Properties['cross_cutting_refs'] -and $Node.cross_cutting_refs) {
                    $Node.cross_cutting_refs = @($Node.cross_cutting_refs | ForEach-Object {
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
                $ChildNode = [ordered]@{
                    id                 = $Child.suggested_id
                    category           = if ($Child.PSObject.Properties['category']) { $Child.category } else { $Target.category }
                    label              = $Child.label
                    description        = $Child.description
                    parent_id          = $TargetId
                    children           = @()
                    cross_cutting_refs = if ($Target.PSObject.Properties['cross_cutting_refs']) { $Target.cross_cutting_refs } else { @() }
                }
                $Raw.nodes += $ChildNode
            }

            # Update parent to reference children
            $Target.children = @($ChildProposals | ForEach-Object { $_.suggested_id })

            Write-Warning "Split '$TargetId' into $($ChildProposals.Count) children. Summaries referencing '$TargetId' may need re-processing."
        }

        default {
            return [PSCustomObject]@{ Success = $false; Error = "Unknown action: $($Proposal.action)" }
        }
    }

    $Raw.last_modified = $Today
    $Json = $Raw | ConvertTo-Json -Depth 20
    Set-Content -Path $FilePath -Value $Json -Encoding UTF8

    return [PSCustomObject]@{ Success = $true; Error = $null }
}
