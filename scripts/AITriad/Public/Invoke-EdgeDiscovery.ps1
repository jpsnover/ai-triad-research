# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-EdgeDiscovery {
    <#
    .SYNOPSIS
        Uses AI to discover typed edges between taxonomy nodes (Phase 2 of LAG proposal).
    .DESCRIPTION
        For each taxonomy node, sends the node plus the full candidate list to an LLM,
        which proposes typed, directed edges with confidence scores and rationale.

        Edges are stored in taxonomy/Origin/edges.json. Proposed edges require human
        approval before becoming active.

        Nodes that have been edited since their last edge discovery are marked STALE
        and can be selectively re-processed with -StaleOnly.
    .PARAMETER POV
        Process only nodes from this POV. If omitted, processes all POVs and cross-cutting.
        Valid values: accelerationist, safetyist, skeptic, cross-cutting.
    .PARAMETER NodeId
        Process only this specific node ID. Useful for targeted re-discovery.
    .PARAMETER StaleOnly
        Only process nodes marked as STALE (edited since last edge discovery).
    .PARAMETER Model
        AI model to use. Defaults to 'gemini-2.5-flash'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.3 (slightly creative for relationship discovery).
    .PARAMETER DryRun
        Build and display the prompt for the first node, but do NOT call the API.
    .PARAMETER Force
        Re-discover edges for all nodes, even those that already have edges and are not STALE.
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .EXAMPLE
        Invoke-EdgeDiscovery -DryRun
    .EXAMPLE
        Invoke-EdgeDiscovery -POV accelerationist
    .EXAMPLE
        Invoke-EdgeDiscovery -StaleOnly
    .EXAMPLE
        Invoke-EdgeDiscovery -NodeId "acc-goals-001" -Force
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')]
        [string]$POV = '',

        [string]$NodeId = '',

        [switch]$StaleOnly,

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

        [switch]$DryRun,

        [switch]$Force,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest

    # ── Step 1: Validate environment ──
    Write-Step 'Validating environment'

    if (-not (Test-Path $RepoRoot)) {
        Write-Fail "Repo root not found: $RepoRoot"
        throw "Repo root not found"
    }

    $TaxDir = Join-Path $RepoRoot 'taxonomy' 'Origin'
    if (-not (Test-Path $TaxDir)) {
        Write-Fail "Taxonomy directory not found: $TaxDir"
        throw "Taxonomy directory not found"
    }

    if (-not $DryRun) {
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

    # ── Step 2: Load all taxonomy nodes ──
    Write-Step 'Loading taxonomy'

    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
    $AllNodes = [System.Collections.Generic.List[PSObject]]::new()
    $NodePovMap = @{}   # node ID → pov key

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }

        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
        foreach ($Node in $FileData.nodes) {
            $AllNodes.Add($Node)
            $NodePovMap[$Node.id] = $PovKey
        }
    }

    Write-OK "Loaded $($AllNodes.Count) nodes across $($PovFiles.Count) POVs"

    # ── Step 3: Load existing edges ──
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
    } else {
        $EdgesData = [PSCustomObject]@{
            _schema_version = '1.0.0'
            _doc            = 'Edge discovery results. Each entry represents a proposed or approved edge between taxonomy nodes.'
            last_modified   = (Get-Date).ToString('yyyy-MM-dd')
            edge_types      = @(
                [PSCustomObject]@{ type = 'SUPPORTS';     bidirectional = $false; definition = 'Source claim directly strengthens or provides evidence for target.' }
                [PSCustomObject]@{ type = 'CONTRADICTS';  bidirectional = $true;  definition = 'Source and target make incompatible claims.' }
                [PSCustomObject]@{ type = 'ASSUMES';      bidirectional = $false; definition = 'Source claim depends on target being true.' }
                [PSCustomObject]@{ type = 'WEAKENS';      bidirectional = $false; definition = 'Source undermines target without fully contradicting it.' }
                [PSCustomObject]@{ type = 'RESPONDS_TO';  bidirectional = $false; definition = 'Source was formulated as a direct response to target.' }
                [PSCustomObject]@{ type = 'TENSION_WITH'; bidirectional = $true;  definition = 'Source and target pull in different directions without direct contradiction.' }
                [PSCustomObject]@{ type = 'CITES';        bidirectional = $false; definition = 'Source explicitly references or builds upon target.' }
                [PSCustomObject]@{ type = 'INTERPRETS';   bidirectional = $false; definition = 'Source provides a POV-specific reading of target concept.' }
                [PSCustomObject]@{ type = 'SUPPORTED_BY'; bidirectional = $false; definition = 'Source claim is backed by evidence in target.' }
            )
            edges           = @()
            discovery_log   = @()
        }
    }

    # Build a set of existing edge keys for dedup: "source|type|target"
    $ExistingEdgeKeys = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Edge in $EdgesData.edges) {
        $Key = "$($Edge.source)|$($Edge.type)|$($Edge.target)"
        [void]$ExistingEdgeKeys.Add($Key)
    }

    # ── Step 4: Determine which nodes to process ──
    $NodesToProcess = [System.Collections.Generic.List[PSObject]]::new()

    # Build set of node IDs that have been discovered
    $DiscoveredNodeIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Entry in $EdgesData.discovery_log) {
        [void]$DiscoveredNodeIds.Add($Entry.node_id)
    }

    foreach ($Node in $AllNodes) {
        # Filter by POV if specified
        if ($POV -and $NodePovMap[$Node.id] -ne $POV) { continue }

        # Filter by NodeId if specified
        if ($NodeId -and $Node.id -ne $NodeId) { continue }

        # Check if node needs processing
        $NeedsProcessing = $false

        if ($Force) {
            $NeedsProcessing = $true
        } elseif ($StaleOnly) {
            # Check if node is marked STALE
            if ($Node.PSObject.Properties['edge_status'] -and $Node.edge_status -eq 'STALE') {
                $NeedsProcessing = $true
            }
        } elseif (-not $DiscoveredNodeIds.Contains($Node.id)) {
            # Not yet discovered
            $NeedsProcessing = $true
        }

        if ($NeedsProcessing) {
            $NodesToProcess.Add($Node)
        }
    }

    if ($NodesToProcess.Count -eq 0) {
        Write-OK 'No nodes need edge discovery (use -Force to re-discover all)'
        return
    }

    Write-Info "$($NodesToProcess.Count) nodes to process"

    # ── Step 5: Build candidate list (compact format for context efficiency) ──
    $CandidateList = foreach ($Node in $AllNodes) {
        $Entry = [ordered]@{
            id    = $Node.id
            pov   = $NodePovMap[$Node.id]
            label = $Node.label
        }
        if ($Node.PSObject.Properties['category']) {
            $Entry['category'] = $Node.category
        }
        if ($Node.PSObject.Properties['description']) {
            # Truncate long descriptions to save context
            $Desc = $Node.description
            if ($Desc.Length -gt 200) {
                $Desc = $Desc.Substring(0, 197) + '...'
            }
            $Entry['description'] = $Desc
        }
        $Entry
    }
    $CandidateJson = $CandidateList | ConvertTo-Json -Depth 5

    # ── Step 6: Load prompts ──
    $SystemPrompt = Get-Prompt -Name 'edge-discovery'
    $SchemaPrompt = Get-Prompt -Name 'edge-discovery-schema'

    # ── Step 7: Process each node ──
    $TotalProcessed = 0
    $TotalEdges     = 0
    $TotalFailed    = 0
    $NewEdgeTypes   = [System.Collections.Generic.List[PSObject]]::new()

    $NodeNum = 0
    foreach ($Node in $NodesToProcess) {
        $NodeNum++
        $PovKey = $NodePovMap[$Node.id]
        Write-Step "[$NodeNum/$($NodesToProcess.Count)] $($Node.id) ($PovKey)"

        # Build source node context (full detail)
        $SourceContext = [ordered]@{
            id          = $Node.id
            pov         = $PovKey
            label       = $Node.label
            description = $Node.description
        }
        if ($Node.PSObject.Properties['category']) {
            $SourceContext['category'] = $Node.category
        }
        if ($PovKey -eq 'cross-cutting' -and $Node.PSObject.Properties['interpretations']) {
            $SourceContext['interpretations'] = $Node.interpretations
        }
        if ($Node.PSObject.Properties['graph_attributes']) {
            $SourceContext['graph_attributes'] = $Node.graph_attributes
        }

        $SourceJson = $SourceContext | ConvertTo-Json -Depth 10

        $FullPrompt = @"
$SystemPrompt

--- SOURCE NODE ---
$SourceJson

--- CANDIDATE NODES ---
$CandidateJson

$SchemaPrompt
"@

        # ── DryRun: show first node prompt and exit ──
        if ($DryRun) {
            Write-Host ''
            Write-Host '=== PROMPT PREVIEW (first node) ===' -ForegroundColor Cyan
            Write-Host ''
            $Lines = $SystemPrompt -split "`n"
            if ($Lines.Count -gt 15) {
                Write-Host ($Lines[0..14] -join "`n") -ForegroundColor DarkGray
                Write-Host "  ... ($($Lines.Count) total lines)" -ForegroundColor DarkGray
            } else {
                Write-Host $SystemPrompt -ForegroundColor DarkGray
            }
            Write-Host ''
            Write-Host '--- SOURCE NODE ---' -ForegroundColor Yellow
            Write-Host $SourceJson -ForegroundColor White
            Write-Host ''
            Write-Host '--- CANDIDATE NODES ---' -ForegroundColor Yellow
            Write-Host "($($AllNodes.Count) nodes, ~$($CandidateJson.Length) chars)" -ForegroundColor DarkGray
            Write-Host ''
            Write-Host "Total prompt length: ~$($FullPrompt.Length) chars (~$([Math]::Round($FullPrompt.Length / 4)) tokens est.)" -ForegroundColor Cyan
            Write-Host "Nodes to process: $($NodesToProcess.Count)" -ForegroundColor Cyan
            return
        }

        # ── Call AI API ──
        $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $Result = Invoke-AIApi `
                -Prompt $FullPrompt `
                -Model $Model `
                -ApiKey $ResolvedKey `
                -Temperature $Temperature `
                -MaxTokens 16384 `
                -JsonMode `
                -TimeoutSec 120
        } catch {
            Write-Fail "API call failed for $($Node.id): $_"
            $TotalFailed++
            continue
        }
        $Stopwatch.Stop()
        Write-Info "API response in $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"

        # ── Parse response ──
        $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
        try {
            $Discovery = $ResponseText | ConvertFrom-Json -Depth 20
        } catch {
            Write-Warn "JSON parse failed, attempting repair..."
            $Repaired = Repair-TruncatedJson -Text $ResponseText
            try {
                $Discovery = $Repaired | ConvertFrom-Json -Depth 20
            } catch {
                Write-Fail "Could not parse response for $($Node.id)"
                $TotalFailed++
                continue
            }
        }

        # Validate source_node_id
        if ($Discovery.source_node_id -ne $Node.id) {
            Write-Warn "$($Node.id): response source_node_id mismatch ('$($Discovery.source_node_id)'), correcting"
        }

        # ── Process new edge types ──
        if ($Discovery.PSObject.Properties['new_edge_types'] -and $Discovery.new_edge_types) {
            foreach ($NewType in $Discovery.new_edge_types) {
                Write-Info "New edge type proposed: $($NewType.type) — $($NewType.definition)"
                $NewEdgeTypes.Add($NewType)
            }
        }

        # ── Process edges ──
        $NodeEdgeCount = 0
        if ($Discovery.PSObject.Properties['edges'] -and $Discovery.edges) {
            foreach ($Edge in @($Discovery.edges)) {
                # Skip malformed edge objects (can happen from truncated JSON repair)
                if (-not $Edge.PSObject.Properties['target'] -or
                    -not $Edge.PSObject.Properties['type'] -or
                    -not $Edge.PSObject.Properties['confidence']) {
                    Write-Warn "$($Node.id): skipping malformed edge (missing target/type/confidence)"
                    continue
                }

                # Validate target exists
                if (-not $NodePovMap.ContainsKey($Edge.target)) {
                    Write-Warn "$($Node.id) → $($Edge.target): target not found in taxonomy, skipping"
                    continue
                }

                # Skip self-edges
                if ($Edge.target -eq $Node.id) {
                    Write-Warn "$($Node.id): self-edge skipped"
                    continue
                }

                # Validate confidence
                $Confidence = [double]$Edge.confidence
                if ($Confidence -lt 0.5) {
                    Write-Warn "$($Node.id) → $($Edge.target): confidence $Confidence < 0.5, skipping"
                    continue
                }

                # Check for duplicate
                $EdgeKey = "$($Node.id)|$($Edge.type)|$($Edge.target)"
                if ($ExistingEdgeKeys.Contains($EdgeKey)) {
                    Write-Info "$($Node.id) → $($Edge.target) ($($Edge.type)): already exists, skipping"
                    continue
                }

                # Build edge object
                $Rationale = if ($Edge.PSObject.Properties['rationale']) { $Edge.rationale } else { '' }
                $EdgeObj = [ordered]@{
                    source        = $Node.id
                    target        = $Edge.target
                    type          = $Edge.type
                    bidirectional = if ($Edge.PSObject.Properties['bidirectional']) { [bool]$Edge.bidirectional } else { $false }
                    confidence    = $Confidence
                    rationale     = $Rationale
                    status        = 'proposed'
                    discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                    model         = $Model
                }

                if ($Edge.PSObject.Properties['strength'] -and $Edge.strength) {
                    $EdgeObj['strength'] = $Edge.strength
                }
                if ($Edge.PSObject.Properties['notes'] -and $Edge.notes) {
                    $EdgeObj['notes'] = $Edge.notes
                }

                # Add to edges array
                $EdgesData.edges += [PSCustomObject]$EdgeObj
                [void]$ExistingEdgeKeys.Add($EdgeKey)

                # Also add reverse key for bidirectional edges
                if ($EdgeObj.bidirectional) {
                    $ReverseKey = "$($Edge.target)|$($Edge.type)|$($Node.id)"
                    [void]$ExistingEdgeKeys.Add($ReverseKey)
                }

                $NodeEdgeCount++
                $TotalEdges++
            }
        }

        Write-OK "$($Node.id): $NodeEdgeCount edge(s) proposed"

        # Update discovery log
        $EdgesData.discovery_log += [PSCustomObject][ordered]@{
            node_id       = $Node.id
            discovered_at = (Get-Date).ToString('yyyy-MM-dd')
            model         = $Model
            edge_count    = $NodeEdgeCount
        }

        $TotalProcessed++
    }

    # ── Step 8: Add any new edge types to the schema ──
    if ($NewEdgeTypes.Count -gt 0) {
        foreach ($NewType in $NewEdgeTypes) {
            $Existing = $EdgesData.edge_types | Where-Object { $_.type -eq $NewType.type }
            if (-not $Existing) {
                $EdgesData.edge_types += [PSCustomObject][ordered]@{
                    type          = $NewType.type
                    bidirectional = if ($NewType.PSObject.Properties['bidirectional']) { [bool]$NewType.bidirectional } else { $false }
                    definition    = $NewType.definition
                    llm_proposed  = $true
                }
                Write-OK "Added new edge type: $($NewType.type)"
            }
        }
    }

    # ── Step 9: Write edges file ──
    if ($TotalProcessed -gt 0) {
        if ($PSCmdlet.ShouldProcess($EdgesPath, 'Write edges file')) {
            $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
            $Json = $EdgesData | ConvertTo-Json -Depth 20
            Set-Content -Path $EdgesPath -Value $Json -Encoding UTF8
            Write-OK "Saved edges to $EdgesPath"
        }
    }

    # ── Summary ──
    Write-Host ''
    Write-Host '=== Edge Discovery Complete ===' -ForegroundColor Cyan
    Write-Host "  Nodes processed:  $TotalProcessed" -ForegroundColor Green
    Write-Host "  Edges proposed:   $TotalEdges" -ForegroundColor Green
    Write-Host "  Failed:           $TotalFailed" -ForegroundColor $(if ($TotalFailed -gt 0) { 'Red' } else { 'Green' })
    if ($NewEdgeTypes.Count -gt 0) {
        Write-Host "  New edge types:   $($NewEdgeTypes.Count)" -ForegroundColor Yellow
    }
    Write-Host "  Total edges in store: $($EdgesData.edges.Count)" -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Proposed edges need human approval. Use Approve-Edge or Review-Edges to manage.' -ForegroundColor DarkGray
    Write-Host ''
}
