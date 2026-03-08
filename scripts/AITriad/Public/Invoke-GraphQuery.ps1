# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-GraphQuery {
    <#
    .SYNOPSIS
        Answers natural-language questions by reasoning over the taxonomy graph.
    .DESCRIPTION
        Takes a natural-language question, loads the full taxonomy graph (nodes,
        attributes, edges), and sends it to an LLM that reasons over the graph
        structure to produce a grounded answer.

        The LLM traces paths, follows edge chains, and considers node attributes
        to answer questions about relationships, assumptions, tensions, and gaps
        in the AI policy debate.
    .PARAMETER Question
        The natural-language question to answer.
    .PARAMETER IncludeConflicts
        Include conflict data in the graph context for conflict-aware reasoning.
    .PARAMETER StatusFilter
        Only include edges with this approval status. Default: approved.
        Use 'all' to include all edges regardless of status.
    .PARAMETER Model
        AI model to use. Defaults to 'gemini-2.5-flash'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.3.
    .PARAMETER Raw
        Return the raw JSON response instead of formatted output.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Invoke-GraphQuery "What assumptions does the safetyist position share with the accelerationist position?"
    .EXAMPLE
        Invoke-GraphQuery "Which claims have no empirical support?" -StatusFilter all
    .EXAMPLE
        Invoke-GraphQuery "How does the skeptic position respond to existential risk arguments?" -IncludeConflicts
    .EXAMPLE
        Invoke-GraphQuery "What would change if scaling laws stopped holding?" -Raw
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Question,

        [switch]$IncludeConflicts,

        [ValidateSet('proposed', 'approved', 'rejected', 'all')]
        [string]$StatusFilter = 'approved',

        [ValidateSet(
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'claude-opus-4', 'claude-sonnet-4-5', 'claude-haiku-3.5',
            'groq-llama-3.3-70b', 'groq-llama-4-scout'
        )]
        [string]$Model = 'gemini-2.5-flash',

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [switch]$Raw,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest

    # ── Step 1: Validate environment ──
    Write-Step 'Validating environment'

    $Backend = if     ($Model -match '^gemini') { 'gemini' }
               elseif ($Model -match '^claude') { 'claude' }
               elseif ($Model -match '^groq')   { 'groq'   }
               else                             { 'gemini'  }
    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
    if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
        Write-Fail 'No API key found. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY.'
        throw 'No API key configured'
    }

    $TaxDir = Join-Path $RepoRoot 'taxonomy' 'Origin'

    # ── Step 2: Load full graph ──
    Write-Step 'Loading taxonomy graph'

    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
    $GraphNodes = [System.Collections.Generic.List[PSObject]]::new()
    $NodePovMap = @{}

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }

        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
        foreach ($Node in $FileData.nodes) {
            $NodeEntry = [ordered]@{
                id          = $Node.id
                pov         = $PovKey
                label       = $Node.label
                description = $Node.description
            }
            if ($Node.PSObject.Properties['category']) {
                $NodeEntry['category'] = $Node.category
            }
            if ($Node.PSObject.Properties['graph_attributes']) {
                $NodeEntry['graph_attributes'] = $Node.graph_attributes
            }
            if ($PovKey -eq 'cross-cutting' -and $Node.PSObject.Properties['interpretations']) {
                $NodeEntry['interpretations'] = $Node.interpretations
            }
            $GraphNodes.Add([PSCustomObject]$NodeEntry)
            $NodePovMap[$Node.id] = $PovKey
        }
    }

    Write-OK "Loaded $($GraphNodes.Count) nodes"

    # ── Step 3: Load edges ──
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $GraphEdges = @()
    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
        if ($StatusFilter -eq 'all') {
            $GraphEdges = @($EdgesData.edges)
        } else {
            $GraphEdges = @($EdgesData.edges | Where-Object { $_.status -eq $StatusFilter })
        }
    }

    Write-OK "Loaded $($GraphEdges.Count) edges (filter: $StatusFilter)"

    # ── Step 4: Optionally load conflicts ──
    $ConflictData = @()
    if ($IncludeConflicts) {
        $ConflictDir = Join-Path $RepoRoot 'conflicts'
        if (Test-Path $ConflictDir) {
            foreach ($File in Get-ChildItem -Path $ConflictDir -Filter '*.json' -File) {
                try {
                    $Conflict = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
                    $ConflictData += [ordered]@{
                        claim_id             = $Conflict.claim_id
                        claim_label          = $Conflict.claim_label
                        description          = $Conflict.description
                        status               = $Conflict.status
                        linked_taxonomy_nodes = $Conflict.linked_taxonomy_nodes
                        instance_count       = @($Conflict.instances).Count
                    }
                } catch {
                    Write-Warn "Failed to load conflict $($File.Name): $_"
                }
            }
            Write-OK "Loaded $($ConflictData.Count) conflicts"
        }
    }

    # ── Step 5: Build compact edge list for context ──
    $CompactEdges = foreach ($Edge in $GraphEdges) {
        $Entry = [ordered]@{
            source     = $Edge.source
            target     = $Edge.target
            type       = $Edge.type
            confidence = $Edge.confidence
            status     = $Edge.status
        }
        if ($Edge.PSObject.Properties['rationale'] -and $Edge.rationale) {
            $Entry['rationale'] = $Edge.rationale
        }
        if ($Edge.PSObject.Properties['bidirectional'] -and $Edge.bidirectional) {
            $Entry['bidirectional'] = $true
        }
        $Entry
    }

    # ── Step 6: Build prompt ──
    Write-Step 'Building prompt'

    $SystemPrompt = Get-Prompt -Name 'graph-query'
    $SchemaPrompt = Get-Prompt -Name 'graph-query-schema'

    $NodesJson = $GraphNodes | ConvertTo-Json -Depth 10
    $EdgesJson = $CompactEdges | ConvertTo-Json -Depth 5

    $FullPrompt = @"
$SystemPrompt

--- USER QUESTION ---
$Question

--- TAXONOMY NODES ($($GraphNodes.Count) nodes) ---
$NodesJson

--- GRAPH EDGES ($($GraphEdges.Count) edges, status filter: $StatusFilter) ---
$EdgesJson
"@

    if ($IncludeConflicts -and $ConflictData.Count -gt 0) {
        $ConflictJson = $ConflictData | ConvertTo-Json -Depth 5
        $FullPrompt += @"

--- CONFLICTS ($($ConflictData.Count) conflicts) ---
$ConflictJson
"@
    }

    $FullPrompt += @"

$SchemaPrompt
"@

    $PromptTokens = [Math]::Round($FullPrompt.Length / 4)
    Write-Info "Prompt: ~$PromptTokens tokens est."

    # ── Step 7: Call AI API ──
    Write-Step 'Querying graph'

    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $Result = Invoke-AIApi `
            -Prompt $FullPrompt `
            -Model $Model `
            -ApiKey $ResolvedKey `
            -Temperature $Temperature `
            -MaxTokens 8192 `
            -JsonMode `
            -TimeoutSec 120
    } catch {
        Write-Fail "API call failed: $_"
        throw
    }
    $Stopwatch.Stop()
    Write-OK "Response in $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"

    # ── Step 8: Parse response ──
    $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
    try {
        $Response = $ResponseText | ConvertFrom-Json -Depth 20
    } catch {
        Write-Warn 'JSON parse failed, attempting repair...'
        $Repaired = Repair-TruncatedJson -Text $ResponseText
        try {
            $Response = $Repaired | ConvertFrom-Json -Depth 20
        } catch {
            Write-Fail 'Could not parse response'
            Write-Host $ResponseText -ForegroundColor DarkGray
            return
        }
    }

    # ── Step 9: Output ──
    if ($Raw) {
        return $Response
    }

    # Formatted output
    Write-Host ''
    Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host "  Q: $Question" -ForegroundColor White
    Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host ''

    # Answer
    if ($Response.PSObject.Properties['answer']) {
        Write-Host $Response.answer -ForegroundColor White
        Write-Host ''
    }

    # Confidence
    if ($Response.PSObject.Properties['confidence']) {
        $ConfPct = [Math]::Round($Response.confidence * 100)
        $ConfColor = if ($ConfPct -ge 80) { 'Green' } elseif ($ConfPct -ge 50) { 'Yellow' } else { 'Red' }
        Write-Host "  Confidence: $ConfPct%" -ForegroundColor $ConfColor
    }

    # Referenced nodes
    if ($Response.PSObject.Properties['referenced_nodes'] -and $Response.referenced_nodes) {
        Write-Host ''
        Write-Host '  Referenced Nodes:' -ForegroundColor Cyan
        foreach ($Ref in @($Response.referenced_nodes)) {
            $PovColor = switch ($Ref.pov) {
                'accelerationist' { 'Blue' }
                'safetyist'       { 'Green' }
                'skeptic'         { 'Yellow' }
                'cross-cutting'   { 'Magenta' }
                default           { 'Gray' }
            }
            Write-Host "    [$($Ref.pov)]" -NoNewline -ForegroundColor $PovColor
            Write-Host " $($Ref.id)" -NoNewline -ForegroundColor White
            Write-Host " — $($Ref.label)" -ForegroundColor DarkGray
            if ($Ref.PSObject.Properties['relevance'] -and $Ref.relevance) {
                Write-Host "      $($Ref.relevance)" -ForegroundColor Gray
            }
        }
    }

    # Paths traced
    if ($Response.PSObject.Properties['paths_traced'] -and $Response.paths_traced) {
        $Paths = @($Response.paths_traced)
        if ($Paths.Count -gt 0) {
            Write-Host ''
            Write-Host '  Paths Traced:' -ForegroundColor Cyan
            foreach ($Path in $Paths) {
                Write-Host "    $($Path.description)" -ForegroundColor White
                if ($Path.PSObject.Properties['nodes'] -and $Path.nodes) {
                    $NodeIds = @($Path.nodes)
                    $EdgeTypes = if ($Path.PSObject.Properties['edge_types']) { @($Path.edge_types) } else { @() }
                    $PathStr = ''
                    for ($i = 0; $i -lt $NodeIds.Count; $i++) {
                        $PathStr += $NodeIds[$i]
                        if ($i -lt $NodeIds.Count - 1) {
                            $EdgeLabel = if ($i -lt $EdgeTypes.Count) { $EdgeTypes[$i] } else { '?' }
                            $PathStr += " --[$EdgeLabel]--> "
                        }
                    }
                    Write-Host "    $PathStr" -ForegroundColor DarkGray
                }
            }
        }
    }

    # Limitations
    if ($Response.PSObject.Properties['limitations'] -and $Response.limitations) {
        Write-Host ''
        Write-Host '  Limitations:' -ForegroundColor Yellow
        Write-Host "    $($Response.limitations)" -ForegroundColor DarkGray
    }

    Write-Host ''
    Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host ''

    return $Response
}
