# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Merges chunk-level POV summaries into a single consolidated summary.
.DESCRIPTION
    When a large document is processed via the chunked pipeline in
    Invoke-DocumentSummary, each chunk produces an independent summary object.
    This function combines them into one unified summary by:

    1. Merging key_points per POV camp, deduplicating by taxonomy_node_id +
       first 80 characters of the point text (case-insensitive).
    2. Merging factual_claims, deduplicating by claim_label (or first 60 chars
       of claim text as fallback).
    3. Merging unmapped_concepts, deduplicating by suggested_label.

    The merged result has the same schema as a single-call summary and can be
    passed directly to Finalize-Summary.
.PARAMETER ChunkResults
    Array of PSObjects — each is a parsed summary from one document chunk.
    Must have pov_summaries, factual_claims, and unmapped_concepts properties.
.EXAMPLE
    $Merged = Merge-ChunkSummaries -ChunkResults @($Chunk1, $Chunk2, $Chunk3)

    Merges three chunk summaries into one, deduplicating overlapping points.
#>
function Merge-ChunkSummaries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][object[]]$ChunkResults,
        [double]$SimilarityThreshold = 0.85
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Helper: cosine similarity between two text strings ─────────────────
    # Uses local all-MiniLM-L6-v2 model via embed_taxonomy.py encode (no API key needed)
    $UseEmbeddings = $false
    $EmbeddingCache = @{}  # text hash → vector
    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Closures that capture parent-scope variables
    $GetTextEmbedding = {
        param([string]$Text)
        $Hash = $Text.GetHashCode().ToString()
        if ($EmbeddingCache.ContainsKey($Hash)) { return $EmbeddingCache[$Hash] }

        try {
            if ($Text.Length -gt 1000) { $TruncText = $Text.Substring(0, 1000) } else { $TruncText = $Text }
            # PS 5.1: native stderr becomes terminating error under $ErrorActionPreference='Stop'
            $SavedEAP = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try { $Output = & $PythonCmd $EmbedScript encode $TruncText 2>$null } finally { $ErrorActionPreference = $SavedEAP }
            if ($LASTEXITCODE -ne 0) { return $null }
            $Vector = [double[]]@($Output | ConvertFrom-Json)
            $EmbeddingCache[$Hash] = $Vector
            return $Vector
        }
        catch { return $null }
    }.GetNewClosure()

    $GetCosineSimilarity = {
        param([double[]]$A, [double[]]$B)
        if ($A.Count -ne $B.Count -or $A.Count -eq 0) { return 0.0 }
        $Dot = 0.0; $NA = 0.0; $NB = 0.0
        for ($i = 0; $i -lt $A.Count; $i++) {
            $Dot += $A[$i] * $B[$i]; $NA += $A[$i] * $A[$i]; $NB += $B[$i] * $B[$i]
        }
        $Denom = [Math]::Sqrt($NA) * [Math]::Sqrt($NB)
        if ($Denom -gt 0) { return $Dot / $Denom } else { return 0.0 }
    }

    # Test if local embedding model is available
    $ProbeVec = & $GetTextEmbedding 'test'
    $UseEmbeddings = $null -ne $ProbeVec
    if ($UseEmbeddings) {
        Write-Verbose 'Merge-ChunkSummaries: using local embedding dedup (cosine > 0.85)'
    }
    else {
        Write-Verbose 'Merge-ChunkSummaries: falling back to string-prefix dedup (local model unavailable)'
    }

    # ── Pre-dedup counts (for context-rot metrics) ─────────────────────────
    $PreDedupPoints = 0; $PreDedupClaims = 0; $PreDedupConcepts = 0
    foreach ($Chunk in $ChunkResults) {
        foreach ($c in @('accelerationist','safetyist','skeptic')) {
            if ($Chunk.pov_summaries.$c -and $Chunk.pov_summaries.$c.key_points) {
                $PreDedupPoints += @($Chunk.pov_summaries.$c.key_points).Count
            }
        }
        if ($Chunk.factual_claims) { $PreDedupClaims += @($Chunk.factual_claims).Count }
        if ($Chunk.unmapped_concepts) { $PreDedupConcepts += @($Chunk.unmapped_concepts).Count }
    }

    # ── Merge key_points per camp ────────────────────────────────────────────
    $Camps = @('accelerationist', 'safetyist', 'skeptic')
    $MergedPovSummaries = [ordered]@{}

    foreach ($Camp in $Camps) {
        $AllPoints = [System.Collections.Generic.List[object]]::new()
        $SeenKeys  = [System.Collections.Generic.HashSet[string]]::new()
        $PointVectors = [System.Collections.Generic.List[object]]::new()  # {point, vector}

        foreach ($Chunk in $ChunkResults) {
            $CampData = $Chunk.pov_summaries.$Camp
            if (-not $CampData -or -not $CampData.key_points) { continue }

            foreach ($kp in $CampData.key_points) {
                $IsDuplicate = $false

                if ($UseEmbeddings -and $kp.point) {
                    # Embedding-based dedup: compare against all accepted points
                    $Vec = & $GetTextEmbedding $kp.point
                    if ($Vec) {
                        foreach ($Existing in $PointVectors) {
                            $Sim = & $GetCosineSimilarity $Vec $Existing.Vector
                            if ($Sim -gt $SimilarityThreshold) {
                                # Keep the longer version
                                if ($kp.point.Length -gt $Existing.Point.point.Length) {
                                    $Idx = $AllPoints.IndexOf($Existing.Point)
                                    if ($Idx -ge 0) { $AllPoints[$Idx] = $kp; $Existing.Point = $kp; $Existing.Vector = $Vec }
                                }
                                $IsDuplicate = $true
                                break
                            }
                        }
                        if (-not $IsDuplicate) {
                            $AllPoints.Add($kp)
                            $PointVectors.Add(@{ Point = $kp; Vector = $Vec })
                        }
                        continue
                    }
                }

                # Fallback: string-prefix dedup
                if (-not $IsDuplicate) {
                    if ($kp.point.Length -gt 80) { $PointPrefix = $kp.point.Substring(0, 80) } else { $PointPrefix = $kp.point }
                    $DedupKey = "$($kp.taxonomy_node_id)|$($PointPrefix.ToLowerInvariant().Trim())"

                    if ($SeenKeys.Add($DedupKey)) {
                        $AllPoints.Add($kp)
                    }
                }
            }
        }

        $MergedPovSummaries[$Camp] = [ordered]@{
            key_points = @($AllPoints)
        }
    }

    # ── Merge factual_claims ─────────────────────────────────────────────────
    $AllClaims = [System.Collections.Generic.List[object]]::new()
    $SeenClaimLabels = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($Chunk in $ChunkResults) {
        if (-not $Chunk.factual_claims) { continue }

        foreach ($Claim in $Chunk.factual_claims) {
            # Dedup on claim_label (lowercased)
            if ($Claim.claim_label) {
                $ClaimKey = $Claim.claim_label.ToLowerInvariant().Trim()
            } else {
                # Fallback: first 60 chars of claim text
                if ($Claim.claim.Length -gt 60) { $ClaimText = $Claim.claim.Substring(0, 60) } else { $ClaimText = $Claim.claim }
                $ClaimKey = $ClaimText.ToLowerInvariant().Trim()
            }

            if ($SeenClaimLabels.Add($ClaimKey)) {
                $AllClaims.Add($Claim)
            }
        }
    }

    # ── Merge unmapped_concepts ──────────────────────────────────────────────
    $AllUnmapped = [System.Collections.Generic.List[object]]::new()
    $SeenLabels  = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($Chunk in $ChunkResults) {
        if (-not $Chunk.unmapped_concepts) { continue }

        foreach ($Concept in $Chunk.unmapped_concepts) {
            $HasLabel = $Concept.PSObject.Properties['suggested_label'] -and $Concept.suggested_label
            if ($HasLabel) {
                $LabelKey = $Concept.suggested_label.ToLowerInvariant().Trim()
            } else {
                $LabelKey = "unknown-$($AllUnmapped.Count)"
            }

            if ($SeenLabels.Add($LabelKey)) {
                $AllUnmapped.Add($Concept)
            }
        }
    }

    # ── Context-rot: merge/dedup metrics ─────────────────────────────────────
    $PostDedupPoints = 0
    foreach ($c in $Camps) { $PostDedupPoints += @($MergedPovSummaries[$c].key_points).Count }
    $PostDedupClaims = $AllClaims.Count
    $PostDedupConcepts = $AllUnmapped.Count
    $TotalIn = $PreDedupPoints + $PreDedupClaims + $PreDedupConcepts
    $TotalOut = $PostDedupPoints + $PostDedupClaims + $PostDedupConcepts
    $MergeMetrics = New-ContextRotStage `
        -Stage 'merge_dedup' -InUnits 'items' -InCount $TotalIn `
        -OutUnits 'items' -OutCount $TotalOut `
        -Flags @{
            points_deduped   = $PreDedupPoints - $PostDedupPoints
            claims_deduped   = $PreDedupClaims - $PostDedupClaims
            concepts_deduped = $PreDedupConcepts - $PostDedupConcepts
            used_embeddings  = [int]$UseEmbeddings
        }

    # ── Return merged structure ──────────────────────────────────────────────
    return [ordered]@{
        pov_summaries    = $MergedPovSummaries
        factual_claims   = @($AllClaims)
        unmapped_concepts = @($AllUnmapped)
        _merge_metrics   = $MergeMetrics
    }
}
