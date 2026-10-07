# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Pure compute helpers for Invoke-BDIWeightAssignment (t/3910, plan t/3910#9, TL t/3910#10).
# Each takes a node and returns its score; none mutates the node. Formulas: docs/weighted-bdi-proposal.md.

# Belief base score by epistemic_type; empirical_claim is further keyed by falsifiability.
$script:BdiBeliefBase = @{
    'empirical_claim|high'   = 0.80
    'empirical_claim|medium' = 0.70
    'empirical_claim|low'    = 0.60
    'empirical_claim|'       = 0.70
    'predictive'             = 0.40
    'interpretive_lens'      = 0.50
    'definitional'           = 0.50
}
$script:BdiFalsifiabilityMod = @{ 'high' = 1; 'low' = -1 }
$script:BdiTreeLabel = @{ 4 = 'leaf'; 3 = 'mid-tree'; 2 = 'root' }

function Get-BdiGraphAttribute {
    # A graph_attributes field, or $null when the node has no graph_attributes or no such field.
    param([Parameter(Mandatory)]$Node, [Parameter(Mandatory)][string]$Name)
    $GA = if ($Node.PSObject.Properties['graph_attributes'] -and $Node.graph_attributes) { $Node.graph_attributes } else { $null }
    if ($GA -and $GA.PSObject.Properties[$Name]) { return $GA.$Name }
    return $null
}

function Get-BdiBeliefBase {
    # The base confidence for an epistemic_type/falsifiability pair (0.50 for anything unlisted).
    param($EpistemicType, $Falsifiability)
    if (-not $EpistemicType) { return 0.50 }
    if ($EpistemicType -eq 'empirical_claim') {
        $Key = if ($Falsifiability -and $script:BdiBeliefBase.ContainsKey("empirical_claim|$Falsifiability")) { "empirical_claim|$Falsifiability" } else { 'empirical_claim|' }
        return $script:BdiBeliefBase[$Key]
    }
    if ($script:BdiBeliefBase.ContainsKey([string]$EpistemicType)) { return $script:BdiBeliefBase[[string]$EpistemicType] }
    return 0.50
}

function Get-BeliefConfidence {
    <#
    .SYNOPSIS
        Belief confidence (0.10-0.95): base(epistemic_type, falsifiability) + evidence boost
        (+0.05/doc, cap 0.15) + debate boost (+0.03/ref, cap 0.10) + edge boost (+-0.02/edge, cap 0.05 each).
    #>
    [CmdletBinding()]
    [OutputType([double])]
    param(
        [Parameter(Mandatory)]$Node,
        [Parameter(Mandatory)][AllowEmptyCollection()][hashtable]$SourceDocCounts,
        [Parameter(Mandatory)][AllowEmptyCollection()][hashtable]$SupportsReceived,
        [Parameter(Mandatory)][AllowEmptyCollection()][hashtable]$AttacksReceived
    )

    $NodeId = $Node.id
    $EpistemicType = Get-BdiGraphAttribute -Node $Node -Name 'epistemic_type'
    $Falsifiability = Get-BdiGraphAttribute -Node $Node -Name 'falsifiability'
    $Base = Get-BdiBeliefBase -EpistemicType $EpistemicType -Falsifiability $Falsifiability

    $EvidenceBoost = [Math]::Min(0.15, ($SourceDocCounts[$NodeId] ?? 0) * 0.05)
    $DebateRefCount = 0
    if ($Node.PSObject.Properties['debate_refs'] -and $Node.debate_refs) { $DebateRefCount = @($Node.debate_refs).Count }
    $DebateBoost = [Math]::Min(0.10, $DebateRefCount * 0.03)
    $EdgeBoost = [Math]::Min(0.05, ($SupportsReceived[$NodeId] ?? 0) * 0.02) - [Math]::Min(0.05, ($AttacksReceived[$NodeId] ?? 0) * 0.02)

    $Raw = $Base + $EvidenceBoost + $DebateBoost + $EdgeBoost
    $Confidence = [Math]::Round([Math]::Max(0.10, [Math]::Min(0.95, $Raw)), 2)
    Write-Verbose "  $NodeId [$EpistemicType/$Falsifiability] base=$Base +ev=$EvidenceBoost +deb=$DebateBoost +edge=$EdgeBoost → $Confidence"
    return $Confidence
}

function Get-DesirePriority {
    <#
    .SYNOPSIS
        Desire priority (2-5): 5 doctrinal boundary, 4 root-level, 3 mid-tree, 2 leaf.
    .OUTPUTS
        [pscustomobject] { Priority; Reason }
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]$Node,
        [Parameter(Mandatory)][AllowEmptyCollection()][System.Collections.Generic.HashSet[string]]$BoundarySet
    )

    $HasParent = $Node.PSObject.Properties['parent_id'] -and $Node.parent_id
    $ChildCount = if ($Node.PSObject.Properties['children']) { @($Node.children).Count } else { 0 }
    $Result = if ($BoundarySet.Contains($Node.id)) { @(5, 'doctrinal boundary') }
              elseif (-not $HasParent) { @(4, 'root-level Desire') }
              elseif ($ChildCount -gt 0) { @(3, 'mid-tree Desire') }
              else { @(2, 'leaf Desire') }
    $Reason = "Initial assignment: $($Result[1])"
    Write-Verbose "  $($Node.id) priority=$($Result[0]) ($Reason)"
    return [pscustomobject]@{ Priority = $Result[0]; Reason = $Reason }
}

function Test-BdiHasAnyItem {
    # True iff the property exists and enumerating it yields at least one item. Mirrors the
    # original `foreach ($_ in $Node.x) { ...; break }` exactly: a $null value counts as empty.
    param([Parameter(Mandatory)]$Node, [Parameter(Mandatory)][string]$Name)
    if (-not $Node.PSObject.Properties[$Name]) { return $false }
    foreach ($Item in $Node.$Name) { return $true }
    return $false
}

function Get-IntentionOperationality {
    <#
    .SYNOPSIS
        Intention operationality (1-5): clamp(tree_base + falsifiability_mod + situation_bonus, 1, 5).
        Tree base: leaf=4, mid-tree=3, root=2 (inverted from Desires).
    .OUTPUTS
        [pscustomobject] { Operationality; Reason }
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param([Parameter(Mandatory)]$Node)

    $HasParent = [bool]($Node.PSObject.Properties['parent_id'] -and $Node.parent_id)
    $IsLeaf = -not (Test-BdiHasAnyItem -Node $Node -Name 'children')
    $TreeBase = if ($IsLeaf) { 4 } elseif ($HasParent) { 3 } else { 2 }

    $Fals = Get-BdiGraphAttribute -Node $Node -Name 'falsifiability'
    $FalsMod = if ($Fals -and $script:BdiFalsifiabilityMod.ContainsKey([string]$Fals)) { $script:BdiFalsifiabilityMod[[string]$Fals] } else { 0 }
    $SitBonus = if (Test-BdiHasAnyItem -Node $Node -Name 'situation_refs') { 1 } else { 0 }

    $Operationality = [Math]::Max(1, [Math]::Min(5, $TreeBase + $FalsMod + $SitBonus))
    $Reason = "Initial assignment: $($script:BdiTreeLabel[$TreeBase]) Intention"
    if ($FalsMod -ne 0) { $Reason += " (falsifiability $(if ($FalsMod -gt 0) { '+1' } else { '-1' }))" }
    if ($SitBonus -gt 0) { $Reason += ' (situation grounded)' }
    Write-Verbose "  $($Node.id) operationality=$Operationality ($Reason)"
    return [pscustomobject]@{ Operationality = $Operationality; Reason = $Reason }
}
