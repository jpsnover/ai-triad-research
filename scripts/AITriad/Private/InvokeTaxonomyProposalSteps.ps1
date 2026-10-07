# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Steps of Invoke-TaxonomyProposal (t/3910 complexity refactor). Behaviour is pinned by
# tests/Invoke-TaxonomyProposal.Characterization.Tests.ps1, defects included (t/4076). These
# helpers run under the caller's Set-StrictMode -Version Latest and $ErrorActionPreference = 'Stop'
# (dynamic scope), so an unguarded read of a model-supplied field throws exactly as it did inline.
# Collections that must keep their exact shape (empty, or a single element) are returned with the
# unary comma so the pipeline doesn't unroll them.

# Model prefix -> backend, checked in order; anything else falls back to gemini.
$script:TaxonomyProposalBackends = @(
    @{ Pattern = '^gemini'; Backend = 'gemini' }
    @{ Pattern = '^claude'; Backend = 'claude' }
    @{ Pattern = '^groq';   Backend = 'groq'   }
    @{ Pattern = '^openai'; Backend = 'openai' }
)
$script:TaxonomyProposalKeyHints = @{
    gemini = 'GEMINI_API_KEY'; claude = 'ANTHROPIC_API_KEY'; groq = 'GROQ_API_KEY'; openai = 'OPENAI_API_KEY'
}

# Per-action schema rules, checked in order. NonBlank: the field must be present and not blank.
# MinCount: the field must be present with at least 2 items.
$script:TaxonomyProposalActionRules = @{
    'NEW'          = @(@{ Field = 'suggested_id'; Kind = 'NonBlank'; Message = 'NEW requires suggested_id' })
    'SPLIT'        = @(@{ Field = 'target_node_id'; Kind = 'NonBlank'; Message = 'SPLIT requires target_node_id' }
                       @{ Field = 'children'; Kind = 'MinCount'; Message = 'SPLIT requires at least 2 children' })
    'MERGE'        = @(@{ Field = 'merge_node_ids'; Kind = 'MinCount'; Message = 'MERGE requires merge_node_ids with at least 2 IDs' }
                       @{ Field = 'surviving_node_id'; Kind = 'NonBlank'; Message = 'MERGE requires surviving_node_id' })
    'RELABEL'      = @(@{ Field = 'target_node_id'; Kind = 'NonBlank'; Message = 'RELABEL requires target_node_id' })
    'REORDER'      = @(@{ Field = 'target_node_id'; Kind = 'NonBlank'; Message = 'REORDER requires target_node_id' }
                       @{ Field = 'new_parent_id'; Kind = 'NonBlank'; Message = 'REORDER requires new_parent_id' })
    'DEPTH_EXPAND' = @(@{ Field = 'target_node_id'; Kind = 'NonBlank'; Message = 'DEPTH_EXPAND requires target_node_id' }
                       @{ Field = 'children'; Kind = 'MinCount'; Message = 'DEPTH_EXPAND requires at least 2 children' })
    'WIDTH_EXPAND' = @(@{ Field = 'suggested_id'; Kind = 'NonBlank'; Message = 'WIDTH_EXPAND requires suggested_id' })
}

# Console summary: the action groups shown, in order, with their colours.
$script:TaxonomyProposalDisplayColors = [ordered]@{ NEW = 'Green'; SPLIT = 'Cyan'; MERGE = 'Yellow'; RELABEL = 'Magenta' }

# ── 1. Environment ────────────────────────────────────────────────────────────

function Resolve-TaxonomyProposalApiKey {
    param([string]$Model, [string]$ApiKey)
    $Backend = 'gemini'
    foreach ($Entry in $script:TaxonomyProposalBackends) {
        if ($Model -match $Entry.Pattern) { $Backend = $Entry.Backend; break }
    }
    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
    if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
        $EnvHint = if ($script:TaxonomyProposalKeyHints.ContainsKey($Backend)) { $script:TaxonomyProposalKeyHints[$Backend] } else { 'AI_API_KEY' }
        Write-Fail "No API key found for $Backend backend."
        Write-Info "Set $EnvHint or AI_API_KEY, or pass -ApiKey."
        throw "No API key found for $Backend backend."
    }
    $ResolvedKey
}

# ── 3. Prompt context ─────────────────────────────────────────────────────────

# Taxonomy nodes (compact: id, label, description — gives the LLM enough to judge overlap).
function Get-TaxonomyProposalCompactNodeList {
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
    , $CompactNodes
}

# One unmapped concept for the prompt, with its nearest existing nodes (by description embedding).
function ConvertTo-TaxonomyProposalUnmappedEntry {
    param($Item, $NearestNodeMap, [hashtable]$NodeIndex)
    $Entry = @{
        concept            = $Item.Concept
        frequency          = $Item.Frequency
        suggested_pov      = $Item.SuggestedPov
        suggested_category = $Item.SuggestedCategory
        doc_count          = $Item.ContributingDocs.Count
    }
    if ($NearestNodeMap -and $NearestNodeMap.ContainsKey($Item.NormalizedKey)) {
        $Entry.nearest_nodes = @($NearestNodeMap[$Item.NormalizedKey] | ForEach-Object {
            $NodeLabel = ''
            if ($NodeIndex.ContainsKey($_.NodeId)) { $NodeLabel = $NodeIndex[$_.NodeId].label }
            @{ id = $_.NodeId; similarity = $_.Similarity; label = $NodeLabel }
        })
    }
    $Entry
}

# Unmapped concepts with frequency >= 2, or the first 30 when none qualify.
function Get-TaxonomyProposalUnmapped {
    param([hashtable]$HealthData, [object[]]$CompactNodes)
    $NearestNodeMap = $HealthData.NearestNodeMap
    $NodeIndex = @{}
    foreach ($N in $CompactNodes) { $NodeIndex[$N.id] = $N }

    $Unmapped = @($HealthData.UnmappedConcepts |
        Where-Object { $_.Frequency -ge 2 } |
        ForEach-Object { ConvertTo-TaxonomyProposalUnmappedEntry -Item $_ -NearestNodeMap $NearestNodeMap -NodeIndex $NodeIndex })
    if ($Unmapped.Count -eq 0) {
        $Unmapped = @($HealthData.UnmappedConcepts | Select-Object -First 30 |
            ForEach-Object { ConvertTo-TaxonomyProposalUnmappedEntry -Item $_ -NearestNodeMap $NearestNodeMap -NodeIndex $NodeIndex })
    }
    , $Unmapped
}

# Citation stats: orphans (capped at 50), most-cited (top 10), high-variance.
function Get-TaxonomyProposalCitationStatistic {
    param([hashtable]$HealthData)
    @{
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
}

# ── 3b. Vocabulary ────────────────────────────────────────────────────────────

function ConvertTo-TaxonomyProposalStandardizedTerm {
    param([string]$Path)
    $T = Get-Content $Path -Raw | ConvertFrom-Json
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
}

function ConvertTo-TaxonomyProposalColloquialTerm {
    param([string]$Path)
    $T = Get-Content $Path -Raw | ConvertFrom-Json
    @{
        colloquial_term = $T.colloquial_term
        status          = $T.status
        resolves_to     = if ($T.PSObject.Properties['resolves_to']) {
            @($T.resolves_to | ForEach-Object { "$($_.standardized_term) ($($_.default_for_camp))" })
        } else { @() }
    }
}

# Loads the dictionary's standardized and colloquial terms as compact JSON ('[]' when absent).
function Get-TaxonomyProposalVocabulary {
    $DictDir = Join-Path (Get-DataRoot) 'dictionary'
    $Vocabulary = @{ Standardized = '[]'; Colloquial = '[]' }
    if (-not (Test-Path $DictDir)) {
        Write-Warn "Dictionary not found at $DictDir — vocabulary constraints will be omitted"
        return $Vocabulary
    }
    $StdDir = Join-Path $DictDir 'standardized'
    $ColDir = Join-Path $DictDir 'colloquial'
    if (Test-Path $StdDir) {
        $StdTerms = @(Get-ChildItem -Path $StdDir -Filter '*.json' | ForEach-Object { ConvertTo-TaxonomyProposalStandardizedTerm -Path $_.FullName })
        $Vocabulary.Standardized = $StdTerms | ConvertTo-Json -Depth 5 -Compress
        Write-OK "Standardized terms  : $($StdTerms.Count)"
    }
    if (Test-Path $ColDir) {
        $ColTerms = @(Get-ChildItem -Path $ColDir -Filter '*.json' | ForEach-Object { ConvertTo-TaxonomyProposalColloquialTerm -Path $_.FullName })
        $Vocabulary.Colloquial = $ColTerms | ConvertTo-Json -Depth 5 -Compress
        Write-OK "Colloquial terms    : $($ColTerms.Count)"
    }
    $Vocabulary
}

# ── 5. Prompt assembly ────────────────────────────────────────────────────────

function ConvertTo-TaxonomyProposalPrompt {
    param([hashtable]$Context)
    $SystemPrompt        = $Context.SystemPrompt
    $TaxonomyNodesJson   = $Context.TaxonomyNodesJson
    $UnmappedJson        = $Context.UnmappedJson
    $CitationStatsJson   = $Context.CitationStatsJson
    $CoverageBalanceJson = $Context.CoverageBalanceJson
    $StandardizedJson    = $Context.StandardizedJson
    $ColloquialJson      = $Context.ColloquialJson
    @"
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
}

# Appends the queued debate-sourced concepts to the prompt, when there are any.
function Add-TaxonomyProposalHarvestQueue {
    param([string]$FullPrompt)
    $HarvestQueuePath = Join-Path (Get-DataRoot) 'harvest-queue.json'
    if (-not (Test-Path $HarvestQueuePath)) { return $FullPrompt }
    $QueueData = Get-Content $HarvestQueuePath -Raw | ConvertFrom-Json
    $QueuedItems = @($QueueData.items | Where-Object { $_.status -eq 'queued' })
    if ($QueuedItems.Count -eq 0) { return $FullPrompt }
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
    $FullPrompt
}

# ── 6. Dry run ────────────────────────────────────────────────────────────────

# $Text is deliberately untyped: a $null block (no nodes, no unmapped concepts) must still throw on
# .Substring as it did inline, not become '' and print a blank preview.
function Write-TaxonomyProposalPreview {
    param([string]$Heading, $Text, [int]$Limit)
    Write-Host "`n$Heading" -ForegroundColor Cyan
    Write-Host $Text.Substring(0, [Math]::Min($Limit, $Text.Length)) -ForegroundColor Gray
}

function Show-TaxonomyProposalDryRun {
    param([hashtable]$Context, [int]$NodeCount, [int]$UnmappedCount)
    Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
    Write-Host "  DRY RUN: PROMPT PREVIEW" -ForegroundColor Yellow
    Write-Host "$('─' * 72)" -ForegroundColor DarkGray

    Write-TaxonomyProposalPreview "[SYSTEM PROMPT — first 800 chars]" $Context.SystemPrompt 800
    Write-Host "... (truncated for display)" -ForegroundColor DarkGray

    Write-TaxonomyProposalPreview "[TAXONOMY NODES — $NodeCount nodes, first 400 chars]" $Context.TaxonomyNodesJson 400
    Write-Host "..." -ForegroundColor DarkGray

    Write-TaxonomyProposalPreview "[UNMAPPED CONCEPTS — $UnmappedCount entries]" $Context.UnmappedJson 400
    Write-Host "..." -ForegroundColor DarkGray

    Write-TaxonomyProposalPreview "[CITATION STATISTICS]" $Context.CitationStatsJson 400
    Write-Host "..." -ForegroundColor DarkGray

    Write-Host "`n[COVERAGE BALANCE]" -ForegroundColor Cyan
    Write-Host $Context.CoverageBalanceJson -ForegroundColor Gray

    Write-TaxonomyProposalPreview "[VOCABULARY — standardized terms, first 400 chars]" $Context.StandardizedJson 400
    Write-Host "..." -ForegroundColor DarkGray

    Write-TaxonomyProposalPreview "[VOCABULARY — colloquial terms]" $Context.ColloquialJson 400
    Write-Host "..." -ForegroundColor DarkGray

    Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
    Write-Host "  DRY RUN complete. No API call made. No files written." -ForegroundColor Yellow
    Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
}

# ── 7–8. AI call and response parsing ─────────────────────────────────────────

function Invoke-TaxonomyProposalAI {
    param([string]$FullPrompt, [string]$Model, [string]$ApiKey, [double]$Temperature)
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
    $AiResult
}

# Parses the response, repairing truncated JSON. Pinned defect (t/4076 item 4): when the repair yields
# nothing, $ProposalObject is never assigned, so the null check throws an unset-variable error before
# the debug file can be saved. $ProposalObject must not be assigned anywhere above the catch.
function ConvertFrom-TaxonomyProposalResponse {
    param($AiResult, [string]$RepoRoot)
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
            Save-TaxonomyProposalDebugFile -RepoRoot $RepoRoot -RawText $RawText
        }
    }

    # Validate presence of proposals array
    if (-not $ProposalObject.proposals) {
        Write-Warn "Response missing 'proposals' array — may be empty or malformed"
        $ProposalObject | Add-Member -NotePropertyName 'proposals' -NotePropertyValue @() -ErrorAction SilentlyContinue
    }
    $ProposalObject
}

function Save-TaxonomyProposalDebugFile {
    param([string]$RepoRoot, [string]$RawText)
    $DebugPath = Join-Path (Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals') "proposal-debug-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    if (-not (Test-Path $ProposalsDir)) { New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null }
    Write-Utf8NoBom -Path $DebugPath -Value $RawText
    Write-Fail "AI returned invalid JSON. Raw response saved: $DebugPath"
    throw "AI returned invalid JSON for taxonomy proposal"
}

# ── Gap 9.1: schema validation per proposal type ──────────────────────────────

# The base checks every proposal gets. Pinned defect (t/4076 item 1): the messages interpolate
# $P.action, $P.pov and $P.category unguarded, so a proposal missing one of them throws.
function Get-TaxonomyProposalBaseError {
    param($P, [string]$ActionType)
    $Errors = [System.Collections.Generic.List[string]]::new()

    if (-not $ActionType -or $ActionType -notin @('NEW','SPLIT','MERGE','RELABEL','REORDER','DEPTH_EXPAND','WIDTH_EXPAND')) {
        $Errors.Add("invalid or missing action type '$($P.action)'")
    }

    if (-not $P.PSObject.Properties['pov'] -or $P.pov -notin @('accelerationist','safetyist','skeptic','situations')) {
        $Errors.Add("invalid or missing pov '$($P.pov)'")
    }

    if ($P.pov -ne 'situations' -and (-not $P.PSObject.Properties['category'] -or $P.category -notin @('Desires','Beliefs','Intentions'))) {
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
    , $Errors
}

function Test-TaxonomyProposalRule {
    param($P, [hashtable]$Rule)
    if (-not $P.PSObject.Properties[$Rule.Field]) { return $false }
    if ($Rule.Kind -eq 'MinCount') { return (@($P.($Rule.Field)).Count -ge 2) }
    -not [string]::IsNullOrWhiteSpace($P.($Rule.Field))
}

# All schema errors for one proposal: the base checks, then the action's own rules.
function Get-TaxonomyProposalError {
    param($P, [string]$ActionType)
    $Errors = Get-TaxonomyProposalBaseError -P $P -ActionType $ActionType
    if ($ActionType -and $script:TaxonomyProposalActionRules.ContainsKey($ActionType)) {
        foreach ($Rule in $script:TaxonomyProposalActionRules[$ActionType]) {
            if (-not (Test-TaxonomyProposalRule -P $P -Rule $Rule)) { $Errors.Add($Rule.Message) }
        }
    }
    , $Errors
}

# Returns the proposals that pass schema validation (a List), warning about each one rejected.
function Select-ValidTaxonomyProposal {
    param([object[]]$Proposals)
    $ValidatedProposals = [System.Collections.Generic.List[object]]::new()
    foreach ($P in $Proposals) {
        $ActionType = if ($P.PSObject.Properties['action']) { $P.action.ToUpperInvariant() } else { $null }
        $Errors = Get-TaxonomyProposalError -P $P -ActionType $ActionType

        $PLabel = if ($P.PSObject.Properties['label'] -and $P.label) { $P.label.Substring(0, [Math]::Min(40, $P.label.Length)) } else { '(no label)' }
        if ($Errors.Count -gt 0) {
            Write-Warn "Proposal '$PLabel' ($ActionType) rejected: $($Errors -join '; ')"
        } else {
            $ValidatedProposals.Add($P)
        }
    }

    $RejectedCount = @($Proposals).Count - $ValidatedProposals.Count
    if ($RejectedCount -gt 0) {
        Write-Warn "$RejectedCount proposal(s) rejected by schema validation"
    }
    , $ValidatedProposals
}

# ── Gap 9.2: duplicate detection against existing proposals ───────────────────

function Get-ExistingTaxonomyProposal {
    param([string]$RepoRoot)
    $ExistingProposals = [System.Collections.Generic.List[object]]::new()
    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    if (-not (Test-Path $ProposalsDir)) { return , $ExistingProposals }
    foreach ($ExFile in (Get-ChildItem -Path $ProposalsDir -Filter 'proposal-*.json' -File)) {
        try {
            $ExData = Get-Content $ExFile.FullName -Raw | ConvertFrom-Json
            if ($ExData.proposals) {
                foreach ($ep in $ExData.proposals) { $ExistingProposals.Add($ep) }
            }
        } catch { }
    }
    , $ExistingProposals
}

# Jaccard overlap of two string sets: |A ∩ B| / |A ∪ B|, compared against a threshold.
function Test-TaxonomyProposalSetOverlap {
    param([System.Collections.Generic.HashSet[string]]$A, [System.Collections.Generic.HashSet[string]]$B, [double]$Threshold)
    $Isect = [System.Collections.Generic.HashSet[string]]::new($A)
    $Isect.IntersectWith($B)
    $Union = [System.Collections.Generic.HashSet[string]]::new($A)
    $Union.UnionWith($B)
    $Union.Count -gt 0 -and ($Isect.Count / $Union.Count) -ge $Threshold
}

function Test-MergeTaxonomyProposalDuplicate {
    param($P, $Existing)
    if (-not ($P.PSObject.Properties['merge_node_ids'] -and $Existing.PSObject.Properties['merge_node_ids'])) { return $false }
    $NewSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($P.merge_node_ids))
    $ExSet  = [System.Collections.Generic.HashSet[string]]::new([string[]]@($Existing.merge_node_ids))
    Test-TaxonomyProposalSetOverlap -A $NewSet -B $ExSet -Threshold 0.5
}

function Test-NewTaxonomyProposalDuplicate {
    param($P, $Existing)
    if ($P.PSObject.Properties['suggested_id'] -and $Existing.PSObject.Properties['suggested_id'] -and
        $P.suggested_id -eq $Existing.suggested_id) {
        return $true
    }
    if (-not ($P.PSObject.Properties['label'] -and $Existing.PSObject.Properties['label'])) { return $false }
    $NewWords = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]($P.label.ToLowerInvariant() -split '\s+'),
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $ExWords = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]($Existing.label.ToLowerInvariant() -split '\s+'),
        [System.StringComparer]::OrdinalIgnoreCase
    )
    Test-TaxonomyProposalSetOverlap -A $NewWords -B $ExWords -Threshold 0.7
}

function Test-TargetTaxonomyProposalDuplicate {
    param($P, $Existing)
    [bool]($P.PSObject.Properties['target_node_id'] -and $Existing.PSObject.Properties['target_node_id'] -and
        $P.target_node_id -eq $Existing.target_node_id)
}

# True when an existing proposal of the same action duplicates $P (REORDER and the expand actions
# are never treated as duplicates).
function Test-TaxonomyProposalDuplicate {
    param($P, [string]$ActionType, [System.Collections.Generic.List[object]]$ExistingProposals)
    foreach ($Existing in $ExistingProposals) {
        $ExAction = if ($Existing.PSObject.Properties['action']) { $Existing.action.ToUpperInvariant() } else { '' }
        if ($ExAction -ne $ActionType) { continue }
        $IsDup = switch ($ActionType) {
            'MERGE'   { Test-MergeTaxonomyProposalDuplicate -P $P -Existing $Existing }
            'NEW'     { Test-NewTaxonomyProposalDuplicate -P $P -Existing $Existing }
            'SPLIT'   { Test-TargetTaxonomyProposalDuplicate -P $P -Existing $Existing }
            'RELABEL' { Test-TargetTaxonomyProposalDuplicate -P $P -Existing $Existing }
            default   { $false }
        }
        if ($IsDup) { return $true }
    }
    $false
}

# Drops proposals that duplicate an existing one (a List); a no-op when there are no existing proposals.
function Select-NonDuplicateTaxonomyProposal {
    param([System.Collections.Generic.List[object]]$ValidatedProposals, [System.Collections.Generic.List[object]]$ExistingProposals)
    if ($ExistingProposals.Count -eq 0) { return , $ValidatedProposals }
    $DedupedProposals = [System.Collections.Generic.List[object]]::new()
    foreach ($P in $ValidatedProposals) {
        $ActionType = $P.action.ToUpperInvariant()
        $IsDup = Test-TaxonomyProposalDuplicate -P $P -ActionType $ActionType -ExistingProposals $ExistingProposals

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
    , $DedupedProposals
}

# ── 9. Write proposal file ────────────────────────────────────────────────────

# Writes the proposal file and returns its path.
function Save-TaxonomyProposalFile {
    param([string]$RepoRoot, [string]$OutputFile, [string]$Model, [hashtable]$HealthData, $Proposals)
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
        proposals        = $Proposals
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
    $OutputFile
}

# ── 10. Human-readable summary ────────────────────────────────────────────────

# One proposal in the console summary. Pinned defect (t/4076 item 2): suggested_id, target_node_id,
# label and category are read unguarded, so a proposal without one of them throws here.
function Write-TaxonomyProposalSummaryEntry {
    param($P)
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
    if ($P.PSObject.Properties['children'] -and $null -ne $P.children -and @($P.children).Count -gt 0) {
        Write-Host "      Children:" -ForegroundColor Gray
        foreach ($Child in $P.children) {
            Write-Host "        [$($Child.suggested_id)] $($Child.label)" -ForegroundColor Gray
        }
    }
    if ($P.PSObject.Properties['merge_node_ids'] -and $null -ne $P.merge_node_ids -and @($P.merge_node_ids).Count -gt 0) {
        Write-Host "      Merging: $($P.merge_node_ids -join ', ') → $($P.surviving_node_id)" -ForegroundColor Gray
    }
}

function Show-TaxonomyProposalSummary {
    param($Proposals, [string]$Model, [hashtable]$HealthData, [int]$ProposalCount, [string]$OutputFile)
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  TAXONOMY PROPOSALS" -ForegroundColor White
    Write-Host "  Model: $Model  |  Taxonomy v$($HealthData.TaxonomyVersion)  |  $ProposalCount proposal(s)" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    foreach ($Action in $script:TaxonomyProposalDisplayColors.Keys) {
        $Group = @($Proposals | Where-Object { $_.action -eq $Action })
        if ($Group.Count -eq 0) { continue }

        Write-Host "`n  [$Action] ($($Group.Count))" -ForegroundColor $script:TaxonomyProposalDisplayColors[$Action]

        foreach ($P in $Group) { Write-TaxonomyProposalSummaryEntry -P $P }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Output: $OutputFile" -ForegroundColor Green
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
