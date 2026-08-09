# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-Mechanism5RetrievalPass {
    <#
    .SYNOPSIS
        Per-key_point re-retrieval pass (Mechanism #5, t/2357) — flag + surface.
    .DESCRIPTION
        After Invoke-RetrievalConfidencePass has scored every key_point, this pass
        identifies the ones where the existing assignment is likely a vocabulary-collision
        misfire and surfaces per-key_point top-3 candidates so the t/2289 override path
        can act on them.

        A key_point is flagged when EITHER:
          (1) retrieval_low_confidence = $true  (confidence < 0.45, from t/2288), OR
          (2) the assigned node is absent from the per-key_point attribution_text top-3
              (taxonomy_node_candidates doesn't include the assigned node_id).

        For flagged key_points, the query is attribution_text (primary) / verbatim
        (fallback) — NOT canonical_proposition (over-abstracted; Arm-1 finding).

        Scoring is done in-memory against $script:CachedEmbeddings (already loaded by
        Get-RelevantTaxonomyNodes earlier in the same pipeline run), POV-filtered.
        All queries are batch-embedded in a single Python subprocess to avoid cold
        model-load cost per key_point.

        Sets two new fields on each flagged key_point:
          mechanism5_flag       = $true
          mechanism5_candidates = top-3 [PSCustomObject]@{id; label; score} per POV

        v1 ships flag→surface only; auto-correct (replace taxonomy_node_id when the
        top-1 beats the assigned node by a conservative margin) is a fast-follow (t/2357).
        Degrades gracefully — never throws, never modifies other fields on failure.
    .PARAMETER KeyPointItems
        Array of hashtables @{KeyPoint=<PSObject>; POV='accelerationist'|'safetyist'|'skeptic'}.
    #>
    [CmdletBinding()]
    param(
        [object[]]$KeyPointItems
    )

    # Guard: embeddings and taxonomy must be loaded (Get-RelevantTaxonomyNodes runs earlier)
    if (-not $script:CachedEmbeddings -or $script:CachedEmbeddings.Count -eq 0) {
        Write-Verbose 'Invoke-Mechanism5RetrievalPass: CachedEmbeddings not loaded — skipping'
        return
    }

    # Identify flagged key_points and build per-item query text
    $Flagged = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($Item in $KeyPointItems) {
        $kp  = $Item.KeyPoint
        $Pov = [string]$Item.POV
        if (-not ($kp.PSObject.Properties['taxonomy_node_id'] -and $kp.taxonomy_node_id)) { continue }

        # Condition 1: low retrieval confidence (set by Invoke-RetrievalConfidencePass)
        $IsLowConf = $kp.PSObject.Properties['retrieval_low_confidence'] -and $kp.retrieval_low_confidence

        # Condition 2: assigned node absent from attribution_text top-3 candidates
        $IsAbsent = $true
        if ($kp.PSObject.Properties['taxonomy_node_candidates'] -and $kp.taxonomy_node_candidates) {
            foreach ($Cand in @($kp.taxonomy_node_candidates)) {
                if ($Cand.PSObject.Properties['id'] -and $Cand.id -eq $kp.taxonomy_node_id) {
                    $IsAbsent = $false
                    break
                }
            }
        }

        if (-not $IsLowConf -and -not $IsAbsent) { continue }

        # Query: attribution_text (primary) / verbatim (fallback)
        $QueryText = $null
        if ($kp.PSObject.Properties['attribution_text'] -and -not [string]::IsNullOrWhiteSpace($kp.attribution_text)) {
            $QueryText = [string]$kp.attribution_text
        } elseif ($kp.PSObject.Properties['verbatim'] -and -not [string]::IsNullOrWhiteSpace($kp.verbatim)) {
            if ($kp.verbatim -is [array]) {
                $QueryText = $kp.verbatim -join ' '
            } else {
                $QueryText = [string]$kp.verbatim
            }
        }
        if ([string]::IsNullOrWhiteSpace($QueryText)) { continue }

        $Flagged.Add(@{
            KeyPoint = $kp
            POV      = $Pov
            Query    = $QueryText
            EmbedId  = "m5_$($Flagged.Count)"
        })
    }

    if ($Flagged.Count -eq 0) { return }

    Write-Verbose "Mechanism5: $($Flagged.Count) key_points flagged for per-key_point re-retrieval"

    # Batch-embed all queries in one subprocess
    $EmbedItems = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($F in $Flagged) {
        $EmbedItems.Add(@{ EmbedId = $F.EmbedId; Text = $F.Query })
    }
    $VectorMap = Invoke-BatchEmbedAttribution -Items $EmbedItems
    if ($null -eq $VectorMap) {
        Write-Verbose 'Mechanism5: batch-encode failed — skipping'
        return
    }

    # POV prefix map for in-memory node filtering
    $PovPrefixMap = @{
        accelerationist = 'acc-'
        safetyist       = 'saf-'
        skeptic         = 'skp-'
    }

    # Node label map (guaranteed populated by Assert-TaxonomyCacheFresh earlier)
    $LabelMap = @{}
    if ($script:TaxonomyData -and $script:TaxonomyData.Count -gt 0) {
        foreach ($PovKey in $script:TaxonomyData.Keys) {
            $PovObj = $script:TaxonomyData[$PovKey]
            if (-not $PovObj.PSObject.Properties['nodes']) { continue }
            foreach ($N in @($PovObj.nodes)) {
                if ($N.PSObject.Properties['id'] -and $N.PSObject.Properties['label']) {
                    $LabelMap[[string]$N.id] = [string]$N.label
                }
            }
        }
    }

    # Dimensionality from any cached vector
    $SampleVec = $null
    foreach ($V in $script:CachedEmbeddings.Values) { $SampleVec = [double[]]$V; break }
    if ($null -eq $SampleVec) { return }
    $Dim = $SampleVec.Count

    $FlaggedCount = 0
    foreach ($F in $Flagged) {
        $kp      = $F.KeyPoint
        $EmbedId = $F.EmbedId
        $Pov     = $F.POV

        if (-not $VectorMap.ContainsKey($EmbedId)) { continue }
        $QueryVec = [double[]]$VectorMap[$EmbedId]
        if ($QueryVec.Count -ne $Dim) { continue }

        # Query L2 norm
        $QNormSq = 0.0
        for ($i = 0; $i -lt $Dim; $i++) { $QNormSq += $QueryVec[$i] * $QueryVec[$i] }
        $QNorm = [Math]::Sqrt($QNormSq)
        if ($QNorm -eq 0) { continue }

        # Score nodes filtered to this POV
        $PovPrefix = if ($PovPrefixMap.ContainsKey($Pov)) { $PovPrefixMap[$Pov] } else { $null }
        $Scores = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($NodeId in $script:CachedEmbeddings.Keys) {
            if ($PovPrefix -and -not $NodeId.StartsWith($PovPrefix)) { continue }
            $NodeVec = [double[]]$script:CachedEmbeddings[$NodeId]
            if ($NodeVec.Count -ne $Dim) { continue }

            $Dot = 0.0; $NNormSq = 0.0
            for ($i = 0; $i -lt $Dim; $i++) {
                $Dot     += $QueryVec[$i] * $NodeVec[$i]
                $NNormSq += $NodeVec[$i]  * $NodeVec[$i]
            }
            $D   = $QNorm * [Math]::Sqrt($NNormSq)
            $Sim = if ($D -gt 0.0) { [Math]::Round($Dot / $D, 4) } else { 0.0 }
            $Scores.Add([PSCustomObject]@{ Id = $NodeId; Score = $Sim })
        }

        $Top3 = @($Scores | Sort-Object Score -Descending | Select-Object -First 3 | ForEach-Object {
            $CId = $_.Id; $CScore = $_.Score
            [PSCustomObject]@{
                id    = $CId
                label = if ($LabelMap.ContainsKey($CId)) { $LabelMap[$CId] } else { '' }
                score = $CScore
            }
        })

        Set-KeyPointField $kp 'mechanism5_flag'       $true
        Set-KeyPointField $kp 'mechanism5_candidates' $Top3
        $FlaggedCount++
    }

    if ($FlaggedCount -gt 0) {
        Write-Host "  │  mechanism5: $FlaggedCount key_point(s) flagged + surfaced" -ForegroundColor DarkCyan
    }
}
