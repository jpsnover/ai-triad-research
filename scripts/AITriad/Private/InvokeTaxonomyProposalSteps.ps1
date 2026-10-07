# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Steps of Invoke-TaxonomyProposal (t/3910 complexity refactor). Behaviour is pinned by
# tests/Invoke-TaxonomyProposal.Characterization.Tests.ps1. These helpers run under the caller's
# Set-StrictMode -Version Latest and $ErrorActionPreference = 'Stop' (dynamic scope), so every
# model-supplied or dictionary-supplied field is read through Get-TaxonomyProposalValue (t/4076):
# a direct read of a key the model omitted throws under StrictMode.
# Collections that must keep their exact shape (empty, or a single element) are returned with the
# unary comma so the pipeline doesn't unroll them.

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

# Console summary: the action groups shown, in order, with their colours. Every action the validator
# accepts is listed, so nothing written to the proposal file is left out of the summary (t/4076 item 8).
$script:TaxonomyProposalDisplayColors = [ordered]@{
    NEW = 'Green'; SPLIT = 'Cyan'; MERGE = 'Yellow'; RELABEL = 'Magenta'
    REORDER = 'Blue'; DEPTH_EXPAND = 'DarkCyan'; WIDTH_EXPAND = 'DarkGreen'
}

# A field of a model- or dictionary-supplied object, or nothing when the key is absent (t/4076).
# Reading $Obj.<name> directly throws under the caller's StrictMode when the key was omitted.
# Emits no value (not $null) for an absent key, so @(Get-TaxonomyProposalValue ...) is an empty array.
function Get-TaxonomyProposalValue {
    param($Obj, [string]$Name)
    if ($null -eq $Obj -or $Obj -isnot [System.Management.Automation.PSCustomObject]) { return }
    if (-not $Obj.PSObject.Properties[$Name]) { return }
    $Obj.$Name
}

# ── 1. Environment ────────────────────────────────────────────────────────────

function Resolve-TaxonomyProposalApiKey {
    # Checks that a key exists for the model's REGISTRY backend (never a prefix guess), or throws naming
    # the env var to set. Returns the key to FORWARD: only the user's own -ApiKey (or ''), never an env
    # key resolved here; Invoke-AIApi resolves the key for the registry backend itself (t/4087).
    param([string]$Model, [string]$ApiKey)
    $KeyStatus = Get-AIModelKeyStatus -Model $Model -ApiKey $ApiKey
    if (-not $KeyStatus.HasKey) {
        Write-Fail "No API key found for $($KeyStatus.Backend) backend."
        Write-Info "Set $($KeyStatus.EnvHint) or AI_API_KEY, or pass -ApiKey."
        throw "No API key found for $($KeyStatus.Backend) backend."
    }
    $ApiKey
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

# True when the term has every required key. Otherwise warns, naming the term, the missing keys and
# the file, and returns $false so the caller skips it instead of crashing the run (t/4076 item 3).
function Test-TaxonomyProposalTermComplete {
    param($T, [string[]]$Required, [string]$NameKey, [string]$Path)
    $Missing = @($Required | Where-Object { $null -eq $T -or -not $T.PSObject.Properties[$_] })
    if ($Missing.Count -eq 0) { return $true }
    $Name = Get-TaxonomyProposalValue $T $NameKey
    if (-not $Name) { $Name = [System.IO.Path]::GetFileNameWithoutExtension($Path) }
    Write-Warning "Dictionary term '$Name' skipped: missing $($Missing -join ', ') ($Path). Fix the term file to include it in the prompt vocabulary."
    $false
}

# The list fields are wrapped in @(...) so a one-element list stays an array and an absent one is []
# in the prompt JSON, not a bare string or null (t/4076 item 7).
function ConvertTo-TaxonomyProposalStandardizedTerm {
    param([string]$Path)
    $T = Get-Content $Path -Raw | ConvertFrom-Json
    $Required = 'canonical_form', 'display_form', 'definition', 'primary_camp_origin'
    if (-not (Test-TaxonomyProposalTermComplete -T $T -Required $Required -NameKey 'canonical_form' -Path $Path)) { return }
    @{
        canonical_form    = $T.canonical_form
        display_form      = $T.display_form
        definition        = $T.definition
        primary_camp      = $T.primary_camp_origin
        used_by_nodes     = @(Get-TaxonomyProposalValue $T 'used_by_nodes')
        do_not_confuse    = @(Get-TaxonomyProposalValue $T 'do_not_confuse_with' | ForEach-Object { "$($_.term): $($_.note)" })
    }
}

function ConvertTo-TaxonomyProposalColloquialTerm {
    param([string]$Path)
    $T = Get-Content $Path -Raw | ConvertFrom-Json
    if (-not (Test-TaxonomyProposalTermComplete -T $T -Required 'colloquial_term', 'status' -NameKey 'colloquial_term' -Path $Path)) { return }
    @{
        colloquial_term = $T.colloquial_term
        status          = $T.status
        resolves_to     = @(Get-TaxonomyProposalValue $T 'resolves_to' | ForEach-Object { "$($_.standardized_term) ($($_.default_for_camp))" })
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

# Parses the response, repairing truncated JSON. When neither the response nor its repair parses, the
# raw response is saved to a debug file and an ActionableError names the parse failure (t/4076 item 4).
function ConvertFrom-TaxonomyProposalResponse {
    param($AiResult, [string]$RepoRoot)
    Write-Step "Parsing AI response"

    $ProposalObject = $null
    $RawText     = $AiResult.Text
    $CleanedText = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $CleanedText = $CleanedText.Trim()

    try {
        $ProposalObject = $CleanedText | ConvertFrom-Json
        Write-OK "Valid JSON received"
    }
    catch {
        $ParseError = $_.Exception.Message
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
            Save-TaxonomyProposalDebugFile -RepoRoot $RepoRoot -RawText $RawText -ParseError $ParseError
        }
    }
    Resolve-TaxonomyProposalObject -ProposalObject $ProposalObject
}

# The parsed response with a proposals array. A response that isn't a JSON object, or has no (or an
# empty or null) 'proposals' key, takes the WARN + empty-list path instead of throwing (t/4076 item 5).
function Resolve-TaxonomyProposalObject {
    param($ProposalObject)
    $Missing = "Response missing 'proposals' array — may be empty or malformed"
    if ($ProposalObject -isnot [System.Management.Automation.PSCustomObject]) {
        Write-Warn $Missing
        return [pscustomobject]@{ proposals = @() }
    }
    if (-not $ProposalObject.PSObject.Properties['proposals']) {
        Write-Warn $Missing
        $ProposalObject | Add-Member -NotePropertyName 'proposals' -NotePropertyValue @()
    }
    elseif (-not $ProposalObject.proposals) {
        Write-Warn $Missing
        $ProposalObject.proposals = @()
    }
    $ProposalObject
}

function Save-TaxonomyProposalDebugFile {
    param([string]$RepoRoot, [string]$RawText, [string]$ParseError)
    $DebugPath = Join-Path (Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals') "proposal-debug-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    if (-not (Test-Path $ProposalsDir)) { New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null }
    Write-Utf8NoBom -Path $DebugPath -Value $RawText
    Write-Fail "AI returned invalid JSON. Raw response saved: $DebugPath"
    throw (New-ActionableError -PassThru `
        -Goal 'Parse the AI taxonomy proposal response' `
        -Problem "AI returned invalid JSON for taxonomy proposal, and repair failed: $ParseError" `
        -Location 'Invoke-TaxonomyProposal (ConvertFrom-TaxonomyProposalResponse)' `
        -NextSteps @("Inspect the raw response saved at $DebugPath", 'Re-run; if it recurs, try another -Model or a lower -Temperature'))
}

# ── Gap 9.1: schema validation per proposal type ──────────────────────────────

# The base checks every proposal gets. Every field is read through Get-TaxonomyProposalValue, so a
# proposal missing a key is rejected with a message naming it, instead of aborting the run (t/4076 item 1).
function Get-TaxonomyProposalBaseError {
    param($P, [string]$ActionType)
    $Errors = [System.Collections.Generic.List[string]]::new()
    $Pov      = Get-TaxonomyProposalValue $P 'pov'
    $Category = Get-TaxonomyProposalValue $P 'category'
    $LabelOptional = $ActionType -in @('MERGE','REORDER')

    if (-not $ActionType -or $ActionType -notin @('NEW','SPLIT','MERGE','RELABEL','REORDER','DEPTH_EXPAND','WIDTH_EXPAND')) {
        $Errors.Add("invalid or missing action type '$(Get-TaxonomyProposalValue $P 'action')'")
    }
    if ($Pov -notin @('accelerationist','safetyist','skeptic','situations')) {
        $Errors.Add("invalid or missing pov '$Pov'")
    }
    if ($Pov -ne 'situations' -and $Category -notin @('Desires','Beliefs','Intentions') -and -not $LabelOptional) {
        $Errors.Add("invalid or missing category '$Category' for non-situations node")
    }
    if ([string]::IsNullOrWhiteSpace([string](Get-TaxonomyProposalValue $P 'label')) -and -not $LabelOptional) {
        $Errors.Add("missing label")
    }
    if ([string]::IsNullOrWhiteSpace([string](Get-TaxonomyProposalValue $P 'rationale'))) {
        $Errors.Add("missing rationale")
    }
    , $Errors
}

function Test-TaxonomyProposalRule {
    param($P, [hashtable]$Rule)
    if ($null -eq $P -or -not $P.PSObject.Properties[$Rule.Field]) { return $false }
    if ($Rule.Kind -eq 'MinCount') { return (@($P.($Rule.Field)).Count -ge 2) }
    -not [string]::IsNullOrWhiteSpace($P.($Rule.Field))
}

# The upper-cased action of a proposal, or $null when it has none.
function Get-TaxonomyProposalActionType {
    param($P)
    $Action = [string](Get-TaxonomyProposalValue $P 'action')
    if ($Action) { $Action.ToUpperInvariant() } else { $null }
}

# Up to 40 characters of a proposal's label, or '(no label)'.
function Get-TaxonomyProposalShortLabel {
    param($P)
    $Label = [string](Get-TaxonomyProposalValue $P 'label')
    if ($Label) { $Label.Substring(0, [Math]::Min(40, $Label.Length)) } else { '(no label)' }
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
        $ActionType = Get-TaxonomyProposalActionType $P
        $Errors = Get-TaxonomyProposalError -P $P -ActionType $ActionType

        $PLabel = Get-TaxonomyProposalShortLabel $P
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
        [string[]](([string]$P.label).ToLowerInvariant() -split '\s+'),
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $ExWords = [System.Collections.Generic.HashSet[string]]::new(
        [string[]](([string]$Existing.label).ToLowerInvariant() -split '\s+'),
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
        $ExAction = [string](Get-TaxonomyProposalActionType $Existing)
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
        $ActionType = Get-TaxonomyProposalActionType $P
        $IsDup = Test-TaxonomyProposalDuplicate -P $P -ActionType $ActionType -ExistingProposals $ExistingProposals

        # A label-less MERGE or REORDER is valid; reading $P.label directly threw here (t/4076 item 2).
        $PLabel = Get-TaxonomyProposalShortLabel $P
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

# The proposal file's path: -OutputFile, or taxonomy/proposals/proposal-<timestamp>.json.
function Resolve-TaxonomyProposalOutputPath {
    param([string]$RepoRoot, [string]$OutputFile)
    if ($OutputFile) { return $OutputFile }
    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    Join-Path $ProposalsDir "proposal-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
}

# Writes the proposal file to $OutputFile (already resolved) and returns its path.
function Save-TaxonomyProposalFile {
    param([string]$RepoRoot, [string]$OutputFile, [string]$Model, [hashtable]$HealthData, $Proposals)
    Write-Step "Writing proposal file"

    $ProposalsDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'proposals'
    if (-not (Test-Path $ProposalsDir)) {
        New-Item -ItemType Directory -Path $ProposalsDir -Force | Out-Null
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

# One proposal in the console summary. Optional fields (suggested_id for MERGE/SPLIT/RELABEL,
# target_node_id for MERGE, label for MERGE/REORDER) are read through Get-TaxonomyProposalValue and
# simply omitted when absent (t/4076 item 2).
function Write-TaxonomyProposalSummaryEntry {
    param($P)
    $SuggestedId = Get-TaxonomyProposalValue $P 'suggested_id'
    $TargetId    = Get-TaxonomyProposalValue $P 'target_node_id'
    $Rationale   = [string](Get-TaxonomyProposalValue $P 'rationale')
    $IdStr     = if ($SuggestedId) { "[$SuggestedId]" } else { '' }
    $TargetStr = if ($TargetId) { " (target: $TargetId)" } else { '' }
    Write-Host "    $IdStr $(Get-TaxonomyProposalValue $P 'label')$TargetStr" -ForegroundColor White
    Write-Host "      POV: $(Get-TaxonomyProposalValue $P 'pov')  |  Category: $(Get-TaxonomyProposalValue $P 'category')" -ForegroundColor Gray
    if ($Rationale) {
        $RatSnippet = if ($Rationale.Length -gt 120) { $Rationale.Substring(0, 120) + '...' } else { $Rationale }
        Write-Host "      Rationale: $RatSnippet" -ForegroundColor DarkGray
    }
    $Children = @(Get-TaxonomyProposalValue $P 'children' | Where-Object { $null -ne $_ })
    if ($Children.Count -gt 0) {
        Write-Host "      Children:" -ForegroundColor Gray
        foreach ($Child in $Children) {
            Write-Host "        [$(Get-TaxonomyProposalValue $Child 'suggested_id')] $(Get-TaxonomyProposalValue $Child 'label')" -ForegroundColor Gray
        }
    }
    $MergeIds = @(Get-TaxonomyProposalValue $P 'merge_node_ids' | Where-Object { $null -ne $_ })
    if ($MergeIds.Count -gt 0) {
        Write-Host "      Merging: $($MergeIds -join ', ') → $(Get-TaxonomyProposalValue $P 'surviving_node_id')" -ForegroundColor Gray
    }
    $NewParent = Get-TaxonomyProposalValue $P 'new_parent_id'
    if ($NewParent) { Write-Host "      New parent: $NewParent" -ForegroundColor Gray }
}

function Show-TaxonomyProposalSummary {
    param($Proposals, [string]$Model, [hashtable]$HealthData, [int]$ProposalCount, [string]$OutputFile)
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  TAXONOMY PROPOSALS" -ForegroundColor White
    Write-Host "  Model: $Model  |  Taxonomy v$($HealthData.TaxonomyVersion)  |  $ProposalCount proposal(s)" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    foreach ($Action in $script:TaxonomyProposalDisplayColors.Keys) {
        $Group = @($Proposals | Where-Object { (Get-TaxonomyProposalActionType $_) -eq $Action })
        if ($Group.Count -eq 0) { continue }

        Write-Host "`n  [$Action] ($($Group.Count))" -ForegroundColor $script:TaxonomyProposalDisplayColors[$Action]

        # The proposal file is already written, so a display failure must not fail the run (t/4076 item 2).
        foreach ($P in $Group) {
            try { Write-TaxonomyProposalSummaryEntry -P $P }
            catch { Write-Warning "Console summary: a [$Action] proposal could not be displayed ($($_.Exception.Message)); it is in the written proposal file $OutputFile." }
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Output: $OutputFile" -ForegroundColor Green
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
