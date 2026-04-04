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
        Cosine similarity threshold. Nodes below this are excluded unless needed for
        MinPerCategory guarantee. Default: 0.30.
    .PARAMETER MaxTotal
        Maximum nodes to return. Default: 50.
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
        [double]$Threshold = 0.30,

        [ValidateRange(1, 200)]
        [int]$MaxTotal = 50,

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

    # ── Load embeddings (cached in module scope) ──────────────────────────────
    if (-not $script:CachedEmbeddings) {
        $EmbPath = Join-Path (Get-TaxonomyDir) 'embeddings.json'
        if (-not (Test-Path $EmbPath)) {
            New-ActionableError -Goal 'load taxonomy embeddings' `
                -Problem "embeddings.json not found at $EmbPath" `
                -Location 'Get-RelevantTaxonomyNodes' `
                -NextSteps @('Run Update-TaxEmbeddings to generate embeddings') -Throw
        }
        Write-Verbose 'Loading embeddings.json (first call, will be cached)...'
        $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json -Depth 20
        $script:CachedEmbeddings = @{}
        foreach ($Prop in $EmbData.nodes.PSObject.Properties) {
            $script:CachedEmbeddings[$Prop.Name] = [double[]]@($Prop.Value.vector)
        }
        Write-Verbose "Cached $($script:CachedEmbeddings.Count) embedding vectors"
    }

    # ── Get query embedding ───────────────────────────────────────────────────
    # Use the same local model (all-MiniLM-L6-v2) as the cached taxonomy embeddings.
    # Calls embed_taxonomy.py encode — no API key required, dimensions always match.
    $EmbedScript = Join-Path $script:ModuleRoot '..' 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) {
        New-ActionableError -Goal 'compute query embedding' `
            -Problem "embed_taxonomy.py not found at $EmbedScript" `
            -Location 'Get-RelevantTaxonomyNodes' `
            -NextSteps @('Verify scripts/embed_taxonomy.py exists in the repo') -Throw
    }

    $PythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }

    # Truncate query to ~2000 chars (model context limit)
    $QueryText = if ($Query.Length -gt 2000) { $Query.Substring(0, 2000) } else { $Query }

    try {
        $EmbOutput = & $PythonCmd $EmbedScript encode $QueryText 2>$null
        if ($LASTEXITCODE -ne 0) {
            New-ActionableError -Goal 'compute query embedding' `
                -Problem "embed_taxonomy.py encode failed (exit code $LASTEXITCODE)" `
                -Location 'Get-RelevantTaxonomyNodes' `
                -NextSteps @('Check Python is installed', 'Run: pip install sentence-transformers') -Throw
        }
        $QueryVector = [double[]]@($EmbOutput | ConvertFrom-Json -Depth 5)
    }
    catch {
        New-ActionableError -Goal 'compute query embedding' `
            -Problem "Local embedding failed: $($_.Exception.Message)" `
            -Location 'Get-RelevantTaxonomyNodes' `
            -NextSteps @('Check Python is installed', 'Run: pip install sentence-transformers') -Throw
    }

    # ── Compute cosine similarity for all nodes ───────────────────────────────
    $Scores = [System.Collections.Generic.List[PSObject]]::new()

    $PovFilter = if ($POV.Count -gt 0) {
        [System.Collections.Generic.HashSet[string]]::new([string[]]$POV, [System.StringComparer]::OrdinalIgnoreCase)
    }
    else { $null }

    foreach ($NodeId in $script:CachedEmbeddings.Keys) {
        # POV filtering
        $NodePov = if ($NodeId -match '^acc-') { 'accelerationist' }
                   elseif ($NodeId -match '^saf-') { 'safetyist' }
                   elseif ($NodeId -match '^skp-') { 'skeptic' }
                   elseif ($NodeId -match '^sit-') { 'situations' }
                   else { 'unknown' }

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
        $Similarity = if ($Denom -gt 0) { $DotProduct / $Denom } else { 0.0 }

        # Determine BDI category from node ID
        $Category = if ($NodeId -match '-beliefs-') { 'Beliefs' }
                    elseif ($NodeId -match '-desires-') { 'Desires' }
                    elseif ($NodeId -match '-intentions-') { 'Intentions' }
                    else { 'Situations' }

        $Scores.Add([PSCustomObject]@{
            NodeId     = $NodeId
            POV        = $NodePov
            Category   = $Category
            Similarity = [Math]::Round($Similarity, 4)
        })
    }

    # ── Selection: threshold + min-per-BDI + max cap ──────────────────────────
    $AboveThreshold = @($Scores | Where-Object { $_.Similarity -ge $Threshold } | Sort-Object Similarity -Descending)

    # Guarantee MinPerCategory
    $Selected = [System.Collections.Generic.List[PSObject]]::new()
    $SelectedIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($Cat in @('Beliefs', 'Desires', 'Intentions')) {
        $CatNodes = @($Scores | Where-Object { $_.Category -eq $Cat } | Sort-Object Similarity -Descending)
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

    Write-Verbose "Selected $($Selected.Count) / $($Scores.Count) nodes (threshold=$Threshold, max=$MaxTotal)"

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
                    $CatLabel = if ($Node.Category) { "[$($Node.Category)]" } else { '' }
                    [void]$Lines.AppendLine("  $($Node.Id) $CatLabel $($Node.Label)")
                    if ($Node.Description) {
                        $DescShort = if ($Node.Description.Length -gt 200) { $Node.Description.Substring(0, 200) + '...' } else { $Node.Description }
                        [void]$Lines.AppendLine("    $DescShort")
                    }
                }
                [void]$Lines.AppendLine("")
            }

            return $Lines.ToString()
        }
    }
}
