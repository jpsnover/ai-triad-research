# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-OrgClaimMatching {
    <#
    .SYNOPSIS
        Stages 2+3 of t/1553 — match Stage 1 org stance claims to taxonomy nodes
        via embedding cosine, then aggregate to proposed ADVOCATES_FOR / OPPOSES
        edges.
    .DESCRIPTION
        Reads organization_stance_claims.json (Stage 1 output), computes
        canonical_proposition embeddings via embed_taxonomy.py batch-encode,
        and does top-K cosine search against the taxonomy-node embedding set.
        Aggregates matches per (org, node, polarity) and emits a proposed edge
        when either:

          - MinAgreement or more INDEPENDENT claims agree
            (independence: distinct doc-families — see -FamilyKey rule below),
                                                                   OR
          - one claim's cosine ≥ MatchThreshold.

        polarity=asserts → ADVOCATES_FOR; polarity=opposes → OPPOSES.

        Every proposal lands with status='proposed' via Import-OrganizationEdge.
        Zero auto-approval (t/1553 AC #5). Existing (org, node, type) tuples in
        any status are treated as covered and skipped, unless -Force.

        The 0.67/0.33 embedding variant (t/524 grid-search optimum) is the
        expected input. Generate with:

          python scripts/embed_taxonomy.py generate \
              --field-weights 0.67,0.33,0,0,0 \
              --output <path-to-embeddings-orgstance-6733.json>

        Confidence NOT used in gating (CL decision, t/1553#14): the 0.9-1.0
        extraction_confidence band is non-discriminating, so it's dropped
        from Stage 3.

        Per CL's calibration note (t/1553#12): document-family variants (RMF
        playbook, CAISI variants, etc.) are ONE independence unit for the
        MinAgreement rule. Family key: strip trailing '-YYYY(-N)?' from source_id.

        Per t/1553#18: the return object carries a .NegationSlice list with the
        top-K matches for every claim whose proposition contains a
        negated deontic — embeddings are weak at negation, so these are the
        highest-risk slice for landing on directional-opposite nodes.
    .PARAMETER ClaimsPath
        Stage 1 claims JSON. Defaults to <taxonomy-dir>/organization_stance_claims.json.
    .PARAMETER EmbeddingsPath
        0.67/0.33 field-weight embedding set (the t/524 variant). Required.
    .PARAMETER MatchThreshold
        Single-claim cosine floor for high-precision proposal. Default: 0.60
        (t/1553 stipulated).
    .PARAMETER MinAgreement
        Minimum independent claims agreeing on (node, polarity) to propose
        without meeting -MatchThreshold. Default: 2 (t/1553 stipulated).
    .PARAMETER PerOrgCap
        Maximum proposed edges written per organization per run. Default: 20.
    .PARAMETER TopK
        Top matches to keep per claim. Default: 5.
    .PARAMETER Org
        Restrict to specific org id(s).
    .PARAMETER WriteProposals
        Write proposed edges via Import-OrganizationEdge. Without this switch,
        the cmdlet reports what it would emit but does not touch the edge
        store — always default to dry-run for review.
    .PARAMETER Force
        Emit proposals even when a (org, node, type) tuple already exists in
        the edge store. Never touches approved/disputed rows unless combined
        with a manual delete — this only overrides the has-any-status skip.
    .PARAMETER SkipDirectionalGate
        Disable the directional-agreement gate (t/2745). By default every
        surviving proposal is reconciled against the matched node's proposition
        via NLI before it is kept: a claim asserting ¬(node) flips
        ADVOCATES_FOR→OPPOSES, and an unresolved direction drops the edge. Use
        this switch only where the NLI model is unavailable, or to isolate the
        aggregation logic in tests — it restores the pre-gate polarity-only
        behavior and can persist polarity-inverted edges.
    .PARAMETER DirectionalMinMargin
        Extra confidence floor (NLI top-1 vs top-2 logit margin) for the gate.
        Default 0.0 — defer to the engine's own NLI_CONFIDENCE_MARGIN gate. The
        τ value registered under t/2744 is wired in here once TL-approved.
    .EXAMPLE
        Invoke-OrgClaimMatching -EmbeddingsPath ../ai-triad-data/taxonomy/Origin/embeddings-orgstance-6733.json
    .EXAMPLE
        Invoke-OrgClaimMatching -EmbeddingsPath ...-6733.json -WriteProposals -Org org-014
    .LINK
        Show-AITriadHelp
    .LINK
        Invoke-OrgDerivedCampScores
    .LINK
        Invoke-OrgPublishedSeeding
    .LINK
        Invoke-OrgStanceExtraction
    .LINK
        Get-Organization
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter()]
        [string]$ClaimsPath,

        [Parameter(Mandatory)]
        [string]$EmbeddingsPath,

        [Parameter()]
        [ValidateRange(0.0, 1.0)]
        [double]$MatchThreshold = 0.60,

        [Parameter()]
        [ValidateRange(1, 20)]
        [int]$MinAgreement = 2,

        [Parameter()]
        [ValidateRange(1, 100)]
        [int]$PerOrgCap = 20,

        [Parameter()]
        [ValidateRange(1, 20)]
        [int]$TopK = 5,

        [Parameter()]
        [string[]]$Org,

        [Parameter()]
        [switch]$WriteProposals,

        [Parameter()]
        [switch]$Force,

        [Parameter()]
        [switch]$SkipDirectionalGate,

        [Parameter()]
        [ValidateRange(0.0, 1000.0)]
        [double]$DirectionalMinMargin = 0.0
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Load claims ──────────────────────────────────────────────────────
    if (-not $ClaimsPath) {
        $ClaimsPath = Join-Path (Get-TaxonomyDir) 'organization_stance_claims.json'
    }
    if (-not (Test-Path $ClaimsPath)) {
        throw (New-ActionableError `
            -Goal 'Match org claims to nodes' `
            -Problem "Claims file not found: $ClaimsPath" `
            -Location 'Invoke-OrgClaimMatching' `
            -NextSteps @('Run Invoke-OrgStanceExtraction first',
                         'Or pass -ClaimsPath explicitly'))
    }
    $claimStore = Get-Content $ClaimsPath -Raw | ConvertFrom-Json
    $claims = if ($claimStore.PSObject.Properties['claims']) { @($claimStore.claims) } else { @() }

    if ($Org -and $Org.Count -gt 0) {
        $wanted = @($Org)
        $claims = @($claims | Where-Object { [string]$_.org_id -in $wanted })
    }
    $totalClaims = @($claims).Count
    Write-Verbose "Claims after -Org filter: $totalClaims"
    if ($totalClaims -eq 0) {
        Write-Host 'No claims match the filter — nothing to do.'
        return [PSCustomObject]@{ Proposed = 0; ProposalsWouldEmit = 0; ClaimsProcessed = 0 }
    }

    # ── Load embeddings (nodes only — skip policies/conflicts) ───────────
    if (-not (Test-Path $EmbeddingsPath)) {
        throw (New-ActionableError `
            -Goal 'Load embeddings' `
            -Problem "Embeddings file not found: $EmbeddingsPath" `
            -Location 'Invoke-OrgClaimMatching' `
            -NextSteps @('Regenerate with python scripts/embed_taxonomy.py generate --field-weights 0.67,0.33,0,0,0 --output <path>'))
    }
    $embStore = Get-Content $EmbeddingsPath -Raw | ConvertFrom-Json
    if (-not $embStore.PSObject.Properties['nodes']) {
        throw "Embeddings file has no 'nodes' property: $EmbeddingsPath"
    }

    # Filter to pov nodes (acc/saf/skp-BDI-NNN). Skip policies (pol-*),
    # conflicts (conflict-*), and cross-cutting sit/cc rows.
    $nodeIds = [System.Collections.Generic.List[string]]::new()
    $nodeVecs = [System.Collections.Generic.List[double[]]]::new()
    foreach ($p in $embStore.nodes.PSObject.Properties) {
        $id = [string]$p.Name
        if ($id -notmatch '^(acc|saf|skp)-(beliefs|desires|intentions)-\d+$') { continue }
        $node = $p.Value
        # Node values are structured records with .vector (weighted composite).
        if (-not $node.PSObject.Properties['vector']) { continue }
        $vec = @($node.vector | ForEach-Object { [double]$_ })
        $nodeIds.Add($id)
        $nodeVecs.Add([double[]]$vec)
    }
    Write-Verbose "Node embeddings loaded: $($nodeIds.Count)"

    # ── Batch-encode claim propositions via embed_taxonomy.py ────────────
    $repoRoot   = $script:RepoRoot
    $embScript  = Join-Path $repoRoot 'scripts' 'embed_taxonomy.py'
    $encodeInput = [System.Collections.Generic.List[PSObject]]::new()
    for ($ei = 0; $ei -lt $totalClaims; $ei++) {
        $c = $claims[$ei]
        $key = "$($c.org_id)::$($c.source_id)::$ei"
        $encodeInput.Add([PSCustomObject]@{ id = $key; text = [string]$c.canonical_proposition })
    }
    $stdin = ($encodeInput | ConvertTo-Json -Compress -Depth 4)
    Write-Verbose "Batch-encoding $($encodeInput.Count) claim propositions..."
    $global:LASTEXITCODE = 0
    $encoded = $stdin | & python $embScript batch-encode 2>$null
    $exit = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
    if ($exit -ne 0 -or -not $encoded) {
        throw (New-ActionableError `
            -Goal 'Batch-encode claim propositions' `
            -Problem 'embed_taxonomy.py batch-encode failed' `
            -Location 'Invoke-OrgClaimMatching' `
            -NextSteps @('Verify python + sentence-transformers install',
                         "Try: python $embScript encode 'test string'"))
    }
    $claimVecs = ($encoded | Out-String | ConvertFrom-Json)

    # ── Top-K cosine per claim ───────────────────────────────────────────
    $matchPerClaim = [System.Collections.Generic.List[PSObject]]::new()
    $doubleMarkPattern = '(?i)(\b(oppose|reject|resist|against|least promising)\b|\b(ought|should|must|need|shall|may)\s+not\b)'
    $negationSlice = [System.Collections.Generic.List[PSObject]]::new()

    $familyKeyPattern = '-(?<year>\d{4})(-\d+)?$'

    for ($i = 0; $i -lt $totalClaims; $i++) {
        $claim = $claims[$i]
        $key   = "$($claim.org_id)::$($claim.source_id)::$i"
        if (-not $claimVecs.PSObject.Properties[$key]) {
            Write-Warning "Missing embedding for $key — skipping"
            continue
        }
        $qv = @($claimVecs.$key | ForEach-Object { [double]$_ })
        $qvArr = [double[]]$qv

        # Cosine — vectors from batch-encode are L2-normalized, node vectors
        # from generate are also normalized. So dot product = cosine.
        $scores = [System.Collections.Generic.List[PSObject]]::new()
        for ($j = 0; $j -lt $nodeIds.Count; $j++) {
            $nv = $nodeVecs[$j]
            $s = 0.0
            for ($k = 0; $k -lt $qvArr.Length; $k++) { $s += $qvArr[$k] * $nv[$k] }
            $scores.Add([PSCustomObject]@{ NodeId = $nodeIds[$j]; Score = $s })
        }
        $top = @($scores | Sort-Object -Property Score -Descending | Select-Object -First $TopK)

        $sourceId = [string]$claim.source_id
        $family = $sourceId -replace $familyKeyPattern, ''
        $matchPerClaim.Add([PSCustomObject]@{
            OrgId       = [string]$claim.org_id
            SourceId    = $sourceId
            Family      = $family
            Polarity    = [string]$claim.polarity
            Proposition = [string]$claim.canonical_proposition
            Top         = @($top)
            Best        = $top[0]
        })

        # Negation slice (t/1553#18): flag any claim whose proposition matches
        # the double-mark pattern, regardless of polarity. Embeddings are weak
        # at negation so these are the top-K rows CL wants to eyeball.
        if ([string]$claim.canonical_proposition -match $doubleMarkPattern) {
            $negationSlice.Add([PSCustomObject]@{
                OrgId       = [string]$claim.org_id
                SourceId    = $sourceId
                Polarity    = [string]$claim.polarity
                Proposition = [string]$claim.canonical_proposition
                Top         = @($top)
            })
        }
    }

    # ── Existing edges to skip ───────────────────────────────────────────
    $existingKeys = @{}
    try {
        $edgeStore = Get-OrganizationEdgesStore
        if ($edgeStore -and $edgeStore.PSObject.Properties['edges']) {
            foreach ($e in @($edgeStore.edges)) {
                if (-not $e.PSObject.Properties['source'] -or
                    -not $e.PSObject.Properties['target'] -or
                    -not $e.PSObject.Properties['type']) { continue }
                $k = "$([string]$e.source)::$([string]$e.target)::$([string]$e.type)"
                $existingKeys[$k] = $true
            }
        }
    } catch {
        Write-Verbose "No edge store readable (fresh install?) — treating all tuples as new"
    }

    # ── Aggregate to proposals ───────────────────────────────────────────
    # Bucket key: (org, node, polarity). For each bucket, dedup by family,
    # then apply MinAgreement / MatchThreshold rules.
    $buckets = @{}
    foreach ($m in $matchPerClaim) {
        # Only the BEST node per claim participates in aggregation
        # (top-K rows are retained for reporting; aggregation uses the argmax).
        $bkey = "$($m.OrgId)::$($m.Best.NodeId)::$($m.Polarity)"
        if (-not $buckets.ContainsKey($bkey)) {
            $buckets[$bkey] = [System.Collections.Generic.List[PSObject]]::new()
        }
        $buckets[$bkey].Add($m)
    }

    $proposals = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($bkey in $buckets.Keys) {
        $items = $buckets[$bkey]
        $orgId    = ($items[0]).OrgId
        $nodeId   = ($items[0]).Best.NodeId
        $polarity = ($items[0]).Polarity
        # PROVISIONAL edge type from the org's own polarity only. The directional
        # gate below (t/2745) reconciles it against the matched node's proposition
        # before any edge is kept — a claim that asserts ¬(node) flips
        # ADVOCATES_FOR→OPPOSES; an unresolved direction drops the edge.
        $edgeType = if ($polarity -eq 'asserts') { 'ADVOCATES_FOR' } else { 'OPPOSES' }

        # Independence: family-dedup
        $families = @($items | ForEach-Object { $_.Family } | Sort-Object -Unique)
        $independence = $families.Count

        # Gate:
        # (a) independent-claims rule: >= MinAgreement DISTINCT families,
        # (b) single-claim threshold: any item's Best.Score >= MatchThreshold.
        $bestScore = ($items | Measure-Object -Property { $_.Best.Score } -Maximum).Maximum
        $meetsA = $independence -ge $MinAgreement
        $meetsB = $bestScore -ge $MatchThreshold
        if (-not ($meetsA -or $meetsB)) { continue }

        # (existing-edge skip is deferred to after directional reconciliation,
        #  because a flip changes the (org, node, type) tuple it keys on.)

        # Representative claim proposition = the highest-cosine item in the
        # bucket (the pair the directional gate judges for this proposal).
        $repProp = (@($items | Sort-Object -Property { $_.Best.Score } -Descending)[0]).Proposition

        # Rationale + source_refs bundle
        $reason = if ($meetsA -and $meetsB) { 'multi-claim-agreement+high-cosine' }
                  elseif ($meetsA) { 'multi-claim-agreement' }
                  else { 'high-cosine' }
        $summary = "match_basis=$reason families=$independence best_cosine={0:N3} (t/1553 Stage 3)" -f $bestScore

        $srcRefs = @($items | ForEach-Object { $_.SourceId } | Sort-Object -Unique)

        $proposals.Add([PSCustomObject]@{
            OrgId       = $orgId
            NodeId      = $nodeId
            EdgeType    = $edgeType
            Polarity    = $polarity
            RepProp     = [string]$repProp
            Direction   = 'skipped'
            DirConfidence = $null
            DirMethod   = 'skipped'
            Reason      = $reason
            BestCosine  = $bestScore
            Independent = $independence
            ClaimCount  = $items.Count
            SourceRefs  = @($srcRefs)
            Rationale   = $summary
            Items       = @($items)
        })
    }

    # ── Directional reconciliation (t/2745, V1) ──────────────────────────
    # Before any edge is kept, verify the claim proposition's DIRECTION vs the
    # matched node's proposition. Embedding cosine picked the node by topic; it
    # cannot tell "asserts P" from "asserts ¬P". The shared gate supplies that
    # signal (NLI). The final edge type is the org's stance toward its OWN claim
    # (polarity) reconciled with whether the claim asserts or negates the node:
    #
    #   orgAssertsNode = (orgAssertsClaim) XNOR (claimAssertsNode)
    #   ADVOCATES_FOR when orgAssertsNode, else OPPOSES.
    #
    # 'unresolved' / 'unrelated' => drop the edge (never persist an unverified
    # stance). Off only under -SkipDirectionalGate (environments without the NLI
    # model / callers that isolate the aggregation logic).
    $directionalDropped = [System.Collections.Generic.List[PSObject]]::new()
    $directionalFlipped = 0
    if (-not $SkipDirectionalGate -and $proposals.Count -gt 0) {
        # Node proposition text (label + Core description) from loaded taxonomy.
        $nodeTextById = @{}
        foreach ($pov in $script:TaxonomyData.Values) {
            if (-not $pov.PSObject.Properties['nodes']) { continue }
            foreach ($n in @($pov.nodes)) {
                if (-not $n.PSObject.Properties['id']) { continue }
                $lbl = if ($n.PSObject.Properties['label']) { [string]$n.label } else { '' }
                $dsc = if ($n.PSObject.Properties['description'] -and $n.description) { [string]$n.description } else { '' }
                $nodeTextById[[string]$n.id] = if ($dsc) { "$lbl — $dsc" } else { $lbl }
            }
        }

        $gatePairs = [System.Collections.Generic.List[PSObject]]::new()
        for ($pi = 0; $pi -lt $proposals.Count; $pi++) {
            $prop = $proposals[$pi]
            $nodeText = if ($nodeTextById.ContainsKey([string]$prop.NodeId)) { $nodeTextById[[string]$prop.NodeId] } else { '' }
            $gatePairs.Add([PSCustomObject]@{ Id = $pi; ClaimProp = $prop.RepProp; NodeProp = $nodeText })
        }

        $verdicts = Test-DirectionalAgreement -Pair @($gatePairs) -MinMargin $DirectionalMinMargin
        $verdictByIdx = @{}
        foreach ($v in @($verdicts)) { $verdictByIdx[[int]$v.Id] = $v }

        $reconciled = [System.Collections.Generic.List[PSObject]]::new()
        for ($pi = 0; $pi -lt $proposals.Count; $pi++) {
            $prop = $proposals[$pi]
            $v = if ($verdictByIdx.ContainsKey($pi)) { $verdictByIdx[$pi] } else { $null }
            $direction = if ($v) { [string]$v.Direction } else { 'unresolved' }
            $prop.Direction     = $direction
            $prop.DirConfidence = if ($v) { $v.Confidence } else { 0.0 }
            $prop.DirMethod     = if ($v) { [string]$v.Method } else { 'none' }

            if ($direction -ne 'agrees' -and $direction -ne 'opposes') {
                # unresolved / unrelated → never persist an unverified stance.
                $directionalDropped.Add($prop)
                continue
            }

            $orgAssertsClaim = ($prop.Polarity -eq 'asserts')
            $claimAssertsNode = ($direction -eq 'agrees')
            $orgAssertsNode  = ($orgAssertsClaim -eq $claimAssertsNode)   # XNOR
            $finalType = if ($orgAssertsNode) { 'ADVOCATES_FOR' } else { 'OPPOSES' }
            if ($finalType -ne $prop.EdgeType) {
                $directionalFlipped++
                $prop.Rationale = "$($prop.Rationale) directional_flip=$($prop.EdgeType)->$finalType nli_dir=$direction"
                $prop.EdgeType = $finalType
            } else {
                $prop.Rationale = "$($prop.Rationale) directional_ok nli_dir=$direction"
            }
            $reconciled.Add($prop)
        }
        $proposals = $reconciled
    }

    # ── Existing-edge skip (keyed on the FINAL, reconciled edge type) ─────
    if (-not $Force) {
        $kept = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($prop in $proposals) {
            $existingCheckKey = "$($prop.OrgId)::$($prop.NodeId)::$($prop.EdgeType)"
            if ($existingKeys.ContainsKey($existingCheckKey)) { continue }
            $kept.Add($prop)
        }
        $proposals = $kept
    }

    # ── Per-org cap (top by best cosine) ─────────────────────────────────
    $capped = [System.Collections.Generic.List[PSObject]]::new()
    $dropped = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($grp in ($proposals | Group-Object -Property OrgId)) {
        $ordered = @($grp.Group | Sort-Object -Property BestCosine -Descending)
        $keep = $ordered | Select-Object -First $PerOrgCap
        $skip = $ordered | Select-Object -Skip $PerOrgCap
        foreach ($p in $keep) { $capped.Add($p) }
        foreach ($p in $skip) { $dropped.Add($p) }
    }

    # ── Emit or dry-run report ──────────────────────────────────────────
    $written = 0
    $failed  = [System.Collections.Generic.List[string]]::new()
    if ($WriteProposals) {
        foreach ($p in $capped) {
            $target = "$($p.OrgId)->$($p.NodeId) [$($p.EdgeType)]"
            if ($PSCmdlet.ShouldProcess($target, 'Propose org→node edge')) {
                try {
                    $null = Import-OrganizationEdge -InputObject ([PSCustomObject]@{
                        source        = $p.OrgId
                        target        = $p.NodeId
                        type          = $p.EdgeType
                        rationale     = $p.Rationale
                        source_refs   = @($p.SourceRefs)
                        status        = 'proposed'
                        discovered_at = (Get-Date).ToString('yyyy-MM-dd')
                    }) -Confirm:$false
                    $written++
                } catch {
                    $failed.Add("$($p.OrgId)->$($p.NodeId): $($_.Exception.Message)")
                    Write-Warning "Failed to write proposal $($p.OrgId)->$($p.NodeId): $($_.Exception.Message)"
                }
            }
        }
    }

    $gateNote = if ($SkipDirectionalGate) { 'gate=OFF' } else { "gate: flipped=$directionalFlipped dropped=$($directionalDropped.Count)" }
    Write-Host ""
    if ($WriteProposals) {
        Write-Host "Claims: $totalClaims | Proposals: $($capped.Count) (wrote $written) | Dropped by cap: $($dropped.Count) | Negation-slice: $($negationSlice.Count) | $gateNote"
    } else {
        Write-Host "Claims: $totalClaims | Proposals (dry-run): $($capped.Count) | Dropped by cap: $($dropped.Count) | Negation-slice: $($negationSlice.Count) | $gateNote"
    }

    [PSCustomObject]@{
        ClaimsProcessed     = $totalClaims
        ProposalsWouldEmit  = $capped.Count
        Proposed            = $written
        DroppedByCap        = @($dropped)
        Proposals           = @($capped)
        NegationSlice       = @($negationSlice)
        DirectionalDropped  = @($directionalDropped)
        DirectionalFlipped  = $directionalFlipped
        DirectionalGate     = (-not $SkipDirectionalGate)
        Failed              = @($failed)
        EmbeddingsPath      = $EmbeddingsPath
    }
}
