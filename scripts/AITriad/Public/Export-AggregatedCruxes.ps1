# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Export-AggregatedCruxes {
    <#
    .SYNOPSIS
        Extracts cruxes from all debates, deduplicates via embedding similarity,
        and writes aggregated-cruxes.json.
    .DESCRIPTION
        Reads both synthesis cruxes (from transcript synthesis entries) and structural
        cruxes (from crux_tracker) across all debate files. Deduplicates near-identical
        cruxes using embedding cosine similarity, picks the clearest statement as
        canonical for each cluster, and writes the result with full backpointers.
    .PARAMETER SimilarityThreshold
        Cosine similarity threshold for deduplication. Default: 0.80.
    .PARAMETER OutputPath
        Path for the output JSON. Default: aggregated-cruxes.json in the taxonomy dir.
    .EXAMPLE
        Export-AggregatedCruxes
    .EXAMPLE
        Export-AggregatedCruxes -SimilarityThreshold 0.75 -WhatIf
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateRange(0.5, 0.95)]
        [double]$SimilarityThreshold = 0.80,

        [ValidateRange(0.3, 0.9)]
        [double]$NodeLinkThreshold = 0.45,

        [ValidateRange(1, 10)]
        [int]$MaxLinkedNodes = 5,

        [string]$OutputPath
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    Assert-TaxonomyCacheFresh

    $DebatesDir = Get-DebatesDir
    if (-not (Test-Path $DebatesDir)) {
        Write-Warning "Debates directory not found: $DebatesDir"
        return
    }

    if (-not $OutputPath) {
        $OutputPath = Join-Path (Get-TaxonomyDir) 'aggregated-cruxes.json'
    }

    # ── Phase 1: Extract all cruxes ───────────────────────────────────────────
    Write-Host 'Phase 1: Extracting cruxes from debates...' -ForegroundColor Cyan

    $AllCruxes = [System.Collections.Generic.List[PSObject]]::new()
    $DebateFiles = Get-ChildItem $DebatesDir -Filter 'debate-*.json' -Recurse |
        Where-Object { $_.Name -notmatch 'diagnostics|harvest|transcript' }

    foreach ($File in $DebateFiles) {
        try {
        $D = $null
        try { $D = Get-Content $File.FullName -Raw | ConvertFrom-Json } catch { continue }
        if (-not $D) { continue }

        $DebateId = if ($D.PSObject.Properties['id']) { $D.id } else { $File.BaseName -replace '^debate-','' }
        $TopicText = ''
        if ($D.PSObject.Properties['topic']) {
            if ($D.topic -is [string]) { $TopicText = $D.topic }
            elseif ($D.topic.PSObject.Properties['original']) { $TopicText = $D.topic.original }
        }

        # Synthesis cruxes from transcript
        if ($D.PSObject.Properties['transcript'] -and $D.transcript) {
            foreach ($Entry in @($D.transcript)) {
                if ($Entry.type -ne 'concluding' -and $Entry.type -ne 'synthesis') { continue }
                if (-not $Entry.PSObject.Properties['metadata'] -or -not $Entry.metadata) { continue }
                $Synth = $Entry.metadata
                if (-not $Synth.PSObject.Properties['synthesis'] -or -not $Synth.synthesis) { continue }
                if (-not $Synth.synthesis.PSObject.Properties['cruxes']) { continue }

                foreach ($C in @($Synth.synthesis.cruxes)) {
                    $Statement = if ($C.PSObject.Properties['question']) { $C.question }
                                 elseif ($C.PSObject.Properties['statement']) { $C.statement }
                                 elseif ($C.PSObject.Properties['description']) { $C.description }
                                 else { '' }
                    if ([string]::IsNullOrWhiteSpace($Statement)) { continue }

                    $Type = if ($C.PSObject.Properties['type']) { $C.type.ToLower() -replace '_','' } else { 'empirical' }
                    if ($Type -match 'empiric') { $Type = 'empirical' }
                    elseif ($Type -match 'value') { $Type = 'values' }
                    elseif ($Type -match 'defin') { $Type = 'definitional' }
                    else { $Type = 'empirical' }

                    $State = if ($C.PSObject.Properties['resolution_status']) { $C.resolution_status } else { 'active' }

                    $AllCruxes.Add([PSCustomObject]@{
                        Statement = $Statement
                        Type      = $Type
                        State     = $State
                        Source    = 'synthesis'
                        DebateId  = $DebateId
                        Topic     = $TopicText
                        TrackerId = ''
                        Turn      = 0
                        NodeIds   = @()
                    })
                }
            }
        }

        # Structural cruxes from crux_tracker
        if ($D.PSObject.Properties['crux_tracker'] -and $D.crux_tracker) {
            foreach ($C in @($D.crux_tracker)) {
                $Statement = if ($C.PSObject.Properties['description']) { $C.description } else { '' }
                if ([string]::IsNullOrWhiteSpace($Statement)) { continue }

                $Type = if ($C.PSObject.Properties['disagreement_type']) { $C.disagreement_type.ToLower() } else { 'empirical' }
                if ($Type -match 'empiric') { $Type = 'empirical' }
                elseif ($Type -match 'value') { $Type = 'values' }
                elseif ($Type -match 'defin') { $Type = 'definitional' }
                else { $Type = 'empirical' }

                $State = if ($C.PSObject.Properties['state']) { $C.state } else { 'active' }
                $Turn = if ($C.PSObject.Properties['identified_turn']) { [int]$C.identified_turn } else { 0 }
                $TrackerId = if ($C.PSObject.Properties['id']) { $C.id } else { '' }

                # Extract linked node IDs from attacking_claim_ids
                $NodeIds = @()
                if ($C.PSObject.Properties['attacking_claim_ids'] -and $C.attacking_claim_ids) {
                    # These are AN-* claim IDs, not taxonomy nodes — skip for now
                }

                $AllCruxes.Add([PSCustomObject]@{
                    Statement = $Statement
                    Type      = $Type
                    State     = $State
                    Source    = 'structural'
                    DebateId  = $DebateId
                    Topic     = $TopicText
                    TrackerId = $TrackerId
                    Turn      = $Turn
                    NodeIds   = $NodeIds
                })
            }
        }
        } catch { Write-Verbose "Skipping $($File.Name): $($_.Exception.Message)" }
    }

    Write-Host "  Extracted $($AllCruxes.Count) cruxes from $($DebateFiles.Count) debates"

    if ($AllCruxes.Count -eq 0) {
        Write-Warning 'No cruxes found in any debates'
        return
    }

    # ── Phase 2: Deduplicate via embedding similarity ─────────────────────────
    Write-Host 'Phase 2: Deduplicating via embeddings...' -ForegroundColor Cyan

    $Statements = @($AllCruxes | ForEach-Object { $_.Statement })
    $Ids = 0..($Statements.Count - 1) | ForEach-Object { $_.ToString() }

    $Embeddings = Get-TextEmbedding -Texts $Statements -Ids $Ids
    if (-not $Embeddings) {
        Write-Warning 'Embeddings unavailable — skipping dedup, all cruxes will be unique'
        $ClusterMap = @{}
        for ($i = 0; $i -lt $AllCruxes.Count; $i++) { $ClusterMap[$i] = $i }
    }
    else {
        # Greedy clustering
        $Canonicals = [System.Collections.Generic.List[int]]::new()
        $CanonicalVecs = [System.Collections.Generic.List[double[]]]::new()
        $ClusterMap = @{}  # crux index → canonical index

        for ($i = 0; $i -lt $AllCruxes.Count; $i++) {
            $Vec = $Embeddings[$i.ToString()]
            if (-not $Vec) { $Canonicals.Add($i); $CanonicalVecs.Add($null); $ClusterMap[$i] = $i; continue }

            $Merged = $false
            for ($j = 0; $j -lt $Canonicals.Count; $j++) {
                $CanVec = $CanonicalVecs[$j]
                if (-not $CanVec) { continue }
                $Dot = 0.0
                for ($k = 0; $k -lt $Vec.Count; $k++) { $Dot += $Vec[$k] * $CanVec[$k] }
                if ($Dot -ge $SimilarityThreshold) {
                    $ClusterMap[$i] = $Canonicals[$j]
                    $Merged = $true
                    break
                }
            }
            if (-not $Merged) {
                $Canonicals.Add($i)
                $CanonicalVecs.Add($Vec)
                $ClusterMap[$i] = $i
            }
        }

        Write-Host "  $($AllCruxes.Count) cruxes → $($Canonicals.Count) unique clusters"
    }

    # ── Phase 3: Build aggregated crux objects ────────────────────────────────
    Write-Host 'Phase 3: Building aggregated cruxes...' -ForegroundColor Cyan

    # Group by canonical index
    $Clusters = @{}
    for ($i = 0; $i -lt $AllCruxes.Count; $i++) {
        $CanIdx = $ClusterMap[$i]
        if (-not $Clusters.ContainsKey($CanIdx)) { $Clusters[$CanIdx] = [System.Collections.Generic.List[int]]::new() }
        $Clusters[$CanIdx].Add($i)
    }

    $CruxNum = 0
    $AggregatedCruxes = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($CanIdx in ($Clusters.Keys | Sort-Object)) {
        $Members = $Clusters[$CanIdx]
        $CruxNum++

        # Pick canonical statement: longest (most detailed) from the cluster
        $BestIdx = $Members[0]
        $BestLen = $AllCruxes[$Members[0]].Statement.Length
        foreach ($MIdx in $Members) {
            if ($AllCruxes[$MIdx].Statement.Length -gt $BestLen) {
                $BestLen = $AllCruxes[$MIdx].Statement.Length
                $BestIdx = $MIdx
            }
        }
        $Canonical = $AllCruxes[$BestIdx]

        # Majority type
        $TypeVotes = @{}
        foreach ($MIdx in $Members) {
            $T = $AllCruxes[$MIdx].Type
            $TypeVotes[$T] = ($TypeVotes[$T] ?? 0) + 1
        }
        $MajorityType = ($TypeVotes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key

        # Resolution summary
        $Resolved = 0; $Active = 0; $Irreducible = 0
        foreach ($MIdx in $Members) {
            switch ($AllCruxes[$MIdx].State) {
                'resolved'    { $Resolved++ }
                'irreducible' { $Irreducible++ }
                default       { $Active++ }
            }
        }

        # Unique debate IDs
        $UniqueDebates = @($Members | ForEach-Object { $AllCruxes[$_].DebateId } | Select-Object -Unique)

        # Sources
        $Sources = @($Members | ForEach-Object {
            $C = $AllCruxes[$_]
            [ordered]@{
                debate_id        = $C.DebateId
                debate_topic     = $C.Topic
                crux_tracker_id  = $C.TrackerId
                identified_turn  = $C.Turn
                final_state      = $C.State
            }
        })

        # Linked node IDs (union across cluster)
        $LinkedNodes = @($Members | ForEach-Object { $AllCruxes[$_].NodeIds } | Where-Object { $_ } |
            ForEach-Object { $_ } | Select-Object -Unique)

        $AggregatedCruxes.Add([ordered]@{
            id                 = "crux-$('{0:D3}' -f $CruxNum)"
            statement          = $Canonical.Statement
            type               = $MajorityType
            sources            = $Sources
            linked_node_ids    = $LinkedNodes
            frequency          = $UniqueDebates.Count
            resolution_summary = [ordered]@{
                resolved    = $Resolved
                active      = $Active
                irreducible = $Irreducible
            }
        })
    }

    Write-Host "  Built $($AggregatedCruxes.Count) aggregated cruxes"

    # ── Phase 4: Link cruxes to taxonomy nodes via embedding similarity ───────
    Write-Host 'Phase 4: Linking cruxes to taxonomy nodes...' -ForegroundColor Cyan

    # Load node embeddings
    $EmbPath = Join-Path (Get-TaxonomyDir) 'embeddings.json'
    $NodeVecs = @{}
    if (Test-Path $EmbPath) {
        $EmbData = Get-Content -Raw $EmbPath | ConvertFrom-Json
        foreach ($Prop in $EmbData.nodes.PSObject.Properties) {
            # Only include taxonomy nodes (not policies/conflicts)
            if ($Prop.Name -match '^(acc|saf|skp|sit|cc)-') {
                $NodeVecs[$Prop.Name] = [double[]]@($Prop.Value.vector)
            }
        }
    }

    if ($NodeVecs.Count -gt 0) {
        # Embed all crux statements in one batch
        $CruxStatements = @($AggregatedCruxes | ForEach-Object { $_.statement })
        $CruxIds = @($AggregatedCruxes | ForEach-Object { $_.id })
        $CruxEmbeddings = Get-TextEmbedding -Texts $CruxStatements -Ids $CruxIds

        if ($CruxEmbeddings -and $CruxEmbeddings.Count -gt 0) {
            # Pre-build node matrix for vectorized search
            $NodeIds = @($NodeVecs.Keys)
            $NodeMatrix = @($NodeVecs.Values)

            $LinkedCount = 0
            foreach ($Crux in $AggregatedCruxes) {
                if (-not $CruxEmbeddings.ContainsKey($Crux.id)) { continue }
                $CruxVec = $CruxEmbeddings[$Crux.id]

                # Compute similarity against all nodes
                $Scores = [System.Collections.Generic.List[PSObject]]::new()
                for ($ni = 0; $ni -lt $NodeIds.Count; $ni++) {
                    $NVec = $NodeMatrix[$ni]
                    $Dot = 0.0
                    for ($k = 0; $k -lt $CruxVec.Count; $k++) { $Dot += $CruxVec[$k] * $NVec[$k] }
                    if ($Dot -ge $NodeLinkThreshold) {
                        $Scores.Add([PSCustomObject]@{ Id = $NodeIds[$ni]; Score = $Dot })
                    }
                }

                # Top N by score
                $TopNodes = @($Scores | Sort-Object Score -Descending | Select-Object -First $MaxLinkedNodes | ForEach-Object { $_.Id })
                if ($TopNodes.Count -gt 0) {
                    $Crux.linked_node_ids = $TopNodes
                    $LinkedCount++
                }
            }
            Write-Host "  $LinkedCount / $($AggregatedCruxes.Count) cruxes linked to taxonomy nodes"
        }
        else {
            Write-Host "  Crux embeddings failed — linked_node_ids will be empty" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "  No node embeddings available — skipping node linking" -ForegroundColor Yellow
    }

    # Stats
    $ByType = @{}
    foreach ($C in $AggregatedCruxes) { $ByType[$C.type] = ($ByType[$C.type] ?? 0) + 1 }
    Write-Host "  By type: $(($ByType.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key): $($_.Value)" }) -join ', ')"

    $MultiDebate = @($AggregatedCruxes | Where-Object { $_.frequency -gt 1 }).Count
    Write-Host "  Cross-debate (frequency > 1): $MultiDebate"

    if ($WhatIfPreference) {
        Write-Host "`nWhatIf: Would write $($AggregatedCruxes.Count) cruxes to $OutputPath"
        Write-Host "`nTop 10 by frequency:"
        $AggregatedCruxes | Sort-Object { $_.frequency } -Descending | Select-Object -First 10 | ForEach-Object {
            $Stmt = if ($_.statement.Length -gt 80) { $_.statement.Substring(0, 80) + '...' } else { $_.statement }
            Write-Host "  [$($_.type)] freq=$($_.frequency) $Stmt" -ForegroundColor Gray
        }
        return
    }

    # ── Write output ──────────────────────────────────────────────────────────
    $Output = [ordered]@{
        generated_at    = (Get-Date).ToString('o')
        total_cruxes    = $AggregatedCruxes.Count
        source_debates  = @($AggregatedCruxes | ForEach-Object { $_.sources } | ForEach-Object { $_.debate_id } | Select-Object -Unique).Count
        dedup_threshold = $SimilarityThreshold
        cruxes          = @($AggregatedCruxes)
    }

    if ($PSCmdlet.ShouldProcess($OutputPath, "Write $($AggregatedCruxes.Count) aggregated cruxes")) {
        $Output | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8
        Write-Host "Written to $OutputPath" -ForegroundColor Green
    }
}
