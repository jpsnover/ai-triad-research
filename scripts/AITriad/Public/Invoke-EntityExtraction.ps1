# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-EntityExtraction {
    <#
    .SYNOPSIS
        Phase 1 entity ontology (t/1806) — extracts person/artifact/event/legislation/
        institution entity proposals from source_evidence_index.json facts, resolves
        each against existing records BEFORE minting, and mints only the unmatched
        remainder via Import-Entity.
    .DESCRIPTION
        Mirrors Invoke-OrgStanceExtraction's structure (t/1553 Stage 1): per-node AI
        calls (parallel, sequential merge), an idempotence sidecar, fence-stripped
        JSON parsing, and a post-parse validator that drops malformed items into a
        counted bucket rather than failing the run.

        Corpus: source_evidence_index.json (a dict keyed by node id; each entry has
        `facts[]` with `claim` text). Per node, calls the `enrichment.entity-extraction`
        UsageID with template vars {{node_id}} and {{facts}} (the node's claim texts).
        The UsageID does not exist in ai-usages.json yet (t/1819 is its go-live
        dependency) — a preflight guard fails actionably rather than letting
        Get-UsageConfig's generic "not found" error surface.

        Response shape: `proposals[]{name, entity_type, aliases[], quote, confidence}`
        plus `org_mentions[]{name}` (captured for traceability only — Phase 1 mints
        no organization records and creates no links from org_mentions).

        entity_type -> dolce_category (frozen mapping, lib/entities/types.ts):
          person -> agentive-physical-object
          artifact -> non-agentive-functional-artifact
          event -> perdurant
          legislation -> normative-description
          institution -> non-agentive-social-object

        CONFIDENCE GATE (stipulated, design t/1806): proposals below -ConfidenceThreshold
        (default 0.6) are dropped and counted, never minted. Proposals in
        [-ConfidenceThreshold, -ConfidenceThreshold + -NearGateBand) are minted but
        flagged `near_gate` in the run report — a human reviewer prompt, not a rejection.

        PERSON EXCEPTION: person proposals are minted with NO `description` — Import-Entity
        already blocks *approving* a person without a human-authored description, but this
        cmdlet never even offers one, for any entity_type (Phase 1's schema carries no
        genus-differentia description field; `quote` is evidence, not a description, and is
        never repurposed as one).

        RESOLUTION BEFORE MINTING (per proposal, name/aliases normalized to
        lowercase+trim+collapse-whitespace):
          1. Exact/alias match against existing entities (name+aliases), organizations
             (name+short_name), taxonomy node labels (acc/saf/skp/situations), the
             dictionary (colloquial_term + standardized canonical_form), and policy
             actions (action text).
          2. Cosine >= -LinkSimilarityThreshold (default 0.60) against EXISTING ENTITY
             vectors only (entity_embeddings.json).
          A match records a `linked` disposition in the run report and mints nothing —
          links are Phase 2. An unmatched proposal is queued for minting; two proposals
          (from the same or different nodes) that normalize to the same new name mint
          ONCE per run (within-run dedup) and every later occurrence is recorded as
          `linked` to the id just minted. Minting happens in sub-batches of <= 20
          (Import-Entity's ValidateCount ceiling).

        IDEMPOTENCE: an entity_extraction_log.json sidecar (mirrors organization_stance_
        claims.json's role for Invoke-OrgStanceExtraction) records every successfully
        processed node id; re-runs skip them unless -Force. A node whose AI call/parse
        FAILS is never marked processed, so it is retried on the next run.
    .PARAMETER NodeId
        Restrict extraction to specific node id(s). Default: every node present in
        source_evidence_index.json with at least one fact.
    .PARAMETER MaxNodes
        Safety cap on nodes processed per run. Default: no cap.
    .PARAMETER Concurrency
        Parallel AI calls. Default 3 (same conservative default as Invoke-OrgStanceExtraction).
    .PARAMETER Force
        Re-extract for node ids that already have a log entry.
    .PARAMETER ConfidenceThreshold
        Minimum extraction_confidence to mint. Default 0.6 (stipulated, t/1806).
    .PARAMETER NearGateBand
        Width of the near-gate review window above -ConfidenceThreshold. Default 0.1
        (so [0.6, 0.7) is flagged `near_gate` when using the defaults).
    .PARAMETER LinkSimilarityThreshold
        Minimum cosine similarity against an existing entity vector to link instead
        of mint. Default 0.60.
    .PARAMETER EntitiesPath
        Override entities.json path (fixtures/tests). Defaults to Get-EntitiesFilePath.
    .PARAMETER EmbeddingsPath
        Override entity_embeddings.json path (fixtures/tests). Defaults to
        Get-EntityEmbeddingsFilePath.
    .PARAMETER SourceEvidenceIndexPath
        Override source_evidence_index.json path (fixtures/tests).
    .PARAMETER OutputPath
        Override the entity_extraction_log.json sidecar path (data-repo taxonomy/Origin
        by default).
    .EXAMPLE
        Invoke-EntityExtraction -MaxNodes 5
    .EXAMPLE
        Invoke-EntityExtraction -NodeId acc-desires-001 -Force
    .LINK
        Show-AITriadHelp
    .LINK
        Import-Entity
    .LINK
        Get-Entity
    .LINK
        Get-EntityReport
    .LINK
        Invoke-OrgStanceExtraction
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter()]
        [string[]]$NodeId,

        [Parameter()]
        [ValidateRange(1, 5000)]
        [int]$MaxNodes,

        [Parameter()]
        [ValidateRange(1, 20)]
        [int]$Concurrency = 3,

        [Parameter()]
        [switch]$Force,

        [Parameter()]
        [ValidateRange(0.0, 1.0)]
        [double]$ConfidenceThreshold = 0.6,

        [Parameter()]
        [ValidateRange(0.0, 1.0)]
        [double]$NearGateBand = 0.1,

        [Parameter()]
        [ValidateRange(0.0, 1.0)]
        [double]$LinkSimilarityThreshold = 0.60,

        [Parameter()]
        [string]$EntitiesPath,

        [Parameter()]
        [string]$EmbeddingsPath,

        [Parameter()]
        [string]$SourceEvidenceIndexPath,

        [Parameter()]
        [Alias('Path')]
        [string]$OutputPath
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $UsageId = 'enrichment.entity-extraction'

    # ── Runtime guard (t/1806): the UsageID is local-only until t/1819 lands it in
    # ai-usages.json. Get-UsageConfig's generic "not found" error is accurate but
    # unhelpful here — a premature live run should fail pointing at the real cause. ──
    $UsageResolves = $false
    try {
        $Registry = Get-UsageRegistry
        $UsageResolves = [bool]$Registry.PSObject.Properties[$UsageId]
    } catch {
        $UsageResolves = $false
    }
    if (-not $UsageResolves) {
        throw (New-ActionableError -PassThru `
            -Goal 'Extract entity proposals from source evidence' `
            -Problem "UsageID '$UsageId' is not registered in ai-usages.json" `
            -Location 'Invoke-EntityExtraction' `
            -NextSteps @(
                'Land t/1819 (enrichment.entity-extraction go-live) to register the UsageID',
                "Verify with: (Get-UsageRegistry).PSObject.Properties.Name | Where-Object { `$_ -eq '$UsageId' }",
                'Do not hand-add the UsageID outside t/1819 — its responseSchema/model choice is that ticket''s design surface'
            ))
    }

    # ── Resolve paths ─────────────────────────────────────────────────────────────
    $TaxDir = Get-TaxonomyDir
    $SeiPath = if ($SourceEvidenceIndexPath) { $SourceEvidenceIndexPath } else { Join-Path $TaxDir 'source_evidence_index.json' }
    if (-not (Test-Path $SeiPath)) {
        throw (New-ActionableError -PassThru `
            -Goal 'Extract entity proposals from source evidence' `
            -Problem "source_evidence_index.json not found at $SeiPath" `
            -Location 'Invoke-EntityExtraction' `
            -NextSteps @(
                'Run the summary pipeline first — source_evidence_index.json is a pipeline output',
                'Verify .aitriad.json or $env:AI_TRIAD_DATA_ROOT for a data-root override'
            ))
    }

    $EntPath = if ($EntitiesPath) { $EntitiesPath } else { Get-EntitiesFilePath }
    $EmbPath = if ($EmbeddingsPath) { $EmbeddingsPath } else { Get-EntityEmbeddingsFilePath }
    if (-not $OutputPath) { $OutputPath = Join-Path $TaxDir 'entity_extraction_log.json' }

    $DolceMap = @{
        person       = 'agentive-physical-object'
        artifact     = 'non-agentive-functional-artifact'
        event        = 'perdurant'
        legislation  = 'normative-description'
        institution  = 'non-agentive-social-object'
    }

    $Normalize = { param($s) (([string]$s).Trim().ToLowerInvariant() -replace '\s+', ' ') }

    # ── Build the exact/alias match index (entities, orgs, taxonomy labels, dictionary,
    # policy actions). First-writer-wins on a normalized-string collision (rare, and
    # any hit is a legitimate reason to link-not-mint). ─────────────────────────────
    $MatchIndex = @{}   # normalized string -> PSCustomObject{ Kind; Id; Label }
    $AddMatch = {
        param($Text, $Kind, $Id, $Label)
        if ([string]::IsNullOrWhiteSpace($Text)) { return }
        $n = & $Normalize $Text
        if ([string]::IsNullOrEmpty($n)) { return }
        if (-not $MatchIndex.ContainsKey($n)) {
            $MatchIndex[$n] = [PSCustomObject]@{ Kind = $Kind; Id = $Id; Label = $Label }
        }
    }.GetNewClosure()

    $EntitiesStore = Get-EntitiesStore -Path $EntPath -InitIfMissing
    $ExistingEntities = if ($EntitiesStore.PSObject.Properties['entities']) { @($EntitiesStore.entities) } else { @() }
    foreach ($e in $ExistingEntities) {
        if (-not $e.PSObject.Properties['id']) { continue }
        & $AddMatch ([string]$e.name) 'entity' ([string]$e.id) ([string]$e.name)
        if ($e.PSObject.Properties['aliases']) {
            foreach ($a in @($e.aliases)) { & $AddMatch ([string]$a) 'entity' ([string]$e.id) ([string]$e.name) }
        }
    }

    try {
        $OrgStore = Get-OrganizationsStore
        $Orgs = if ($OrgStore.PSObject.Properties['organizations']) { @($OrgStore.organizations) } else { @() }
        foreach ($o in $Orgs) {
            if (-not $o.PSObject.Properties['id']) { continue }
            & $AddMatch ([string]$o.name) 'organization' ([string]$o.id) ([string]$o.name)
            if ($o.PSObject.Properties['short_name']) { & $AddMatch ([string]$o.short_name) 'organization' ([string]$o.id) ([string]$o.name) }
        }
    } catch { Write-Verbose "Invoke-EntityExtraction: organizations.json unavailable — $($_.Exception.Message)" }

    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        try {
            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
            foreach ($n in @($FileData.nodes)) {
                if (-not $n.PSObject.Properties['id']) { continue }
                $lbl = if ($n.PSObject.Properties['label']) { [string]$n.label } else { '' }
                & $AddMatch $lbl 'node' ([string]$n.id) $lbl
            }
        } catch { Write-Verbose "Invoke-EntityExtraction: failed to load $PovKey.json — $($_.Exception.Message)" }
    }

    $DictRoot = Join-Path (Get-DataRoot) 'dictionary'
    foreach ($SubDir in @('standardized', 'colloquial')) {
        $D = Join-Path $DictRoot $SubDir
        if (-not (Test-Path $D)) { continue }
        foreach ($F in Get-ChildItem -Path $D -Filter '*.json' -ErrorAction SilentlyContinue) {
            try {
                $Term = Get-Content -Raw -Path $F.FullName | ConvertFrom-Json
                if ($SubDir -eq 'standardized' -and $Term.PSObject.Properties['canonical_form']) {
                    & $AddMatch ([string]$Term.canonical_form) 'term' ([string]$Term.canonical_form) ([string]$Term.canonical_form)
                } elseif ($SubDir -eq 'colloquial' -and $Term.PSObject.Properties['colloquial_term']) {
                    & $AddMatch ([string]$Term.colloquial_term) 'term' ([string]$Term.colloquial_term) ([string]$Term.colloquial_term)
                }
            } catch { Write-Verbose "Invoke-EntityExtraction: failed to parse $($F.Name) — $($_.Exception.Message)" }
        }
    }

    $PolicyPath = Join-Path $TaxDir 'policy_actions.json'
    if (Test-Path $PolicyPath) {
        try {
            $PolicyReg = Get-Content -Raw -Path $PolicyPath | ConvertFrom-Json
            foreach ($p in @($PolicyReg.policies)) {
                if (-not $p.PSObject.Properties['id']) { continue }
                & $AddMatch ([string]$p.action) 'policy' ([string]$p.id) ([string]$p.action)
            }
        } catch { Write-Verbose "Invoke-EntityExtraction: failed to parse policy_actions.json — $($_.Exception.Message)" }
    }

    # Existing entity vectors — cosine fallback is scoped to entities ONLY (design).
    $EntityVectors = @{}
    if (Test-Path $EmbPath) {
        try {
            $EmbStore = Get-Content -Raw -Path $EmbPath -Encoding utf8 | ConvertFrom-Json
            if ($EmbStore.PSObject.Properties['vectors']) {
                foreach ($prop in $EmbStore.vectors.PSObject.Properties) {
                    $EntityVectors[$prop.Name] = [double[]]@($prop.Value)
                }
            }
        } catch { Write-Verbose "Invoke-EntityExtraction: failed to load entity_embeddings.json — $($_.Exception.Message)" }
    }
    $EntityNameById = @{}
    foreach ($e in $ExistingEntities) {
        if ($e.PSObject.Properties['id']) { $EntityNameById[[string]$e.id] = [string]$e.name }
    }

    # ── Load source evidence index ──────────────────────────────────────────────────
    $Sei = Get-Content -Raw -Path $SeiPath | ConvertFrom-Json -AsHashtable

    # ── Idempotence log ──────────────────────────────────────────────────────────────
    $ProcessedNodeIds = @{}
    $ExistingLogNodes = [System.Collections.Generic.List[PSObject]]::new()
    if (Test-Path $OutputPath) {
        $PrevLog = Get-Content -Raw -Path $OutputPath | ConvertFrom-Json
        if ($PrevLog.PSObject.Properties['nodes']) {
            foreach ($n in @($PrevLog.nodes)) {
                $ExistingLogNodes.Add($n)
                if ($n.PSObject.Properties['node_id']) { $ProcessedNodeIds[[string]$n.node_id] = 1 }
            }
        }
    }

    # ── Build work list ──────────────────────────────────────────────────────────────
    $WantedNodes = if ($NodeId) { [System.Collections.Generic.HashSet[string]]::new([string[]]$NodeId) } else { $null }
    $WorkItems = [System.Collections.Generic.List[PSObject]]::new()
    $SkippedNoFacts = 0
    $SkippedAlreadyDone = 0

    foreach ($Nid in ($Sei.Keys | Sort-Object)) {
        if ($WantedNodes -and -not $WantedNodes.Contains($Nid)) { continue }
        if (-not $Force -and $ProcessedNodeIds.ContainsKey($Nid)) { $SkippedAlreadyDone++; continue }

        $Entry = $Sei[$Nid]
        $Facts = if ($Entry -is [hashtable] -and $Entry.ContainsKey('facts') -and $Entry['facts']) { @($Entry['facts']) } else { @() }
        $Claims = [System.Collections.Generic.List[string]]::new()
        $DocIds = [System.Collections.Generic.List[string]]::new()
        foreach ($f in $Facts) {
            if ($f -isnot [hashtable]) { continue }
            if ($f.ContainsKey('claim') -and $f['claim']) { $Claims.Add([string]$f['claim']) }
            if ($f.ContainsKey('doc_id') -and $f['doc_id']) { $DocIds.Add([string]$f['doc_id']) }
        }
        if ($Claims.Count -eq 0) { $SkippedNoFacts++; continue }

        $FactsText = ($Claims | ForEach-Object { "- $_" }) -join "`n"
        $WorkItems.Add([PSCustomObject]@{
            NodeId    = $Nid
            FactsText = $FactsText
            DocIds    = @($DocIds | Select-Object -Unique)
        })
    }

    if ($MaxNodes -and $WorkItems.Count -gt $MaxNodes) {
        $WorkItems = [System.Collections.Generic.List[PSObject]]($WorkItems | Select-Object -First $MaxNodes)
    }

    $Total = @($WorkItems).Count
    Write-Verbose "Work items: $Total (skipped no-facts: $SkippedNoFacts, already-done: $SkippedAlreadyDone)"

    if ($Total -eq 0) {
        Write-Host 'Nothing to extract — no nodes with facts match the filter, or all are already done.'
        return [PSCustomObject]@{
            NodesProcessed     = 0
            ProposalsTotal     = 0
            Minted             = 0
            Linked             = 0
            DroppedBelowGate   = 0
            NearGateMinted     = 0
            InvalidDropped     = 0
            Failed             = 0
            SkippedNoFacts     = $SkippedNoFacts
            SkippedAlreadyDone = $SkippedAlreadyDone
            MintedEntities     = @()
            LinkedDispositions = @()
            OutputPath         = $OutputPath
        }
    }

    if (-not $PSCmdlet.ShouldProcess("$Total node(s)", "Extract entity proposals via $UsageId")) {
        return [PSCustomObject]@{
            WouldProcess = $Total
            OutputPath   = $OutputPath
        }
    }

    # ── Extract (parallel or sequential) — AI call + shape validation ONLY. Resolution/
    # minting is sequential, after this loop (Private helpers aren't visible inside
    # -Parallel worker runspaces — same class of bug as t/1550/t/1553). ────────────────
    $RawResults = [System.Collections.Concurrent.ConcurrentBag[PSObject]]::new()
    $Failed     = [System.Collections.Concurrent.ConcurrentBag[string]]::new()
    $Invalid    = [System.Collections.Concurrent.ConcurrentBag[string]]::new()

    $ModulePath = Join-Path $script:ModuleRoot 'AITriad.psm1'
    $EnrichPath = Join-Path $script:ModuleRoot '..' 'AIEnrich.psm1'
    if (-not (Test-Path $EnrichPath)) { $EnrichPath = Join-Path $script:ModuleRoot 'AIEnrich.psm1' }
    $KnownTypes = @('person', 'artifact', 'event', 'legislation', 'institution')
    $ProgressId = 2
    $Completed  = [ref]0

    Write-Progress -Id $ProgressId -Activity 'Extracting entity proposals' -Status "0 / $Total" -PercentComplete 0

    $ProcessOne = {
        param($Item, $UsageId, $KnownTypes, $InvBag, $FailBag)
        $Node = [PSCustomObject]@{ NodeId = $Item.NodeId; DocIds = $Item.DocIds; Proposals = @(); OrgMentions = @(); Model = $null; ParseOk = $false }
        try {
            $ai = Invoke-AIByUsage -UsageId $UsageId -Values @{ node_id = $Item.NodeId; facts = $Item.FactsText }
            if ($null -ne $ai -and $ai.Text) {
                $body = [string]$ai.Text
                $body = $body -replace '^\s*```(json)?\s*', ''
                $body = $body -replace '\s*```\s*$', ''
                $parsed = $body.Trim() | ConvertFrom-Json -ErrorAction Stop
                $Node.Model = if ($ai.PSObject.Properties['Model']) { $ai.Model } else { 'gemini-3.1-flash-lite' }
                $Node.ParseOk = $true

                $validProps = [System.Collections.Generic.List[object]]::new()
                foreach ($p in @($parsed.proposals)) {
                    if ($null -eq $p) { continue }
                    $ok = $true; $reason = ''
                    $name = if ($p.PSObject.Properties['name']) { [string]$p.name } else { '' }
                    $etype = if ($p.PSObject.Properties['entity_type']) { [string]$p.entity_type } else { '' }
                    $conf = 0.0
                    if ([string]::IsNullOrWhiteSpace($name)) { $ok = $false; $reason = 'missing name' }
                    elseif ($etype -notin $KnownTypes) { $ok = $false; $reason = "entity_type '$etype' not in {$($KnownTypes -join ', ')}" }
                    elseif (-not $p.PSObject.Properties['confidence']) { $ok = $false; $reason = 'missing confidence' }
                    else {
                        try { $conf = [double]$p.confidence } catch { $ok = $false; $reason = 'confidence not numeric' }
                        if ($ok -and ($conf -lt 0.0 -or $conf -gt 1.0)) { $ok = $false; $reason = "confidence $conf out of [0,1]" }
                    }
                    if (-not $ok) {
                        $InvBag.Add("$($Item.NodeId): $reason")
                        continue
                    }
                    $aliases = if ($p.PSObject.Properties['aliases'] -and $p.aliases) { @($p.aliases | ForEach-Object { [string]$_ }) } else { @() }
                    $quote   = if ($p.PSObject.Properties['quote']) { [string]$p.quote } else { '' }
                    $validProps.Add([PSCustomObject]@{
                        name        = $name
                        entity_type = $etype
                        aliases     = $aliases
                        quote       = $quote
                        confidence  = $conf
                    })
                }
                $Node.Proposals = @($validProps)
                $Node.OrgMentions = @(
                    @($parsed.org_mentions) | Where-Object { $_ -and $_.PSObject.Properties['name'] -and $_.name } | ForEach-Object { [string]$_.name }
                )
            } else {
                $FailBag.Add("$($Item.NodeId): empty AI response")
            }
        } catch {
            $FailBag.Add("$($Item.NodeId): $($_.Exception.Message)")
        }
        return $Node
    }

    if ($Concurrency -eq 1) {
        foreach ($Item in $WorkItems) {
            $Node = & $ProcessOne $Item $UsageId $KnownTypes $Invalid $Failed
            $RawResults.Add($Node)
            $Done = [System.Threading.Interlocked]::Increment($Completed)
            $Pct  = [math]::Min(100, [math]::Round(($Done / $Total) * 100))
            Write-Progress -Id $ProgressId -Activity 'Extracting entity proposals' -Status "$Done / $Total" -PercentComplete $Pct
        }
    } else {
        $WorkItems | ForEach-Object -Parallel {
            Import-Module $using:ModulePath -Force -WarningAction SilentlyContinue
            Import-Module $using:EnrichPath -Force -WarningAction SilentlyContinue
            $Item       = $_
            $UsageIdVal = $using:UsageId
            $KnownTypesVal = $using:KnownTypes
            $RawBag     = $using:RawResults
            $FailBag    = $using:Failed
            $InvBag     = $using:Invalid
            $CompRef    = $using:Completed
            $TotalCnt   = $using:Total
            $ProgId     = $using:ProgressId

            $Node = [PSCustomObject]@{ NodeId = $Item.NodeId; DocIds = $Item.DocIds; Proposals = @(); OrgMentions = @(); Model = $null; ParseOk = $false }
            try {
                $ai = Invoke-AIByUsage -UsageId $UsageIdVal -Values @{ node_id = $Item.NodeId; facts = $Item.FactsText }
                if ($null -ne $ai -and $ai.Text) {
                    $body = [string]$ai.Text
                    $body = $body -replace '^\s*```(json)?\s*', ''
                    $body = $body -replace '\s*```\s*$', ''
                    $parsed = $body.Trim() | ConvertFrom-Json -ErrorAction Stop
                    $Node.Model = if ($ai.PSObject.Properties['Model']) { $ai.Model } else { 'gemini-3.1-flash-lite' }
                    $Node.ParseOk = $true

                    $validProps = [System.Collections.Generic.List[object]]::new()
                    foreach ($p in @($parsed.proposals)) {
                        if ($null -eq $p) { continue }
                        $ok = $true; $reason = ''
                        $name = if ($p.PSObject.Properties['name']) { [string]$p.name } else { '' }
                        $etype = if ($p.PSObject.Properties['entity_type']) { [string]$p.entity_type } else { '' }
                        $conf = 0.0
                        if ([string]::IsNullOrWhiteSpace($name)) { $ok = $false; $reason = 'missing name' }
                        elseif ($etype -notin $KnownTypesVal) { $ok = $false; $reason = "entity_type '$etype' not in {$($KnownTypesVal -join ', ')}" }
                        elseif (-not $p.PSObject.Properties['confidence']) { $ok = $false; $reason = 'missing confidence' }
                        else {
                            try { $conf = [double]$p.confidence } catch { $ok = $false; $reason = 'confidence not numeric' }
                            if ($ok -and ($conf -lt 0.0 -or $conf -gt 1.0)) { $ok = $false; $reason = "confidence $conf out of [0,1]" }
                        }
                        if (-not $ok) {
                            $InvBag.Add("$($Item.NodeId): $reason")
                            continue
                        }
                        $aliases = if ($p.PSObject.Properties['aliases'] -and $p.aliases) { @($p.aliases | ForEach-Object { [string]$_ }) } else { @() }
                        $quote   = if ($p.PSObject.Properties['quote']) { [string]$p.quote } else { '' }
                        $validProps.Add([PSCustomObject]@{
                            name        = $name
                            entity_type = $etype
                            aliases     = $aliases
                            quote       = $quote
                            confidence  = $conf
                        })
                    }
                    $Node.Proposals = @($validProps)
                    $Node.OrgMentions = @(
                        @($parsed.org_mentions) | Where-Object { $_ -and $_.PSObject.Properties['name'] -and $_.name } | ForEach-Object { [string]$_.name }
                    )
                } else {
                    $FailBag.Add("$($Item.NodeId): empty AI response")
                }
            } catch {
                $FailBag.Add("$($Item.NodeId): $($_.Exception.Message)")
            }
            $RawBag.Add($Node)

            $Done = [System.Threading.Interlocked]::Increment($CompRef)
            $Pct  = [math]::Min(100, [math]::Round(($Done / $TotalCnt) * 100))
            Write-Progress -Id $ProgId -Activity 'Extracting entity proposals' -Status "$Done / $TotalCnt" -PercentComplete $Pct
        } -ThrottleLimit $Concurrency
    }

    Write-Progress -Id $ProgressId -Activity 'Extracting entity proposals' -Completed

    # ── Sequential resolution + minting ──────────────────────────────────────────────
    $SortedResults = @($RawResults | Sort-Object -Property NodeId)

    $ProposalsTotal   = 0
    $DroppedBelowGate = 0
    $NearGateMinted   = 0
    $LinkedDispositions = [System.Collections.Generic.List[PSObject]]::new()

    # Mint candidates, deduped by normalized name WITHIN this run.
    $MintCandidates = [System.Collections.Generic.List[PSObject]]::new()
    $MintIndexByName = @{}   # normalized name -> index into $MintCandidates

    foreach ($Node in $SortedResults) {
        foreach ($p in @($Node.Proposals)) {
            $ProposalsTotal++
            if ($p.confidence -lt $ConfidenceThreshold) {
                $DroppedBelowGate++
                continue
            }
            $nearGate = ($p.confidence -lt ($ConfidenceThreshold + $NearGateBand))
            $dolce = $DolceMap[$p.entity_type]

            $normName = & $Normalize $p.name
            $normAliases = @($p.aliases | ForEach-Object { & $Normalize $_ })

            # 1) Exact/alias match against existing stores.
            $hit = $null
            if ($MatchIndex.ContainsKey($normName)) { $hit = $MatchIndex[$normName] }
            if (-not $hit) {
                foreach ($na in $normAliases) {
                    if ($MatchIndex.ContainsKey($na)) { $hit = $MatchIndex[$na]; break }
                }
            }
            if ($hit) {
                $LinkedDispositions.Add([PSCustomObject]@{
                    node_id        = $Node.NodeId
                    proposal_name  = $p.name
                    matched_kind   = $hit.Kind
                    matched_id     = $hit.Id
                    matched_label  = $hit.Label
                    reason         = 'exact-or-alias-match'
                })
                continue
            }

            # 2) Cosine against EXISTING ENTITY vectors only.
            if ($EntityVectors.Count -gt 0) {
                $probe = Get-TextEmbedding -Texts @($p.name) -Ids @('probe')
                if ($probe -and $probe.ContainsKey('probe') -and @($probe['probe']).Count -gt 0) {
                    $probeVec = [double[]]@($probe['probe'])
                    $bestSim = -1.0; $bestId = $null
                    foreach ($eid in $EntityVectors.Keys) {
                        $sim = Get-CosineSimilarity -A $probeVec -B $EntityVectors[$eid]
                        if ($sim -gt $bestSim) { $bestSim = $sim; $bestId = $eid }
                    }
                    if ($bestId -and $bestSim -ge $LinkSimilarityThreshold) {
                        $LinkedDispositions.Add([PSCustomObject]@{
                            node_id        = $Node.NodeId
                            proposal_name  = $p.name
                            matched_kind   = 'entity'
                            matched_id     = $bestId
                            matched_label  = $EntityNameById[$bestId]
                            reason         = "cosine>=$LinkSimilarityThreshold (sim=$([math]::Round($bestSim,4)))"
                        })
                        continue
                    }
                } else {
                    Write-Verbose "Invoke-EntityExtraction: embedding unavailable for '$($p.name)' — cosine link check skipped"
                }
            }

            # 3) Within-run dedup — same normalized name proposed more than once mints ONCE.
            if ($MintIndexByName.ContainsKey($normName)) {
                $existingCandidate = $MintCandidates[$MintIndexByName[$normName]]
                $existingCandidate.OtherOccurrences.Add([PSCustomObject]@{ NodeId = $Node.NodeId; ProposalName = $p.name })
                foreach ($d in $Node.DocIds) { [void]$existingCandidate.DocIdSet.Add($d) }
                # NearGateMinted counts distinct MINTED entities, not raw occurrences —
                # a dedup'd duplicate is linked, not minted, so it is not counted again here.
                continue
            }

            $docIdSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            foreach ($d in $Node.DocIds) { [void]$docIdSet.Add($d) }

            $candidate = [PSCustomObject]@{
                NodeId            = $Node.NodeId
                Name              = $p.name
                EntityType        = $p.entity_type
                Dolce             = $dolce
                Aliases           = @($p.aliases)
                Confidence        = $p.confidence
                NearGate          = $nearGate
                Quote             = $p.quote
                Model             = $Node.Model
                DocIdSet          = $docIdSet
                OtherOccurrences  = [System.Collections.Generic.List[object]]::new()
                MintedId          = $null
            }
            $MintIndexByName[$normName] = $MintCandidates.Count
            $MintCandidates.Add($candidate)
            if ($nearGate) { $NearGateMinted++ }
        }
    }

    # ── Mint in sub-batches of <= 20 (Import-Entity's ValidateCount ceiling). ───────
    $BatchSize = 20
    for ($i = 0; $i -lt $MintCandidates.Count; $i += $BatchSize) {
        $Slice = @($MintCandidates | Select-Object -Skip $i -First $BatchSize)
        $Proposals = @($Slice | ForEach-Object {
            # PERSON EXCEPTION (and, per design, every entity_type in Phase 1): NO
            # `description` key is ever passed — the LLM never authors one.
            @{
                name           = $_.Name
                entity_type    = $_.EntityType
                dolce_category = $_.Dolce
                aliases        = @($_.Aliases)
                source_refs    = @($_.DocIdSet)
                confidence     = $_.Confidence
                discovered_by  = @{ usage_id = $UsageId; model = $_.Model }
                status         = 'proposed'
            }
        })
        $MintResults = @(Import-Entity -Proposal $Proposals -Path $EntPath -EmbeddingsPath $EmbPath -Confirm:$false)
        for ($j = 0; $j -lt $Slice.Count; $j++) {
            $Slice[$j].MintedId = $MintResults[$j].Id
        }
    }

    # Occurrences beyond the first (within-run dedup) link to the freshly minted id.
    foreach ($candidate in $MintCandidates) {
        foreach ($occ in $candidate.OtherOccurrences) {
            $LinkedDispositions.Add([PSCustomObject]@{
                node_id        = $occ.NodeId
                proposal_name  = $occ.ProposalName
                matched_kind   = 'entity'
                matched_id     = $candidate.MintedId
                matched_label  = $candidate.Name
                reason         = 'within-run-dedup'
            })
        }
    }

    $MintedEntities = @($MintCandidates | ForEach-Object {
        [PSCustomObject]@{
            node_id        = $_.NodeId
            id             = $_.MintedId
            name           = $_.Name
            entity_type    = $_.EntityType
            dolce_category = $_.Dolce
            confidence     = $_.Confidence
            near_gate      = $_.NearGate
        }
    })

    # ── Persist the idempotence sidecar (only nodes whose AI call/parse succeeded are
    # marked processed — a failure is retried next run). ─────────────────────────────
    $NewlyProcessed = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Node in $SortedResults) {
        if (-not $Node.ParseOk) { continue }
        $NewlyProcessed.Add([PSCustomObject]@{
            node_id         = $Node.NodeId
            processed_at    = (Get-Date).ToString('o')
            model           = $Node.Model
            proposals_total = @($Node.Proposals).Count
            org_mentions    = @($Node.OrgMentions)
        })
    }

    if ($Force) {
        $refreshedIdList = @($NewlyProcessed | ForEach-Object { [string]$_.node_id })
        $refreshedIds = [System.Collections.Generic.HashSet[string]]::new([string[]]$refreshedIdList)
        $ExistingLogNodes = [System.Collections.Generic.List[PSObject]](
            @($ExistingLogNodes | Where-Object { -not $refreshedIds.Contains([string]$_.node_id) })
        )
    }
    foreach ($n in $NewlyProcessed) { $ExistingLogNodes.Add($n) }

    if ($NewlyProcessed.Count -gt 0) {
        $LogStore = [PSCustomObject]@{
            _schema_version = '1.0.0'
            _doc            = 'Entity extraction idempotence log (t/1806 Phase 1). Feeds -Force replay decisions; not a data-of-record store (entities.json is).'
            last_modified   = (Get-Date).ToString('yyyy-MM-dd')
            node_count      = @($ExistingLogNodes).Count
            nodes           = @($ExistingLogNodes)
        }
        $Temp = "$OutputPath.tmp"
        $Json = $LogStore | ConvertTo-Json -Depth 8
        Set-Content -Path $Temp -Value $Json -Encoding utf8NoBOM
        [System.IO.File]::Move($Temp, $OutputPath, $true)
    }

    $FailCount = @($Failed).Count
    $InvalidCount = @($Invalid).Count
    $MintedCount = @($MintCandidates).Count
    $LinkedCount = @($LinkedDispositions).Count

    Write-Host ""
    Write-Host "Done. Nodes processed: $Total | Proposals: $ProposalsTotal | Minted: $MintedCount | Linked: $LinkedCount | Dropped (below gate): $DroppedBelowGate | Near-gate minted: $NearGateMinted | Invalid: $InvalidCount | Failed: $FailCount"

    [PSCustomObject]@{
        NodesProcessed     = $Total
        ProposalsTotal     = $ProposalsTotal
        Minted             = $MintedCount
        Linked             = $LinkedCount
        DroppedBelowGate   = $DroppedBelowGate
        NearGateMinted     = $NearGateMinted
        InvalidDropped     = $InvalidCount
        InvalidItems       = @($Invalid)
        Failed             = $FailCount
        FailedItems        = @($Failed)
        SkippedNoFacts     = $SkippedNoFacts
        SkippedAlreadyDone = $SkippedAlreadyDone
        MintedEntities     = $MintedEntities
        LinkedDispositions = @($LinkedDispositions)
        OutputPath         = $OutputPath
    }
}
