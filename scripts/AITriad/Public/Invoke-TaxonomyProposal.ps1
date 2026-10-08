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
        AI model to use. Defaults to env default or 'gemini-3.5-flash-lite'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via the backend-specific env var (AI_API_KEY is a fallback for gemini models only).
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
        Invoke-TaxonomyProposal -Model 'gemini-3.5-flash-lite'
    .EXAMPLE
        $h = Get-TaxonomyHealth -PassThru
        Invoke-TaxonomyProposal -HealthData $h
    .LINK
        Show-AITriadHelp
    .LINK
        Approve-TaxonomyProposal
    .LINK
        Invoke-HierarchyProposal
    .LINK
        Set-TaxonomyHierarchy
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model       = (Get-AITierModel -Tier basic),

        [string]$ApiKey      = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [string]$RepoRoot    = $script:RepoRoot,
        [switch]$DryRun,
        [switch]$IncludeHarvestQueue,
        [Alias('OutputPath')]
        [string]$OutputFile  = '',
        [hashtable]$HealthData = $null
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Each step lives in Private/InvokeTaxonomyProposalSteps.ps1 (t/3910). Behaviour is pinned by
    # tests/Invoke-TaxonomyProposal.Characterization.Tests.ps1.

    # ── 1. Validate environment ────────────────────────────────────────────────
    Write-Step "Validating environment"

    if (-not (Test-Path $RepoRoot)) {
        Write-Fail "Repo root not found: $RepoRoot"
        throw "Repo root not found: $RepoRoot"
    }

    if (-not $DryRun) {
        $ApiKey = Resolve-TaxonomyProposalApiKey -Model $Model -ApiKey $ApiKey
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

    $CompactNodes      = Get-TaxonomyProposalCompactNodeList
    $UnmappedForPrompt = Get-TaxonomyProposalUnmapped -HealthData $HealthData -CompactNodes $CompactNodes
    $CitationStats     = Get-TaxonomyProposalCitationStatistic -HealthData $HealthData
    $Context = @{
        TaxonomyNodesJson   = $CompactNodes | ConvertTo-Json -Depth 5 -Compress
        UnmappedJson        = $UnmappedForPrompt | ConvertTo-Json -Depth 5 -Compress
        CitationStatsJson   = $CitationStats | ConvertTo-Json -Depth 5 -Compress
        CoverageBalanceJson = $HealthData.CoverageBalance | ConvertTo-Json -Depth 10 -Compress
    }

    Write-OK "Compact nodes       : $($CompactNodes.Count)"
    Write-OK "Unmapped for prompt : $($UnmappedForPrompt.Count)"
    Write-OK "Orphan nodes        : $($CitationStats.orphan_nodes.Count)"
    Write-OK "High-variance nodes : $($CitationStats.high_variance.Count)"

    # ── 3b. Load vocabulary/dictionary ────────────────────────────────────────
    $Vocabulary = Get-TaxonomyProposalVocabulary
    $Context.StandardizedJson = $Vocabulary.Standardized
    $Context.ColloquialJson   = $Vocabulary.Colloquial

    # ── 4. Load prompt template ────────────────────────────────────────────────
    $Context.SystemPrompt = Get-Prompt -Name 'taxonomy-proposal' -Replacements @{
        TAXONOMY_VERSION = $HealthData.TaxonomyVersion
        SUMMARY_COUNT    = $HealthData.SummaryCount.ToString()
    }

    # ── 5. Assemble full prompt ────────────────────────────────────────────────
    $FullPrompt = ConvertTo-TaxonomyProposalPrompt -Context $Context
    if ($IncludeHarvestQueue) {
        $FullPrompt = Add-TaxonomyProposalHarvestQueue -FullPrompt $FullPrompt
    }

    $PromptLength = $FullPrompt.Length
    $EstTokens    = [int]($PromptLength / 4)
    Write-OK "Prompt assembled: $PromptLength chars (~$EstTokens tokens est.)"

    # ── 6. DRY RUN — print and return ─────────────────────────────────────────
    if ($DryRun) {
        Show-TaxonomyProposalDryRun -Context $Context -NodeCount $CompactNodes.Count -UnmappedCount $UnmappedForPrompt.Count
        return
    }

    # ── 7–8. Call the AI, then parse and validate the response ────────────────
    $AiResult       = Invoke-TaxonomyProposalAI -FullPrompt $FullPrompt -Model $Model -ApiKey $ApiKey -Temperature $Temperature
    $ProposalObject = ConvertFrom-TaxonomyProposalResponse -AiResult $AiResult -RepoRoot $RepoRoot

    $ValidatedProposals = Select-ValidTaxonomyProposal -Proposals @($ProposalObject.proposals)
    $ExistingProposals  = Get-ExistingTaxonomyProposal -RepoRoot $RepoRoot
    $ValidatedProposals = Select-NonDuplicateTaxonomyProposal -ValidatedProposals $ValidatedProposals -ExistingProposals $ExistingProposals

    $ProposalObject.proposals = @($ValidatedProposals)
    $ProposalCount = $ValidatedProposals.Count
    Write-OK "$ProposalCount proposal(s) after validation"

    # ── 9–10. Write the proposal file and print the summary ───────────────────
    # One ShouldProcess gate over the write step (t/4076 item 6): under -WhatIf nothing is written,
    # no directory is created, and nothing reports a write that didn't happen.
    $OutputFile = Resolve-TaxonomyProposalOutputPath -RepoRoot $RepoRoot -OutputFile $OutputFile
    if (-not $PSCmdlet.ShouldProcess($OutputFile, 'Write taxonomy proposal file')) {
        Write-Info "Proposal file not written (WhatIf): $ProposalCount proposal(s) would go to $OutputFile"
        return
    }
    $OutputFile = Save-TaxonomyProposalFile -RepoRoot $RepoRoot -OutputFile $OutputFile -Model $Model -HealthData $HealthData -Proposals $ProposalObject.proposals
    Show-TaxonomyProposalSummary -Proposals $ProposalObject.proposals -Model $Model -HealthData $HealthData -ProposalCount $ProposalCount -OutputFile $OutputFile
}
