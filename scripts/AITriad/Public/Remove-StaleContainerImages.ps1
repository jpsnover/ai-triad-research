# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Remove-StaleContainerImages {
    <#
    .SYNOPSIS
        Deletes untagged GHCR container image versions older than a cutoff, keeping N most recent.
    .DESCRIPTION
        Consolidates the paginate→filter→delete pattern hand-rolled in
        `.github/workflows/ghcr-cleanup.yml` (t/1492). Paginates the GitHub
        Packages API for a container package, filters to untagged versions
        older than the cutoff, and deletes all but the N most recent.

        Supports -WhatIf and -Confirm — the delete step is guarded by
        ShouldProcess, so `-WhatIf` lists exactly what would be deleted
        without touching the registry.

        Returns a StaleImageCleanupResult with kept/deleted counts, the
        list of deleted version IDs, and any per-version failure messages.
    .PARAMETER Owner
        GitHub owner (user or org) that owns the package. Defaults to the
        GHCR_OWNER env var, then GITHUB_REPOSITORY_OWNER, then 'jpsnover'.
    .PARAMETER Package
        Container package name (e.g. 'taxonomy-editor').
    .PARAMETER OlderThanDays
        Only delete versions whose updated_at is older than this many days.
        Default: 30.
    .PARAMETER KeepLatest
        Always keep the N most recently updated untagged versions,
        regardless of age. Default: 5.
    .PARAMETER MaxPages
        Safety cap on pagination. Default: 10 (up to 1000 versions).
    .EXAMPLE
        Remove-StaleContainerImages -Package taxonomy-editor -WhatIf
    .EXAMPLE
        Remove-StaleContainerImages -Package ai-triad-base -KeepLatest 10 -OlderThanDays 14
    #>
    [CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
    param(
        [Parameter()]
        [string]$Owner,

        [Parameter(Mandatory)]
        [string]$Package,

        [Parameter()]
        [ValidateRange(0, 3650)]
        [int]$OlderThanDays = 30,

        [Parameter()]
        [ValidateRange(0, 100)]
        [int]$KeepLatest = 5,

        [Parameter()]
        [ValidateRange(1, 50)]
        [int]$MaxPages = 10
    )

    Set-StrictMode -Version Latest

    if (-not $Owner) {
        $Owner = if ($env:GHCR_OWNER) { $env:GHCR_OWNER }
                 elseif ($env:GITHUB_REPOSITORY_OWNER) { $env:GITHUB_REPOSITORY_OWNER }
                 else { 'jpsnover' }
    }

    $Cutoff = (Get-Date).ToUniversalTime().AddDays(-$OlderThanDays)
    Write-Verbose "Owner=$Owner Package=$Package OlderThanDays=$OlderThanDays KeepLatest=$KeepLatest Cutoff=$($Cutoff.ToString('o'))"

    # ── Paginate versions ────────────────────────────────────────────────
    $AllVersions = [System.Collections.Generic.List[object]]::new()
    for ($Page = 1; $Page -le $MaxPages; $Page++) {
        $Endpoint = "/users/$Owner/packages/container/$Package/versions?per_page=100&page=$Page"
        $Batch = $null
        try {
            $Batch = Invoke-GitHubApi -Endpoint $Endpoint -Method 'GET' -CallerName 'Remove-StaleContainerImages'
        } catch {
            # Missing package → nothing to do (matches workflow's early-exit behavior).
            if ($_.Exception.Message -match 'Resource not found') {
                Write-Verbose "Package '$Package' not found under owner '$Owner' — nothing to clean up"
                $Result = [StaleImageCleanupResult]::new()
                $Result.Package         = $Package
                $Result.Owner           = $Owner
                $Result.TotalUntagged   = 0
                $Result.KeptCount       = 0
                $Result.DeletedCount    = 0
                $Result.DeletedIds      = @()
                $Result.Failures        = @()
                $Result.CutoffUtc       = $Cutoff.ToString('o')
                return $Result
            }
            throw
        }
        if (-not $Batch) { break }
        $BatchArray = @($Batch)
        foreach ($v in $BatchArray) { $AllVersions.Add($v) }
        if ($BatchArray.Count -lt 100) { break }  # last page
    }

    # ── Filter to untagged, sort newest first ────────────────────────────
    $Untagged = @(
        $AllVersions | Where-Object {
            $_.PSObject.Properties['metadata'] -and
            $_.metadata.PSObject.Properties['container'] -and
            $_.metadata.container.PSObject.Properties['tags'] -and
            @($_.metadata.container.tags).Count -eq 0
        } | Sort-Object -Property updated_at -Descending
    )

    $TotalUntagged = $Untagged.Count
    Write-Verbose "Untagged versions found: $TotalUntagged"

    # ── Compute delete set ───────────────────────────────────────────────
    $ToDelete = @()
    if ($TotalUntagged -gt $KeepLatest) {
        $Candidates = $Untagged | Select-Object -Skip $KeepLatest
        $ToDelete = @(
            $Candidates | Where-Object {
                ([datetime]$_.updated_at).ToUniversalTime() -lt $Cutoff
            }
        )
    }

    Write-Verbose "Versions to delete: $($ToDelete.Count)"

    # ── Delete (guarded by ShouldProcess) ────────────────────────────────
    $DeletedIds = [System.Collections.Generic.List[long]]::new()
    $Failures   = [System.Collections.Generic.List[string]]::new()
    foreach ($v in $ToDelete) {
        $Target = "version $($v.id) (updated $($v.updated_at))"
        if ($PSCmdlet.ShouldProcess($Target, "Delete untagged $Package")) {
            try {
                $null = Invoke-GitHubApi `
                    -Endpoint "/users/$Owner/packages/container/$Package/versions/$($v.id)" `
                    -Method DELETE `
                    -CallerName 'Remove-StaleContainerImages'
                $DeletedIds.Add([long]$v.id)
            } catch {
                $Failures.Add("$($v.id): $($_.Exception.Message)")
                Write-Warning "Failed to delete version $($v.id): $($_.Exception.Message)"
            }
        }
    }

    $Result = [StaleImageCleanupResult]::new()
    $Result.Package         = $Package
    $Result.Owner           = $Owner
    $Result.TotalUntagged   = $TotalUntagged
    $Result.KeptCount       = [Math]::Min($TotalUntagged, $KeepLatest)
    $Result.DeletedCount    = $DeletedIds.Count
    $Result.DeletedIds      = @($DeletedIds)
    $Result.Failures        = @($Failures)
    $Result.CutoffUtc       = $Cutoff.ToString('o')
    $Result
}
