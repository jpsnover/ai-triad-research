# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMOutdatedPackage {
    <#
    .SYNOPSIS
        Updates ONE outdated SBOM package via its own package manager
        (npm/npm-dev, python, ps-module; anything else is skipped with a
        verbose note). Extracted verbatim from Get-AITSBOM's -Update loop
        (t/3910) -- no behavior change, including which types prompt via
        ShouldProcess vs. update unconditionally (python/ps-module do not
        call ShouldProcess in the original code; preserved as-is).
    .PARAMETER Package
        One outdated SBOM entry.
    .PARAMETER RepoRoot
        Repository root path (used to resolve the npm app directory).
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Package,

        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    Set-StrictMode -Version Latest

    try {
        switch ($Package.Type) {
            { $_ -in @('npm', 'npm-dev') } {
                $AppDir = ($Package.Source -split '/')[0]
                if ($AppDir -eq 'package.json') { $WorkDir = $RepoRoot } else { $WorkDir = Join-Path $RepoRoot $AppDir }
                if ($PSCmdlet.ShouldProcess($Package.Name, "npm update in $AppDir")) {
                    Push-Location $WorkDir
                    npm update $Package.Name 2>&1 | Out-Null
                    Pop-Location
                    Write-Host "    Updated $($Package.Name)" -ForegroundColor Green
                }
            }
            'python' {
                $PkgName = $Package.Name -replace '\[.*\]', ''
                if (Get-Command pip -EA SilentlyContinue) { $PyCmd = 'pip' } else { $PyCmd = 'pip3' }
                if ($PSCmdlet.ShouldProcess($PkgName, 'pip install --upgrade')) {
                    & $PyCmd install --upgrade $PkgName 2>&1 | Out-Null
                    Write-Host "    Updated $PkgName" -ForegroundColor Green
                }
            }
            'ps-module' {
                if ($PSCmdlet.ShouldProcess($Package.Name, 'Update-Module')) {
                    Update-Module -Name $Package.Name -Force
                    Write-Host "    Updated $($Package.Name)" -ForegroundColor Green
                }
            }
            default {
                Write-Verbose "  Skipping $($Package.Name) ($($Package.Type)) — manual update required"
            }
        }
    }
    catch {
        New-ActionableError -Goal "update $($Package.Name)" `
            -Problem $_.Exception.Message `
            -Location 'Get-AITSBOM -Update' `
            -NextSteps @(
                "Try manually: update $($Package.Name) via $($Package.Type) package manager",
                'Check network connectivity'
            )
    }
}
