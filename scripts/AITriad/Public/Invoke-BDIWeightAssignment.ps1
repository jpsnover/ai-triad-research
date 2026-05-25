# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-BDIWeightAssignment {
    <#
    .SYNOPSIS
        Assigns confidence (Beliefs) and priority (Desires) to taxonomy nodes.
    .DESCRIPTION
        Implements the multi-signal formulas from docs/weighted-bdi-proposal.md:

        BELIEF CONFIDENCE (0.10–0.95):
          base(epistemic_type, falsifiability)
          + evidence_boost(source_doc_count, +0.05/doc, cap +0.15)
          + debate_boost(debate_ref_count, +0.03/ref, cap +0.10)
          + edge_boost(supports - attacks, range -0.05 to +0.05)

        DESIRE PRIORITY (1–5):
          5 = doctrinal boundary (from POVER_INFO)
          4 = root-level (no parent)
          3 = mid-tree (has parent + children)
          2 = leaf (has parent, no children)

        Reads source_evidence_index.json for evidence counts and edges.json
        for edge balance. Writes results back to taxonomy JSON files with
        history entries.
    .PARAMETER POV
        One or more POVs to process. Default: all three.
    .PARAMETER DryRun
        Show computed values without writing to files.
    .PARAMETER DoctrinalBoundaryMap
        Hashtable mapping POV name to array of Desire node IDs that are
        doctrinal boundaries (priority 5). If omitted, uses semantic matching
        against POVER_INFO boundary strings.
    .EXAMPLE
        Invoke-BDIWeightAssignment
    .EXAMPLE
        Invoke-BDIWeightAssignment -DryRun
    .EXAMPLE
        Invoke-BDIWeightAssignment -POV accelerationist
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic')]
        [string[]]$POV = @('accelerationist', 'safetyist', 'skeptic'),

        [switch]$DryRun,

        [hashtable]$DoctrinalBoundaryMap
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $Today  = Get-Date -Format 'yyyy-MM-dd'

    # ── Load source evidence index ────────────────────────────────────────
    Write-Host 'Loading data...' -ForegroundColor Cyan
    $SeiPath = Join-Path $TaxDir 'source_evidence_index.json'
    $SourceDocCounts = @{}  # nodeId → count of unique doc_ids
    if (Test-Path $SeiPath) {
        $Sei = Get-Content $SeiPath -Raw | ConvertFrom-Json -AsHashtable
        foreach ($NodeId in $Sei.Keys) {
            $Entry = $Sei[$NodeId]
            $DocIds = [System.Collections.Generic.HashSet[string]]::new(
                [System.StringComparer]::OrdinalIgnoreCase)
            $Facts = if ($Entry.ContainsKey('facts') -and $Entry['facts']) { @($Entry['facts']) } else { @() }
            foreach ($Fact in $Facts) {
                if ($null -ne $Fact -and $Fact -is [hashtable] -and $Fact.ContainsKey('doc_id') -and $Fact['doc_id']) {
                    $null = $DocIds.Add($Fact['doc_id'])
                }
            }
            $KeyPts = if ($Entry.ContainsKey('keyPoints') -and $Entry['keyPoints']) { @($Entry['keyPoints']) } else { @() }
            foreach ($Kp in $KeyPts) {
                if ($null -ne $Kp -and $Kp -is [hashtable] -and $Kp.ContainsKey('doc_id') -and $Kp['doc_id']) {
                    $null = $DocIds.Add($Kp['doc_id'])
                }
            }
            $SourceDocCounts[$NodeId] = $DocIds.Count
        }
        Write-Host "  Source evidence: $($Sei.Count) nodes indexed" -ForegroundColor Gray
    } else {
        Write-Warning "source_evidence_index.json not found — evidence boost will be 0"
    }

    # ── Load edges ────────────────────────────────────────────────────────
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $SupportsReceived = @{}  # nodeId → count
    $AttacksReceived  = @{}  # nodeId → count
    if (Test-Path $EdgesPath) {
        $EdgesRaw = Get-Content $EdgesPath -Raw | ConvertFrom-Json
        $Edges = if ($EdgesRaw.PSObject.Properties['edges']) { @($EdgesRaw.edges) } else { @($EdgesRaw) }
        foreach ($Edge in @($Edges)) {
            if ($Edge.PSObject.Properties['status'] -and $Edge.status -eq 'rejected') { continue }
            $Type = if ($Edge.PSObject.Properties['type']) { $Edge.type } else { $null }
            if (-not $Type) { continue }
            $Target = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
            $Source = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
            if (-not $Target) { continue }
            if ($Type -eq 'SUPPORTS') {
                $SupportsReceived[$Target] = ($SupportsReceived[$Target] ?? 0) + 1
                if ($Edge.PSObject.Properties['bidirectional'] -and $Edge.bidirectional -and $Source) {
                    $SupportsReceived[$Source] = ($SupportsReceived[$Source] ?? 0) + 1
                }
            } elseif ($Type -in 'CONTRADICTS', 'WEAKENS') {
                $AttacksReceived[$Target] = ($AttacksReceived[$Target] ?? 0) + 1
                if ($Edge.PSObject.Properties['bidirectional'] -and $Edge.bidirectional -and $Source) {
                    $AttacksReceived[$Source] = ($AttacksReceived[$Source] ?? 0) + 1
                }
            }
        }
        Write-Host "  Edges: $(@($Edges).Count) loaded" -ForegroundColor Gray
    } else {
        Write-Warning "edges.json not found — edge boost will be 0"
    }

    # ── Doctrinal boundary mapping ────────────────────────────────────────
    # For now, root-level Desires with labels matching POVER_INFO boundary
    # themes get priority 5. Manual override via -DoctrinalBoundaryMap.
    $DocBoundaryIds = @{}  # pov → HashSet of node IDs
    if ($DoctrinalBoundaryMap) {
        foreach ($Pov_ in $DoctrinalBoundaryMap.Keys) {
            $DocBoundaryIds[$Pov_] = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@($DoctrinalBoundaryMap[$Pov_]), [System.StringComparer]::OrdinalIgnoreCase)
        }
    }
    # If no map provided, doctrinal boundaries default to empty (tree position only)

    # ── Process each POV ──────────────────────────────────────────────────
    $TotalBeliefs = 0; $TotalDesires = 0; $TotalIntentions = 0

    foreach ($PovName in $POV) {
        $FilePath = Join-Path $TaxDir "$PovName.json"
        if (-not (Test-Path $FilePath)) {
            Write-Warning "Taxonomy file not found: $FilePath"
            continue
        }

        $Data = Get-Content $FilePath -Raw | ConvertFrom-Json
        $Nodes = @($Data.nodes)
        Write-Host "`n── $PovName ($($Nodes.Count) nodes) ──" -ForegroundColor Cyan

        $BeliefCount = 0; $DesireCount = 0; $IntentionCount = 0
        if ($DocBoundaryIds.ContainsKey($PovName)) {
            $BoundarySet = $DocBoundaryIds[$PovName]
        } else {
            $BoundarySet = [System.Collections.Generic.HashSet[string]]::new()
        }

        foreach ($Node in $Nodes) {
            if (-not $Node -or -not $Node.PSObject.Properties['id']) { continue }
            $NodeId = $Node.id
            $Category = if ($Node.PSObject.Properties['category']) { $Node.category } else { $null }
            if (-not $Category) { continue }

            if ($Category -eq 'Beliefs') {
                # ── Belief confidence ─────────────────────────────────
                $GA = if ($Node.PSObject.Properties['graph_attributes'] -and $Node.graph_attributes) { $Node.graph_attributes } else { $null }
                $EpistemicType = if ($GA -and $GA.PSObject.Properties['epistemic_type']) { $GA.epistemic_type } else { $null }
                $Falsifiability = if ($GA -and $GA.PSObject.Properties['falsifiability']) { $GA.falsifiability } else { $null }

                # Base score
                $Base = switch ($EpistemicType) {
                    'empirical_claim' {
                        switch ($Falsifiability) {
                            'high'   { 0.80 }
                            'medium' { 0.70 }
                            'low'    { 0.60 }
                            default  { 0.70 }
                        }
                    }
                    'predictive'       { 0.40 }
                    'interpretive_lens' { 0.50 }
                    'definitional'     { 0.50 }
                    default            { 0.50 }
                }

                # Boosts
                $SrcCount = $SourceDocCounts[$NodeId] ?? 0
                $EvidenceBoost = [Math]::Min(0.15, $SrcCount * 0.05)

                $DebateRefCount = 0
                if ($Node.PSObject.Properties['debate_refs'] -and $Node.debate_refs) {
                    $DebateRefCount = @($Node.debate_refs).Count
                }
                $DebateBoost = [Math]::Min(0.10, $DebateRefCount * 0.03)

                $Sup = $SupportsReceived[$NodeId] ?? 0
                $Att = $AttacksReceived[$NodeId] ?? 0
                $EdgeBoost = [Math]::Min(0.05, $Sup * 0.02) - [Math]::Min(0.05, $Att * 0.02)

                $Raw = $Base + $EvidenceBoost + $DebateBoost + $EdgeBoost
                $Confidence = [Math]::Round([Math]::Max(0.10, [Math]::Min(0.95, $Raw)), 2)

                if (-not $DryRun) {
                    $Node | Add-Member -NotePropertyName 'confidence' -NotePropertyValue $Confidence -Force
                    $Node | Add-Member -NotePropertyName 'confidence_history' -NotePropertyValue @(
                        [ordered]@{ date = $Today; value = $Confidence; delta = 0; reason = 'Initial multi-signal assignment' }
                    ) -Force
                }

                $BeliefCount++
                Write-Verbose "  $NodeId [$EpistemicType/$Falsifiability] base=$Base +ev=$EvidenceBoost +deb=$DebateBoost +edge=$EdgeBoost → $Confidence"

            } elseif ($Category -eq 'Desires') {
                # ── Desire priority ───────────────────────────────────
                $IsDoctrinal = $BoundarySet.Contains($NodeId)
                $HasParent = $Node.PSObject.Properties['parent_id'] -and $Node.parent_id
                $ChildCount = if ($Node.PSObject.Properties['children']) { @($Node.children).Count } else { 0 }
                if ($IsDoctrinal) {
                    $Priority = 5
                    $Reason = 'Initial assignment: doctrinal boundary'
                } elseif (-not $HasParent) {
                    $Priority = 4
                    $Reason = 'Initial assignment: root-level Desire'
                } elseif ($ChildCount -gt 0) {
                    $Priority = 3
                    $Reason = 'Initial assignment: mid-tree Desire'
                } else {
                    $Priority = 2
                    $Reason = 'Initial assignment: leaf Desire'
                }

                Write-Verbose "  $NodeId priority=$Priority ($Reason)"

                if (-not $DryRun) {
                    $Node | Add-Member -NotePropertyName 'priority' -NotePropertyValue $Priority -Force
                    $Node | Add-Member -NotePropertyName 'priority_history' -NotePropertyValue @(
                        [ordered]@{ date = $Today; value = $Priority; delta = 0; reason = $Reason }
                    ) -Force
                }

                $DesireCount++

            } elseif ($Category -eq 'Intentions') {
                # ── Intention operationality ──────────────────────────
                # Formula: clamp(tree_base + falsifiability_mod + situation_bonus, 1, 5)
                # Tree base: leaf=4, mid-tree=3, root=2 (inverted from Desires)
                $HasParent = $false
                if ($Node.PSObject.Properties['parent_id'] -and $Node.parent_id) { $HasParent = $true }
                $IsLeaf = $true
                if ($Node.PSObject.Properties['children']) {
                    foreach ($_ in $Node.children) { $IsLeaf = $false; break }
                }
                if ($IsLeaf) {
                    $TreeBase = 4  # leaf — actionable
                } elseif ($HasParent) {
                    $TreeBase = 3  # mid-tree — organizing
                } else {
                    $TreeBase = 2  # root — abstract
                }

                $GA = if ($Node.PSObject.Properties['graph_attributes'] -and $Node.graph_attributes) { $Node.graph_attributes } else { $null }
                $Fals = if ($GA -and $GA.PSObject.Properties['falsifiability']) { $GA.falsifiability } else { $null }
                $FalsMod = switch ($Fals) { 'high' { 1 } 'low' { -1 } default { 0 } }

                $SitBonus = 0
                if ($Node.PSObject.Properties['situation_refs']) {
                    foreach ($_ in $Node.situation_refs) { $SitBonus = 1; break }
                }

                $Operationality = [Math]::Max(1, [Math]::Min(5, $TreeBase + $FalsMod + $SitBonus))

                $TreeLabel = switch ($TreeBase) { 4 { 'leaf' } 3 { 'mid-tree' } 2 { 'root' } }
                $Reason = "Initial assignment: $TreeLabel Intention"
                if ($FalsMod -ne 0) { $Reason += " (falsifiability $(if ($FalsMod -gt 0) { '+1' } else { '-1' }))" }
                if ($SitBonus -gt 0) { $Reason += ' (situation grounded)' }

                Write-Verbose "  $NodeId operationality=$Operationality ($Reason)"

                if (-not $DryRun) {
                    $Node | Add-Member -NotePropertyName 'operationality' -NotePropertyValue $Operationality -Force
                    $Node | Add-Member -NotePropertyName 'operationality_history' -NotePropertyValue @(
                        [ordered]@{ date = $Today; value = $Operationality; delta = 0; reason = $Reason }
                    ) -Force
                }

                $IntentionCount++
            }
        }

        Write-Host "  Beliefs: $BeliefCount confidence scores assigned" -ForegroundColor Green
        Write-Host "  Desires: $DesireCount priorities assigned" -ForegroundColor Green
        Write-Host "  Intentions: $IntentionCount operationality scores assigned" -ForegroundColor Green

        $TotalBeliefs += $BeliefCount
        $TotalDesires += $DesireCount
        $TotalIntentions += $IntentionCount

        # Write back
        if (-not $DryRun -and $PSCmdlet.ShouldProcess("$PovName.json", 'Write confidence + priority + operationality')) {
            $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
            Write-Host "  Saved $PovName.json" -ForegroundColor Green
        }
    }

    # ── Summary ───────────────────────────────────────────────────────────
    Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "  Belief nodes:     $TotalBeliefs confidence scores"
    Write-Host "  Desire nodes:     $TotalDesires priorities"
    Write-Host "  Intention nodes:  $TotalIntentions operationality scores"
    if ($DryRun) { Write-Host "  (DRY RUN — no files written)" -ForegroundColor Yellow }
}
