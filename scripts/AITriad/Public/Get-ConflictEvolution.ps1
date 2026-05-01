# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-ConflictEvolution {
    <#
    .SYNOPSIS
        Analyzes how conflicts evolve across sources using graph-aware reasoning.
    .DESCRIPTION
        For a given conflict (or all conflicts), loads the linked taxonomy nodes
        and their graph edges, then uses an LLM to analyze:
        - Whether positions are converging or diverging
        - Which assumptions underlie each side
        - What evidence would resolve the conflict
        - Which graph paths connect the conflicting claims

        Without -Analyze, returns a structured summary of each conflict's
        graph context (linked nodes, edges between them, source instances).
        With -Analyze, sends the graph context to an LLM for deeper reasoning.
    .PARAMETER Id
        Conflict ID to analyze (e.g., "conflict-agi-timelines-001").
        If omitted, processes all conflicts.
    .PARAMETER Analyze
        Use LLM to generate a deep analysis of conflict evolution.
        Without this switch, only structured graph context is returned.
    .PARAMETER Model
        AI model to use for analysis. Defaults to 'gemini-2.5-flash'.
    .PARAMETER ApiKey
        AI API key.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Get-ConflictEvolution
    .EXAMPLE
        Get-ConflictEvolution -Id "conflict-agi-timelines-001"
    .EXAMPLE
        Get-ConflictEvolution -Id "conflict-agi-timelines-001" -Analyze
    .EXAMPLE
        Get-ConflictEvolution -Analyze | Where-Object { $_.analysis.convergence_trend -eq 'diverging' }
    #>
    [CmdletBinding()]
    param(
        [string]$Id = '',

        [switch]$Analyze,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = 'gemini-2.5-flash',

        [string]$ApiKey = '',

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Load taxonomy nodes ──
    $TaxDir = Get-TaxonomyDir
    $AllNodes = @{}
    $NodePovMap = @{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
        foreach ($Node in $FileData.nodes) {
            $AllNodes[$Node.id] = $Node
            $NodePovMap[$Node.id] = $PovKey
        }
    }

    # ── Load edges ──
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $AllEdges = @()
    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
        $AllEdges = @($EdgesData.edges)
    }

    # ── Load conflicts ──
    $ConflictDir = Get-ConflictsDir
    if (-not (Test-Path $ConflictDir)) {
        Write-Fail "Conflicts directory not found: $ConflictDir"
        return
    }

    $ConflictFiles = Get-ChildItem -Path $ConflictDir -Filter '*.json' -File
    $Conflicts = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($File in $ConflictFiles) {
        try {
            $Conflict = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
            if ($Id -and $Conflict.claim_id -ne $Id) { continue }
            $Conflicts.Add($Conflict)
        } catch {
            Write-Warn "Failed to load $($File.Name): $_"
        }
    }

    if ($Conflicts.Count -eq 0) {
        if ($Id) {
            Write-Fail "Conflict not found: $Id"
        } else {
            Write-Warn 'No conflicts found.'
        }
        return
    }

    Write-Step "Analyzing $($Conflicts.Count) conflict(s)"

    # ── Resolve API key if analyzing ──
    $ResolvedKey = $null
    if ($Analyze) {
        $Backend = if     ($Model -match '^gemini') { 'gemini' }
                   elseif ($Model -match '^claude') { 'claude' }
                   elseif ($Model -match '^groq')   { 'groq'   }
                   else                             { 'gemini'  }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            Write-Fail 'No API key found. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY.'
            throw 'No API key configured'
        }
    }

    # ── Process each conflict ──
    $Results = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Conflict in $Conflicts) {
        Write-Info "$($Conflict.claim_id): $($Conflict.claim_label)"

        # Find linked nodes
        $LinkedNodeIds = @()
        if ($Conflict.PSObject.Properties['linked_taxonomy_nodes']) {
            $LinkedNodeIds = @($Conflict.linked_taxonomy_nodes)
        }

        $LinkedNodes = foreach ($NId in $LinkedNodeIds) {
            if ($AllNodes.ContainsKey($NId)) {
                $N = $AllNodes[$NId]
                [ordered]@{
                    id               = $N.id
                    pov              = $NodePovMap[$NId]
                    label            = $N.label
                    description      = $N.description
                    graph_attributes = if ($N.PSObject.Properties['graph_attributes']) { $N.graph_attributes } else { $null }
                }
            }
        }

        # Find edges between linked nodes (and edges involving linked nodes)
        $LinkedNodeSet = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($NId in $LinkedNodeIds) { [void]$LinkedNodeSet.Add($NId) }

        $RelevantEdges = foreach ($Edge in $AllEdges) {
            $SourceLinked = $LinkedNodeSet.Contains($Edge.source)
            $TargetLinked = $LinkedNodeSet.Contains($Edge.target)
            if ($SourceLinked -or $TargetLinked) {
                [ordered]@{
                    source     = $Edge.source
                    target     = $Edge.target
                    type       = $Edge.type
                    confidence = $Edge.confidence
                    status     = $Edge.status
                    rationale  = if ($Edge.PSObject.Properties['rationale']) { $Edge.rationale } else { '' }
                    both_linked = ($SourceLinked -and $TargetLinked)
                }
            }
        }

        # Count instances by stance
        $Instances = @($Conflict.instances | Where-Object { $_.doc_id -ne '_seed' })
        # Support both new schema (stance field) and legacy (position string)
        $SupportsCount = @($Instances | Where-Object {
            ($_.PSObject.Properties['stance'] -and $_.stance -eq 'supports') -or
            (-not $_.PSObject.Properties['stance'] -and $_.position -match '^supports')
        }).Count
        $DisputesCount = @($Instances | Where-Object {
            ($_.PSObject.Properties['stance'] -and $_.stance -eq 'disputes') -or
            (-not $_.PSObject.Properties['stance'] -and $_.position -match '^disputes')
        }).Count
        $QualifiesCount = @($Instances | Where-Object {
            $_.PSObject.Properties['stance'] -and $_.stance -eq 'qualifies'
        }).Count
        $NeutralCount  = $Instances.Count - $SupportsCount - $DisputesCount - $QualifiesCount

        $ConflictContext = [PSCustomObject][ordered]@{
            conflict_id      = $Conflict.claim_id
            claim_label      = $Conflict.claim_label
            description      = $Conflict.description
            status           = $Conflict.status
            linked_nodes     = @($LinkedNodes)
            edges            = @($RelevantEdges)
            internal_edges   = @($RelevantEdges | Where-Object { $_.both_linked }).Count
            instance_count   = $Instances.Count
            supports_count   = $SupportsCount
            disputes_count   = $DisputesCount
            qualifies_count  = $QualifiesCount
            neutral_count    = $NeutralCount
            instances        = $Instances
        }

        if (-not $Analyze) {
            $Results.Add($ConflictContext)
            continue
        }

        # ── LLM Analysis ──
        $ConflictJson = $ConflictContext | ConvertTo-Json -Depth 10

        $AnalysisPrompt = @"
You are analyzing the evolution and structure of a factual conflict in the AI policy debate.

A conflict represents a disputed claim where different sources and POVs disagree. You are given:
1. The conflict description and linked taxonomy nodes.
2. Graph edges involving those nodes (with types, confidence, and rationale).
3. Source instances — each recording a document's position on the claim.

Analyze this conflict and respond in JSON:

{
  "convergence_trend": "converging|diverging|stable|insufficient_data",
  "convergence_reasoning": "Why you assessed the trend this way",
  "key_assumptions": [
    {
      "assumption": "The assumption text",
      "held_by": ["pov1", "pov2"],
      "contested_by": ["pov3"],
      "graph_evidence": "Which edges/nodes support this"
    }
  ],
  "resolution_paths": [
    {
      "description": "What evidence or concession could resolve this",
      "type": "empirical_evidence|conceptual_reframing|assumption_challenge|scope_narrowing",
      "feasibility": "high|medium|low"
    }
  ],
  "graph_insights": [
    "Observations about the graph structure around this conflict"
  ],
  "pov_positions": {
    "accelerationist": "Summary of accelerationist stance on this conflict",
    "safetyist": "Summary of safetyist stance",
    "skeptic": "Summary of skeptic stance"
  },
  "evidence_balance": {
    "empirical_support": "strong|moderate|weak|none",
    "source_diversity": "high|medium|low",
    "assessment": "Overall evidence quality assessment"
  }
}

--- CONFLICT DATA ---
$ConflictJson
"@

        $EvolutionSchema = @{
            type       = 'object'
            properties = @{
                convergence_trend     = @{ type = 'string'; enum = @('converging', 'diverging', 'stable', 'insufficient_data') }
                convergence_reasoning = @{ type = 'string' }
                key_assumptions       = @{
                    type  = 'array'
                    items = @{
                        type       = 'object'
                        properties = @{
                            assumption     = @{ type = 'string' }
                            held_by        = @{ type = 'array'; items = @{ type = 'string' } }
                            contested_by   = @{ type = 'array'; items = @{ type = 'string' } }
                            graph_evidence = @{ type = 'string' }
                        }
                        required   = @('assumption')
                    }
                }
                resolution_paths      = @{
                    type  = 'array'
                    items = @{
                        type       = 'object'
                        properties = @{
                            description = @{ type = 'string' }
                            type        = @{ type = 'string'; enum = @('empirical_evidence', 'conceptual_reframing', 'assumption_challenge', 'scope_narrowing') }
                            feasibility = @{ type = 'string'; enum = @('high', 'medium', 'low') }
                        }
                        required   = @('description', 'type', 'feasibility')
                    }
                }
                graph_insights        = @{ type = 'array'; items = @{ type = 'string' } }
                pov_positions         = @{
                    type       = 'object'
                    properties = @{
                        accelerationist = @{ type = 'string' }
                        safetyist       = @{ type = 'string' }
                        skeptic         = @{ type = 'string' }
                    }
                }
                evidence_balance      = @{
                    type       = 'object'
                    properties = @{
                        empirical_support = @{ type = 'string'; enum = @('strong', 'moderate', 'weak', 'none') }
                        source_diversity  = @{ type = 'string'; enum = @('high', 'medium', 'low') }
                        assessment        = @{ type = 'string' }
                    }
                    required   = @('empirical_support', 'source_diversity', 'assessment')
                }
            }
            required   = @('convergence_trend', 'convergence_reasoning', 'key_assumptions', 'resolution_paths')
        }

        try {
            $AIResult = Invoke-AIApi `
                -Prompt $AnalysisPrompt `
                -Model $Model `
                -ApiKey $ResolvedKey `
                -Temperature 0.3 `
                -MaxTokens 4096 `
                -ResponseSchema $EvolutionSchema `
                -TimeoutSec 120

            $ResponseText = $AIResult.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
            try {
                $Analysis = $ResponseText | ConvertFrom-Json
            } catch {
                $Repaired = Repair-TruncatedJson -Text $ResponseText
                $Analysis = $Repaired | ConvertFrom-Json
            }

            $ConflictContext | Add-Member -NotePropertyName 'analysis' -NotePropertyValue $Analysis
            Write-OK "$($Conflict.claim_id): $($Analysis.convergence_trend)"
        } catch {
            Write-Fail "$($Conflict.claim_id): analysis failed — $_"
            $ConflictContext | Add-Member -NotePropertyName 'analysis' -NotePropertyValue $null
        }

        $Results.Add($ConflictContext)
    }

    # ── Output ──
    if ($Results.Count -eq 1) {
        return $Results[0]
    }
    return $Results
}
