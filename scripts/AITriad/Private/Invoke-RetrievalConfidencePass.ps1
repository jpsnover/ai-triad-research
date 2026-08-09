# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-BatchEmbedAttribution {
    # Isolated wrapper so Pester tests can mock this without touching Python.
    # Input:  list of @{EmbedId='kp_N'; Text='attribution text...'}
    # Output: hashtable EmbedId -> double[] (null on failure)
    [CmdletBinding()]
    param([System.Collections.Generic.List[hashtable]]$Items)

    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) {
        $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py'
    }
    if (-not (Test-Path $EmbedScript)) { return $null }

    $BatchItems = [System.Collections.Generic.List[object]]::new()
    foreach ($Item in $Items) {
        $BatchItems.Add([ordered]@{ id = $Item.EmbedId; text = $Item.Text })
    }
    $BatchJson = $BatchItems | ConvertTo-Json -Compress -Depth 3

    try {
        $Raw = $BatchJson | & python $EmbedScript batch-encode 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Raw)) { return $null }
        $Parsed = $Raw | ConvertFrom-Json
        $Map = @{}
        foreach ($Prop in $Parsed.PSObject.Properties) {
            $Map[$Prop.Name] = [double[]]@($Prop.Value)
        }
        return $Map
    } catch {
        return $null
    }
}

function Set-KeyPointField {
    param([object]$KeyPoint, [string]$Name, $Value)
    if ($KeyPoint.PSObject.Properties[$Name]) {
        $KeyPoint.$Name = $Value
    } else {
        $KeyPoint | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    }
}

function Invoke-RetrievalConfidencePass {
    <#
    .SYNOPSIS
        Adds retrieval_confidence, taxonomy_node_candidates, and retrieval_low_confidence
        to each key_point that has a valid taxonomy_node_id and attribution_text.
    .DESCRIPTION
        Called from Invoke-DocumentSummary after the hallucinated-ID nulling pass (which
        has already set invalid taxonomy_node_id values to $null). Only key_points with
        a non-null node ID and non-empty attribution_text are processed.

        All attribution_text values are batch-embedded in one Python subprocess call
        (embed_taxonomy.py batch-encode). Cosine similarity is then computed in-memory
        against $script:CachedEmbeddings (loaded earlier by Get-RelevantTaxonomyNodes).

        Degrades gracefully on any failure — never throws, never modifies existing fields
        on error. $script:TaxonomyData is guaranteed loaded by Assert-TaxonomyCacheFresh
        (called inside Get-RelevantTaxonomyNodes earlier in the same pipeline run).
    .PARAMETER KeyPoints
        Flat array of key_point PSObjects from all POV camps for a single document.
    .PARAMETER Threshold
        Confidence value below which retrieval_low_confidence is set to $true.
        Provisional — calibrate against SAF-167 repro case and a good-vs-bad
        attribution distribution. Caller should pass $script:RetrievalConfidenceThreshold.
    #>
    [CmdletBinding()]
    param(
        [object[]]$KeyPoints,
        [double]$Threshold = 0.45
    )

    # Guard: CachedEmbeddings must be loaded (Get-RelevantTaxonomyNodes always runs first)
    if (-not $script:CachedEmbeddings -or $script:CachedEmbeddings.Count -eq 0) {
        Write-Verbose 'Invoke-RetrievalConfidencePass: CachedEmbeddings not loaded — skipping confidence pass'
        return
    }

    # Collect workable key_points
    $WorkItems = [System.Collections.Generic.List[hashtable]]::new()
    for ($Idx = 0; $Idx -lt $KeyPoints.Count; $Idx++) {
        $kp = $KeyPoints[$Idx]
        if (-not $kp.taxonomy_node_id) { continue }
        if (-not $kp.PSObject.Properties['attribution_text']) { continue }
        $AttrText = [string]$kp.attribution_text
        if ([string]::IsNullOrWhiteSpace($AttrText)) { continue }
        if (-not $script:CachedEmbeddings.ContainsKey($kp.taxonomy_node_id)) { continue }
        $WorkItems.Add(@{ Idx = $Idx; KeyPoint = $kp; EmbedId = "kp_$Idx"; Text = $AttrText })
    }
    if ($WorkItems.Count -eq 0) { return }

    # Batch-embed all attribution_texts in one subprocess call
    $VectorMap = Invoke-BatchEmbedAttribution -Items $WorkItems
    if ($null -eq $VectorMap) {
        Write-Verbose 'Invoke-RetrievalConfidencePass: batch-encode failed — skipping confidence pass'
        return
    }

    # Build node-id → label map from TaxonomyData (guaranteed populated by Assert-TaxonomyCacheFresh)
    $LabelMap = @{}
    foreach ($PovKey in $script:TaxonomyData.Keys) {
        $PovObj = $script:TaxonomyData[$PovKey]
        if (-not $PovObj.PSObject.Properties['nodes']) { continue }
        foreach ($N in @($PovObj.nodes)) {
            if ($N.PSObject.Properties['id'] -and $N.PSObject.Properties['label']) {
                $LabelMap[[string]$N.id] = [string]$N.label
            }
        }
    }

    # Determine vector dimensionality from any cached embedding
    $SampleVec = $null
    foreach ($V in $script:CachedEmbeddings.Values) { $SampleVec = [double[]]$V; break }
    if ($null -eq $SampleVec) { return }
    $Dim = $SampleVec.Count

    foreach ($Item in $WorkItems) {
        $kp      = $Item.KeyPoint
        $EmbedId = $Item.EmbedId
        if (-not $VectorMap.ContainsKey($EmbedId)) { continue }

        $QueryVec = [double[]]$VectorMap[$EmbedId]
        if ($QueryVec.Count -ne $Dim) { continue }

        # Compute query L2 norm
        $QNormSq = 0.0
        for ($i = 0; $i -lt $Dim; $i++) { $QNormSq += $QueryVec[$i] * $QueryVec[$i] }
        $QNorm = [Math]::Sqrt($QNormSq)
        if ($QNorm -eq 0) { continue }

        # Score every cached node against the query vector
        $Scores = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($NodeId in $script:CachedEmbeddings.Keys) {
            if ($script:PillarNodeIds -and $script:PillarNodeIds.Contains($NodeId)) { continue }  # t/2369
            $NodeVec = [double[]]$script:CachedEmbeddings[$NodeId]
            if ($NodeVec.Count -ne $Dim) { continue }
            $Dot = 0.0; $NNormSq = 0.0
            for ($i = 0; $i -lt $Dim; $i++) {
                $Dot    += $QueryVec[$i] * $NodeVec[$i]
                $NNormSq += $NodeVec[$i]  * $NodeVec[$i]
            }
            $D   = $QNorm * [Math]::Sqrt($NNormSq)
            $Sim = if ($D -gt 0.0) { [Math]::Round($Dot / $D, 4) } else { 0.0 }
            $Scores.Add([PSCustomObject]@{ Id = $NodeId; Score = $Sim })
        }
        $Ranked = @($Scores | Sort-Object Score -Descending)

        # retrieval_confidence = similarity of the ASSIGNED node (included in candidates if top-3)
        $AssignedHits = @($Ranked | Where-Object { $_.Id -eq $kp.taxonomy_node_id })
        $Confidence   = if ($AssignedHits.Count -gt 0) { $AssignedHits[0].Score } else { 0.0 }

        # taxonomy_node_candidates = top-3 by similarity (assigned node included when it ranks there)
        $Top3 = @($Ranked | Select-Object -First 3 | ForEach-Object {
            $CId = $_.Id; $CScore = $_.Score
            [PSCustomObject]@{
                id    = $CId
                label = if ($LabelMap.ContainsKey($CId)) { $LabelMap[$CId] } else { '' }
                score = $CScore
            }
        })

        Set-KeyPointField $kp 'retrieval_confidence'     $Confidence
        Set-KeyPointField $kp 'taxonomy_node_candidates' $Top3
        Set-KeyPointField $kp 'retrieval_low_confidence' ($Confidence -lt $Threshold)
    }
}
