# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-AITSBOMPackageUpdate {
    <#
    .SYNOPSIS
        Get-AITSBOM's -Update orchestration: lists outdated packages,
        prompts for confirmation unless -Force, then updates each via
        Update-AITSBOMOutdatedPackage. Extracted verbatim (t/3910) -- no
        behavior change.
    .PARAMETER Entries
        The full SBOM entries list (already passed through -CheckUpdates).
    .PARAMETER RepoRoot
        Repository root path.
    .PARAMETER Force
        Skip the confirmation prompt.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries,

        [Parameter(Mandatory)]
        [string]$RepoRoot,

        [switch]$Force
    )

    Set-StrictMode -Version Latest

    $Outdated = @($Entries | Where-Object { $_.Status -eq 'outdated' })
    if ($Outdated.Count -eq 0) {
        Write-Host '  All packages are up to date.' -ForegroundColor Green
        return
    }

    Write-Host "  $($Outdated.Count) outdated package(s) found:" -ForegroundColor Yellow
    foreach ($Pkg in $Outdated) {
        Write-Host "    $($Pkg.Name): $($Pkg.Version) → $($Pkg.LatestVersion) ($($Pkg.Type))" -ForegroundColor Yellow
    }

    $ProceedWithUpdate = $true
    if (-not $Force) {
        $Confirm = Read-Host "`n  Update all? (y/N)"
        if ($Confirm -notin @('y', 'Y', 'yes')) {
            Write-Host '  Update cancelled.' -ForegroundColor Gray
            $ProceedWithUpdate = $false
        }
    }

    if ($ProceedWithUpdate) {
        foreach ($Pkg in $Outdated) {
            Update-AITSBOMOutdatedPackage -Package $Pkg -RepoRoot $RepoRoot
        }
    }
}
