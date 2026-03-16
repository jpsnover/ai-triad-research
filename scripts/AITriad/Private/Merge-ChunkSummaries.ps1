# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Merges multiple chunk-level POV summaries into a single consolidated summary.
# Deduplicates key_points by taxonomy_node_id + point similarity,
# unions factual_claims and unmapped_concepts, and removes exact duplicates.

function Merge-ChunkSummaries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][object[]]$ChunkResults
    )

    Set-StrictMode -Version Latest

    # ── Merge key_points per camp ────────────────────────────────────────────
    $Camps = @('accelerationist', 'safetyist', 'skeptic')
    $MergedPovSummaries = [ordered]@{}

    foreach ($Camp in $Camps) {
        $AllPoints = [System.Collections.Generic.List[object]]::new()
        $SeenKeys  = [System.Collections.Generic.HashSet[string]]::new()

        foreach ($Chunk in $ChunkResults) {
            $CampData = $Chunk.pov_summaries.$Camp
            if (-not $CampData -or -not $CampData.key_points) { continue }

            foreach ($kp in $CampData.key_points) {
                # Build a dedup key: taxonomy_node_id + first 80 chars of point
                $PointPrefix = if ($kp.point.Length -gt 80) { $kp.point.Substring(0, 80) } else { $kp.point }
                $DedupKey = "$($kp.taxonomy_node_id)|$($PointPrefix.ToLowerInvariant().Trim())"

                if ($SeenKeys.Add($DedupKey)) {
                    $AllPoints.Add($kp)
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
            $ClaimKey = if ($Claim.claim_label) {
                $Claim.claim_label.ToLowerInvariant().Trim()
            } else {
                # Fallback: first 60 chars of claim text
                $ClaimText = if ($Claim.claim.Length -gt 60) { $Claim.claim.Substring(0, 60) } else { $Claim.claim }
                $ClaimText.ToLowerInvariant().Trim()
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
            $LabelKey = if ($Concept.suggested_label) {
                $Concept.suggested_label.ToLowerInvariant().Trim()
            } else {
                "unknown-$($AllUnmapped.Count)"
            }

            if ($SeenLabels.Add($LabelKey)) {
                $AllUnmapped.Add($Concept)
            }
        }
    }

    # ── Return merged structure ──────────────────────────────────────────────
    return [ordered]@{
        pov_summaries    = $MergedPovSummaries
        factual_claims   = @($AllClaims)
        unmapped_concepts = @($AllUnmapped)
    }
}
