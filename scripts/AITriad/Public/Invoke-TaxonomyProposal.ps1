# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-TaxonomyProposal {
    <#
    .SYNOPSIS
        Uses AI to generate structured taxonomy improvement proposals based on health data.
    .DESCRIPTION
        Feeds taxonomy health metrics (orphan nodes, unmapped concepts, stance variance,
        coverage imbalances) to an AI model which returns structured NEW/SPLIT/MERGE/RELABEL
        proposals in JSON format.

        Proposals are written to taxonomy/proposals/proposal-{timestamp}.json.
    .PARAMETER Model
        AI model to use. Defaults to env default or 'gemini-3.1-flash-lite-preview'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.3 (slightly creative).
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .PARAMETER DryRun
        Build and display the prompt preview, but do NOT call the API or write files.
    .PARAMETER OutputFile
        Path for the proposal JSON. Defaults to taxonomy/proposals/proposal-{timestamp}.json.
    .PARAMETER HealthData
        Pre-computed health data hashtable from Get-TaxonomyHealth -PassThru.
        If omitted, health data is computed fresh.
    .EXAMPLE
        Invoke-TaxonomyProposal -DryRun
    .EXAMPLE
        Invoke-TaxonomyProposal -Model 'gemini-2.5-flash'
    .EXAMPLE
        $h = Get-TaxonomyHealth -PassThru
        Invoke-TaxonomyProposal -HealthData $h
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model       = 'gemini-3.1-flash-lite-preview',

        [string]$ApiKey      = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [string]$RepoRoot    = $script:RepoRoot,
        [switch]$DryRun,
        [switch]$IncludeHarvestQueue,
        [string]$OutputFile  = '',
        [hashtable]$HealthData = $null
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── 1. Validate environment ────────────────────────────────────────────────
    Write-Step "Validating environment"

    if (-not (Test-Path $RepoRoot)) {
        Write-Fail "Repo root not found: $RepoRoot"
        throw "Repo root not found: $RepoRoot"
    }

    if (-not $DryRun) {
        if     ($Model -match '^gemini') { $Backend = 'gemini' }
        elseif ($Model -match '^claude') { $Backend = 'claude' }
        elseif ($Model -match '^groq')   { $Backend = 'groq'   }
        elseif ($Model -match '^openai') { $Backend = 'openai' }
        else                             { $Backend = 'gemini'  }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            $EnvHint = switch ($Backend) {
                'gemini' { 'GEMINI_API_KEY' }
                'claude' { 'ANTHROPIC_API_KEY' }
                'groq'   { 'GROQ_API_KEY' }
                'openai' { 'OPENAI_API_KEY' }
                default  { 'AI_API_KEY' }
            }
            Write-Fail "No API key found for $Backend backend."
            Write-Info "Set $EnvHint or AI_API_KEY, or pass -ApiKey."
            throw "No API key found for $Backend backend."
        }
        $ApiKey = $ResolvedKey
    }

    Write-OK "Model       : $Model"
    Write-OK "Temperature : $Temperature"
    if ($DryRun) { Write-Warn "DRY RUN — no API call, no file writes" }

    # ── 2. Compute or accept health data ───────────────────────────────────────
    Write-Step "Preparing health data"

    if ($HealthData) {
        Write-OK "Using pre-computed health data ($($HealthData.SummaryCount) summaries)"
    } else {
        $HealthData = Get-TaxonomyHealthData -RepoRoot $RepoRoot
        Write-OK "Computed fresh health data ($($HealthData.SummaryCount) summaries)"
    }

    # ── 3. Build compact data representations ──────────────────────────────────
    Write-Step "Building prompt context"

    # Taxonomy nodes (compact: id, label, description — gives the LLM enough to judge overlap)
    $CompactNodes = @()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            $Desc = ''
            if ($Node.PSObject.Properties['description']) { $Desc = $Node.description }
            $CompactNodes += @{
                id          = $Node.id
                label       = $Node.label
                description = $Desc
            }
        }
    }
    $TaxonomyNodesJson = $CompactNodes | ConvertTo-Json -Depth 5 -Compress

    # Unmapped concepts (freq >= 2, or top 30) — compact with nearest-node similarity
    $NearestNodeMap = $HealthData.NearestNodeMap
    $NodeIndex = @{}
    foreach ($N in $CompactNodes) { $NodeIndex[$N.id] = $N }

    $BuildUnmapped = {
        param($Item)
        $Entry = @{
            concept            = $Item.Concept
            frequency          = $Item.Frequency
            suggested_pov      = $Item.SuggestedPov
            suggested_category = $Item.SuggestedCategory
            doc_count          = $Item.ContributingDocs.Count
        }
        # Attach nearest existing nodes (by description embedding similarity)
        if ($NearestNodeMap -and $NearestNodeMap.ContainsKey($Item.NormalizedKey)) {
            $Entry.nearest_nodes = @($NearestNodeMap[$Item.NormalizedKey] | ForEach-Object {
                $NodeLabel = ''
                if ($NodeIndex.ContainsKey($_.NodeId)) { $NodeLabel = $NodeIndex[$_.NodeId].label }
                @{ id = $_.NodeId; similarity = $_.Similarity; label = $NodeLabel }
            })
        }
        $Entry
    }

    $UnmappedForPrompt = @($HealthData.UnmappedConcepts |
        Where-Object { $_.Frequency -ge 2 } |
        ForEach-Object { & $BuildUnmapped $_ })
    if ($UnmappedForPrompt.Count -eq 0) {
        $UnmappedForPrompt = @($HealthData.UnmappedConcepts | Select-Object -First 30 |
            ForEach-Object { & $BuildUnmapped $_ })
    }
    $UnmappedJson = $UnmappedForPrompt | ConvertTo-Json -Depth 5 -Compress

    # Citation stats: orphans (capped at 50), most-cited (top 10), high-variance
    $CitationStats = @{
        orphan_count = $HealthData.OrphanNodes.Count
        orphan_nodes = @($HealthData.OrphanNodes | Select-Object -First 50 | ForEach-Object {
            @{ id = $_.Id; label = $_.Label }
        })
        most_cited = @($HealthData.MostCited | Select-Object -First 10 | ForEach-Object {
            @{ id = $_.Id; label = $_.Label; citations = $_.Citations }
        })
        high_variance = @($HealthData.HighVarianceNodes | ForEach-Object {
            @{ id = $_.Id; label = $_.Label; total_stances = $_.TotalStances }
        })
    }
    $CitationStatsJson = $CitationStats | ConvertTo-Json -Depth 5 -Compress

    # Coverage balance
    $CoverageBalanceJson = $HealthData.CoverageBalance | ConvertTo-Json -Depth 10 -Compress

    Write-OK "Compact nodes       : $($CompactNodes.Count)"
    Write-OK "Unmapped for prompt : $($UnmappedForPrompt.Count)"
    Write-OK "Orphan nodes        : $($CitationStats.orphan_nodes.Count)"
    Write-OK "High-variance nodes : $($CitationStats.high_variance.Count)"

    # ── 3b. Load vocabulary/dictionary ────────────────────────────────────────
    $DictDir = Join-Path (Get-DataRoot) 'dictionary'
    $StandardizedJson = '[]'
    $ColloquialJson   = '[]'
    if (Test-Path $DictDir) {
        $StdDir = Join-Path $DictDir 'standardized'
        $ColDir = Join-Path $DictDir 'colloquial'
        if (Test-Path $StdDir) {
            $StdTerms = @(Get-ChildItem -Path $StdDir -Filter '*.json' | ForEach-Object {
                $T = Get-Content $_.FullName -Raw | ConvertFrom-Json
                @{
                    canonical_form    = $T.canonical_form
                    display_form      = $T.display_form
                    definition        = $T.definition
                    primary_camp      = $T.primary_camp_origin
                    used_by_nodes     = if ($T.PSObject.Properties['used_by_nodes']) { @($T.used_by_nodes) } else { @() }
                    do_not_confuse    = if ($T.PSObject.Properties['do_not_confuse_with']) {
                        @($T.do_not_confuse_with | ForEach-Object { "$($_.term): $($_.note)" })
                    } else { @() }
                }
            })
            $StandardizedJson = $StdTerms | ConvertTo-Json -Depth 5 -Compress
            Write-OK "Standardized terms  : $($StdTerms.Count)"
        }
        if (Test-Path $ColDir) {
            $ColTerms = @(Get-ChildItem -Path $ColDir -Filter '*.json' | ForEach-Object {
                $T = Get-Content $_.FullName -Raw | ConvertFrom-Json
                @{
                    colloquial_term = $T.colloquial_term
                    status          = $T.status
                    resolves_to     = if ($T.PSObject.Properties['resolves_to']) {
                        @($T.resolves_to | ForEach-Object { "$($_.standardized_term) ($($_.default_for_camp))" })
                    } else { @() }
                }
            })
            $ColloquialJson = $ColTerms | ConvertTo-Json -Depth 5 -Compress
            Write-OK "Colloquial terms    : $($ColTerms.Count)"
        }
    } else {
        Write-Warn "Dictionary not found at $DictDir — vocabulary constraints will be omitted"
    }

    # ── 4. Load prompt template ────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'taxonomy-proposal' -Replacements @{
        TAXONOMY_VERSION = $HealthData.TaxonomyVersion
        SUMMARY_COUNT    = $HealthData.SummaryCount.ToString()
    }

    # ── 5. Assemble full prompt ────────────────────────────────────────────────
    $FullPrompt = @"
$SystemPrompt

=== HEALTH DATA ===

--- EXISTING TAXONOMY NODES ---
$TaxonomyNodesJson

--- UNMAPPED CONCEPTS (sorted by frequency) ---
$UnmappedJson

--- CITATION STATISTICS (orphans, most-cited, high-variance) ---
$CitationStatsJson

--- COVERAGE BALANCE (nodes per POV per category) ---
$CoverageBalanceJson

--- VOCABULARY (STANDARDIZED TERMS) ---
These are the project's controlled vocabulary terms. Each has a canonical_form (machine ID used in node vocabulary_terms arrays), a display_form (human-readable), a definition, and the primary camp that coined it. Proposals MUST use these terms instead of bare colloquial forms.
$StandardizedJson

--- VOCABULARY (COLLOQUIAL TERMS — DO NOT USE BARE) ---
These colloquial terms are ambiguous across camps. Each resolves to different standardized terms depending on context. Never use these bare in descriptions or labels — always use the camp-appropriate standardized form.
$ColloquialJson
"@

    # Inject harvest queue if requested
    if ($IncludeHarvestQueue) {
        $HarvestQueuePath = Join-Path (Get-DataRoot) 'harvest-queue.json'
        if (Test-Path $HarvestQueuePath) {
            $QueueData = Get-Content $HarvestQueuePath -Raw | ConvertFrom-Json
            $QueuedItems = @($QueueData.items | Where-Object { $_.status -eq 'queued' })
            if ($QueuedItems.Count -gt 0) {
                $QueueBlock = ($QueuedItems | ForEach-Object {
                    "- $($_.label) ($($_.suggested_pov)/$($_.suggested_category)): $($_.description)"
                }) -join "`n"
                $FullPrompt += @"

--- DEBATE-SOURCED CONCEPT CANDIDATES ---
The following concepts were identified in structured debates and queued for consideration.
Treat them as additional unmapped concept candidates alongside the health data above.
$QueueBlock
"@
                Write-Info "  Included $($QueuedItems.Count) harvest queue items"
            }
        }
    }

    $PromptLength = $FullPrompt.Length
    $EstTokens    = [int]($PromptLength / 4)
    Write-OK "Prompt assembled: $PromptLength chars (~$EstTokens tokens est.)"

    # ── 6. DRY RUN — print and return ─────────────────────────────────────────
    if ($DryRun) {
        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN: PROMPT PREVIEW" -ForegroundColor Yellow
        Write-Host "$('─' * 72)" -ForegroundColor DarkGray

        Write-Host "`n[SYSTEM PROMPT — first 800 chars]" -ForegroundColor Cyan
        Write-Host $SystemPrompt.Substring(0, [Math]::Min(800, $SystemPrompt.Length)) -ForegroundColor Gray
        Write-Host "... (truncated for display)" -ForegroundColor DarkGray

        Write-Host "`n[TAXONOMY NODES — $($CompactNodes.Count) nodes, first 400 chars]" -ForegroundColor Cyan
        Write-Host $TaxonomyNodesJson.Substring(0, [Math]::Min(400, $TaxonomyNodesJson.Length)) -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[UNMAPPED CONCEPTS — $($UnmappedForPrompt.Count) entries]" -ForegroundColor Cyan
        $UnmappedPreview = $UnmappedJson.Substring(0, [Math]::Min(400, $UnmappedJson.Length))
        Write-Host $UnmappedPreview -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[CITATION STATISTICS]" -ForegroundColor Cyan
        Write-Host $CitationStatsJson.Substring(0, [Math]::Min(400, $CitationStatsJson.Length)) -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[COVERAGE BALANCE]" -ForegroundColor Cyan
        Write-Host $CoverageBalanceJson -ForegroundColor Gray

        Write-Host "`n[VOCABULARY — standardized terms, first 400 chars]" -ForegroundColor Cyan
        Write-Host $StandardizedJson.Substring(0, [Math]::Min(400, $StandardizedJson.Length)) -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n[VOCABULARY — colloquial terms]" -ForegroundColor Cyan
        Write-Host $ColloquialJson.Substring(0, [Math]::Min(400, $ColloquialJson.Length)) -ForegroundColor Gray
        Write-Host "..." -ForegroundColor DarkGray

        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN complete. No API call made. No files written." -ForegroundColor Yellow
        Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
        return
    }

    # ── 7. Call Invoke-AIApi ───────────────────────────────────────────────────
    Write-Step "Calling AI API ($Model)"

    $StartTime = Get-Date
    Write-Info "Sending request..."

    $AiResult = Invoke-AIApi `
        -Prompt      $FullPrompt `
        -Model       $Model `
        -ApiKey      $ApiKey `
        -Temperature $Temperature `
        -MaxTokens   65536 `
        -JsonMode `
        -TimeoutSec  600

    if ($null -eq $AiResult) {
        throw "AI API call returned null"
    }

    $Elapsed = (Get-Date) - $StartTime
    Write-OK "Response received from $($AiResult.Backend) in $([int]$Elapsed.TotalSeconds)s"

    # ── 8. Parse and validate response ─────────────────────────────────────────
    Write-Step "Parsing AI response"

    $RawText     = $AiResult.Text
    $CleanedText = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanedText = $CleanedText.Trim()

    try {
        $ProposalObject = $CleanedText | ConvertFrom-Json
        Write-OK "Valid JSON received"
    }
    catch {
        Write-Warn "JSON parse failed — attempting repair"
        $Repaired = Repair-TruncatedJson -Text $RawText
        if ($Repaired) {
            try {
                $ProposalObject = $Repaired | ConvertFrom-Json
                Write-OK "JSON repaired successfully"
            }
            catch {
                $ProposalObject = $null
            }
        }
        if ($null -eq $ProposalObject) {
            $DebugPath = Join-Path (Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals') "proposal-debug-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
            $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
            if (-not (Test-Path $ProposalsDir)) { New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null }
            Write-Utf8NoBom -Path $DebugPath -Value $RawText 
            Write-Fail "AI returned invalid JSON. Raw response saved: $DebugPath"
            throw "AI returned invalid JSON for taxonomy proposal"
        }
    }

    # Validate presence of proposals array
    if (-not $ProposalObject.proposals) {
        Write-Warn "Response missing 'proposals' array — may be empty or malformed"
        $ProposalObject | Add-Member -NotePropertyName 'proposals' -NotePropertyValue @() -ErrorAction SilentlyContinue
    }

    # ── Gap 9.1: Schema validation per proposal type ──────────────────────────
    $ValidActions = @('NEW','SPLIT','MERGE','RELABEL','REORDER','DEPTH_EXPAND','WIDTH_EXPAND')
    $ValidPovs    = @('accelerationist','safetyist','skeptic','situations')
    $ValidCats    = @('Desires','Beliefs','Intentions')
    $ValidatedProposals = [System.Collections.Generic.List[object]]::new()

    foreach ($P in @($ProposalObject.proposals)) {
        $ActionType = if ($P.PSObject.Properties['action']) { $P.action.ToUpperInvariant() } else { $null }
        $Errors = [System.Collections.Generic.List[string]]::new()

        if (-not $ActionType -or $ActionType -notin $ValidActions) {
            $Errors.Add("invalid or missing action type '$($P.action)'")
        }

        if (-not $P.PSObject.Properties['pov'] -or $P.pov -notin $ValidPovs) {
            $Errors.Add("invalid or missing pov '$($P.pov)'")
        }

        if ($P.pov -ne 'situations' -and (-not $P.PSObject.Properties['category'] -or $P.category -notin $ValidCats)) {
            if ($ActionType -notin @('MERGE','REORDER')) {
                $Errors.Add("invalid or missing category '$($P.category)' for non-situations node")
            }
        }

        if (-not $P.PSObject.Properties['label'] -or [string]::IsNullOrWhiteSpace($P.label)) {
            if ($ActionType -notin @('MERGE','REORDER')) {
                $Errors.Add("missing label")
            }
        }

        if (-not $P.PSObject.Properties['rationale'] -or [string]::IsNullOrWhiteSpace($P.rationale)) {
            $Errors.Add("missing rationale")
        }

        switch ($ActionType) {
            'NEW' {
                if (-not $P.PSObject.Properties['suggested_id'] -or [string]::IsNullOrWhiteSpace($P.suggested_id)) {
                    $Errors.Add("NEW requires suggested_id")
                }
            }
            'SPLIT' {
                if (-not $P.PSObject.Properties['target_node_id'] -or [string]::IsNullOrWhiteSpace($P.target_node_id)) {
                    $Errors.Add("SPLIT requires target_node_id")
                }
                if (-not $P.PSObject.Properties['children'] -or @($P.children).Count -lt 2) {
                    $Errors.Add("SPLIT requires at least 2 children")
                }
            }
            'MERGE' {
                if (-not $P.PSObject.Properties['merge_node_ids'] -or @($P.merge_node_ids).Count -lt 2) {
                    $Errors.Add("MERGE requires merge_node_ids with at least 2 IDs")
                }
                if (-not $P.PSObject.Properties['surviving_node_id'] -or [string]::IsNullOrWhiteSpace($P.surviving_node_id)) {
                    $Errors.Add("MERGE requires surviving_node_id")
                }
            }
            'RELABEL' {
                if (-not $P.PSObject.Properties['target_node_id'] -or [string]::IsNullOrWhiteSpace($P.target_node_id)) {
                    $Errors.Add("RELABEL requires target_node_id")
                }
            }
            'REORDER' {
                if (-not $P.PSObject.Properties['target_node_id'] -or [string]::IsNullOrWhiteSpace($P.target_node_id)) {
                    $Errors.Add("REORDER requires target_node_id")
                }
                if (-not $P.PSObject.Properties['new_parent_id'] -or [string]::IsNullOrWhiteSpace($P.new_parent_id)) {
                    $Errors.Add("REORDER requires new_parent_id")
                }
            }
            'DEPTH_EXPAND' {
                if (-not $P.PSObject.Properties['target_node_id'] -or [string]::IsNullOrWhiteSpace($P.target_node_id)) {
                    $Errors.Add("DEPTH_EXPAND requires target_node_id")
                }
                if (-not $P.PSObject.Properties['children'] -or @($P.children).Count -lt 2) {
                    $Errors.Add("DEPTH_EXPAND requires at least 2 children")
                }
            }
            'WIDTH_EXPAND' {
                if (-not $P.PSObject.Properties['suggested_id'] -or [string]::IsNullOrWhiteSpace($P.suggested_id)) {
                    $Errors.Add("WIDTH_EXPAND requires suggested_id")
                }
            }
        }

        $PLabel = if ($P.PSObject.Properties['label'] -and $P.label) { $P.label.Substring(0, [Math]::Min(40, $P.label.Length)) } else { '(no label)' }
        if ($Errors.Count -gt 0) {
            Write-Warn "Proposal '$PLabel' ($ActionType) rejected: $($Errors -join '; ')"
        } else {
            $ValidatedProposals.Add($P)
        }
    }

    $RejectedCount = @($ProposalObject.proposals).Count - $ValidatedProposals.Count
    if ($RejectedCount -gt 0) {
        Write-Warn "$RejectedCount proposal(s) rejected by schema validation"
    }

    # ── Gap 9.2: Duplicate proposal detection against existing proposals ───────
    $ExistingProposals = [System.Collections.Generic.List[object]]::new()
    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    if (Test-Path $ProposalsDir) {
        foreach ($ExFile in (Get-ChildItem -Path $ProposalsDir -Filter 'proposal-*.json' -File)) {
            try {
                $ExData = Get-Content $ExFile.FullName -Raw | ConvertFrom-Json
                if ($ExData.proposals) {
                    foreach ($ep in $ExData.proposals) { $ExistingProposals.Add($ep) }
                }
            } catch { }
        }
    }

    if ($ExistingProposals.Count -gt 0) {
        $DedupedProposals = [System.Collections.Generic.List[object]]::new()
        foreach ($P in $ValidatedProposals) {
            $IsDup = $false
            $ActionType = $P.action.ToUpperInvariant()

            foreach ($Existing in $ExistingProposals) {
                $ExAction = if ($Existing.PSObject.Properties['action']) { $Existing.action.ToUpperInvariant() } else { '' }
                if ($ExAction -ne $ActionType) { continue }

                switch ($ActionType) {
                    'MERGE' {
                        if ($P.PSObject.Properties['merge_node_ids'] -and $Existing.PSObject.Properties['merge_node_ids']) {
                            $NewSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($P.merge_node_ids))
                            $ExSet  = [System.Collections.Generic.HashSet[string]]::new([string[]]@($Existing.merge_node_ids))
                            $Overlap = [System.Collections.Generic.HashSet[string]]::new($NewSet)
                            $Overlap.IntersectWith($ExSet)
                            $Union = [System.Collections.Generic.HashSet[string]]::new($NewSet)
                            $Union.UnionWith($ExSet)
                            if ($Union.Count -gt 0 -and ($Overlap.Count / $Union.Count) -ge 0.5) {
                                $IsDup = $true
                            }
                        }
                    }
                    'NEW' {
                        if ($P.PSObject.Properties['suggested_id'] -and $Existing.PSObject.Properties['suggested_id'] -and
                            $P.suggested_id -eq $Existing.suggested_id) {
                            $IsDup = $true
                        }
                        elseif ($P.PSObject.Properties['label'] -and $Existing.PSObject.Properties['label']) {
                            $NewWords = [System.Collections.Generic.HashSet[string]]::new(
                                [string[]]($P.label.ToLowerInvariant() -split '\s+'),
                                [System.StringComparer]::OrdinalIgnoreCase
                            )
                            $ExWords = [System.Collections.Generic.HashSet[string]]::new(
                                [string[]]($Existing.label.ToLowerInvariant() -split '\s+'),
                                [System.StringComparer]::OrdinalIgnoreCase
                            )
                            $Isect = [System.Collections.Generic.HashSet[string]]::new($NewWords)
                            $Isect.IntersectWith($ExWords)
                            $Un = [System.Collections.Generic.HashSet[string]]::new($NewWords)
                            $Un.UnionWith($ExWords)
                            if ($Un.Count -gt 0 -and ($Isect.Count / $Un.Count) -ge 0.7) {
                                $IsDup = $true
                            }
                        }
                    }
                    'SPLIT' {
                        if ($P.PSObject.Properties['target_node_id'] -and $Existing.PSObject.Properties['target_node_id'] -and
                            $P.target_node_id -eq $Existing.target_node_id) {
                            $IsDup = $true
                        }
                    }
                    'RELABEL' {
                        if ($P.PSObject.Properties['target_node_id'] -and $Existing.PSObject.Properties['target_node_id'] -and
                            $P.target_node_id -eq $Existing.target_node_id) {
                            $IsDup = $true
                        }
                    }
                }

                if ($IsDup) { break }
            }

            $PLabel = if ($P.label) { $P.label.Substring(0, [Math]::Min(40, $P.label.Length)) } else { '(no label)' }
            if ($IsDup) {
                Write-Warn "Duplicate proposal skipped: [$ActionType] $PLabel"
            } else {
                $DedupedProposals.Add($P)
            }
        }

        $DupCount = $ValidatedProposals.Count - $DedupedProposals.Count
        if ($DupCount -gt 0) {
            Write-Warn "$DupCount proposal(s) removed as duplicates of existing proposals"
        }
        $ValidatedProposals = $DedupedProposals
    }

    $ProposalObject.proposals = @($ValidatedProposals)
    $ProposalCount = $ValidatedProposals.Count
    Write-OK "$ProposalCount proposal(s) after validation"

    # ── 9. Write proposal file ─────────────────────────────────────────────────
    Write-Step "Writing proposal file"

    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    if (-not (Test-Path $ProposalsDir)) {
        New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null
    }

    $Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (-not $OutputFile) {
        $OutputFile = Join-Path $ProposalsDir "proposal-$Timestamp.json"
    }

    # Enrich with metadata
    $FinalProposal = [ordered]@{
        generated_at     = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
        model            = $Model
        taxonomy_version = $HealthData.TaxonomyVersion
        summary_count    = $HealthData.SummaryCount
        proposals        = $ProposalObject.proposals
    }

    $ProposalJson = $FinalProposal | ConvertTo-Json -Depth 20
    try {
        Write-Utf8NoBom -Path $OutputFile -Value $ProposalJson 
        Write-OK "Proposal written to: $OutputFile"
    }
    catch {
        Write-Fail "Failed to write proposal file — $($_.Exception.Message)"
        Write-Info "Proposal data was generated but NOT saved. Check path and permissions."
        throw
    }

    # ── 10. Print human-readable summary ───────────────────────────────────────
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  TAXONOMY PROPOSALS" -ForegroundColor White
    Write-Host "  Model: $Model  |  Taxonomy v$($HealthData.TaxonomyVersion)  |  $ProposalCount proposal(s)" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    $ActionTypes = @('NEW', 'SPLIT', 'MERGE', 'RELABEL')
    foreach ($Action in $ActionTypes) {
        $Group = @($ProposalObject.proposals | Where-Object { $_.action -eq $Action })
        if ($Group.Count -eq 0) { continue }

        $ActionColor = switch ($Action) {
            'NEW'     { 'Green'   }
            'SPLIT'   { 'Cyan'    }
            'MERGE'   { 'Yellow'  }
            'RELABEL' { 'Magenta' }
        }

        Write-Host "`n  [$Action] ($($Group.Count))" -ForegroundColor $ActionColor

        foreach ($P in $Group) {
            if ($P.suggested_id) { $IdStr = "[$($P.suggested_id)]" } else { $IdStr = '' }
            if ($P.target_node_id) { $TargetStr = " (target: $($P.target_node_id))" } else { $TargetStr = '' }
            Write-Host "    $IdStr $($P.label)$TargetStr" -ForegroundColor White
            Write-Host "      POV: $($P.pov)  |  Category: $($P.category)" -ForegroundColor Gray
            if ($P.rationale) {
                if ($P.rationale.Length -gt 120) {
                    $RatSnippet = $P.rationale.Substring(0, 120) + '...'
                } else { $RatSnippet = $P.rationale }
                Write-Host "      Rationale: $RatSnippet" -ForegroundColor DarkGray
            }
            if ($P.PSObject.Properties['children'] -and $P.children.Count -gt 0) {
                Write-Host "      Children:" -ForegroundColor Gray
                foreach ($Child in $P.children) {
                    Write-Host "        [$($Child.suggested_id)] $($Child.label)" -ForegroundColor Gray
                }
            }
            if ($P.PSObject.Properties['merge_node_ids'] -and $P.merge_node_ids.Count -gt 0) {
                Write-Host "      Merging: $($P.merge_node_ids -join ', ') → $($P.surviving_node_id)" -ForegroundColor Gray
            }
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Output: $OutputFile" -ForegroundColor Green
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
