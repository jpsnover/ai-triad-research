# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TopicFrequency {
    <#
    .SYNOPSIS
        Discovers the most common topics per POV camp by clustering taxonomy node citations.
    .DESCRIPTION
        Scans all summary JSONs, counts how often each taxonomy node is cited per POV camp,
        clusters cited nodes by embedding similarity (agglomerative, average-linkage), then
        ranks clusters by total citation count. Optionally calls an LLM to generate topic
        labels and summaries for each cluster.
    .PARAMETER TopN
        Number of top topics to show per POV camp (1-20, default 5).
    .PARAMETER POV
        Filter to a single POV camp or 'all' (default).
    .PARAMETER OutputFile
        Optional path to write the full results as JSON.
    .PARAMETER NoAI
        Skip LLM labeling; use highest-cited node label as the cluster label.
    .PARAMETER IncludeFactualClaims
        Also count taxonomy node references in factual_claims.
    .PARAMETER ClusterThreshold
        Cosine similarity threshold for agglomerative clustering (0.3-0.9, default 0.55).
    .PARAMETER Model
        AI model override (default from $env:AI_MODEL or gemini-3.1-flash-lite-preview).
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Get-TopicFrequency -NoAI
    .EXAMPLE
        Get-TopicFrequency -TopN 3 -POV safetyist -OutputFile topics.json
    .EXAMPLE
        Get-TopicFrequency -IncludeFactualClaims -NoAI
    #>
    [CmdletBinding()]
    param(
        [ValidateRange(1, 20)]
        [int]$TopN = 5,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'all')]
        [string]$POV = 'all',

        [string]$OutputFile,

        [switch]$NoAI,

        [switch]$IncludeFactualClaims,

        [ValidateRange(0.3, 0.9)]
        [double]$ClusterThreshold = 0.55,

        [string]$Model,

        [string]$ApiKey,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $Model) {
        $Model = if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.1-flash-lite-preview' }
    }

    # ── Build node index ─────────────────────────────────────────────────────
    Write-Step "Building node index"
    $NodeIndex = @{}
    $PovNames  = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')

    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $Desc = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
            $NodeIndex[$Node.id] = @{
                Label       = $Node.label
                Description = $Desc
                POV         = $PovKey
            }
        }
    }
    Write-OK "Indexed $($NodeIndex.Count) taxonomy nodes"

    # ── Step 1: Scan summaries and build citation counts ─────────────────────
    Write-Step "Scanning summaries for citations"
    $SummariesDir = Join-Path $RepoRoot 'summaries'
    if (-not (Test-Path $SummariesDir)) {
        Write-Fail "Summaries directory not found: $SummariesDir"
        return
    }

    $SummaryFiles = @(Get-ChildItem -Path $SummariesDir -Filter '*.json' -File)
    $SummaryCount = $SummaryFiles.Count

    if ($SummaryCount -lt 3) {
        Write-Warn "Only $SummaryCount summaries found — results will be limited"
    }

    # Citations[camp][nodeId] = @{ Count = N; DocIds = List }
    $CampKeys  = @('accelerationist', 'safetyist', 'skeptic')
    $Citations = @{}
    foreach ($Camp in $CampKeys) {
        $Citations[$Camp] = @{}
    }
    $TotalKeyPoints = 0

    foreach ($File in $SummaryFiles) {
        try {
            $Summary = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
        }
        catch {
            Write-Warning "Failed to parse $($File.Name): $_"
            continue
        }

        $DocId = $Summary.doc_id
        if (-not $DocId) { $DocId = $File.BaseName }

        # Count key_points per camp
        foreach ($Camp in $CampKeys) {
            $CampData = $Summary.pov_summaries.$Camp
            if (-not $CampData -or -not $CampData.key_points) { continue }

            foreach ($KP in $CampData.key_points) {
                $TotalKeyPoints++
                $NodeId = $KP.taxonomy_node_id
                if (-not $NodeId) { continue }

                if (-not $Citations[$Camp].ContainsKey($NodeId)) {
                    $Citations[$Camp][$NodeId] = @{
                        Count  = 0
                        DocIds = [System.Collections.Generic.List[string]]::new()
                    }
                }
                $Citations[$Camp][$NodeId].Count++
                if ($DocId -notin $Citations[$Camp][$NodeId].DocIds) {
                    $Citations[$Camp][$NodeId].DocIds.Add($DocId)
                }
            }
        }

        # Optionally count factual_claims (attributed equally to all camps)
        if ($IncludeFactualClaims -and $Summary.factual_claims) {
            foreach ($Claim in $Summary.factual_claims) {
                if (-not $Claim.linked_taxonomy_nodes) { continue }
                foreach ($NodeId in $Claim.linked_taxonomy_nodes) {
                    if (-not $NodeId) { continue }
                    foreach ($Camp in $CampKeys) {
                        if (-not $Citations[$Camp].ContainsKey($NodeId)) {
                            $Citations[$Camp][$NodeId] = @{
                                Count  = 0
                                DocIds = [System.Collections.Generic.List[string]]::new()
                            }
                        }
                        $Citations[$Camp][$NodeId].Count++
                        if ($DocId -notin $Citations[$Camp][$NodeId].DocIds) {
                            $Citations[$Camp][$NodeId].DocIds.Add($DocId)
                        }
                    }
                }
            }
        }
    }

    Write-OK "Scanned $SummaryCount summaries, $TotalKeyPoints key points"

    # ── Step 2: Load embeddings ──────────────────────────────────────────────
    Write-Step "Loading embeddings"
    $EmbeddingsFile = Join-Path $RepoRoot 'taxonomy' 'Origin' 'embeddings.json'
    $Embeddings     = @{}

    if (Test-Path $EmbeddingsFile) {
        try {
            $EmbData = Get-Content -Raw -Path $EmbeddingsFile | ConvertFrom-Json
            $EmbNodes = if ($EmbData.PSObject.Properties['nodes']) { $EmbData.nodes } else { $EmbData }
            foreach ($Prop in $EmbNodes.PSObject.Properties) {
                $Val = $Prop.Value
                # Handle both flat arrays and {pov, vector} objects
                if ($Val -is [array]) {
                    $Embeddings[$Prop.Name] = [double[]]$Val
                }
                elseif ($Val.PSObject.Properties['vector']) {
                    $Embeddings[$Prop.Name] = [double[]]$Val.vector
                }
            }
            Write-OK "Loaded $($Embeddings.Count) embeddings"
        }
        catch {
            Write-Warn "Failed to load embeddings: $_ — clustering will be limited"
        }
    }
    else {
        Write-Warn "embeddings.json not found — each node will be its own cluster"
    }

    # ── Step 3: Cluster per POV ──────────────────────────────────────────────
    Write-Step "Clustering cited nodes per POV"

    $TargetCamps = if ($POV -eq 'all') { $CampKeys } else { @($POV) }
    $AllTopics   = @{}

    foreach ($Camp in $TargetCamps) {
        $CampCitations = $Citations[$Camp]
        $CitedNodes    = @($CampCitations.Keys | Where-Object { $CampCitations[$_].Count -gt 0 })

        if ($CitedNodes.Count -eq 0) {
            Write-Info "$Camp — no cited nodes"
            $AllTopics[$Camp] = @()
            continue
        }

        # Separate nodes with/without embeddings
        $WithEmb    = @($CitedNodes | Where-Object { $Embeddings.ContainsKey($_) })
        $WithoutEmb = @($CitedNodes | Where-Object { -not $Embeddings.ContainsKey($_) })

        # Cluster nodes with embeddings
        $MaxClusters = $TopN * 2
        $ClusterArrays = @()
        if ($WithEmb.Count -gt 0) {
            $ClusterArrays = @(Get-EmbeddingClusters `
                -NodeIds      $WithEmb `
                -Embeddings   $Embeddings `
                -MaxClusters  $MaxClusters `
                -MinSimilarity $ClusterThreshold)
        }

        # Add singleton clusters for nodes without embeddings
        foreach ($NodeId in $WithoutEmb) {
            $ClusterArrays += ,@($NodeId)
        }

        # Score each cluster by summing citation counts, rank descending
        $ScoredClusters = @($ClusterArrays | ForEach-Object {
            $Members = $_
            $TotalCit = 0
            $AllDocs  = [System.Collections.Generic.List[string]]::new()
            foreach ($NId in $Members) {
                if ($CampCitations.ContainsKey($NId)) {
                    $TotalCit += $CampCitations[$NId].Count
                    foreach ($D in $CampCitations[$NId].DocIds) {
                        if ($D -notin $AllDocs) { $AllDocs.Add($D) }
                    }
                }
            }
            [PSCustomObject]@{
                Members        = $Members
                TotalCitations = $TotalCit
                DocIds         = $AllDocs.ToArray()
            }
        } | Sort-Object -Property TotalCitations -Descending)

        # Take top N
        $TopClusters = @($ScoredClusters | Select-Object -First $TopN)
        $AllTopics[$Camp] = $TopClusters

        Write-Info "$Camp — $($CitedNodes.Count) cited nodes, $($ClusterArrays.Count) clusters, top $($TopClusters.Count) selected"
    }

    # ── Step 4: Label clusters ───────────────────────────────────────────────
    $AILabeled = $false

    if (-not $NoAI) {
        Write-Step "Labeling clusters with AI"

        try {
            $Backend = if     ($Model -match '^gemini') { 'gemini' }
                       elseif ($Model -match '^claude') { 'claude' }
                       elseif ($Model -match '^groq')   { 'groq'   }
                       else                             { 'gemini'  }

            $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
            if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
                Write-Warn "No API key found for $Backend — falling back to -NoAI labeling"
                $NoAI = $true
            }
            else {
                $ApiKey = $ResolvedKey

                # Build cluster descriptions for the prompt
                $ClusterDescs = [System.Text.StringBuilder]::new()
                foreach ($Camp in $TargetCamps) {
                    for ($i = 0; $i -lt $AllTopics[$Camp].Count; $i++) {
                        $Cluster = $AllTopics[$Camp][$i]
                        [void]$ClusterDescs.AppendLine("--- $($Camp)_$i ---")
                        [void]$ClusterDescs.AppendLine("POV: $Camp | Citations: $($Cluster.TotalCitations)")
                        [void]$ClusterDescs.AppendLine("Member nodes:")
                        foreach ($NId in $Cluster.Members) {
                            $Lbl  = if ($NodeIndex.ContainsKey($NId)) { $NodeIndex[$NId].Label } else { $NId }
                            $Desc = if ($NodeIndex.ContainsKey($NId)) { $NodeIndex[$NId].Description } else { '' }
                            $Cit  = if ($Citations[$Camp].ContainsKey($NId)) { $Citations[$Camp][$NId].Count } else { 0 }
                            [void]$ClusterDescs.AppendLine("  - $NId ($Cit citations): $Lbl — $Desc")
                        }
                        [void]$ClusterDescs.AppendLine()
                    }
                }

                $PromptBody  = Get-Prompt -Name 'topic-frequency-label' -Replacements @{ CLUSTERS = $ClusterDescs.ToString() }
                $SchemaBody  = Get-Prompt -Name 'topic-frequency-label-schema'
                $FullPrompt  = "$PromptBody`n`n$SchemaBody"

                $AIResult = Invoke-AIApi `
                    -Prompt     $FullPrompt `
                    -Model      $Model `
                    -ApiKey     $ApiKey `
                    -Temperature 0.1 `
                    -MaxTokens  4096 `
                    -JsonMode `
                    -TimeoutSec 120 `
                    -MaxRetries 3 `
                    -RetryDelays @(5, 15, 45)

                if ($AIResult -and $AIResult.Text) {
                    $LabelText = $AIResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
                    $Labels = $LabelText | ConvertFrom-Json
                    $AILabeled = $true
                    Write-OK "AI labeling complete ($($AIResult.Backend))"
                }
                else {
                    Write-Warn "AI returned no result — falling back to -NoAI labeling"
                    $NoAI = $true
                }
            }
        }
        catch {
            Write-Warn "AI labeling failed: $_ — falling back to -NoAI labeling"
            $NoAI = $true
        }
    }

    # ── Build output structure ───────────────────────────────────────────────
    Write-Step "Building results"

    $TopicsByPov = [ordered]@{}
    foreach ($Camp in $TargetCamps) {
        $CampTopics = [System.Collections.Generic.List[PSObject]]::new()

        for ($i = 0; $i -lt $AllTopics[$Camp].Count; $i++) {
            $Cluster = $AllTopics[$Camp][$i]
            $Key     = "$($Camp)_$i"

            # Determine label and summary
            if ($AILabeled -and $Labels.PSObject.Properties[$Key]) {
                $TopicLabel   = $Labels.$Key.topic_label
                $TopicSummary = $Labels.$Key.topic_summary
            }
            else {
                # NoAI fallback: use highest-cited member's label
                $BestNode = $Cluster.Members |
                    Sort-Object { if ($Citations[$Camp].ContainsKey($_)) { $Citations[$Camp][$_].Count } else { 0 } } -Descending |
                    Select-Object -First 1
                $TopicLabel   = if ($NodeIndex.ContainsKey($BestNode)) { $NodeIndex[$BestNode].Label } else { $BestNode }
                $TopicSummary = ($Cluster.Members | ForEach-Object {
                    if ($NodeIndex.ContainsKey($_)) { $NodeIndex[$_].Label } else { $_ }
                }) -join ', '
            }

            # Build member details
            $MemberDetails = @($Cluster.Members | ForEach-Object {
                $NId = $_
                [ordered]@{
                    id        = $NId
                    label     = if ($NodeIndex.ContainsKey($NId)) { $NodeIndex[$NId].Label } else { $NId }
                    citations = if ($Citations[$Camp].ContainsKey($NId)) { $Citations[$Camp][$NId].Count } else { 0 }
                }
            } | Sort-Object { $_.citations } -Descending)

            $CampTopics.Add([PSCustomObject][ordered]@{
                rank                = $i + 1
                topic_label         = $TopicLabel
                topic_summary       = $TopicSummary
                total_citations     = $Cluster.TotalCitations
                member_nodes        = $MemberDetails
                contributing_doc_ids = $Cluster.DocIds
            })
        }

        $TopicsByPov[$Camp] = @($CampTopics)
    }

    $Result = [ordered]@{
        generated_at      = (Get-Date -Format 'o')
        summary_count     = $SummaryCount
        total_key_points  = $TotalKeyPoints
        cluster_threshold = $ClusterThreshold
        ai_labeled        = $AILabeled
        topics_by_pov     = $TopicsByPov
    }

    # ── Step 5: Console output ───────────────────────────────────────────────
    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan
    Write-Host "  TOPIC FREQUENCY — $SummaryCount summaries, ~$TotalKeyPoints key points" -ForegroundColor White
    Write-Host "$('═' * 60)" -ForegroundColor Cyan

    foreach ($Camp in $TargetCamps) {
        $CampUpper = $Camp.ToUpper()
        Write-Host "`n  $CampUpper — Top $($TopicsByPov[$Camp].Count) Topics" -ForegroundColor White
        Write-Host "  $('─' * 45)" -ForegroundColor DarkGray

        foreach ($Topic in $TopicsByPov[$Camp]) {
            $NodeCount = $Topic.member_nodes.Count
            Write-Host "   $($Topic.rank). $($Topic.topic_label)  " -ForegroundColor White -NoNewline
            Write-Host "($($Topic.total_citations) citations, $NodeCount nodes)" -ForegroundColor Gray
            Write-Host "      $($Topic.topic_summary)" -ForegroundColor DarkGray
            $NodeIds = ($Topic.member_nodes | ForEach-Object { $_.id }) -join ', '
            Write-Host "      Nodes: $NodeIds" -ForegroundColor DarkGray
        }
    }

    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan

    # ── JSON export ──────────────────────────────────────────────────────────
    if ($OutputFile) {
        $Json = $Result | ConvertTo-Json -Depth 20
        Set-Content -Path $OutputFile -Value $Json -Encoding UTF8
        Write-OK "Exported to $OutputFile"
    }

    return $Result
}
