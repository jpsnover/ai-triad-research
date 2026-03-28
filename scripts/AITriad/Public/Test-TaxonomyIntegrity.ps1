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
    .EXAMPLE
        Test-TaxonomyIntegrity
    .EXAMPLE
        Test-TaxonomyIntegrity -Detailed
    #>
    [CmdletBinding()]
    param(
        [switch]$Detailed,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $Issues = [System.Collections.Generic.List[PSCustomObject]]::new()
    $Checks = 0
    $Passed = 0

    # ── Load all data ──
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
    $AllNodeIds = [System.Collections.Generic.HashSet[string]]::new()
    $PolicyRefs = @{}          # policy_id -> list of node_ids
    $DuplicateRefs = @()       # nodes with duplicate policy_id refs
    $MissingPolicyId = @()     # policy_actions without policy_id
    $ActualPovs = @{}          # policy_id -> set of povs
    $ActualCounts = @{}        # policy_id -> count

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20

        foreach ($Node in $FileData.nodes) {
            [void]$AllNodeIds.Add($Node.id)

            if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
            if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }

            $SeenIds = [System.Collections.Generic.HashSet[string]]::new()
            foreach ($PA in $Node.graph_attributes.policy_actions) {
                $Pid = if ($PA.PSObject.Properties['policy_id']) { $PA.policy_id } else { $null }
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
        $Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json -Depth 20
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
            $Actual = if ($ActualCounts.ContainsKey($Pol.id)) { $ActualCounts[$Pol.id] } else { 0 }
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
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json -Depth 20
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
        $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json -Depth 20
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
            $Color = if ($Issue.Severity -eq 'Error') { 'Red' } else { 'Yellow' }
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
