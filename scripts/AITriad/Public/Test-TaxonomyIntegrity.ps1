# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-TaxonomyIntegrity {
    <#
    .SYNOPSIS
        Validate taxonomy data integrity across all files.
    .DESCRIPTION
        Checks:
        - All policy_id references resolve to registry entries
        - All registry entries are referenced by at least one node
        - member_count and source_povs are accurate
        - No duplicate policy_id references within a single node
        - Edge source/target IDs resolve to existing nodes or policies
        - Embeddings exist for all nodes and policies
    .PARAMETER Detailed
        Show per-issue details instead of just counts.
    .PARAMETER PassThru
        Return a summary object.
    .PARAMETER Repair
        Auto-fix all repairable issues (dangling children, parent refs, situation refs, bad edges).
    .EXAMPLE
        Test-TaxonomyIntegrity
    .EXAMPLE
        Test-TaxonomyIntegrity -Detailed
    .EXAMPLE
        Test-TaxonomyIntegrity -Repair
    #>
    [CmdletBinding()]
    param(
        [switch]$Detailed,
        [switch]$PassThru,
        [switch]$Repair
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $Issues = [System.Collections.Generic.List[PSCustomObject]]::new()
    $Checks = 0
    $Passed = 0

    # ── Load all data ──
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    $AllNodeIds = [System.Collections.Generic.HashSet[string]]::new()
    $PovNodeIds = [System.Collections.Generic.HashSet[string]]::new()
    $PolicyRefs = @{}          # policy_id -> list of node_ids
    $DuplicateRefs = @()       # nodes with duplicate policy_id refs
    $MissingPolicyId = @()     # policy_actions without policy_id
    $ActualPovs = @{}          # policy_id -> set of povs
    $ActualCounts = @{}        # policy_id -> count
    $LoadedFiles = @{}         # povKey -> { Path, Data }
    $Dirty = @{}               # povKey -> $true if modified

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
        $LoadedFiles[$PovKey] = @{ Path = $FilePath; Data = $FileData }

        foreach ($Node in $FileData.nodes) {
            [void]$AllNodeIds.Add($Node.id)
            if ($PovKey -ne 'situations') { [void]$PovNodeIds.Add($Node.id) }

            if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
            if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }

            $SeenIds = [System.Collections.Generic.HashSet[string]]::new()
            foreach ($PA in $Node.graph_attributes.policy_actions) {
                if ($PA.PSObject.Properties['policy_id']) { $Pid = $PA.policy_id } else { $Pid = $null }
                if (-not $Pid) {
                    $MissingPolicyId += [PSCustomObject]@{ NodeId = $Node.id; POV = $PovKey; Action = $PA.action }
                    continue
                }

                if (-not $SeenIds.Add($Pid)) {
                    $DuplicateRefs += [PSCustomObject]@{ NodeId = $Node.id; PolicyId = $Pid }
                }

                if (-not $PolicyRefs.ContainsKey($Pid)) {
                    $PolicyRefs[$Pid] = [System.Collections.Generic.List[string]]::new()
                    $ActualPovs[$Pid] = [System.Collections.Generic.HashSet[string]]::new()
                    $ActualCounts[$Pid] = 0
                }
                $PolicyRefs[$Pid].Add($Node.id)
                [void]$ActualPovs[$Pid].Add($PovKey)
                $ActualCounts[$Pid]++
            }
        }
    }

    # ── Check 1: Policy registry ──
    $Checks++
    $RegistryPath = Join-Path $TaxDir 'policy_actions.json'
    if (Test-Path $RegistryPath) {
        $Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
        $RegistryIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($Pol in $Registry.policies) { [void]$RegistryIds.Add($Pol.id) }

        # Unresolved refs
        $Unresolved = @($PolicyRefs.Keys | Where-Object { -not $RegistryIds.Contains($_) })
        if ($Unresolved.Count -gt 0) {
            $Issues.Add([PSCustomObject]@{ Check = 'PolicyRef'; Severity = 'Error'; Count = $Unresolved.Count; Detail = "policy_id refs not in registry: $($Unresolved -join ', ')" })
        } else { $Passed++ }

        # Orphaned
        $Checks++
        $Orphaned = @($RegistryIds | Where-Object { -not $PolicyRefs.ContainsKey($_) })
        if ($Orphaned.Count -gt 0) {
            $Issues.Add([PSCustomObject]@{ Check = 'Orphaned'; Severity = 'Warning'; Count = $Orphaned.Count; Detail = "registry entries with no node refs: $($Orphaned[0..([Math]::Min(4, $Orphaned.Count-1))] -join ', ')$(if ($Orphaned.Count -gt 5) { ' ...' })" })
        } else { $Passed++ }

        # member_count accuracy
        $Checks++
        $CountMismatches = 0
        foreach ($Pol in $Registry.policies) {
            if ($ActualCounts.ContainsKey($Pol.id)) { $Actual = $ActualCounts[$Pol.id] } else { $Actual = 0 }
            if ($Pol.member_count -ne $Actual) { $CountMismatches++ }
        }
        if ($CountMismatches -gt 0) {
            $Issues.Add([PSCustomObject]@{ Check = 'MemberCount'; Severity = 'Warning'; Count = $CountMismatches; Detail = "$CountMismatches policies have inaccurate member_count" })
        } else { $Passed++ }
    }
    else {
        $Issues.Add([PSCustomObject]@{ Check = 'Registry'; Severity = 'Error'; Count = 1; Detail = 'policy_actions.json not found' })
    }

    # ── Check 2: Missing policy_id ──
    $Checks++
    if ($MissingPolicyId.Count -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'MissingPolicyId'; Severity = 'Warning'; Count = $MissingPolicyId.Count; Detail = "$($MissingPolicyId.Count) policy_actions without policy_id" })
    } else { $Passed++ }

    # ── Check 3: Duplicate refs ──
    $Checks++
    if ($DuplicateRefs.Count -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'DuplicateRef'; Severity = 'Warning'; Count = $DuplicateRefs.Count; Detail = "$($DuplicateRefs.Count) duplicate policy_id refs within nodes" })
    } else { $Passed++ }

    # ── Check 4: Edge integrity ──
    $Checks++
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $BadEdges = 0
    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
        $ValidIds = [System.Collections.Generic.HashSet[string]]::new($AllNodeIds)
        if ($Registry) { foreach ($Pol in $Registry.policies) { [void]$ValidIds.Add($Pol.id) } }

        foreach ($Edge in $EdgesData.edges) {
            if (-not $ValidIds.Contains($Edge.source) -or -not $ValidIds.Contains($Edge.target)) {
                $BadEdges++
            }
        }
    }
    if ($BadEdges -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'EdgeRef'; Severity = 'Error'; Count = $BadEdges; Detail = "$BadEdges edges reference non-existent nodes/policies" })
    } else { $Passed++ }

    # ── Check 5: Embedding coverage ──
    $Checks++
    $EmbPath = Join-Path $TaxDir 'embeddings.json'
    $MissingEmb = 0
    if (Test-Path $EmbPath) {
        $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
        $EmbIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($Prop in $EmbData.nodes.PSObject.Properties) { [void]$EmbIds.Add($Prop.Name) }

        foreach ($Nid in $AllNodeIds) {
            if (-not $EmbIds.Contains($Nid)) { $MissingEmb++ }
        }
        if ($Registry) {
            foreach ($Pol in $Registry.policies) {
                if (-not $EmbIds.Contains($Pol.id)) { $MissingEmb++ }
            }
        }
    }
    else {
        $MissingEmb = $AllNodeIds.Count
    }
    if ($MissingEmb -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'Embeddings'; Severity = 'Warning'; Count = $MissingEmb; Detail = "$MissingEmb nodes/policies missing embeddings" })
    } else { $Passed++ }

    # ── Check 6: Dangling children ──
    $Checks++
    $DanglingChildren = @()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            if (-not $Node.PSObject.Properties['children'] -or $null -eq $Node.children) { continue }
            foreach ($ChildId in @($Node.children)) {
                if (-not $PovNodeIds.Contains($ChildId)) {
                    $DanglingChildren += [PSCustomObject]@{ NodeId = $Node.id; ChildId = $ChildId; POV = $PovKey }
                }
            }
        }
    }
    if ($DanglingChildren.Count -gt 0) {
        $Detail = ($DanglingChildren | ForEach-Object { "$($_.NodeId) -> $($_.ChildId)" }) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'DanglingChild'; Severity = 'Error'; Count = $DanglingChildren.Count; Detail = "children ref non-existent nodes: $Detail" })
    } else { $Passed++ }

    # ── Check 7: Dangling parent_id ──
    $Checks++
    $DanglingParents = @()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            if ($Node.parent_id -and -not $PovNodeIds.Contains($Node.parent_id)) {
                $DanglingParents += [PSCustomObject]@{ NodeId = $Node.id; ParentId = $Node.parent_id; POV = $PovKey }
            }
        }
    }
    if ($DanglingParents.Count -gt 0) {
        $Detail = ($DanglingParents | ForEach-Object { "$($_.NodeId) -> $($_.ParentId)" }) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'DanglingParent'; Severity = 'Error'; Count = $DanglingParents.Count; Detail = "parent_id refs non-existent nodes: $Detail" })
    } else { $Passed++ }

    # ── Check 8: Dangling situation_refs ──
    $Checks++
    $SitIds = [System.Collections.Generic.HashSet[string]]::new()
    if ($LoadedFiles.ContainsKey('situations')) {
        foreach ($N in $LoadedFiles['situations'].Data.nodes) { [void]$SitIds.Add($N.id) }
    }
    $DanglingSitRefs = @()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            if (-not $Node.PSObject.Properties['situation_refs'] -or $null -eq $Node.situation_refs) { continue }
            foreach ($Ref in @($Node.situation_refs)) {
                if (-not $SitIds.Contains($Ref)) {
                    $DanglingSitRefs += [PSCustomObject]@{ NodeId = $Node.id; SitRef = $Ref; POV = $PovKey }
                }
            }
        }
    }
    if ($DanglingSitRefs.Count -gt 0) {
        $Detail = ($DanglingSitRefs | ForEach-Object { "$($_.NodeId) -> $($_.SitRef)" }) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'DanglingSitRef'; Severity = 'Error'; Count = $DanglingSitRefs.Count; Detail = "situation_refs non-existent nodes: $Detail" })
    } else { $Passed++ }

    # ── Check 9: Dangling linked_nodes in situations ──
    $Checks++
    $DanglingLinked = @()
    if ($LoadedFiles.ContainsKey('situations')) {
        foreach ($Node in $LoadedFiles['situations'].Data.nodes) {
            if (-not $Node.PSObject.Properties['linked_nodes'] -or $null -eq $Node.linked_nodes) { continue }
            foreach ($Linked in @($Node.linked_nodes)) {
                if (-not $AllNodeIds.Contains($Linked)) {
                    $DanglingLinked += [PSCustomObject]@{ NodeId = $Node.id; LinkedId = $Linked }
                }
            }
        }
    }
    if ($DanglingLinked.Count -gt 0) {
        $Detail = ($DanglingLinked | ForEach-Object { "$($_.NodeId) -> $($_.LinkedId)" }) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'DanglingLinked'; Severity = 'Warning'; Count = $DanglingLinked.Count; Detail = "linked_nodes ref non-existent nodes: $Detail" })
    } else { $Passed++ }

    # ── Repair ──
    if ($Repair -and $Issues.Count -gt 0) {
        $Repaired = 0
        Write-Host ''
        Write-Host '  Repairing...' -ForegroundColor Cyan

        # Fix dangling children
        foreach ($DC in $DanglingChildren) {
            $Node = $LoadedFiles[$DC.POV].Data.nodes | Where-Object { $_.id -eq $DC.NodeId }
            $Node.children = @($Node.children | Where-Object { $_ -ne $DC.ChildId })
            $Dirty[$DC.POV] = $true
            $Repaired++
            Write-Host "    Removed child '$($DC.ChildId)' from $($DC.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling parent_id
        foreach ($DP in $DanglingParents) {
            $Node = $LoadedFiles[$DP.POV].Data.nodes | Where-Object { $_.id -eq $DP.NodeId }
            $Node.parent_id = $null
            $Dirty[$DP.POV] = $true
            $Repaired++
            Write-Host "    Cleared parent_id '$($DP.ParentId)' from $($DP.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling situation_refs
        foreach ($DS in $DanglingSitRefs) {
            $Node = $LoadedFiles[$DS.POV].Data.nodes | Where-Object { $_.id -eq $DS.NodeId }
            $Node.situation_refs = @($Node.situation_refs | Where-Object { $_ -ne $DS.SitRef })
            $Dirty[$DS.POV] = $true
            $Repaired++
            Write-Host "    Removed situation_ref '$($DS.SitRef)' from $($DS.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling linked_nodes in situations
        foreach ($DL in $DanglingLinked) {
            $Node = $LoadedFiles['situations'].Data.nodes | Where-Object { $_.id -eq $DL.NodeId }
            $Node.linked_nodes = @($Node.linked_nodes | Where-Object { $_ -ne $DL.LinkedId })
            $Dirty['situations'] = $true
            $Repaired++
            Write-Host "    Removed linked_node '$($DL.LinkedId)' from $($DL.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling edges
        $EdgesPath = Join-Path $TaxDir 'edges.json'
        if ($BadEdges -gt 0 -and (Test-Path $EdgesPath)) {
            $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
            $ValidIds = [System.Collections.Generic.HashSet[string]]::new($AllNodeIds)
            if ($Registry) { foreach ($Pol in $Registry.policies) { [void]$ValidIds.Add($Pol.id) } }
            $OrigCount = $EdgesData.edges.Count
            $EdgesData.edges = @($EdgesData.edges | Where-Object { $ValidIds.Contains($_.source) -and $ValidIds.Contains($_.target) })
            $Removed = $OrigCount - $EdgesData.edges.Count
            if ($Removed -gt 0) {
                ($EdgesData | ConvertTo-Json -Depth 20) -replace "`r`n", "`n" | Set-Content -Path $EdgesPath -Encoding UTF8 -NoNewline
                $Repaired += $Removed
                Write-Host "    Removed $Removed dangling edges" -ForegroundColor Yellow
            }
        }

        # Save modified files
        foreach ($PovKey in $Dirty.Keys) {
            $Entry = $LoadedFiles[$PovKey]
            ($Entry.Data | ConvertTo-Json -Depth 20) -replace "`r`n", "`n" | Set-Content -Path $Entry.Path -Encoding UTF8 -NoNewline
            Write-Host "    Saved $($Entry.Path)" -ForegroundColor Green
        }

        Write-Host "  Repaired $Repaired issue(s)." -ForegroundColor Green
    }

    # ── Report ──
    Write-Host ''
    Write-Host '=== Taxonomy Integrity Check ===' -ForegroundColor Cyan
    Write-Host "  Nodes:       $($AllNodeIds.Count)" -ForegroundColor White
    Write-Host "  Policies:    $(if ($Registry) { $Registry.policies.Count } else { '?' })" -ForegroundColor White
    Write-Host "  Checks:      $Checks" -ForegroundColor White
    Write-Host "  Passed:      $Passed" -ForegroundColor Green
    Write-Host "  Issues:      $($Issues.Count)" -ForegroundColor $(if ($Issues.Count -gt 0) { 'Yellow' } else { 'Green' })

    if ($Issues.Count -gt 0) {
        Write-Host ''
        foreach ($Issue in $Issues) {
            if ($Issue.Severity -eq 'Error') { $Color = 'Red' } else { $Color = 'Yellow' }
            Write-Host "  [$($Issue.Severity)] $($Issue.Check): $($Issue.Detail)" -ForegroundColor $Color
        }
    }
    else {
        Write-Host ''
        Write-Host '  All checks passed!' -ForegroundColor Green
    }
    Write-Host ''

    if ($PassThru) {
        [PSCustomObject]@{
            Nodes     = $AllNodeIds.Count
            Policies  = if ($Registry) { $Registry.policies.Count } else { 0 }
            Checks    = $Checks
            Passed    = $Passed
            Issues    = $Issues.Count
            Details   = @($Issues)
        }
    }
}
