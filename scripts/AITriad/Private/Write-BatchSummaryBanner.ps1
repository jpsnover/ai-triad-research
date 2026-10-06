# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-BatchSummaryBanner {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 0 console banner (t/3910): the resolved settings and
        which modes/filters are active.
    .PARAMETER ImportedSince
        $null when -ImportedSince was not bound.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$TaxonomyVersion,
        [string]$Model,
        [double]$Temperature,
        [int]$MaxConcurrent,
        [switch]$DryRun,
        [switch]$ForceAll,
        [string[]]$DocIdFilter = @(),
        [switch]$SkipConflictDetection,
        [switch]$ImportedToday,
        [Nullable[datetime]]$ImportedSince
    )

    Write-OK "Repo root         : $RepoRoot"
    Write-OK "Taxonomy version  : $TaxonomyVersion"
    Write-OK "Model             : $Model"
    Write-OK "Temperature       : $Temperature"
    Write-OK "MaxConcurrent     : $MaxConcurrent"
    if ($DryRun)                { Write-Warn "DRY RUN — no API calls, no file writes" }
    if ($ForceAll)              { Write-Warn "FORCE ALL — every document will be reprocessed" }
    if ($DocIdFilter.Count -gt 0) { Write-Info "Doc filter ($($DocIdFilter.Count)): $($DocIdFilter -join ', ')" }
    if ($SkipConflictDetection) { Write-Info "Conflict detection: skipped" }
    if ($ImportedToday)         { Write-Info "Filtering to documents imported today" }
    if ($null -ne $ImportedSince) { Write-Info "Filtering to documents imported since $($ImportedSince.ToString('yyyy-MM-dd'))" }
}
