# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepElectronApp {
    <#
    .SYNOPSIS
        Checks ONE Electron app's package.json/node_modules presence (and, in test mode,
        outdated-package detection) for Invoke-DependencyCheck's section 4 (t/3910).
        Extracted verbatim from the per-app loop body, including the pre-existing
        PSObject.Properties.Count StrictMode bug in the outdated-detection path (t/3999,
        filed separately -- not fixed here, this is a pure refactor).
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$App,
        [Parameter(Mandatory)][bool]$IsTestMode,
        [Parameter(Mandatory)][bool]$IsInstallMode,
        [Parameter(Mandatory)][bool]$Fix,
        [Parameter(Mandatory)][bool]$HasNode
    )

    $AppDir   = Join-Path $RepoRoot $App
    $PkgJson  = Join-Path $AppDir 'package.json'
    $NodeMods = Join-Path $AppDir 'node_modules'

    if (-not (Test-Path $PkgJson)) { Write-DepWarn -Ctx $Ctx -Message "$App — package.json not found"; return }

    if (Test-Path $NodeMods) {
        $ModCount = (Get-ChildItem -Path $NodeMods -Directory | Measure-Object).Count
        Write-DepPass -Ctx $Ctx -Message "$App — node_modules present ($ModCount packages)"

        # Test mode: check for outdated packages
        if ($IsTestMode -and $HasNode) {
            try {
                Push-Location $AppDir
                $OutdatedRaw = npm outdated --json 2>$null
                Pop-Location
                if ($OutdatedRaw) {
                    $Outdated = $OutdatedRaw | ConvertFrom-Json
                    $OutdatedCount = $Outdated.PSObject.Properties.Count
                    if ($OutdatedCount -gt 0) {
                        Write-DepStale -Ctx $Ctx -Message "$App — $OutdatedCount outdated package(s) (run 'npm update' in $App/ to update)"
                        # Show top 3
                        $Shown = 0
                        foreach ($Prop in $Outdated.PSObject.Properties) {
                            if ($Shown -ge 3) { break }
                            $Pkg = $Prop.Value
                            if ($Pkg.PSObject.Properties['current']) { $CurVer = $Pkg.current } else { $CurVer = '?' }
                            if ($Pkg.PSObject.Properties['wanted']) { $WantVer = $Pkg.wanted } else { $WantVer = '?' }
                            Write-Host "         $($Prop.Name): $CurVer -> $WantVer" -ForegroundColor DarkGray
                            $Shown++
                        }
                        if ($OutdatedCount -gt 3) {
                            Write-Host "         ... and $($OutdatedCount - 3) more" -ForegroundColor DarkGray
                        }
                    }
                }
            }
            catch { }  # npm outdated can fail gracefully
        }
    }
    else {
        Write-DepWarn -Ctx $Ctx -Message "$App — node_modules missing"
        if ($IsInstallMode -and $Fix -and $HasNode) {
            Write-DepFix "Running pnpm install in $App..."
            Push-Location $AppDir
            try {
                pnpm install 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) { $Ctx.Fixed++; Write-DepPass -Ctx $Ctx -Message "$App — pnpm install succeeded" }
                else { Write-DepFail -Ctx $Ctx -Message "$App — pnpm install failed (exit code $LASTEXITCODE)" }
            }
            catch { Write-DepFail -Ctx $Ctx -Message "$App — pnpm install failed: $_" }
            finally { Pop-Location }
        }
        else { Write-DepSkip -Message "Run 'pnpm install' in $App/" }
    }
}
