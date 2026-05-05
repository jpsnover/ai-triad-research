# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-RelevantTaxonomyNodes {
    <#
    .SYNOPSIS
        Returns taxonomy nodes most relevant to a query using embedding similarity.
    .DESCRIPTION
        Loads cached embedding vectors, computes cosine similarity between the query
        and every taxonomy node, and returns the top matches. Uses threshold + min-per-BDI
        + max cap selection logic (mirrors Shared Lib's selectRelevantNodes).

        Replaces full-taxonomy injection in the pipeline — at 518 nodes, unfiltered
        injection wastes 15,000+ tokens. This cmdlet typically returns 30-50 relevant
        nodes (~3,000-5,000 tokens).
    .PARAMETER Query
        Text to find relevant nodes for (e.g., document excerpt, first 500 words).
    .PARAMETER Threshold
        Cosine similarity floor. Nodes below this are excluded unless needed for
        MinPerCategory guarantee. When -AdaptiveThreshold is set (default), the
        effective threshold is the higher of this floor and the score at the
        TopK-th percentile, adapting to query specificity. Default: 0.20.
    .PARAMETER MaxTotal
        Maximum nodes to return. Default: 50.
    .PARAMETER TopK
        Select the top-K nodes by similarity rank instead of using a fixed threshold.
        Combined with Threshold as a floor — nodes below the floor are excluded even
        if they're in the top K. Default: 40. Set to 0 to disable rank-based selection.
    .PARAMETER MinPerCategory
        Minimum nodes per BDI category (Beliefs, Desires, Intentions). Guarantees
        coverage even if one category has low similarity. Default: 3.
    .PARAMETER POV
        Filter to specific POVs. Default: all.
    .PARAMETER IncludeSituations
        Include situation nodes. Default: true.
    .PARAMETER Format
        Output format: 'objects' (TaxonomyNode[]), 'json' (serialized), 'context'
        (formatted text block for prompt injection). Default: 'objects'.
    .PARAMETER Model
        Deprecated — ignored. Query embedding now uses the same local model
        (all-MiniLM-L6-v2) as the cached taxonomy embeddings.
    .PARAMETER ApiKey
        Deprecated — ignored. No API key required; embeddings are computed locally.
    .EXAMPLE
        Get-RelevantTaxonomyNodes -Query "AI regulation and liability frameworks"
    .EXAMPLE
        Get-RelevantTaxonomyNodes -Query $DocText -MaxTotal 40 -Format context
    .EXAMPLE
        Get-RelevantTaxonomyNodes -Query $DocText -POV accelerationist,safetyist
    .EXAMPLE
        # Chunk-level: use chunk text for per-chunk relevance
        Get-RelevantTaxonomyNodes -Query $ChunkText -MaxTotal 40 -MinPerCategory 2 -Format context
    .EXAMPLE
        # Topic-level: use debate topic + recent transcript for debate context
        Get-RelevantTaxonomyNodes -Query "$DebateTopic. $RecentTranscript" -MaxTotal 30 -Format context
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Query,

        [ValidateRange(0.0, 1.0)]
        [double]$Threshold = 0.20,

        [ValidateRange(1, 600)]
        [int]$MaxTotal = 50,

        [ValidateRange(0, 500)]
        [int]$TopK = 40,

        [ValidateRange(0, 20)]
        [int]$MinPerCategory = 3,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'situations', '')]
        [string[]]$POV = @(),

        [switch]$IncludeSituations = $true,

        [ValidateSet('objects', 'json', 'context')]
        [string]$Format = 'objects',

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = '',
        [string]$ApiKey = ''
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Load embeddings (cached in module scope, auto-refreshes if stale) ─────
    Assert-TaxonomyCacheFresh  # invalidates $script:CachedEmbeddings if embeddings.json changed
    if (-not $script:CachedEmbeddings) {
        $EmbPath = Join-Path (Get-TaxonomyDir) 'embeddings.json'
        if (-not (Test-Path $EmbPath)) {
            New-ActionableError -Goal 'load taxonomy embeddings' `
                -Problem "embeddings.json not found at $EmbPath" `
                -Location 'Get-RelevantTaxonomyNodes' `
                -NextSteps @('Run Update-TaxEmbeddings to generate embeddings') -Throw
        }
        Write-Verbose 'Loading embeddings.json (first call or after refresh)...'
        $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
        $script:CachedEmbeddings = @{}
        foreach ($Prop in $EmbData.nodes.PSObject.Properties) {
            $script:CachedEmbeddings[$Prop.Name] = [double[]]@($Prop.Value.vector)
        }
        $script:EmbeddingsTimestamp = (Get-Item $EmbPath).LastWriteTime
        Write-Verbose "Cached $($script:CachedEmbeddings.Count) embedding vectors"
    }

    # ── Get query embedding ───────────────────────────────────────────────────
    # Use the same local model (all-MiniLM-L6-v2) as the cached taxonomy embeddings.
    # Calls embed_taxonomy.py encode — no API key required, dimensions always match.
    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (-not (Test-Path $EmbedScript)) {
        New-ActionableError -Goal 'compute query embedding' `
            -Problem "embed_taxonomy.py not found at $EmbedScript" `
            -Location 'Get-RelevantTaxonomyNodes' `
            -NextSteps @('Verify scripts/embed_taxonomy.py exists in the repo') -Throw
    }

    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Truncate query to ~2000 chars (model context limit)
    if ($Query.Length -gt 2000) { $QueryText = $Query.Substring(0, 2000) } else { $QueryText = $Query }

    try {
        # Pipe query text via stdin to avoid CLI arg escaping issues with long text.
        # embed_taxonomy.py encode reads from stdin when arg is '-' (default).
        $PrevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $EmbOutput = $QueryText | & $PythonCmd $EmbedScript encode - 2>$null
        } finally {
            $ErrorActionPreference = $PrevEAP
        }
        if ($LASTEXITCODE -ne 0) {
            New-ActionableError -Goal 'compute query embedding' `
                -Problem "embed_taxonomy.py encode failed (exit code $LASTEXITCODE)" `
                -Location 'Get-RelevantTaxonomyNodes' `
                -NextSteps @('Check Python is installed', 'Run: pip install sentence-transformers') -Throw
        }
        if (-not $EmbOutput -or "$EmbOutput".Trim().Length -eq 0) {
            New-ActionableError -Goal 'compute query embedding' `
                -Problem "embed_taxonomy.py produced no output" `
                -Location 'Get-RelevantTaxonomyNodes' `
                -NextSteps @('Check Python is installed', 'Run: pip install sentence-transformers') -Throw
        }
        $Parsed = $EmbOutput | ConvertFrom-Json
        $QueryVector = [double[]]($Parsed | ForEach-Object { [double]$_ })
    }
    catch {
        New-ActionableError -Goal 'compute query embedding' `
            -Problem "Local embedding failed: $($_.Exception.Message)" `
            -Location 'Get-RelevantTaxonomyNodes' `
            -NextSteps @('Check Python is installed', 'Run: pip install sentence-transformers') -Throw
    }

    # ── Compute cosine similarity for all nodes ───────────────────────────────
    $Scores = [System.Collections.Generic.List[PSObject]]::new()

    if ($POV.Count -gt 0) {
        $PovFilter = [System.Collections.Generic.HashSet[string]]::new([string[]]$POV, [System.StringComparer]::OrdinalIgnoreCase)
    }
    else { $PovFilter = $null }

    foreach ($NodeId in $script:CachedEmbeddings.Keys) {
        # POV filtering
        if ($NodeId -match '^acc-') { $NodePov = 'accelerationist' }
        elseif ($NodeId -match '^saf-') { $NodePov = 'safetyist' }
        elseif ($NodeId -match '^skp-') { $NodePov = 'skeptic' }
        elseif ($NodeId -match '^sit-') { $NodePov = 'situations' }
        else { $NodePov = 'unknown' }

        if ($NodePov -eq 'situations' -and -not $IncludeSituations) { continue }
        if ($PovFilter -and -not $PovFilter.Contains($NodePov)) { continue }

        # Cosine similarity
        $NodeVec = $script:CachedEmbeddings[$NodeId]
        if ($NodeVec.Count -ne $QueryVector.Count) { continue }

        $DotProduct = 0.0; $NormA = 0.0; $NormB = 0.0
        for ($i = 0; $i -lt $QueryVector.Count; $i++) {
            $DotProduct += $QueryVector[$i] * $NodeVec[$i]
            $NormA += $QueryVector[$i] * $QueryVector[$i]
            $NormB += $NodeVec[$i] * $NodeVec[$i]
        }
        $Denom = [Math]::Sqrt($NormA) * [Math]::Sqrt($NormB)
        if ($Denom -gt 0) { $Similarity = $DotProduct / $Denom } else { $Similarity = 0.0 }

        # Determine BDI category from node ID
        if ($NodeId -match '-beliefs-') { $Category = 'Beliefs' }
        elseif ($NodeId -match '-desires-') { $Category = 'Desires' }
        elseif ($NodeId -match '-intentions-') { $Category = 'Intentions' }
        else { $Category = 'Situations' }

        $Scores.Add([PSCustomObject]@{
            NodeId     = $NodeId
            POV        = $NodePov
            Category   = $Category
            Similarity = [Math]::Round($Similarity, 4)
        })
    }

    # ── Selection: adaptive top-K + threshold floor + min-per-BDI + max cap ──
    $Ranked = @($Scores | Sort-Object Similarity -Descending)

    # Adaptive threshold: use top-K rank to determine effective cutoff
    $EffectiveThreshold = $Threshold
    if ($TopK -gt 0 -and $Ranked.Count -gt $TopK) {
        $KthScore = $Ranked[$TopK - 1].Similarity
        $EffectiveThreshold = [Math]::Max($Threshold, $KthScore)
    }

    $AboveThreshold = @($Ranked | Where-Object { $_.Similarity -ge $EffectiveThreshold })

    # Guarantee MinPerCategory (uses raw threshold floor, not adaptive)
    $Selected = [System.Collections.Generic.List[PSObject]]::new()
    $SelectedIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($Cat in @('Beliefs', 'Desires', 'Intentions')) {
        $CatNodes = @($Ranked | Where-Object { $_.Category -eq $Cat })
        $Added = 0
        foreach ($N in $CatNodes) {
            if ($Added -ge $MinPerCategory) { break }
            if (-not $SelectedIds.Contains($N.NodeId)) {
                $Selected.Add($N)
                [void]$SelectedIds.Add($N.NodeId)
                $Added++
            }
        }
    }

    # Fill remaining slots from above-threshold pool
    foreach ($N in $AboveThreshold) {
        if ($Selected.Count -ge $MaxTotal) { break }
        if (-not $SelectedIds.Contains($N.NodeId)) {
            $Selected.Add($N)
            [void]$SelectedIds.Add($N.NodeId)
        }
    }

    # Sort final selection by similarity descending
    $Selected = @($Selected | Sort-Object Similarity -Descending)

    Write-Verbose "Selected $($Selected.Count) / $($Scores.Count) nodes (floor=$Threshold, effective=$([Math]::Round($EffectiveThreshold, 3)), topK=$TopK, max=$MaxTotal)"

    # Context-rot: RAG filtering metrics (module-scoped for pipeline to capture)
    $BelowThresholdForced = @($Selected | Where-Object { $_.Similarity -lt $EffectiveThreshold }).Count
    $CatCounts = @{}
    foreach ($S in $Selected) { $CatCounts[$S.Category] = ($CatCounts[$S.Category] ?? 0) + 1 }
    $script:LastRAGMetrics = New-ContextRotStage `
        -Stage 'rag_filtering' -InUnits 'nodes' -InCount $Scores.Count `
        -OutUnits 'nodes' -OutCount $Selected.Count `
        -Flags @{
            threshold_floor        = $Threshold
            effective_threshold    = $EffectiveThreshold
            top_k                  = $TopK
            above_threshold        = $AboveThreshold.Count
            below_threshold_forced = $BelowThresholdForced
            beliefs_selected       = ($CatCounts['Beliefs'] ?? 0)
            desires_selected       = ($CatCounts['Desires'] ?? 0)
            intentions_selected    = ($CatCounts['Intentions'] ?? 0)
        }

    # ── Look up full node data ────────────────────────────────────────────────
    $Results = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($S in $Selected) {
        $NodeData = $null
        foreach ($PovKey in $script:TaxonomyData.Keys) {
            $Found = $script:TaxonomyData[$PovKey].nodes | Where-Object { $_.id -eq $S.NodeId } | Select-Object -First 1
            if ($Found) {
                $NodeData = $Found
                break
            }
        }

        if ($NodeData) {
            $Obj = ConvertTo-TaxonomyNode -PovKey $S.POV -Node $NodeData -Score $S.Similarity
            $Results.Add($Obj)
        }
    }

    # ── Format output ─────────────────────────────────────────────────────────
    switch ($Format) {
        'objects' {
            return $Results.ToArray()
        }
        'json' {
            $JsonData = @($Results | ForEach-Object {
                [ordered]@{
                    id          = $_.Id
                    pov         = $_.POV
                    category    = $_.Category
                    label       = $_.Label
                    description = $_.Description
                    score       = $_.Score
                }
            })
            return ($JsonData | ConvertTo-Json -Depth 5)
        }
        'context' {
            # Build compact context block for prompt injection
            $Lines = [System.Text.StringBuilder]::new()
            [void]$Lines.AppendLine("=== RELEVANT TAXONOMY NODES ($($Results.Count) of $($script:CachedEmbeddings.Count) total, filtered by relevance) ===")
            [void]$Lines.AppendLine("")

            $GroupedByPov = $Results | Group-Object POV
            foreach ($Group in $GroupedByPov) {
                [void]$Lines.AppendLine("--- $($Group.Name) ---")
                foreach ($Node in $Group.Group) {
                    if ($Node.Category) { $CatLabel = "[$($Node.Category)]" } else { $CatLabel = '' }
                    [void]$Lines.AppendLine("  $($Node.Id) $CatLabel $($Node.Label)")
                    if ($Node.Description) {
                        if ($Node.Description.Length -gt 200) { $DescShort = $Node.Description.Substring(0, 200) + '...' } else { $DescShort = $Node.Description }
                        [void]$Lines.AppendLine("    $DescShort")
                    }
                }
                [void]$Lines.AppendLine("")
            }

            return $Lines.ToString()
        }
    }
}
