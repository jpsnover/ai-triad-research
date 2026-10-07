# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Repair-PovLineage {
    <#
    .SYNOPSIS
        Enriches bare-string intellectual_lineage entries with descriptions,
        validated URLs, and categories.
    .DESCRIPTION
        Scans all taxonomy nodes' graph_attributes.intellectual_lineage arrays.
        Bare string entries (e.g., "Effective Altruism") are enriched with:
          - description: 2-5 sentence definition
          - url: Wikipedia or authoritative URL (validated via HEAD request)
          - category: philosophical_movement, economic_theory, etc.

        Processes unique values in batch (not per-node) to minimize AI calls.
        Caches results in a lineage-enrichments.json file for incremental re-runs.
    .PARAMETER NodeIds
        One or more taxonomy node IDs to process. Accepts pipeline input
        by value or by property name (Id, NodeId). If omitted, processes all nodes.
    .PARAMETER POV
        Filter to a specific POV file.
    .PARAMETER Model
        AI model for enrichment. Default: gemini-3.5-flash-lite.
    .PARAMETER ApiKey
        AI API key. Resolved from env if omitted.
    .PARAMETER BatchSize
        Number of lineage values per AI call. Default: 25.
    .PARAMETER SkipUrlValidation
        Skip HTTP HEAD URL validation (faster for testing).
    .PARAMETER Force
        Convert existing rich lineage objects (name/description/url/category)
        back to bare strings before processing, forcing full re-enrichment.
    .EXAMPLE
        Repair-PovLineage -WhatIf
    .EXAMPLE
        Repair-PovLineage -NodeIds acc-beliefs-001, acc-beliefs-002
    .EXAMPLE
        Get-Tax -POV accelerationist | Repair-PovLineage -SkipUrlValidation
    .EXAMPLE
        Repair-PovLineage -POV accelerationist -BatchSize 10
    .EXAMPLE
        Repair-PovLineage -Force
        # Re-enrich all lineage entries from scratch.
    .LINK
        Show-AITriadHelp
    .LINK
        Get-IntellectualLineage
    .LINK
        Get-PovLineage
    .LINK
        Repair-PovAttributes
    .LINK
        Repair-PovDescriptions
    .LINK
        Repair-ResolvedBackfill
    .LINK
        Repair-UnmappedConcepts
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('NodeId', 'Id')]
        [string[]]$NodeIds,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'situations')]
        [string]$POV,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = (Get-AITierModel -Tier basic),

        [string]$ApiKey,

        [ValidateRange(5, 50)]
        [int]$BatchSize = 25,

        [switch]$SkipUrlValidation,

        [switch]$FixUrls,

        [Parameter(HelpMessage = 'Convert existing rich lineage objects back to bare strings for re-enrichment')]
        [switch]$Force,

        [Parameter(HelpMessage = 'Regenerate lineage descriptions with 2-4 paragraph node-specific content')]
        [switch]$RegenerateContent,

        [Parameter(HelpMessage = 'Nodes per AI batch in RegenerateContent mode')]
        [ValidateRange(1, 10)]
        [int]$NodeBatchSize = 3
    )

    begin {
        $CollectedIds = [System.Collections.Generic.List[string]]::new()
    }

    process {
        if ($NodeIds) {
            foreach ($nid in $NodeIds) {
                if (-not [string]::IsNullOrWhiteSpace($nid)) { $CollectedIds.Add($nid) }
            }
        }
    }

    end {
    # Build filter set from collected IDs (empty = process all)
    $FilterNodeIds = $null
    if ($CollectedIds.Count -gt 0) {
        $FilterNodeIds = [System.Collections.Generic.HashSet[string]]::new(
            [string[]]@($CollectedIds), [System.StringComparer]::OrdinalIgnoreCase)
    }

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $CacheDir = Join-Path (Get-DataRoot) 'calibration' 'core'
    if (-not (Test-Path $CacheDir)) { $null = New-Item -ItemType Directory -Path $CacheDir -Force }
    $CachePath = Join-Path $CacheDir 'lineage-enrichments.json'

    # ── Load cache ────────────────────────────────────────────────────────────
    $Cache = @{}
    if (Test-Path $CachePath) {
        $CacheData = Get-Content $CachePath -Raw | ConvertFrom-Json -AsHashtable
        if ($CacheData) { $Cache = $CacheData }
        Write-Verbose "Loaded $($Cache.Count) cached enrichments"
    }

    # URL validation helper (GET-based, soft-404 detection) lives in Private/Test-LineageUrl.ps1 —
    # migrated to the shared Node fetch-CLI (Get-UrlViaSharedFetcher) so live WAF-protected citations
    # aren't 403'd-as-dead by the PS client fingerprint (t/3313). Extracted for unit-testability.
    # Each mode's steps live in Private/RepairPovLineageSteps.ps1 (t/3910).

    # ── FixUrls mode: scan cache, validate via GET, Wikipedia fallback ────────
    if ($FixUrls) {
        Invoke-LineageUrlFix -Cache $Cache -CachePath $CachePath -TaxDir $TaxDir
        return
    }

    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    if ($POV) { $PovFiles = @($POV) }

    # ── RegenerateContent mode: per-node 2-4 paragraph descriptions ──────────
    if ($RegenerateContent) {
        Invoke-LineageRegenerate -TaxDir $TaxDir -PovFiles $PovFiles -FilterNodeIds $FilterNodeIds `
            -Model $Model -ApiKey $ApiKey -NodeBatchSize $NodeBatchSize
        return
    }

    # ── Default mode: enrich bare-string lineage entries ──────────────────────
    Invoke-LineageEnrich -TaxDir $TaxDir -PovFiles $PovFiles -FilterNodeIds $FilterNodeIds -CollectedIds $CollectedIds `
        -Cache $Cache -CachePath $CachePath -Model $Model -ApiKey $ApiKey -BatchSize $BatchSize `
        -SkipUrlValidation:$SkipUrlValidation -Force:$Force -Cmdlet $PSCmdlet
    } # end
}
