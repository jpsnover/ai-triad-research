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
        [switch]$Force
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

        # Skip existing
        $existingCheckKey = "$orgId::$nodeId::$edgeType"
        if (-not $Force -and $existingKeys.ContainsKey($existingCheckKey)) { continue }

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
            Reason      = $reason
            BestCosine  = $bestScore
            Independent = $independence
            ClaimCount  = $items.Count
            SourceRefs  = @($srcRefs)
            Rationale   = $summary
            Items       = @($items)
        })
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

    Write-Host ""
    if ($WriteProposals) {
        Write-Host "Claims: $totalClaims | Proposals: $($capped.Count) (wrote $written) | Dropped by cap: $($dropped.Count) | Negation-slice: $($negationSlice.Count)"
    } else {
        Write-Host "Claims: $totalClaims | Proposals (dry-run): $($capped.Count) | Dropped by cap: $($dropped.Count) | Negation-slice: $($negationSlice.Count)"
    }

    [PSCustomObject]@{
        ClaimsProcessed     = $totalClaims
        ProposalsWouldEmit  = $capped.Count
        Proposed            = $written
        DroppedByCap        = @($dropped)
        Proposals           = @($capped)
        NegationSlice       = @($negationSlice)
        Failed              = @($failed)
        EmbeddingsPath      = $EmbeddingsPath
    }
}
