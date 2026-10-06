# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-BatchExtractionMetric {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 8b (t/3910): append one line of per-run extraction
        metrics to calibration/core/extraction-metrics.jsonl, for tuning parameters #12-#15.
    .DESCRIPTION
        The line carries run totals, per-document density (claims per 1k words), density
        percentiles, and a near-duplicate key-point label count. Any failure only WARNs:
        metrics logging is non-critical.
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][object[]]$Succeeded = @(),
        [AllowEmptyCollection()][object[]]$Failed = @(),
        [int]$DocumentsTotal,
        [string]$Model,
        [double]$Temperature,
        [string]$TaxonomyVersion,
        [switch]$IterativeExtraction,
        [switch]$AutoFire,
        [Parameter(Mandatory)][string]$SourcesDir,
        [Parameter(Mandatory)][string]$SummariesDir
    )

    try {
        $CalibDir = Join-Path (Split-Path $SummariesDir -Parent) 'calibration'
        if (-not (Test-Path $CalibDir)) { New-Item -ItemType Directory -Path $CalibDir -Force | Out-Null }

        $ExtractionMetrics = @{
            timestamp            = (Get-Date -Format 'o')
            model                = $Model
            temperature          = $Temperature
            taxonomy_version     = $TaxonomyVersion
            documents_total      = $DocumentsTotal
            documents_success    = $Succeeded.Count
            documents_failed     = $Failed.Count
            fire_enabled         = [bool]($IterativeExtraction -or $AutoFire)
            total_key_points     = Get-BatchResultSum -Result $Succeeded -Property TotalPoints
            total_factual_claims = Get-BatchResultSum -Result $Succeeded -Property FactualCount
            total_unmapped       = Get-BatchResultSum -Result $Succeeded -Property UnmappedCount
            total_api_seconds    = Get-BatchResultSum -Result $Succeeded -Property ElapsedSecs
            per_document         = @($Succeeded | ForEach-Object { Get-BatchDocumentMetric -Result $_ -SourcesDir $SourcesDir })
        }
        $ExtractionMetrics['density_stats'] = Get-BatchDensityStat -PerDocument $ExtractionMetrics.per_document
        $DupCandidates = Get-BatchNearDuplicateLabelCount -Succeeded $Succeeded -SummariesDir $SummariesDir
        $ExtractionMetrics['near_duplicate_labels'] = $DupCandidates

        $CoreDir = Join-Path $CalibDir 'core'
        if (-not (Test-Path $CoreDir)) { $null = New-Item -ItemType Directory -Path $CoreDir -Force }
        $MetricsPath = Join-Path $CoreDir 'extraction-metrics.jsonl'

        # JSONL append — one compressed JSON object per line, no full-file rewrite
        $JsonLine = $ExtractionMetrics | ConvertTo-Json -Depth 5 -Compress
        Add-Content -Path $MetricsPath -Value $JsonLine -Encoding utf8

        Write-OK "Extraction metrics logged to calibration/core/extraction-metrics.jsonl (density mean: $($ExtractionMetrics.density_stats.mean ?? 'N/A') claims/1k words, $DupCandidates near-dup label pairs)"
    }
    catch {
        Write-Warn "Extraction metrics logging failed (non-critical): $_"
    }
}
