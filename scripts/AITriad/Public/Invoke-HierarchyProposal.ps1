# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-HierarchyProposal {
    <#
    .SYNOPSIS
        Proposes parent-child hierarchy for flat taxonomy nodes using embeddings, edges, and AI.
    .DESCRIPTION
        Processes each POV/category bucket: clusters nodes via embeddings, enriches clusters
        with edge and graph-attribute evidence, then sends each bucket to an AI model to
        propose parent nodes and child assignments. Outputs a proposal JSON file for human review.
    .EXAMPLE
        Invoke-HierarchyProposal
        Invoke-HierarchyProposal -POV accelerationist -Category 'Intentions'
        Invoke-HierarchyProposal -DryRun
    .LINK
        Show-AITriadHelp
    .LINK
        Approve-TaxonomyProposal
    .LINK
        Invoke-TaxonomyProposal
    .LINK
        Set-TaxonomyHierarchy
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations')]
        [string]$POV = '',

        [ValidateScript({ Test-CategoryParameter $_ })]
        [string]$Category = '',

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = (Get-AITierModel -Tier basic),

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [ValidateRange(0.20, 0.80)]
        [double]$MinSimilarity = 0.40,

        [Alias('OutputPath')]
        [string]$OutputDir = '',

        [switch]$DryRun
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Resolve paths ────────────────────────────────────────────────────────
    # The output directory is only created right before a write (t/4071), so -DryRun and the
    # no-proposal paths leave the data tree untouched.
    $TaxDir = Get-TaxonomyDir
    $OutputDir = Resolve-HierarchyOutputDir -OutputDir $OutputDir

    # ── Resolve API key ──────────────────────────────────────────────────────
    # -DryRun only previews the prompt, so it needs no key (t/4071).
    # Backend from ai-models.json, never guessed (t/4087). $ResolvedKey is the key FORWARDED to
    # Invoke-AIApi: only the user's own -ApiKey (or ''), never an env key resolved here.
    $ResolvedKey = $ApiKey
    if (-not $DryRun) {
        $KeyStatus = Get-AIModelKeyStatus -Model $Model -ApiKey $ApiKey
        if (-not $KeyStatus.HasKey) {
            Write-Fail "No API key found for backend '$($KeyStatus.Backend)'. Set $($KeyStatus.EnvHint) or AI_API_KEY, or pass -ApiKey."
            return
        }
    }

    # ── Load taxonomy, embeddings and edges ──────────────────────────────────
    Write-Step 'Loading taxonomy data'
    $PovFileMap = @{
        accelerationist = 'accelerationist.json'
        safetyist       = 'safetyist.json'
        skeptic         = 'skeptic.json'
        'situations' = 'situations.json'
    }
    $AllTaxData = Import-HierarchyTaxonomy -TaxDir $TaxDir -PovFileMap $PovFileMap

    Write-Step 'Loading embeddings'
    $Embeddings = Import-HierarchyEmbeddingTable -TaxDir $TaxDir

    Write-Step 'Loading edges'
    $AllEdges = Import-HierarchyApprovedEdgeList -TaxDir $TaxDir

    # ── Build processing buckets ─────────────────────────────────────────────
    Write-Step 'Building processing buckets'
    $Buckets = Get-HierarchyBucketList -AllTaxData $AllTaxData -POV $POV -Category $Category
    Write-OK "$($Buckets.Count) buckets to process"
    foreach ($B in $Buckets) {
        Write-Info "$($B.POV) / $(Get-HierarchyCategoryLabel -Bucket $B)`: $($B.Nodes.Count) nodes"
    }

    # ── Load prompts ─────────────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'hierarchy-proposal'
    $SchemaPrompt = Get-Prompt -Name 'hierarchy-proposal-schema'

    # ── Process each bucket: cluster, enrich, prompt, call, validate ─────────
    $AllProposals = [System.Collections.Generic.List[PSObject]]::new()
    $BucketNum    = 0

    foreach ($Bucket in $Buckets) {
        $BucketNum++
        Write-Step "Bucket $BucketNum/$($Buckets.Count): $($Bucket.POV) / $(Get-HierarchyCategoryLabel -Bucket $Bucket) ($($Bucket.Nodes.Count) nodes)"

        $NodeIds     = @($Bucket.Nodes | ForEach-Object { $_.id })
        $Clusters    = Get-HierarchyBucketClusterSet -Bucket $Bucket -NodeIds $NodeIds -Embeddings $Embeddings -MinSimilarity $MinSimilarity
        $ClusterData = ConvertTo-HierarchyClusterData -Clusters $Clusters -Bucket $Bucket -AllEdges $AllEdges
        $FullPrompt  = Get-HierarchyBucketPrompt -Bucket $Bucket -ClusterData $ClusterData -SystemPrompt $SystemPrompt -SchemaPrompt $SchemaPrompt

        if ($DryRun) {
            Show-HierarchyDryRunPrompt -FullPrompt $FullPrompt
            if ($BucketNum -eq 1) { return }
            continue
        }

        $Proposal = Invoke-HierarchyBucket -Bucket $Bucket -NodeIds $NodeIds -FullPrompt $FullPrompt `
            -ClusterCount $ClusterData.Count -Model $Model -ResolvedKey $ResolvedKey `
            -Temperature $Temperature -MinSimilarity $MinSimilarity
        if ($null -ne $Proposal) { $AllProposals.Add($Proposal) }
    }

    # ── Write output ─────────────────────────────────────────────────────────
    if ($AllProposals.Count -eq 0) {
        Write-Warn 'No proposals generated'
        return
    }

    $Timestamp  = (Get-Date).ToString('yyyy-MM-dd-HHmmss')
    $OutputFile = Join-Path $OutputDir "hierarchy-proposal-$Timestamp.json"

    $OutputObj = [ordered]@{
        generated_at = (Get-Date).ToString('o')
        model        = $Model
        buckets      = $AllProposals.ToArray()
    }

    $Json = $OutputObj | ConvertTo-Json -Depth 30
    if ($PSCmdlet.ShouldProcess($OutputFile, 'Write hierarchy proposal')) {
        Initialize-HierarchyOutputDir -OutputDir $OutputDir
        Write-Utf8NoBom -Path $OutputFile -Value $Json
        Write-Step 'Done'
        Write-OK "Proposal saved to $OutputFile"
    }

    # ── Generate review Markdown (after the proposal is written) ─────────────
    $ReviewFile = Join-Path $OutputDir "hierarchy-review-$Timestamp.md"
    $ReviewMd = ConvertTo-HierarchyReviewMarkdown -AllProposals $AllProposals -Model $Model -Timestamp $Timestamp `
        -AllTaxData $AllTaxData -PovFileMap $PovFileMap

    if ($PSCmdlet.ShouldProcess($ReviewFile, 'Write review Markdown')) {
        Initialize-HierarchyOutputDir -OutputDir $OutputDir
        Write-Utf8NoBom -Path $ReviewFile -Value $ReviewMd
        Write-OK "Review document saved to $ReviewFile"
    }

    return [PSCustomObject]@{
        ProposalFile = $OutputFile
        ReviewFile   = $ReviewFile
        BucketCount  = $AllProposals.Count
        TotalParents = Get-HierarchyTotalParentCount -AllProposals $AllProposals
    }
}
