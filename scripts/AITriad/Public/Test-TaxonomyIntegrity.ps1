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
        - No self-loop edges (source == target), which are malformed
        - Embeddings exist for all nodes and policies
    .PARAMETER Detailed
        Show per-issue details instead of just counts.
    .PARAMETER PassThru
        Return a summary object.
    .PARAMETER Repair
        Auto-fix all repairable issues (dangling children, parent refs, situation refs, bad edges).
        Every pruned reference and edge (full edge object, rationale included) is written to a
        durable audit file before any taxonomy file is modified, and summarised as a warning.
    .PARAMETER AuditDir
        Directory for the -Repair audit file. Defaults to <data root>/audit/integrity-repair.
    .PARAMETER Force
        Required when -Repair would prune more than 20 edges (dangling + self-loop combined)
        in one run. Without it, the edge-prune step is SKIPPED (edges.json is left untouched,
        byte-identical) and a Write-Warning explains why; the four reference categories
        (children, parent_id, situation_refs, linked_nodes) still repair normally, since a
        human fixing one small dangling-parent issue shouldn't be blocked by an unrelated
        large edge cascade. See the N=20 threshold comment at the point of use (t/3853) for
        why that number and when to revisit it.
    .EXAMPLE
        Test-TaxonomyIntegrity
    .EXAMPLE
        Test-TaxonomyIntegrity -Detailed
    .EXAMPLE
        Test-TaxonomyIntegrity -Repair
    .EXAMPLE
        Test-TaxonomyIntegrity -Repair -Force
    .LINK
        Show-AITriadHelp
    .LINK
        Get-Tax
    .LINK
        Get-GraphNode
    .LINK
        Get-TaxonomyHealth
    .LINK
        Compare-Taxonomy
    .LINK
        Test-OntologyCompliance
    .LINK
        Get-RelevantTaxonomyNodes
    #>
    [CmdletBinding()]
    param(
        [switch]$Detailed,
        [switch]$PassThru,
        [switch]$Repair,
        [string]$AuditDir,
        [switch]$Force
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
                if ($PA.PSObject.Properties['policy_id']) { $PolicyId = $PA.policy_id } else { $PolicyId = $null }
                if (-not $PolicyId) {
                    $PaAction = if ($PA.PSObject.Properties['action']) { $PA.action } else { $null }
                    $MissingPolicyId += [PSCustomObject]@{ NodeId = $Node.id; POV = $PovKey; Action = $PaAction }
                    continue
                }

                if (-not $SeenIds.Add($PolicyId)) {
                    $DuplicateRefs += [PSCustomObject]@{ NodeId = $Node.id; PolicyId = $PolicyId }
                }

                if (-not $PolicyRefs.ContainsKey($PolicyId)) {
                    $PolicyRefs[$PolicyId] = [System.Collections.Generic.List[string]]::new()
                    $ActualPovs[$PolicyId] = [System.Collections.Generic.HashSet[string]]::new()
                    $ActualCounts[$PolicyId] = 0
                }
                $PolicyRefs[$PolicyId].Add($Node.id)
                [void]$ActualPovs[$PolicyId].Add($PovKey)
                $ActualCounts[$PolicyId]++
            }
        }
    }

    # ── Check 1: Policy registry ──
    # t/3879 decomposition: extracted to Get-PolicyRegistryIssues (Private/), verbatim logic.
    # $Registry is threaded back explicitly -- Check 4 (edge integrity), Check 5 (embeddings),
    # and the final report all read it downstream of this check.
    $RegistryPath = Join-Path $TaxDir 'policy_actions.json'
    $PolicyRegistryResult = Get-PolicyRegistryIssues -RegistryPath $RegistryPath -PolicyRefs $PolicyRefs -ActualCounts $ActualCounts
    $Registry = $PolicyRegistryResult.Registry
    $Checks += $PolicyRegistryResult.ChecksRun
    $Passed += $PolicyRegistryResult.Passed
    foreach ($RegIssue in $PolicyRegistryResult.Issues) { $Issues.Add($RegIssue) }

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
    $SelfLoopEdges = 0
    if (Test-Path $EdgesPath) {
        $EdgesData = Read-EdgesFile -Path $EdgesPath   # t/2974: coercion-free read (preserve discovered_at strings)
        $ValidIds = [System.Collections.Generic.HashSet[string]]::new($AllNodeIds)
        if ($Registry) { foreach ($Pol in $Registry.policies) { [void]$ValidIds.Add($Pol.id) } }

        foreach ($Edge in @($EdgesData.edges)) {
            $Src = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
            $Tgt = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
            if (-not $ValidIds.Contains($Src) -or -not $ValidIds.Contains($Tgt)) {
                $BadEdges++
            }
            # Self-loops (source == target) are malformed: Invoke-EdgeDiscovery and
            # Import-OrganizationEdge reject them at creation, so any in the stored
            # graph are legacy/hand-introduced (t/2682). Count non-null sources only.
            if ($null -ne $Src -and $Src -eq $Tgt) {
                $SelfLoopEdges++
            }
        }
    }
    if ($BadEdges -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'EdgeRef'; Severity = 'Error'; Count = $BadEdges; Detail = "$BadEdges edges reference non-existent nodes/policies" })
    } else { $Passed++ }

    # ── Check 4b: Self-loop edges ──
    $Checks++
    if ($SelfLoopEdges -gt 0) {
        $Issues.Add([PSCustomObject]@{ Check = 'SelfLoopEdge'; Severity = 'Error'; Count = $SelfLoopEdges; Detail = "$SelfLoopEdges self-loop edge(s) where source == target (malformed; rejected at creation)" })
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
            $ParentId = if ($Node.PSObject.Properties['parent_id']) { $Node.parent_id } else { $null }
            if ($ParentId -and -not $PovNodeIds.Contains($ParentId)) {
                $DanglingParents += [PSCustomObject]@{ NodeId = $Node.id; ParentId = $ParentId; POV = $PovKey }
            }
        }
    }
    if ($DanglingParents.Count -gt 0) {
        $Detail = ($DanglingParents | ForEach-Object { "$($_.NodeId) -> $($_.ParentId)" }) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'DanglingParent'; Severity = 'Error'; Count = $DanglingParents.Count; Detail = "parent_id refs non-existent nodes: $Detail" })
    } else { $Passed++ }

    # ── Check 7b: Parent BDI category mismatch ──
    #$Checks++
    #$CategoryMismatches = @()
    #$NodeCategoryMap = @{}
    #foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
    #    if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
    #    foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
    #        if ($Node.PSObject.Properties['category'] -and $Node.category) {
    #            $NodeCategoryMap[$Node.id] = $Node.category
    #        }
    #    }
    #}
    #foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
    #    if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
    #    foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
    #        if (-not $Node.parent_id) { continue }
    #        $NodeCat = if ($Node.PSObject.Properties['category']) { $Node.category } else { $null }
    #        $ParentCat = $NodeCategoryMap[$Node.parent_id]
    #        if ($NodeCat -and $ParentCat -and $NodeCat -ne $ParentCat) {
    #            $CategoryMismatches += [PSCustomObject]@{
    #                NodeId    = $Node.id
    #                NodeCat   = $NodeCat
    #                ParentId  = $Node.parent_id
    #                ParentCat = $ParentCat
    #                POV       = $PovKey
    #            }
    #        }
    #    }
    #}
    #if ($CategoryMismatches.Count -gt 0) {
    #    $Detail = ($CategoryMismatches | ForEach-Object { "$($_.NodeId) ($($_.NodeCat)) parent=$($_.ParentId) ($($_.ParentCat))" }) -join '; '
    #    $Issues.Add([PSCustomObject]@{ Check = 'ParentCategoryMismatch'; Severity = 'Warning'; Count = $CategoryMismatches.Count; Detail = "parent_id points to different BDI category: $Detail" })
    #} else { $Passed++ }

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

    # ── Check 10: Situation <-> POV-node reciprocity (t/2979) ──
    # linked_nodes (situation -> POV node) and situation_refs (POV node -> situation) must be
    # MUTUAL: N in S.linked_nodes  <=>  S in N.situation_refs. The two directions were free to
    # diverge — creation sites init both empty, and this cmdlet only PRUNES dangling refs (Checks
    # 8/9), it never reciprocates — so evidence authored on one side is invisible on the other.
    # That silent drift is the t/2979 root cause. PROMOTED Warning -> Error (t/2979): the WS-A
    # reciprocity backfill is pushed and the live corpus is confirmed fully mutual
    # (Repair-SituationReciprocity -DryRun = 0/0), so the false-block risk that kept this warn-first
    # is gone; any NEW drift is now a hard failure. Report BOTH asymmetry classes. Only links whose
    # BOTH endpoints exist are evaluated — a ref to a non-existent node/situation is a dangling-ref
    # issue (Checks 8/9), not an asymmetry.
    $Checks++
    $SitLinked = @{}    # situation id -> HashSet of its linked node ids
    if ($LoadedFiles.ContainsKey('situations')) {
        foreach ($Node in $LoadedFiles['situations'].Data.nodes) {
            $Set = [System.Collections.Generic.HashSet[string]]::new()
            if ($Node.PSObject.Properties['linked_nodes'] -and $null -ne $Node.linked_nodes) {
                foreach ($L in @($Node.linked_nodes)) { [void]$Set.Add($L) }
            }
            $SitLinked[$Node.id] = $Set
        }
    }
    $NodeSitRefs = @{}  # POV node id -> HashSet of its situation refs
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            $Set = [System.Collections.Generic.HashSet[string]]::new()
            if ($Node.PSObject.Properties['situation_refs'] -and $null -ne $Node.situation_refs) {
                foreach ($R in @($Node.situation_refs)) { [void]$Set.Add($R) }
            }
            $NodeSitRefs[$Node.id] = $Set
        }
    }
    # forward-only: N in S.linked_nodes (N a real POV node) but S NOT in N.situation_refs
    $ForwardOnly = [System.Collections.Generic.List[string]]::new()
    foreach ($SitId in $SitLinked.Keys) {
        foreach ($N in $SitLinked[$SitId]) {
            if (-not $PovNodeIds.Contains($N)) { continue }   # only POV nodes carry situation_refs
            $Refs = if ($NodeSitRefs.ContainsKey($N)) { $NodeSitRefs[$N] } else { $null }
            if ($null -eq $Refs -or -not $Refs.Contains($SitId)) { $ForwardOnly.Add("$SitId -> $N") }
        }
    }
    # reverse-only: S in N.situation_refs (S a real situation) but N NOT in S.linked_nodes
    $ReverseOnly = [System.Collections.Generic.List[string]]::new()
    foreach ($N in $NodeSitRefs.Keys) {
        foreach ($SitId in $NodeSitRefs[$N]) {
            if (-not $SitIds.Contains($SitId)) { continue }   # dangling situation_ref -> Check 8
            $Linked = if ($SitLinked.ContainsKey($SitId)) { $SitLinked[$SitId] } else { $null }
            if ($null -eq $Linked -or -not $Linked.Contains($N)) { $ReverseOnly.Add("$N -> $SitId") }
        }
    }
    $AsymCount = $ForwardOnly.Count + $ReverseOnly.Count
    if ($AsymCount -gt 0) {
        $FwdPart = if ($ForwardOnly.Count -gt 0) { " forward-only (in linked_nodes, missing situation_refs back-ref) [$($ForwardOnly.Count)]: $((@($ForwardOnly) | Select-Object -First 5) -join '; ')$(if ($ForwardOnly.Count -gt 5) { ' ...' })" } else { '' }
        $RevPart = if ($ReverseOnly.Count -gt 0) { " reverse-only (in situation_refs, missing linked_nodes back-ref) [$($ReverseOnly.Count)]: $((@($ReverseOnly) | Select-Object -First 5) -join '; ')$(if ($ReverseOnly.Count -gt 5) { ' ...' })" } else { '' }
        $Issues.Add([PSCustomObject]@{ Check = 'SituationReciprocity'; Severity = 'Error'; Count = $AsymCount; Detail = "situation.linked_nodes and POV situation_refs are not mutual (t/2979) —$FwdPart$RevPart. Fix: run Repair-SituationReciprocity -DryRun to preview, then Repair-SituationReciprocity to reconcile both directions. The two directions must stay mutual." })
    } else { $Passed++ }

    # ── BDI weight range validation ──
    # Distinguishes "out-of-range" (Error — value present but violates the schema
    # range) from "unscored" (Warning — value null, node was never assigned).
    # Refined under t/1320: null confidence/priority/operationality is a semantic
    # gap (needs re-run of Invoke-BDIWeightAssignment) not a data corruption bug,
    # and treating it as Error was blocking Test-TaxonomyIntegrity error count = 0
    # even when the taxonomy was otherwise clean.
    $Checks++
    $BadWeights   = [System.Collections.Generic.List[string]]::new()
    $UnscoredList = [System.Collections.Generic.List[string]]::new()
    foreach ($PovKey in $LoadedFiles.Keys) {
        $Entry = $LoadedFiles[$PovKey]
        if (-not $Entry.Data.PSObject.Properties['nodes']) { continue }
        foreach ($Node in $Entry.Data.nodes) {
            if (-not $Node.PSObject.Properties['category']) { continue }
            if ($Node.category -eq 'Intentions' -and $Node.PSObject.Properties['operationality']) {
                $Op = $Node.operationality
                if ($null -eq $Op) {
                    $UnscoredList.Add("$($Node.id): operationality=null")
                } elseif ($Op -lt 1 -or $Op -gt 5) {
                    $BadWeights.Add("$($Node.id): operationality=$Op (expected 1-5)")
                }
            }
            if ($Node.category -eq 'Beliefs' -and $Node.PSObject.Properties['confidence']) {
                $Conf = $Node.confidence
                if ($null -eq $Conf) {
                    $UnscoredList.Add("$($Node.id): confidence=null")
                } elseif ($Conf -lt 0.0 -or $Conf -gt 1.0) {
                    $BadWeights.Add("$($Node.id): confidence=$Conf (expected 0.0-1.0)")
                }
            }
            if ($Node.category -eq 'Desires' -and $Node.PSObject.Properties['priority']) {
                $Pri = $Node.priority
                if ($null -eq $Pri) {
                    $UnscoredList.Add("$($Node.id): priority=null")
                } elseif ($Pri -lt 1 -or $Pri -gt 5) {
                    $BadWeights.Add("$($Node.id): priority=$Pri (expected 1-5)")
                }
            }
        }
    }
    if ($BadWeights.Count -gt 0) {
        $Detail = ($BadWeights | Select-Object -First 10) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'BDIWeightRange'; Severity = 'Error'; Count = $BadWeights.Count; Detail = "Out-of-range BDI weights: $Detail" })
    } else { $Passed++ }
    if ($UnscoredList.Count -gt 0) {
        $Detail = ($UnscoredList | Select-Object -First 10) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'UnscoredBDIWeight'; Severity = 'Warning'; Count = $UnscoredList.Count; Detail = "BDI weight unscored (null): $Detail. Fix: re-run Invoke-BDIWeightAssignment on these nodes." })
    }

    # ── Repair ──
    # Pruning is a cascade: one deleted node silently takes its children/parent/situation
    # refs and every edge (with its rationale) along with it — 194 edges for acc-intentions-003
    # with no record of what ran. So every prune is collected in memory first, written to a
    # durable audit file BEFORE any taxonomy file is touched (audit write fails → nothing is
    # pruned), and summarised as a WARN.
    if ($Repair -and $Issues.Count -gt 0) {
        $Repaired = 0
        Write-Host ''
        Write-Host '  Repairing...' -ForegroundColor Cyan

        $Audit = [ordered]@{
            children        = [System.Collections.Generic.List[object]]::new()
            parent_ids      = [System.Collections.Generic.List[object]]::new()
            situation_refs  = [System.Collections.Generic.List[object]]::new()
            linked_nodes    = [System.Collections.Generic.List[object]]::new()
            dangling_edges  = [System.Collections.Generic.List[object]]::new()
            self_loop_edges = [System.Collections.Generic.List[object]]::new()
        }
        $MissingIds = [System.Collections.Generic.SortedSet[string]]::new()

        # Fix dangling children
        foreach ($DC in $DanglingChildren) {
            $Node = $LoadedFiles[$DC.POV].Data.nodes | Where-Object { $_.id -eq $DC.NodeId }
            $Node.children = @($Node.children | Where-Object { $_ -ne $DC.ChildId })
            $Dirty[$DC.POV] = $true
            $Repaired++
            $Audit.children.Add([ordered]@{ file = $DC.POV; node_id = $DC.NodeId; removed = $DC.ChildId })
            [void]$MissingIds.Add($DC.ChildId)
            Write-Host "    Removed child '$($DC.ChildId)' from $($DC.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling parent_id
        foreach ($DP in $DanglingParents) {
            $Node = $LoadedFiles[$DP.POV].Data.nodes | Where-Object { $_.id -eq $DP.NodeId }
            $Node.parent_id = $null
            $Dirty[$DP.POV] = $true
            $Repaired++
            $Audit.parent_ids.Add([ordered]@{ file = $DP.POV; node_id = $DP.NodeId; removed = $DP.ParentId })
            [void]$MissingIds.Add($DP.ParentId)
            Write-Host "    Cleared parent_id '$($DP.ParentId)' from $($DP.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling situation_refs
        foreach ($DS in $DanglingSitRefs) {
            $Node = $LoadedFiles[$DS.POV].Data.nodes | Where-Object { $_.id -eq $DS.NodeId }
            $Node.situation_refs = @($Node.situation_refs | Where-Object { $_ -ne $DS.SitRef })
            $Dirty[$DS.POV] = $true
            $Repaired++
            $Audit.situation_refs.Add([ordered]@{ file = $DS.POV; node_id = $DS.NodeId; removed = $DS.SitRef })
            [void]$MissingIds.Add($DS.SitRef)
            Write-Host "    Removed situation_ref '$($DS.SitRef)' from $($DS.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling linked_nodes in situations
        foreach ($DL in $DanglingLinked) {
            $Node = $LoadedFiles['situations'].Data.nodes | Where-Object { $_.id -eq $DL.NodeId }
            $Node.linked_nodes = @($Node.linked_nodes | Where-Object { $_ -ne $DL.LinkedId })
            $Dirty['situations'] = $true
            $Repaired++
            $Audit.linked_nodes.Add([ordered]@{ file = 'situations'; node_id = $DL.NodeId; removed = $DL.LinkedId })
            [void]$MissingIds.Add($DL.LinkedId)
            Write-Host "    Removed linked_node '$($DL.LinkedId)' from $($DL.NodeId)" -ForegroundColor Yellow
        }

        # Fix dangling + self-loop edges in one in-memory pass; written once, after the audit.
        # Full edge objects are kept in the audit so a wrong prune is restorable (rationale included).
        #
        # N=20: chosen WITHOUT historical data -- no -Repair log existed before this change
        # (t/3853). Reasoned from the incident (194 edges) vs the check's structure (a
        # dangling parent/child typically cascades to single digits, not dozens). REVISIT
        # once the audit directory has real entries; this is the first number to re-derive
        # from evidence, not to raise the first time it's inconvenient.
        $EdgeForceThreshold = 20
        $EdgesPath = Join-Path $TaxDir 'edges.json'
        $EdgesDirty = $false
        if (($BadEdges -gt 0 -or $SelfLoopEdges -gt 0) -and (Test-Path $EdgesPath)) {
            $EdgesData = Read-EdgesFile -Path $EdgesPath   # t/2974: coercion-free read (preserve discovered_at strings)
            $ValidIds = [System.Collections.Generic.HashSet[string]]::new($AllNodeIds)
            if ($Registry) { foreach ($Pol in $Registry.policies) { [void]$ValidIds.Add($Pol.id) } }
            $Kept = [System.Collections.Generic.List[object]]::new()
            $PendingDangling = [System.Collections.Generic.List[object]]::new()
            $PendingSelfLoop = [System.Collections.Generic.List[object]]::new()
            $PendingMissingIds = [System.Collections.Generic.SortedSet[string]]::new()
            foreach ($Edge in @($EdgesData.edges)) {
                $Src = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
                $Tgt = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
                if (-not $ValidIds.Contains($Src) -or -not $ValidIds.Contains($Tgt)) {
                    $PendingDangling.Add($Edge)
                    foreach ($Id in @($Src, $Tgt)) { if ($null -ne $Id -and -not $ValidIds.Contains($Id)) { [void]$PendingMissingIds.Add($Id) } }
                }
                elseif ($null -ne $Src -and $Src -eq $Tgt) {
                    $PendingSelfLoop.Add($Edge)
                }
                else { $Kept.Add($Edge) }
            }
            $PendingEdgeCount = $PendingDangling.Count + $PendingSelfLoop.Count

            if ($PendingEdgeCount -gt $EdgeForceThreshold -and -not $Force) {
                # edges.json is intentionally left COMPLETELY untouched here -- not re-read,
                # not re-serialized, not written -- so a blocked run is byte-identical (t/3853).
                Write-Warning "Test-TaxonomyIntegrity -Repair: $PendingEdgeCount edge(s) would be pruned, exceeding the $EdgeForceThreshold-edge safety threshold (t/3853) -- SKIPPING edge repair, edges.json left untouched. Re-run with -Repair -Force if this is intentional."
            }
            elseif ($PendingEdgeCount -gt 0) {
                foreach ($E in $PendingDangling) { $Audit.dangling_edges.Add($E) }
                foreach ($E in $PendingSelfLoop) { $Audit.self_loop_edges.Add($E) }
                foreach ($Id in $PendingMissingIds) { [void]$MissingIds.Add($Id) }

                if ($PendingDangling.Count -gt 0) {
                    Write-Host "    Removed $($PendingDangling.Count) dangling edges" -ForegroundColor Yellow
                }
                if ($PendingSelfLoop.Count -gt 0) {
                    Write-Host "    Removed $($PendingSelfLoop.Count) self-loop edges" -ForegroundColor Yellow
                }
                $EdgesData.edges = @($Kept)
                $EdgesDirty = $true
                $Repaired += $PendingEdgeCount
            }
        }

        # Durable audit — written before any taxonomy file so a failed audit prunes nothing.
        $RefCount  = $Audit.children.Count + $Audit.parent_ids.Count + $Audit.situation_refs.Count + $Audit.linked_nodes.Count
        $EdgeCount = $Audit.dangling_edges.Count + $Audit.self_loop_edges.Count
        if ($RefCount + $EdgeCount -gt 0) {
            $ResolvedAuditDir = if ($AuditDir) { $AuditDir } else { Join-Path (Get-DataRoot) 'audit' 'integrity-repair' }
            $Stamp = (Get-Date).ToUniversalTime()
            $AuditPath = Join-Path $ResolvedAuditDir "integrity-repair-$($Stamp.ToString('yyyyMMdd-HHmmss-fff')).json"
            $AuditDoc = [ordered]@{
                _schema_version = '1.0.0'
                _doc            = 'Test-TaxonomyIntegrity -Repair audit: every reference and edge pruned in one run. Edge objects are verbatim (restorable).'
                cmdlet          = 'Test-TaxonomyIntegrity -Repair'
                timestamp       = $Stamp.ToString('o')
                user            = [Environment]::UserName
                host            = [Environment]::MachineName
                taxonomy_dir    = $TaxDir
                missing_ids     = @($MissingIds)
                counts          = [ordered]@{
                    children        = $Audit.children.Count
                    parent_ids      = $Audit.parent_ids.Count
                    situation_refs  = $Audit.situation_refs.Count
                    linked_nodes    = $Audit.linked_nodes.Count
                    dangling_edges  = $Audit.dangling_edges.Count
                    self_loop_edges = $Audit.self_loop_edges.Count
                }
                pruned          = $Audit
            }
            try {
                if (-not (Test-Path $ResolvedAuditDir)) { New-Item -ItemType Directory -Path $ResolvedAuditDir -Force | Out-Null }
                $AuditJson = ($AuditDoc | ConvertTo-Json -Depth 20) -replace "`r`n", "`n"
                [System.IO.File]::WriteAllText($AuditPath, $AuditJson + "`n", [System.Text.UTF8Encoding]::new($false))
            }
            catch {
                throw (New-ActionableError -Goal 'Record the integrity-repair audit before pruning taxonomy references' `
                    -Problem "Could not write the repair audit file: $($_.Exception.Message)" `
                    -Location "Test-TaxonomyIntegrity -Repair → $AuditPath" `
                    -NextSteps @(
                        'No taxonomy file was modified — the repair was aborted before any write.',
                        "Check that '$ResolvedAuditDir' is writable, or pass -AuditDir <writable dir>, then re-run."
                    ) `
                    -InnerError $_)
            }

            $IdList = @($MissingIds)
            $IdText = (@($IdList | Select-Object -First 10) -join ', ') + $(if ($IdList.Count -gt 10) { " (+$($IdList.Count - 10) more)" } else { '' })
            Write-Warning ("Test-TaxonomyIntegrity -Repair pruned $RefCount reference(s) and $EdgeCount edge(s) " +
                "($($Audit.dangling_edges.Count) dangling, $($Audit.self_loop_edges.Count) self-loop) because these IDs no longer exist: " +
                "$(if ($IdText) { $IdText } else { '(none — self-loops only)' }). Audit (restorable): $AuditPath")
        }

        if ($EdgesDirty) { Write-EdgesFile -EdgesData $EdgesData -Path $EdgesPath }

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
