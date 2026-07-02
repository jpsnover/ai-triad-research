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
        AI model to use. Defaults to 'gemini-3.1-flash-lite'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.3.
    .PARAMETER DryRun
        Build and display the prompt for the first node, but do NOT call the API.
    .PARAMETER Force
        Re-discover edges for all nodes, even those that already have edges and are not STALE.
    .PARAMETER MaxConcurrent
        Number of parallel API workers. Default: 4. Values > 1 enable
        ForEach-Object -Parallel. Checkpointing is only active in sequential mode.
        Recommended settings by backend:
          Gemini free tier: 3 (avoids 429 rate limits)
          Gemini paid:      8
          Claude:           4
          Groq:             6 (generous free tier)
        Rate-limited (429) calls are automatically retried with exponential backoff.
    .PARAMETER TopKCandidates
        Maximum number of embedding-filtered candidates per source node. Default: 30.
        Has no effect when -SkipEmbeddingFilter is set or embeddings.json is absent.
    .PARAMETER TwoPhase
        Enables two-phase discovery: Phase 1 uses a fast/cheap model to screen which
        candidates have ANY relationship with the source. Phase 2 runs full classification
        only on screened-in candidates. Reduces total tokens by ~50-60% when most candidates
        have no relationship.
    .PARAMETER ScreenModel
        Model for Phase 1 screening when -TwoPhase is set. Should be a fast/cheap model.
        Default: 'gemini-2.0-flash-lite' (falls back to main -Model if not set).
    .PARAMETER BatchSize
        When > 0, enables batch mode: groups nodes into clusters of this size and asks
        the LLM to propose edges between ANY pair in the group. Reduces total API calls
        from N to N/BatchSize. Default: 0 (disabled, uses per-node mode).
        Recommended: 8-12. Nodes are clustered by embedding similarity to maximize edge
        discovery within each batch.
    .PARAMETER MinSimilarity
        Minimum embedding cosine similarity for candidate inclusion. Candidates below
        this threshold are excluded from top-K selection (cross-POV floor still applies).
        Default: 0.20. Analysis shows only 0.5% of real edges fall below 0.20 similarity.
        Set to 0.0 to disable.
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
        Invoke-EdgeDiscovery -TopKCandidates 25 -MinSimilarity 0.25 -MinPerOtherPov 6
    .EXAMPLE
        Invoke-EdgeDiscovery -EmbeddingFirst -DryRun
        # Preview embedding-first candidate pairs without LLM calls.
    .EXAMPLE
        Invoke-EdgeDiscovery -EmbeddingFirst -EmbeddingFirstThreshold 0.35
        # Embedding-first with tighter threshold (fewer candidates, less LLM cost).
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations')]
        [string]$POV = '',

        [string]$NodeId = '',

        [switch]$StaleOnly,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = 'gemini-3.1-flash-lite',

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [switch]$DryRun,

        [switch]$Force,

        [ValidateRange(1, 32)]
        [int]$MaxConcurrent = 4,

        [ValidateRange(5, 500)]
        [int]$TopKCandidates = 30,

        [ValidateRange(0.0, 1.0)]
        [double]$MinSimilarity = 0.20,

        [ValidateRange(0, 20)]
        [int]$MinPerOtherPov = 4,

        [ValidateRange(0, 20)]
        [int]$BatchSize = 0,

        [switch]$TwoPhase,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$ScreenModel = '',

        [Parameter(HelpMessage = 'Embedding-first mode: compute similarity matrix, LLM classifies type only')]
        [switch]$EmbeddingFirst,

        [Parameter(HelpMessage = 'Similarity threshold for embedding-first candidate pairs')]
        [ValidateRange(0.10, 0.90)]
        [double]$EmbeddingFirstThreshold = 0.30,

        [Parameter(HelpMessage = 'Max pairs per LLM classification batch in embedding-first mode')]
        [ValidateRange(5, 50)]
        [int]$ClassifyBatchSize = 20,

        [switch]$SkipEmbeddingFilter,

        [ValidateRange(0, 100)]
        [int]$CheckpointEvery = 10,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    function Save-DiscoveryLog {
        param(
            [string]$Path,
            [System.Collections.Generic.List[PSObject]]$Entries
        )
        $LogFile = [ordered]@{
            _schema_version = '1.0.0'
            _doc            = 'Edge discovery run log. Written by Invoke-EdgeDiscovery.'
            last_modified   = (Get-Date).ToString('yyyy-MM-dd')
            entries         = @($Entries)
        }
        $LogFile | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $Path
    }

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
    $Labels = @{}       # node ID → label
    $Descriptions = @{} # node ID → truncated description

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }

        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
        foreach ($Node in $FileData.nodes) {
            $AllNodes.Add($Node)
            $NodePovMap[$Node.id] = $PovKey
            $Labels[$Node.id] = $Node.label
            if ($Node.PSObject.Properties['description'] -and $Node.description) {
                $Desc = $Node.description
                if ($Desc.Length -gt 120) { $Desc = $Desc.Substring(0, 120) + '...' }
                $Descriptions[$Node.id] = $Desc
            }
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
            # t/1093: canonical 8-type vocabulary. Removed CITES, SUPPORTED_BY,
            # PROPOSES (deprecated). Added CONVERGES_WITH. Resolve-EdgeType
            # enforces this set at the validation sites below.
            edge_types      = @(
                [PSCustomObject]@{ type = 'SUPPORTS';       bidirectional = $false; definition = 'Source claim directly strengthens or provides evidence for target.' }
                [PSCustomObject]@{ type = 'CONTRADICTS';    bidirectional = $true;  definition = 'Source and target make incompatible claims.' }
                [PSCustomObject]@{ type = 'WEAKENS';        bidirectional = $false; definition = 'Source undermines target without fully contradicting it.' }
                [PSCustomObject]@{ type = 'TENSION_WITH';   bidirectional = $true;  definition = 'Source and target pull in different directions without direct contradiction.' }
                [PSCustomObject]@{ type = 'RESPONDS_TO';    bidirectional = $false; definition = 'Source was formulated as a direct response to target.' }
                [PSCustomObject]@{ type = 'ASSUMES';        bidirectional = $false; definition = 'Source claim depends on target being true.' }
                [PSCustomObject]@{ type = 'INTERPRETS';     bidirectional = $false; definition = 'POV node offers an interpretation of a situation node (target must be situation).' }
                [PSCustomObject]@{ type = 'CONVERGES_WITH'; bidirectional = $false; definition = 'POV node has reached consensus with a situation node (target must be situation).' }
            )
            edges           = @()
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

    # ── Load discovery log from standalone file ──
    $DiscLogPath = Join-Path $TaxDir 'edge_discovery_log.json'
    $DiscLogEntries = [System.Collections.Generic.List[PSObject]]::new()
    if (Test-Path $DiscLogPath) {
        $DiscLogData = Get-Content -Raw -Path $DiscLogPath | ConvertFrom-Json
        if ($DiscLogData.PSObject.Properties['entries'] -and $DiscLogData.entries) {
            foreach ($E in @($DiscLogData.entries)) {
                if ($null -ne $E) { $DiscLogEntries.Add($E) }
            }
        }
    } elseif ($EdgesData.PSObject.Properties['discovery_log'] -and $EdgesData.discovery_log) {
        foreach ($E in @($EdgesData.discovery_log)) {
            if ($null -ne $E) { $DiscLogEntries.Add($E) }
        }
    }

    $DiscoveredNodeIds = [System.Collections.Generic.HashSet[string]]::new()
    $EvaluatedPairs = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Entry in $DiscLogEntries) {
        [void]$DiscoveredNodeIds.Add($Entry.node_id)
        if ($Entry.PSObject.Properties['candidates_evaluated']) {
            foreach ($CandId in $Entry.candidates_evaluated) {
                $PairKey = if ($Entry.node_id -lt $CandId) { "$($Entry.node_id)|$CandId" } else { "$CandId|$($Entry.node_id)" }
                [void]$EvaluatedPairs.Add($PairKey)
            }
        }
    }
    if ($EvaluatedPairs.Count -gt 0) {
        Write-OK "Loaded $($EvaluatedPairs.Count) previously evaluated pairs (will skip in incremental mode)"
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
                Write-OK "Loaded embeddings for $($Embeddings.Count) nodes (TopK=$TopKCandidates, MinSim=$MinSimilarity, MinPerPov=$MinPerOtherPov)"
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

    # Two-phase: resolve screen model and load screen prompt
    if ($TwoPhase) {
        $ScreenPrompt = Get-Prompt -Name 'edge-screen'
        if ([string]::IsNullOrWhiteSpace($ScreenModel)) { $ScreenModel = 'gemini-2.0-flash-lite' }
        # Resolve screen model API key (may differ from main model)
        if     ($ScreenModel -match '^gemini') { $ScreenBackend = 'gemini' }
        elseif ($ScreenModel -match '^claude') { $ScreenBackend = 'claude' }
        elseif ($ScreenModel -match '^groq')   { $ScreenBackend = 'groq'   }
        else                                   { $ScreenBackend = 'gemini'  }
        $ScreenKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $ScreenBackend
        Write-Info "Two-phase mode: screen=$ScreenModel, classify=$Model"

        $ScreenSchema = @{
            type       = 'object'
            properties = @{
                source_id   = @{ type = 'string' }
                related_ids = @{ type = 'array'; items = @{ type = 'string' } }
            }
            required   = @('source_id', 'related_ids')
        }
    }

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

    # ── Step 7: Build prompts (embedding-first, batch, or per-node mode) ──

    if ($EmbeddingFirst) {
        # ═══════════════════════════════════════════════════════════════════
        # EMBEDDING-FIRST MODE: similarity matrix → LLM classifies type only
        # ═══════════════════════════════════════════════════════════════════
        Write-Step "Embedding-first discovery (threshold=$EmbeddingFirstThreshold)"

        # Load or build similarity cache (prefer NumPy-accelerated rebuild)
        $CachePath = Join-Path $TaxDir 'similarity-cache.json'
        $CandidatePairs = [System.Collections.Generic.List[PSObject]]::new()

        # Auto-rebuild cache if missing or stale
        $NeedRebuild = -not (Test-Path $CachePath)
        if (-not $NeedRebuild) {
            $CacheMTime = (Get-Item $CachePath).LastWriteTimeUtc
            $EmbMTime = if (Test-Path (Join-Path $TaxDir 'embeddings.json')) { (Get-Item (Join-Path $TaxDir 'embeddings.json')).LastWriteTimeUtc } else { [datetime]::MinValue }
            if ($EmbMTime -gt $CacheMTime) { $NeedRebuild = $true }
        }
        if ($NeedRebuild) {
            $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
            $PyCmd = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }
            if (Test-Path $EmbedScript) {
                Write-Info 'Rebuilding similarity cache (NumPy-accelerated)...'
                & $PyCmd $EmbedScript similarity-matrix --top-k 30 --threshold 0.20 -o $CachePath 2>&1 | ForEach-Object { Write-Verbose $_ }
            }
        }

        if (Test-Path $CachePath) {
            $SimCache = Get-Content $CachePath -Raw | ConvertFrom-Json -AsHashtable
            Write-OK "Loaded similarity cache ($($SimCache['node_count']) nodes, top-$($SimCache['top_k']))"

            # Extract candidate pairs above threshold
            $ProcessIds = [System.Collections.Generic.HashSet[string]]::new()
            foreach ($N in $NodesToProcess) { $null = $ProcessIds.Add($N.id) }

            foreach ($NodeKey in $SimCache['entries'].Keys) {
                if (-not $ProcessIds.Contains($NodeKey) -and -not $Force) { continue }
                foreach ($Entry in $SimCache['entries'][$NodeKey]) {
                    $Sim = [double]$Entry['sim']
                    $TargetId = $Entry['id']
                    if ($Sim -lt $EmbeddingFirstThreshold) { continue }
                    if (-not $ValidNodeIds.Contains($TargetId)) { continue }

                    # Dedup: sorted pair key
                    $PairKey = if ($NodeKey -lt $TargetId) { "$NodeKey|$TargetId" } else { "$TargetId|$NodeKey" }
                    if ($EvaluatedPairs.Contains($PairKey)) { continue }

                    # Skip if edge already exists (any type)
                    $AlreadyEdged = $false
                    foreach ($ET in $ValidEdgeTypes) {
                        if ($ExistingEdgeKeys.Contains("$NodeKey|$ET|$TargetId") -or $ExistingEdgeKeys.Contains("$TargetId|$ET|$NodeKey")) {
                            $AlreadyEdged = $true; break
                        }
                    }
                    if ($AlreadyEdged) { continue }

                    $CandidatePairs.Add([PSCustomObject]@{
                        Source     = $NodeKey
                        Target     = $TargetId
                        Similarity = $Sim
                        PairKey    = $PairKey
                    })
                }
            }
        } elseif ($Embeddings.Count -gt 0) {
            # No cache — compute on the fly from embeddings
            Write-Info 'No similarity cache — computing from embeddings...'
            $ProcessIds = [System.Collections.Generic.HashSet[string]]::new()
            foreach ($N in $NodesToProcess) { $null = $ProcessIds.Add($N.id) }

            foreach ($SrcId in $ProcessIds) {
                if (-not $Embeddings.ContainsKey($SrcId)) { continue }
                $VecA = $Embeddings[$SrcId]
                foreach ($TgtId in $Embeddings.Keys) {
                    if ($SrcId -eq $TgtId) { continue }
                    if ($TgtId -like 'pol-*') { continue }

                    $PairKey = if ($SrcId -lt $TgtId) { "$SrcId|$TgtId" } else { "$TgtId|$SrcId" }
                    if ($EvaluatedPairs.Contains($PairKey)) { continue }

                    $Dot = 0.0
                    $VecB = $Embeddings[$TgtId]
                    for ($k = 0; $k -lt $VecA.Count; $k++) { $Dot += $VecA[$k] * $VecB[$k] }
                    if ($Dot -lt $EmbeddingFirstThreshold) { continue }

                    $CandidatePairs.Add([PSCustomObject]@{
                        Source     = $SrcId
                        Target     = $TgtId
                        Similarity = [Math]::Round($Dot, 4)
                        PairKey    = $PairKey
                    })
                }
            }
        } else {
            Write-Fail 'Embedding-first mode requires embeddings.json or similarity-cache.json'
            throw 'No embedding data available for embedding-first mode'
        }

        # Dedup pairs
        $SeenPairs = [System.Collections.Generic.HashSet[string]]::new()
        $UniquePairs = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($P in $CandidatePairs) {
            if ($SeenPairs.Add($P.PairKey)) { $UniquePairs.Add($P) }
        }
        $CandidatePairs = $UniquePairs

        Write-OK "$($CandidatePairs.Count) candidate pairs above threshold $EmbeddingFirstThreshold"

        if ($CandidatePairs.Count -eq 0) {
            Write-OK 'No new candidate pairs to classify'
            return
        }

        if ($DryRun) {
            Write-Host "`n  DRY RUN — top 20 candidate pairs:" -ForegroundColor Yellow
            $CandidatePairs | Sort-Object Similarity -Descending | Select-Object -First 20 | ForEach-Object {
                $SrcLabel = if ($Labels.ContainsKey($_.Source)) { $Labels[$_.Source] } else { $_.Source }
                $TgtLabel = if ($Labels.ContainsKey($_.Target)) { $Labels[$_.Target] } else { $_.Target }
                Write-Host "    sim=$($_.Similarity.ToString('F3')) $($_.Source) → $($_.Target)" -ForegroundColor Gray
                Write-Host "      $SrcLabel ↔ $TgtLabel" -ForegroundColor DarkGray
            }
            Write-Host "`n  Would send $([Math]::Ceiling($CandidatePairs.Count / $ClassifyBatchSize)) classification batches" -ForegroundColor Yellow
            return
        }

        # Group into classification batches
        $SortedPairs = @($CandidatePairs | Sort-Object Similarity -Descending)
        $ClassifyBatches = [System.Collections.Generic.List[PSObject[]]]::new()
        for ($bi = 0; $bi -lt $SortedPairs.Count; $bi += $ClassifyBatchSize) {
            $End = [Math]::Min($bi + $ClassifyBatchSize - 1, $SortedPairs.Count - 1)
            $ClassifyBatches.Add(@($SortedPairs[$bi..$End]))
        }

        Write-Info "$($ClassifyBatches.Count) classification batches ($ClassifyBatchSize pairs/batch)"

        $NewEdgeCount = 0
        $BatchNum = 0

        foreach ($Batch in $ClassifyBatches) {
            $BatchNum++
            Write-Host "  Batch $BatchNum/$($ClassifyBatches.Count) ($($Batch.Count) pairs)..." -ForegroundColor Gray -NoNewline

            # Build pair descriptions for LLM
            $PairLinesList = [System.Collections.Generic.List[string]]::new()
            foreach ($P in $Batch) {
                $SrcLabel = if ($Labels.ContainsKey($P.Source)) { $Labels[$P.Source] } else { $P.Source }
                $TgtLabel = if ($Labels.ContainsKey($P.Target)) { $Labels[$P.Target] } else { $P.Target }
                $SrcDesc = if ($Descriptions.ContainsKey($P.Source)) { $Descriptions[$P.Source] } else { '' }
                $TgtDesc = if ($Descriptions.ContainsKey($P.Target)) { $Descriptions[$P.Target] } else { '' }
                $PairLinesList.Add("- [$($P.Source)] $SrcLabel`: $SrcDesc`n  [$($P.Target)] $TgtLabel`: $TgtDesc")
            }
            $PairLines = $PairLinesList -join "`n`n"

            $EdgeTypeLines = [System.Collections.Generic.List[string]]::new()
            foreach ($ET in $EdgesData.edge_types) {
                $IsBidir = if ($ET.PSObject.Properties['bidirectional']) { $ET.bidirectional } elseif ($ET.PSObject.Properties['direction'] -and $ET.direction -eq 'bidirectional') { $true } else { $false }
                $Def = if ($ET.PSObject.Properties['definition']) { $ET.definition } elseif ($ET.PSObject.Properties['description']) { $ET.description } else { '' }
                $EdgeTypeLines.Add("$($ET.type)$(if ($IsBidir) { ' (bidirectional)' }): $Def")
            }
            $EdgeTypeList = $EdgeTypeLines -join "`n"

            $ClassifyPrompt = @"
Classify the relationship between each pair of taxonomy nodes below. These pairs have high semantic similarity and likely have a meaningful relationship.

EDGE TYPES:
$EdgeTypeList

PAIRS TO CLASSIFY:
$PairLines

For each pair, determine:
1. The edge type (from the list above, or "NONE" if no meaningful relationship)
2. Direction: which node is source and which is target
3. Confidence (0.0-1.0)
4. Weight (0.0-1.0): strength of the relationship
5. Brief rationale

Return JSON: {"edges": [{"source": "id", "target": "id", "type": "TYPE", "confidence": 0.8, "weight": 0.7, "rationale": "..."}]}
Omit pairs with no relationship. No markdown fences.
"@

            if (-not $PSCmdlet.ShouldProcess("Batch $BatchNum ($($Batch.Count) pairs)", 'Classify edges')) {
                continue
            }

            try {
                # t/1261: route through UsageID registry. Template variables
                # render from -Values; -Override preserves the caller's runtime
                # model + temperature choices.
                $Response = Invoke-AIByUsage -UsageId 'enrichment.edge-discovery.classify' `
                    -Values @{
                        edge_type_list = $EdgeTypeList
                        pair_lines     = $PairLines
                    } `
                    -Override @{
                        model       = $Model
                        temperature = $Temperature
                    } `
                    -ApiKey $ResolvedKey

                if ($null -eq $Response -or -not $Response.Text) {
                    Write-Host " no response" -ForegroundColor Red
                    continue
                }

                $Text = $Response.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
                $Parsed = $null
                try { $Parsed = $Text | ConvertFrom-Json } catch {
                    $Repaired = Repair-TruncatedJson -Text $Text
                    if ($Repaired) { $Parsed = $Repaired | ConvertFrom-Json }
                }

                if ($Parsed -and $Parsed.PSObject.Properties['edges']) {
                    $BatchNewEdges = 0
                    foreach ($E in @($Parsed.edges)) {
                        # Guard all property access — truncated JSON may produce partial objects
                        $ESrc  = if ($E.PSObject.Properties['source']) { $E.source } else { $null }
                        $ETgt  = if ($E.PSObject.Properties['target']) { $E.target } else { $null }
                        $EType = if ($E.PSObject.Properties['type'])   { $E.type }   else { $null }
                        if (-not $ESrc -or -not $ETgt -or -not $EType) { continue }
                        if ($EType -eq 'NONE') { continue }
                        if (-not $ValidNodeIds.Contains($ESrc) -or -not $ValidNodeIds.Contains($ETgt)) { continue }

                        $EdgeKey = "$ESrc|$EType|$ETgt"
                        if ($ExistingEdgeKeys.Contains($EdgeKey)) { continue }

                        $NewEdge = [ordered]@{
                            source        = $ESrc
                            target        = $ETgt
                            type          = $EType.ToUpper()
                            bidirectional = if ($E.PSObject.Properties['bidirectional']) { $E.bidirectional } else { $false }
                            confidence    = if ($E.PSObject.Properties['confidence']) { [Math]::Round([double]$E.confidence, 2) } else { 0.5 }
                            weight        = if ($E.PSObject.Properties['weight']) { [Math]::Round([double]$E.weight, 2) } else { $null }
                            rationale     = if ($E.PSObject.Properties['rationale']) { $E.rationale } else { '' }
                            status        = 'proposed'
                            discovered_by = 'embedding-first'
                            discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                        }

                        $EdgesList.Add([PSCustomObject]$NewEdge)
                        $null = $ExistingEdgeKeys.Add($EdgeKey)
                        $BatchNewEdges++
                        $NewEdgeCount++
                    }
                    Write-Host " $BatchNewEdges edges" -ForegroundColor Green
                } else {
                    Write-Host " parse error" -ForegroundColor Red
                }
            } catch {
                Write-Host " failed: $($_.Exception.Message)" -ForegroundColor Red
            }

            # Mark pairs as evaluated
            foreach ($P in $Batch) {
                $null = $EvaluatedPairs.Add($P.PairKey)
            }

            # Checkpoint
            if ($CheckpointEvery -gt 0 -and $BatchNum % $CheckpointEvery -eq 0) {
                $EdgesData.edges = @($EdgesList)
                $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
                $EdgesData | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $EdgesPath
                Write-Info "  Checkpoint at batch $BatchNum"
            }

            if ($BatchNum -lt $ClassifyBatches.Count) { Start-Sleep -Milliseconds 500 }
        }

        # Final save
        $EdgesData.edges = @($EdgesList)
        $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')

        # Add discovery log entry for this run
        $DiscLogEntries.Add([PSCustomObject][ordered]@{
            node_id              = 'embedding-first-batch'
            timestamp            = (Get-Date).ToString('o')
            model                = $Model
            mode                 = 'embedding-first'
            threshold            = $EmbeddingFirstThreshold
            candidate_pairs      = $CandidatePairs.Count
            new_edges            = $NewEdgeCount
            batches              = $ClassifyBatches.Count
        })

        $EdgesData | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $EdgesPath
        Save-DiscoveryLog -Path $DiscLogPath -Entries $DiscLogEntries

        Write-Host "`n=== EMBEDDING-FIRST COMPLETE ===" -ForegroundColor Cyan
        Write-Host "  Candidate pairs: $($CandidatePairs.Count)"
        Write-Host "  Classification batches: $($ClassifyBatches.Count)"
        Write-Host "  New edges discovered: $NewEdgeCount" -ForegroundColor Green
        Write-Host "  Total edges: $($EdgesList.Count)"
        return
    }

    if ($BatchSize -gt 0 -and $Embeddings.Count -gt 0) {
        # ═══════════════════════════════════════════════════════════════════
        # BATCH MODE: cluster nodes and discover edges between all pairs in each batch
        # ═══════════════════════════════════════════════════════════════════
        $BatchSystemPrompt = Get-Prompt -Name 'edge-discovery-batch'
        $BatchSchemaPrompt = Get-Prompt -Name 'edge-discovery-batch-schema'

        $BatchEdgeSchema = @{
            type       = 'object'
            properties = @{
                edges = @{
                    type  = 'array'
                    items = @{
                        type       = 'object'
                        properties = @{
                            source        = @{ type = 'string' }
                            target        = @{ type = 'string' }
                            type          = @{ type = 'string' }
                            bidirectional = @{ type = 'boolean' }
                            confidence    = @{ type = 'number' }
                            weight        = @{ type = 'number' }
                            rationale     = @{ type = 'string' }
                            strength      = @{ type = 'string'; enum = @('strong', 'moderate', 'weak') }
                            notes         = @{ type = 'string' }
                        }
                        required   = @('source', 'target', 'type', 'confidence', 'rationale')
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

        Write-Step "Clustering $($NodesToProcess.Count) nodes into batches of $BatchSize"
        $NodesToProcessArray = @($NodesToProcess.ToArray())
        $Batches = Get-NodeBatches `
            -Nodes      $NodesToProcessArray `
            -Embeddings $Embeddings `
            -NodePovMap $NodePovMap `
            -BatchSize  $BatchSize

        Write-OK "$($Batches.Count) batches created (avg $([Math]::Round($NodesToProcessArray.Count / $Batches.Count, 1)) nodes/batch)"

        if ($DryRun -and $Batches.Count -gt 0) {
            $FirstBatch = $Batches[0]
            $NodeListJson = @($FirstBatch | ForEach-Object {
                $Entry = [ordered]@{ id = $_.id; pov = $NodePovMap[$_.id]; label = $_.label }
                if ($_.PSObject.Properties['category'])    { $Entry['category']    = $_.category }
                if ($_.PSObject.Properties['description']) {
                    $Desc = $_.description
                    if ($Desc.Length -gt 200) { $Desc = $Desc.Substring(0, 197) + '...' }
                    $Entry['description'] = $Desc
                }
                $Entry
            }) | ConvertTo-Json -Depth 5
            $PreviewPrompt = "$BatchSystemPrompt`n`n--- NODE GROUP ($($FirstBatch.Count) nodes) ---`n$NodeListJson`n`n$BatchSchemaPrompt"
            Write-Host ''
            Write-Host '=== BATCH PROMPT PREVIEW (first batch) ===' -ForegroundColor Cyan
            Write-Host "Batch contains: $($FirstBatch | ForEach-Object { $_.id } | Join-String -Separator ', ')" -ForegroundColor Yellow
            Write-Host "Total prompt length: ~$($PreviewPrompt.Length) chars (~$([Math]::Round($PreviewPrompt.Length / 4)) tokens est.)" -ForegroundColor Cyan
            Write-Host "Batches: $($Batches.Count), API calls saved: $($NodesToProcessArray.Count - $Batches.Count)" -ForegroundColor Green
            return
        }

        # Execute batch discovery
        $TotalProcessed = 0
        $TotalEdges     = 0
        $TotalFailed    = 0
        $NewEdgeTypes   = [System.Collections.Generic.List[PSObject]]::new()

        $BatchNum = 0
        foreach ($Batch in $Batches) {
            $BatchNum++
            $BatchNodeIds = @($Batch | ForEach-Object { $_.id })
            Write-Step "[$BatchNum/$($Batches.Count)] Batch: $($BatchNodeIds.Count) nodes"

            # Build node group JSON (full detail for batch)
            $NodeListJson = @($Batch | ForEach-Object {
                $N = $_
                $Entry = [ordered]@{ id = $N.id; pov = $NodePovMap[$N.id]; label = $N.label }
                if ($N.PSObject.Properties['category'])    { $Entry['category']    = $N.category }
                if ($N.PSObject.Properties['description']) {
                    $Desc = $N.description
                    if ($Desc.Length -gt 300) { $Desc = $Desc.Substring(0, 297) + '...' }
                    $Entry['description'] = $Desc
                }
                if ($NodePovMap[$N.id] -eq 'situations' -and $N.PSObject.Properties['interpretations']) {
                    $Entry['interpretations'] = $N.interpretations
                }
                $Entry
            }) | ConvertTo-Json -Depth 10

            $BatchPrompt = @"
$BatchSystemPrompt

--- NODE GROUP ($($BatchNodeIds.Count) nodes) ---
$NodeListJson

$BatchSchemaPrompt
"@

            # Create a pseudo-node for Invoke-NodeEdgeDiscovery (reuse existing infrastructure)
            $PseudoNode = [PSCustomObject]@{ id = "batch-$BatchNum" }
            $Disc = Invoke-NodeEdgeDiscovery `
                -Node            $PseudoNode `
                -FullPrompt      $BatchPrompt `
                -Model           $Model `
                -ApiKey          $ResolvedKey `
                -Temperature     $Temperature `
                -ResponseSchema  $BatchEdgeSchema

            if ($Disc.Error) {
                Write-Fail "Batch ${BatchNum}: $($Disc.Error)"
                $TotalFailed++
                continue
            }

            Write-Info "Batch ${BatchNum}: API response in $($Disc.ElapsedSec)s"

            $BatchEdgeCount = 0
            foreach ($Edge in @($Disc.RawEdges)) {
                # Batch mode: edges have 'source' field instead of inheriting from source node
                $SourceId = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
                $TargetId = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
                if (-not $SourceId -or -not $TargetId -or
                    -not $Edge.PSObject.Properties['type'] -or
                    -not $Edge.PSObject.Properties['confidence']) {
                    Write-Warn "Batch ${BatchNum}: malformed edge (missing source/target/type/confidence), skipping"
                    continue
                }
                if (-not $ValidNodeIds.Contains($SourceId)) {
                    Write-Warn "Batch ${BatchNum}: source '$SourceId' not in taxonomy, skipping"
                    continue
                }
                if (-not $ValidNodeIds.Contains($TargetId)) {
                    Write-Warn "Batch ${BatchNum}: target '$TargetId' not in taxonomy, skipping"
                    continue
                }
                if ($SourceId -eq $TargetId) { continue }
                # t/1093: gate every edge through Resolve-EdgeType — accept, reclassify, or drop
                $Resolved = Resolve-EdgeType -Type $Edge.type
                if ($Resolved.Action -eq 'drop') {
                    Write-Warn "Batch ${BatchNum}: dropped edge $SourceId→$TargetId type='$($Edge.type)' — $($Resolved.Reason)"
                    continue
                }
                $CanonicalType = $Resolved.Type
                if ($Resolved.Action -eq 'reclassify') {
                    Write-Verbose "Batch ${BatchNum}: reclassified $SourceId→$TargetId — $($Resolved.Reason)"
                }
                $Confidence = [double]$Edge.confidence
                if ($Confidence -lt 0.5) { continue }
                $EdgeKey = "$SourceId|$CanonicalType|$TargetId"
                if ($ExistingEdgeKeys.Contains($EdgeKey)) {
                    if ($Resolved.Action -eq 'reclassify') {
                        Write-Verbose "Batch ${BatchNum}: dedup drop $SourceId→$TargetId ($CanonicalType already exists)"
                    }
                    continue
                }

                if ($Edge.PSObject.Properties['bidirectional']) { $Bidir = [bool]$Edge.bidirectional } else { $Bidir = $false }
                if ($Edge.PSObject.Properties['rationale'])    { $Rationale = $Edge.rationale }           else { $Rationale = '' }
                $EdgeObj = [ordered]@{
                    source        = $SourceId
                    target        = $TargetId
                    type          = $CanonicalType
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
                if ($Bidir) { [void]$ExistingEdgeKeys.Add("$TargetId|$CanonicalType|$SourceId") }
                $BatchEdgeCount++
                $TotalEdges++
            }

            foreach ($NewType in @($Disc.NewEdgeTypes)) {
                Write-Info "New edge type proposed: $($NewType.type) — $(if ($NewType.PSObject.Properties['definition']) { $NewType.definition } elseif ($NewType.PSObject.Properties['description']) { $NewType.description } else { '(no definition)' })"
                $NewEdgeTypes.Add($NewType)
            }

            Write-OK "Batch ${BatchNum}: $BatchEdgeCount edge(s) proposed"

            # Log all pairs in this batch as evaluated
            $DiscLogEntries.Add([PSCustomObject][ordered]@{
                node_id              = "batch-$BatchNum"
                discovered_at        = (Get-Date).ToString('yyyy-MM-dd')
                model                = $Model
                edge_count           = $BatchEdgeCount
                candidates_evaluated = $BatchNodeIds
                batch_mode           = $true
            })

            # Update evaluated_pairs for all pairs in this batch
            for ($i = 0; $i -lt $BatchNodeIds.Count; $i++) {
                for ($j = $i + 1; $j -lt $BatchNodeIds.Count; $j++) {
                    $A = $BatchNodeIds[$i]; $B = $BatchNodeIds[$j]
                    $PairKey = if ($A -lt $B) { "$A|$B" } else { "$B|$A" }
                    [void]$EvaluatedPairs.Add($PairKey)
                }
            }

            $TotalProcessed += $BatchNodeIds.Count

            # Checkpoint every 5 batches
            if ($CheckpointEvery -gt 0 -and $BatchNum % 5 -eq 0) {
                if ($PSCmdlet.ShouldProcess($EdgesPath, "Write checkpoint after batch $BatchNum")) {
                    try {
                        $EdgesData.edges         = $EdgesList.ToArray()
                        $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
                        $Json = $EdgesData | ConvertTo-Json -Depth 20
                        Write-Utf8NoBom -Path $EdgesPath -Value $Json
                        Write-Info "Checkpoint saved ($($EdgesList.Count) edges)"
                    } catch {
                        Write-Warn "Checkpoint write failed: $($_.Exception.Message)"
                    }
                }
            }
        }

    } else {
    # ═══════════════════════════════════════════════════════════════════
    # PER-NODE MODE (original behavior)
    # ═══════════════════════════════════════════════════════════════════

    Write-Step 'Building per-node prompts'

    $NodePrompts = @{}   # node ID → full prompt string
    $NodeCandidateIds = @{}   # node ID → [string[]] candidate IDs (for evaluated_pairs tracking)
    $AllNodeArray = $AllNodes.ToArray()

    foreach ($Node in $NodesToProcess) {
        $PovKey = $NodePovMap[$Node.id]

        # Filter candidates for this source node
        if ($Embeddings.Count -gt 0) {
            $Candidates = Get-FilteredCandidates `
                -SourceId       $Node.id `
                -Embeddings     $Embeddings `
                -AllNodes       $AllNodeArray `
                -NodePovMap     $NodePovMap `
                -TopK           $TopKCandidates `
                -MinPerOtherPov $MinPerOtherPov `
                -MinSimilarity  $MinSimilarity
        } else {
            $Candidates = @($AllNodes | Where-Object { $_.id -ne $Node.id })
        }

        # Skip already-evaluated pairs (incremental optimization)
        # Only active when not using -Force (full re-evaluation ignores evaluated pairs)
        if (-not $Force -and $EvaluatedPairs.Count -gt 0) {
            $PreFilterCount = $Candidates.Count
            $Candidates = @($Candidates | Where-Object {
                $CandId = $_.id
                $PairKey = if ($Node.id -lt $CandId) { "$($Node.id)|$CandId" } else { "$CandId|$($Node.id)" }
                -not $EvaluatedPairs.Contains($PairKey)
            })
            $SkippedCount = $PreFilterCount - $Candidates.Count
            if ($SkippedCount -gt 0) {
                Write-Verbose "$($Node.id): skipped $SkippedCount already-evaluated candidates ($($Candidates.Count) remaining)"
            }
            # If all candidates were already evaluated, skip this node entirely
            if ($Candidates.Count -eq 0) {
                Write-Verbose "$($Node.id): all candidates already evaluated — skipping"
                continue
            }
        }

        # Two-phase screen: use cheap model to filter candidates before full classification
        if ($TwoPhase -and -not $DryRun) {
            $ScreenCandJson = @($Candidates | ForEach-Object {
                $E = [ordered]@{ id = $_.id; pov = $NodePovMap[$_.id]; label = $_.label }
                if ($_.PSObject.Properties['description']) {
                    $D = $_.description; if ($D.Length -gt 120) { $D = $D.Substring(0, 117) + '...' }
                    $E['description'] = $D
                }
                $E
            }) | ConvertTo-Json -Depth 3

            $ScreenSourceJson = (@{ id = $Node.id; label = $Node.label; description = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' } }) | ConvertTo-Json -Depth 2

            $ScreenFullPrompt = @"
$ScreenPrompt

--- SOURCE NODE ---
$ScreenSourceJson

--- CANDIDATES ---
$ScreenCandJson
"@

            try {
                # t/1261: route through UsageID registry. -Override preserves
                # the caller's runtime screen model + the inline ScreenSchema.
                $ScreenResult = Invoke-AIByUsage -UsageId 'enrichment.edge-discovery.screen' `
                    -Values @{
                        screen_prompt   = $ScreenPrompt
                        source_json     = $ScreenSourceJson
                        candidates_json = $ScreenCandJson
                    } `
                    -Override @{
                        model          = $ScreenModel
                        responseSchema = $ScreenSchema
                    } `
                    -ApiKey $ScreenKey
                $ScreenText = $ScreenResult.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
                $ScreenParsed = $ScreenText | ConvertFrom-Json
                if ($ScreenParsed.PSObject.Properties['related_ids'] -and $ScreenParsed.related_ids.Count -gt 0) {
                    $ScreenedIds = [System.Collections.Generic.HashSet[string]]::new([string[]]@($ScreenParsed.related_ids))
                    $PreScreenCount = $Candidates.Count
                    $Candidates = @($Candidates | Where-Object { $ScreenedIds.Contains($_.id) })
                    Write-Verbose "$($Node.id): screen passed $($Candidates.Count)/$PreScreenCount candidates"
                    if ($Candidates.Count -eq 0) {
                        Write-Verbose "$($Node.id): screen returned 0 candidates — skipping full classification"
                        continue
                    }
                }
            } catch {
                Write-Warn "$($Node.id): screen failed ($($_.Exception.Message)) — proceeding with full candidate list"
            }
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
        $NodeCandidateIds[$Node.id] = @($Candidates | ForEach-Object { $_.id })
    }

    # ── Step 8: Execute per-node edge discovery ──
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
                # t/1093: gate via Resolve-EdgeType — accept, reclassify, or drop
                $Resolved = Resolve-EdgeType -Type $Edge.type
                if ($Resolved.Action -eq 'drop') {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): dropped type='$($Edge.type)' — $($Resolved.Reason)"
                    continue
                }
                $CanonicalType = $Resolved.Type
                if ($Resolved.Action -eq 'reclassify') {
                    Write-Verbose "$($Disc.NodeId) → $($Edge.target): reclassified — $($Resolved.Reason)"
                }
                $Confidence = [double]$Edge.confidence
                if ($Confidence -lt 0.5) {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): confidence $Confidence < 0.5, skipping"
                    continue
                }
                $EdgeKey = "$($Disc.NodeId)|$CanonicalType|$($Edge.target)"
                if ($ExistingEdgeKeys.Contains($EdgeKey)) {
                    if ($Resolved.Action -eq 'reclassify') {
                        Write-Verbose "$($Disc.NodeId) → $($Edge.target): dedup drop ($CanonicalType already exists)"
                    } else {
                        Write-Info "$($Disc.NodeId) → $($Edge.target) ($CanonicalType): already exists, skipping"
                    }
                    continue
                }

                if ($Edge.PSObject.Properties['bidirectional']) { $Bidir = [bool]$Edge.bidirectional } else { $Bidir = $false }
                if ($Edge.PSObject.Properties['rationale'])    { $Rationale = $Edge.rationale }           else { $Rationale = '' }
                $EdgeObj  = [ordered]@{
                    source        = $Disc.NodeId
                    target        = $Edge.target
                    type          = $CanonicalType
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
                Write-Info "New edge type proposed: $($NewType.type) — $(if ($NewType.PSObject.Properties['definition']) { $NewType.definition } elseif ($NewType.PSObject.Properties['description']) { $NewType.description } else { '(no definition)' })"
                $NewEdgeTypes.Add($NewType)
            }

            Write-OK "$($Disc.NodeId): $NodeEdgeCount edge(s) proposed"

            $CandIds = $NodeCandidateIds[$Disc.NodeId]
            $DiscLogEntries.Add([PSCustomObject][ordered]@{
                node_id                = $Disc.NodeId
                discovered_at          = (Get-Date).ToString('yyyy-MM-dd')
                model                  = $Model
                edge_count             = $NodeEdgeCount
                candidates_evaluated   = if ($CandIds) { $CandIds } else { @() }
            })

            # Update evaluated_pairs set for subsequent nodes in this run
            if ($CandIds) {
                foreach ($CandId in $CandIds) {
                    $PairKey = if ($Disc.NodeId -lt $CandId) { "$($Disc.NodeId)|$CandId" } else { "$CandId|$($Disc.NodeId)" }
                    [void]$EvaluatedPairs.Add($PairKey)
                }
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
                # t/1093: gate via Resolve-EdgeType — accept, reclassify, or drop
                $Resolved = Resolve-EdgeType -Type $Edge.type
                if ($Resolved.Action -eq 'drop') {
                    Write-Warn "$($Disc.NodeId) → $($Edge.target): dropped type='$($Edge.type)' — $($Resolved.Reason)"
                    continue
                }
                $CanonicalType = $Resolved.Type
                if ($Resolved.Action -eq 'reclassify') {
                    Write-Verbose "$($Disc.NodeId) → $($Edge.target): reclassified — $($Resolved.Reason)"
                }
                $Confidence = [double]$Edge.confidence
                if ($Confidence -lt 0.5) { continue }
                $EdgeKey = "$($Disc.NodeId)|$CanonicalType|$($Edge.target)"
                if ($ExistingEdgeKeys.Contains($EdgeKey)) { continue }

                if ($Edge.PSObject.Properties['bidirectional']) { $Bidir = [bool]$Edge.bidirectional } else { $Bidir = $false }
                if ($Edge.PSObject.Properties['rationale'])    { $Rationale = $Edge.rationale }           else { $Rationale = '' }
                $EdgeObj  = [ordered]@{
                    source        = $Disc.NodeId
                    target        = $Edge.target
                    type          = $CanonicalType
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
                Write-Info "New edge type proposed: $($NewType.type) — $(if ($NewType.PSObject.Properties['definition']) { $NewType.definition } elseif ($NewType.PSObject.Properties['description']) { $NewType.description } else { '(no definition)' })"
                $NewEdgeTypes.Add($NewType)
            }

            Write-OK "$($Disc.NodeId): $NodeEdgeCount edge(s)"

            $CandIds2 = $NodeCandidateIds[$Disc.NodeId]
            $DiscLogEntries.Add([PSCustomObject][ordered]@{
                node_id                = $Disc.NodeId
                discovered_at          = (Get-Date).ToString('yyyy-MM-dd')
                model                  = $Model
                edge_count             = $NodeEdgeCount
                candidates_evaluated   = if ($CandIds2) { $CandIds2 } else { @() }
            })

            $TotalProcessed++
        }
    }

    } # end per-node mode else block

    # ── Step 9: Add any new edge types to the schema ──
    if ($NewEdgeTypes.Count -gt 0) {
        foreach ($NewType in $NewEdgeTypes) {
            $Existing = $EdgesData.edge_types | Where-Object { $_.type -eq $NewType.type }
            if (-not $Existing) {
                $EdgesData.edge_types += [PSCustomObject][ordered]@{
                    type          = $NewType.type
                    bidirectional = if ($NewType.PSObject.Properties['bidirectional']) { [bool]$NewType.bidirectional } else { $false }
                    definition    = if ($NewType.PSObject.Properties['definition']) { $NewType.definition } elseif ($NewType.PSObject.Properties['description']) { $NewType.description } else { '' }
                    llm_proposed  = $true
                }
                Write-OK "Added new edge type: $($NewType.type)"
            }
        }
    }

    # ── Step 10: Write edges file + discovery log ──
    if ($TotalProcessed -gt 0) {
        if ($PSCmdlet.ShouldProcess($EdgesPath, 'Write edges file')) {
            $EdgesData.edges        = $EdgesList.ToArray()
            $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
            if ($EdgesData.PSObject.Properties['discovery_log']) {
                $EdgesData.PSObject.Properties.Remove('discovery_log')
            }
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
        Save-DiscoveryLog -Path $DiscLogPath -Entries $DiscLogEntries
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
