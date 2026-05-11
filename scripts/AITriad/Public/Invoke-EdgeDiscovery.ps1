# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-EdgeDiscovery {
    <#
    .SYNOPSIS
        Uses AI to discover typed edges between taxonomy nodes (Phase 2 of LAG proposal).
    .DESCRIPTION
        For each taxonomy node, sends the node plus a filtered candidate list to an LLM,
        which proposes typed, directed edges with confidence scores and rationale.

        Edges are stored in taxonomy/Origin/edges.json. Proposed edges require human
        approval before becoming active.

        Nodes that have been edited since their last edge discovery are marked STALE
        and can be selectively re-processed with -StaleOnly.

        SCALING FEATURES
        ----------------
        - Embedding pre-filter (-TopKCandidates): uses embeddings.json to send only the
          top-K most semantically similar candidates per node instead of the full list,
          reducing prompt size from O(N) to O(K) per call. Disabled with -SkipEmbeddingFilter.
        - Cross-POV floor (-MinPerOtherPov): guarantees a minimum number of candidates
          from each non-source POV to preserve cross-cutting relationship discovery.
        - Parallel workers (-MaxConcurrent): runs multiple API calls concurrently using
          ForEach-Object -Parallel. Default 1 (sequential).
        - Checkpointing (-CheckpointEvery): writes edges.json every N nodes in sequential
          mode so progress is not lost on crash or interruption.
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
        Sampling temperature (0.0-1.0). Default: 0.3.
    .PARAMETER DryRun
        Build and display the prompt for the first node, but do NOT call the API.
    .PARAMETER Force
        Re-discover edges for all nodes, even those that already have edges and are not STALE.
    .PARAMETER MaxConcurrent
        Number of parallel API workers. Default: 1 (sequential). Values > 1 enable
        ForEach-Object -Parallel. Checkpointing is only active in sequential mode.
    .PARAMETER TopKCandidates
        Maximum number of embedding-filtered candidates per source node. Default: 40.
        Has no effect when -SkipEmbeddingFilter is set or embeddings.json is absent.
    .PARAMETER MinPerOtherPov
        Minimum candidates from each non-source POV, added after top-K ranking to
        ensure cross-cutting edge discovery. Default: 4.
    .PARAMETER SkipEmbeddingFilter
        Disable embedding-based pre-filtering and send all candidates per node.
        Use when embeddings.json is stale or to replicate original behavior.
    .PARAMETER CheckpointEvery
        Write edges.json after every N nodes in sequential mode. Default: 10. Set to 0
        to disable checkpointing (write only at the end).
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .EXAMPLE
        Invoke-EdgeDiscovery -DryRun
    .EXAMPLE
        Invoke-EdgeDiscovery -POV accelerationist
    .EXAMPLE
        Invoke-EdgeDiscovery -StaleOnly
    .EXAMPLE
        Invoke-EdgeDiscovery -NodeId "acc-desires-001" -Force
    .EXAMPLE
        Invoke-EdgeDiscovery -MaxConcurrent 6
    .EXAMPLE
        Invoke-EdgeDiscovery -TopKCandidates 30 -MinPerOtherPov 6
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations')]
        [string]$POV = '',

        [string]$NodeId = '',

        [switch]$StaleOnly,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = 'gemini-2.5-flash',

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [switch]$DryRun,

        [switch]$Force,

        [ValidateRange(1, 32)]
        [int]$MaxConcurrent = 1,

        [ValidateRange(5, 500)]
        [int]$TopKCandidates = 40,

        [ValidateRange(0, 20)]
        [int]$MinPerOtherPov = 4,

        [switch]$SkipEmbeddingFilter,

        [ValidateRange(0, 100)]
        [int]$CheckpointEvery = 10,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ForEach-Object -Parallel is PS 7+ only. The AITriad module supports
    # Windows PowerShell 5.1 as a hard requirement (see AITriad.psd1), so on
    # 5.1 we clamp -MaxConcurrent to 1 and use the sequential code path.
    if ($MaxConcurrent -gt 1 -and $PSVersionTable.PSVersion.Major -lt 7) {
        Write-Warn "MaxConcurrent > 1 requires PowerShell 7+; falling back to sequential (MaxConcurrent = 1) on Windows PowerShell $($PSVersionTable.PSVersion)."
        $MaxConcurrent = 1
    }

    # ── Step 1: Validate environment ──
    Write-Step 'Validating environment'

    if (-not (Test-Path $RepoRoot)) {
        Write-Fail "Repo root not found: $RepoRoot"
        throw 'Repo root not found'
    }

    $TaxDir = Get-TaxonomyDir
    if (-not (Test-Path $TaxDir)) {
        Write-Fail "Taxonomy directory not found: $TaxDir"
        throw 'Taxonomy directory not found'
    }

    if (-not $DryRun) {
        if     ($Model -match '^gemini') { $Backend = 'gemini' }
        elseif ($Model -match '^claude') { $Backend = 'claude' }
        elseif ($Model -match '^groq')   { $Backend = 'groq'   }
        elseif ($Model -match '^openai') { $Backend = 'openai' }
        else                             { $Backend = 'gemini'  }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            Write-Fail 'No API key found. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY.'
            throw 'No API key configured'
        }
    } else {
        $ResolvedKey = ''
    }

    # ── Step 2: Load all taxonomy nodes ──
    Write-Step 'Loading taxonomy'

    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
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

    # Build canonical edge type set for validation (gap 7.2)
    $ValidEdgeTypes = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($ET in @($EdgesData.edge_types)) {
        [void]$ValidEdgeTypes.Add($ET.type)
    }

    # Build full node ID set for validation (gap 7.1)
    $ValidNodeIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($Node in $AllNodes) { [void]$ValidNodeIds.Add($Node.id) }

    # Use a List for O(1) appends instead of O(N²) array concatenation
    $EdgesList = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Edge in @($EdgesData.edges)) {
        $EdgesList.Add($Edge)
    }

    # Build a set of existing edge keys for dedup: "source|type|target"
    $ExistingEdgeKeys = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Edge in $EdgesList) {
        [void]$ExistingEdgeKeys.Add("$($Edge.source)|$($Edge.type)|$($Edge.target)")
    }

    # ── Step 4: Determine which nodes to process ──
    $NodesToProcess = [System.Collections.Generic.List[PSObject]]::new()

    $DiscoveredNodeIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Entry in $EdgesData.discovery_log) {
        [void]$DiscoveredNodeIds.Add($Entry.node_id)
    }

    foreach ($Node in $AllNodes) {
        if ($POV    -and $NodePovMap[$Node.id] -ne $POV)    { continue }
        if ($NodeId -and $Node.id -ne $NodeId)              { continue }

        $NeedsProcessing = $false
        if     ($Force)                                                                               { $NeedsProcessing = $true }
        elseif ($StaleOnly -and $Node.PSObject.Properties['edge_status'] -and $Node.edge_status -eq 'STALE') { $NeedsProcessing = $true }
        elseif (-not $Force -and -not $StaleOnly -and -not $DiscoveredNodeIds.Contains($Node.id))    { $NeedsProcessing = $true }

        if ($NeedsProcessing) { $NodesToProcess.Add($Node) }
    }

    if ($NodesToProcess.Count -eq 0) {
        Write-OK 'No nodes need edge discovery (use -Force to re-discover all)'
        return
    }

    Write-Info "$($NodesToProcess.Count) nodes to process"

    # ── Step 5: Load embeddings (best-effort) ──
    $Embeddings = @{}   # node ID → [double[]]

    if (-not $SkipEmbeddingFilter) {
        $EmbeddingsPath = Join-Path $TaxDir 'embeddings.json'
        if (Test-Path $EmbeddingsPath) {
            try {
                $EmbJson = Get-Content -Raw -Path $EmbeddingsPath | ConvertFrom-Json
                foreach ($Prop in $EmbJson.nodes.PSObject.Properties) {
                    $Embeddings[$Prop.Name] = [double[]]@($Prop.Value.vector)
                }
                Write-OK "Loaded embeddings for $($Embeddings.Count) nodes (TopK=$TopKCandidates, MinPerPov=$MinPerOtherPov)"
            } catch {
                Write-Warn "Failed to parse embeddings from '$EmbeddingsPath': $($_.Exception.Message)"
                Write-Info 'Falling back to full candidate list. To fix, regenerate embeddings with Update-TaxonomyEmbeddings.'
            }
        } else {
            Write-Info 'embeddings.json not found — using full candidate list'
        }
    } else {
        Write-Info 'Embedding filter disabled (-SkipEmbeddingFilter)'
    }

    # ── Step 6: Load prompts ──
    $SystemPrompt = Get-Prompt -Name 'edge-discovery'
    $SchemaPrompt = Get-Prompt -Name 'edge-discovery-schema'

    $EdgeSchema = @{
        type       = 'object'
        properties = @{
            source_node_id = @{ type = 'string' }
            edges          = @{
                type  = 'array'
                items = @{
                    type       = 'object'
                    properties = @{
                        type          = @{ type = 'string' }
                        target        = @{ type = 'string' }
                        bidirectional = @{ type = 'boolean' }
                        confidence    = @{ type = 'number' }
                        weight        = @{ type = 'number' }
                        rationale     = @{ type = 'string' }
                        strength      = @{ type = 'string'; enum = @('strong', 'moderate', 'weak') }
                        notes         = @{ type = 'string' }
                    }
                    required   = @('type', 'target', 'confidence', 'rationale')
                }
            }
            new_edge_types = @{
                type  = 'array'
                items = @{
                    type       = 'object'
                    properties = @{
                        type          = @{ type = 'string' }
                        definition    = @{ type = 'string' }
                        bidirectional = @{ type = 'boolean' }
                    }
                    required   = @('type', 'definition')
                }
            }
        }
        required   = @('edges')
    }

    # ── Step 7: Build per-node filtered candidate list and full prompt ──
    Write-Step 'Building per-node prompts'

    $NodePrompts = @{}   # node ID → full prompt string
    $AllNodeArray = $AllNodes.ToArray()

    foreach ($Node in $NodesToProcess) {
        $PovKey = $NodePovMap[$Node.id]

        # Filter candidates for this source node
        if ($Embeddings.Count -gt 0) {
            $Candidates = Get-FilteredCandidates `
                -SourceId      $Node.id `
                -Embeddings    $Embeddings `
                -AllNodes      $AllNodeArray `
                -NodePovMap    $NodePovMap `
                -TopK          $TopKCandidates `
                -MinPerOtherPov $MinPerOtherPov
        } else {
            $Candidates = @($AllNodes | Where-Object { $_.id -ne $Node.id })
        }

        # Build compact candidate JSON
        $CandidateList = foreach ($Cand in $Candidates) {
            $Entry = [ordered]@{
                id    = $Cand.id
                pov   = $NodePovMap[$Cand.id]
                label = $Cand.label
            }
            if ($Cand.PSObject.Properties['category'])    { $Entry['category']    = $Cand.category }
            if ($Cand.PSObject.Properties['description']) {
                $Desc = $Cand.description
                if ($Desc.Length -gt 200) { $Desc = $Desc.Substring(0, 197) + '...' }
                $Entry['description'] = $Desc
            }
            $Entry
        }
        $CandidateJson = $CandidateList | ConvertTo-Json -Depth 5

        # Build source node context (full detail)
        $SourceContext = [ordered]@{
            id          = $Node.id
            pov         = $PovKey
            label       = $Node.label
        }
        if ($Node.PSObject.Properties['description']) { $SourceContext['description'] = $Node.description }
        if ($Node.PSObject.Properties['category'])         { $SourceContext['category']        = $Node.category }
        if ($PovKey -eq 'situations' -and $Node.PSObject.Properties['interpretations']) {
            $SourceContext['interpretations'] = $Node.interpretations
        }
        if ($Node.PSObject.Properties['graph_attributes']) { $SourceContext['graph_attributes'] = $Node.graph_attributes }

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
            $CandCount = @($Candidates).Count
            Write-Host "($CandCount candidates, ~$($CandidateJson.Length) chars)" -ForegroundColor DarkGray
            if ($Embeddings.Count -gt 0) {
                Write-Host "  (filtered from $($AllNodes.Count) using embeddings)" -ForegroundColor DarkGray
            }
            Write-Host ''
            Write-Host "Total prompt length: ~$($FullPrompt.Length) chars (~$([Math]::Round($FullPrompt.Length / 4)) tokens est.)" -ForegroundColor Cyan
            Write-Host "Nodes to process: $($NodesToProcess.Count)" -ForegroundColor Cyan
            return
        }

        $NodePrompts[$Node.id] = $FullPrompt
    }

    # ── Step 8: Execute edge discovery ──
    $TotalProcessed = 0
    $TotalEdges     = 0
    $TotalFailed    = 0
    $NewEdgeTypes   = [System.Collections.Generic.List[PSObject]]::new()

    # Shared save-checkpoint logic (called in sequential mode)
    $SaveCheckpoint = {
        param([string]$Path, [PSObject]$Data, [System.Collections.Generic.List[PSObject]]$List)
        $Data.edges         = $List.ToArray()
        $Data.last_modified = (Get-Date).ToString('yyyy-MM-dd')
        $Json = $Data | ConvertTo-Json -Depth 20
        Write-Utf8NoBom -Path $Path -Value $Json 
        Write-Info "Checkpoint saved ($($List.Count) edges)"
    }

    if ($MaxConcurrent -le 1) {
        # ── Sequential path (with checkpointing) ──
        $NodeNum = 0
        foreach ($Node in $NodesToProcess) {
            $NodeNum++
            $PovKey = $NodePovMap[$Node.id]
            Write-Step "[$NodeNum/$($NodesToProcess.Count)] $($Node.id) ($PovKey)"

            $Disc = Invoke-NodeEdgeDiscovery `
                -Node            $Node `
                -FullPrompt      $NodePrompts[$Node.id] `
                -Model           $Model `
                -ApiKey          $ResolvedKey `
                -Temperature     $Temperature `
                -ResponseSchema  $EdgeSchema

            # ── Process result ──
            if ($Disc.Error) {
                Write-Fail "$($Disc.NodeId): $($Disc.Error)"
                $TotalFailed++
                continue
            }

            Write-Info "$($Disc.NodeId): API response in $($Disc.ElapsedSec)s"

            $NodeEdgeCount = 0
            foreach ($Edge in @($Disc.RawEdges)) {
                if (-not ($Edge.PSObject.Properties['target'] -and
                          $Edge.PSObject.Properties['type']   -and
                          $Edge.PSObject.Properties['confidence'])) {
                    Write-Warn "$($Disc.NodeId): malformed edge (missing target/type/confidence), skipping"
                    continue
                }
                if (-not $NodePovMap.ContainsKey($Edge.target)) {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): target not in taxonomy, skipping"
                    continue
                }
                if ($Edge.target -eq $Disc.NodeId) {
                    Write-Warn "$($Disc.NodeId): self-edge skipped"
                    continue
                }
                if (-not $ValidEdgeTypes.Contains($Edge.type)) {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): unknown edge type '$($Edge.type)', skipping"
                    continue
                }
                $Confidence = [double]$Edge.confidence
                if ($Confidence -lt 0.5) {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): confidence $Confidence < 0.5, skipping"
                    continue
                }
                $EdgeKey = "$($Disc.NodeId)|$($Edge.type)|$($Edge.target)"
                if ($ExistingEdgeKeys.Contains($EdgeKey)) {
                    Write-Info "$($Disc.NodeId) → $($Edge.target) ($($Edge.type)): already exists, skipping"
                    continue
                }

                if ($Edge.PSObject.Properties['bidirectional']) { $Bidir = [bool]$Edge.bidirectional } else { $Bidir = $false }
                if ($Edge.PSObject.Properties['rationale'])    { $Rationale = $Edge.rationale }           else { $Rationale = '' }
                $EdgeObj  = [ordered]@{
                    source        = $Disc.NodeId
                    target        = $Edge.target
                    type          = $Edge.type
                    bidirectional = $Bidir
                    confidence    = $Confidence
                    rationale     = $Rationale
                    status        = 'proposed'
                    discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                    model         = $Model
                }
                if ($Edge.PSObject.Properties['weight'] -and $null -ne $Edge.weight) {
                    $W = [double]$Edge.weight
                    if ($W -ge 0.0 -and $W -le 1.0) { $EdgeObj['weight'] = $W }
                }
                if ($Edge.PSObject.Properties['strength'] -and $Edge.strength) { $EdgeObj['strength'] = $Edge.strength }
                if ($Edge.PSObject.Properties['notes']    -and $Edge.notes)    { $EdgeObj['notes']    = $Edge.notes    }

                $EdgesList.Add([PSCustomObject]$EdgeObj)
                [void]$ExistingEdgeKeys.Add($EdgeKey)
                if ($Bidir) { [void]$ExistingEdgeKeys.Add("$($Edge.target)|$($Edge.type)|$($Disc.NodeId)") }
                $NodeEdgeCount++
                $TotalEdges++
            }

            foreach ($NewType in @($Disc.NewEdgeTypes)) {
                Write-Info "New edge type proposed: $($NewType.type) — $($NewType.definition)"
                $NewEdgeTypes.Add($NewType)
            }

            Write-OK "$($Disc.NodeId): $NodeEdgeCount edge(s) proposed"

            $EdgesData.discovery_log += [PSCustomObject][ordered]@{
                node_id       = $Disc.NodeId
                discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                model         = $Model
                edge_count    = $NodeEdgeCount
            }

            $TotalProcessed++

            # Checkpoint
            if ($CheckpointEvery -gt 0 -and $TotalProcessed % $CheckpointEvery -eq 0) {
                if ($PSCmdlet.ShouldProcess($EdgesPath, "Write checkpoint after $TotalProcessed nodes")) {
                    try {
                        & $SaveCheckpoint $EdgesPath $EdgesData $EdgesList
                    } catch {
                        Write-Warn "Checkpoint write failed: $($_.Exception.Message)"
                    }
                }
            }
        }

    } else {
        # ── Parallel path ──
        Write-Info "Running $MaxConcurrent parallel workers"

        $DiscFnBody   = (Get-Command Invoke-NodeEdgeDiscovery).ScriptBlock.ToString()
        $AIEnrichPath = Join-Path (Join-Path $script:ModuleRoot '..') 'AIEnrich.psm1'
        $ParallelBag  = [System.Collections.Concurrent.ConcurrentBag[object]]::new()

        $NodesToProcess | ForEach-Object -Parallel {
            Import-Module $using:AIEnrichPath -Force
            . ([scriptblock]::Create("function Invoke-NodeEdgeDiscovery {$using:DiscFnBody}"))

            $Prompts = $using:NodePrompts
            $Disc = Invoke-NodeEdgeDiscovery `
                -Node            $_ `
                -FullPrompt      $Prompts[$_.id] `
                -Model           $using:Model `
                -ApiKey          $using:ResolvedKey `
                -Temperature     $using:Temperature `
                -ResponseSchema  $using:EdgeSchema

            [void]($using:ParallelBag).Add($Disc)

        } -ThrottleLimit $MaxConcurrent

        # ── Merge parallel results ──
        Write-Step 'Merging parallel results'

        foreach ($Disc in $ParallelBag) {
            if ($Disc.Error) {
                Write-Fail "$($Disc.NodeId): $($Disc.Error)"
                $TotalFailed++
                continue
            }

            Write-Info "$($Disc.NodeId): $($Disc.ElapsedSec)s"

            $NodeEdgeCount = 0
            foreach ($Edge in @($Disc.RawEdges)) {
                if (-not ($Edge.PSObject.Properties['target'] -and
                          $Edge.PSObject.Properties['type']   -and
                          $Edge.PSObject.Properties['confidence'])) {
                    Write-Warn "$($Disc.NodeId): malformed edge, skipping"
                    continue
                }
                if (-not $NodePovMap.ContainsKey($Edge.target)) {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): target not in taxonomy, skipping"
                    continue
                }
                if ($Edge.target -eq $Disc.NodeId) { continue }
                if (-not $ValidEdgeTypes.Contains($Edge.type)) {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): unknown edge type '$($Edge.type)', skipping"
                    continue
                }
                $Confidence = [double]$Edge.confidence
                if ($Confidence -lt 0.5) { continue }
                $EdgeKey = "$($Disc.NodeId)|$($Edge.type)|$($Edge.target)"
                if ($ExistingEdgeKeys.Contains($EdgeKey)) { continue }

                if ($Edge.PSObject.Properties['bidirectional']) { $Bidir = [bool]$Edge.bidirectional } else { $Bidir = $false }
                if ($Edge.PSObject.Properties['rationale'])    { $Rationale = $Edge.rationale }           else { $Rationale = '' }
                $EdgeObj  = [ordered]@{
                    source        = $Disc.NodeId
                    target        = $Edge.target
                    type          = $Edge.type
                    bidirectional = $Bidir
                    confidence    = $Confidence
                    rationale     = $Rationale
                    status        = 'proposed'
                    discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                    model         = $Model
                }
                if ($Edge.PSObject.Properties['weight'] -and $null -ne $Edge.weight) {
                    $W = [double]$Edge.weight
                    if ($W -ge 0.0 -and $W -le 1.0) { $EdgeObj['weight'] = $W }
                }
                if ($Edge.PSObject.Properties['strength'] -and $Edge.strength) { $EdgeObj['strength'] = $Edge.strength }
                if ($Edge.PSObject.Properties['notes']    -and $Edge.notes)    { $EdgeObj['notes']    = $Edge.notes    }

                $EdgesList.Add([PSCustomObject]$EdgeObj)
                [void]$ExistingEdgeKeys.Add($EdgeKey)
                if ($Bidir) { [void]$ExistingEdgeKeys.Add("$($Edge.target)|$($Edge.type)|$($Disc.NodeId)") }
                $NodeEdgeCount++
                $TotalEdges++
            }

            foreach ($NewType in @($Disc.NewEdgeTypes)) {
                Write-Info "New edge type proposed: $($NewType.type) — $($NewType.definition)"
                $NewEdgeTypes.Add($NewType)
            }

            Write-OK "$($Disc.NodeId): $NodeEdgeCount edge(s)"

            $EdgesData.discovery_log += [PSCustomObject][ordered]@{
                node_id       = $Disc.NodeId
                discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                model         = $Model
                edge_count    = $NodeEdgeCount
            }

            $TotalProcessed++
        }
    }

    # ── Step 9: Add any new edge types to the schema ──
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

    # ── Step 10: Write edges file ──
    if ($TotalProcessed -gt 0) {
        if ($PSCmdlet.ShouldProcess($EdgesPath, 'Write edges file')) {
            $EdgesData.edges        = $EdgesList.ToArray()
            $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
            $Json = $EdgesData | ConvertTo-Json -Depth 20
            try {
                Write-Utf8NoBom -Path $EdgesPath -Value $Json 
                Write-OK "Saved edges to $EdgesPath"
            } catch {
                Write-Fail "Failed to write edges.json — $($_.Exception.Message)"
                Write-Info "$TotalEdges edges were discovered but NOT saved. Check file permissions and try again."
                throw
            }
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
    Write-Host "  Total edges in store: $($EdgesList.Count)" -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Proposed edges need human approval. Use Approve-Edge or Review-Edges to manage.' -ForegroundColor DarkGray
    Write-Host ''
}
