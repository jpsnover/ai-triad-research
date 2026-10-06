# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepNodeNpm {
    <#
    .SYNOPSIS
        Section 4 of Invoke-DependencyCheck (t/3910): Node.js/npm detection + the Electron
        app loop (delegated to Test-DepElectronApp). Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][bool]$SkipNode,
        [Parameter(Mandatory)][bool]$IsTestMode,
        [Parameter(Mandatory)][bool]$IsInstallMode,
        [Parameter(Mandatory)][bool]$Fix,
        [Parameter(Mandatory)][string]$Platform
    )

    if ($SkipNode) {
        Write-DepSection 'NODE.JS & NPM (skipped)'
        Write-DepSkip -Message 'Skipped via -SkipNode'
        return
    }

    Write-DepSection 'NODE.JS & NPM (required for desktop apps)'

    $HasNode = $false
    if (Get-Command node -ErrorAction SilentlyContinue) {
        try {
            $NodeVer = (node --version 2>&1).Trim()
            $Major = [int]($NodeVer -replace '^v', '' -split '\.' | Select-Object -First 1)
            if ($Major -ge 20) {
                $NodeResult = node -e "console.log(JSON.stringify({ok:true,version:process.version}))" 2>&1
                $NodeJson = $NodeResult | ConvertFrom-Json
                if ($NodeJson.ok) {
                    Write-DepPass -Ctx $Ctx -Message "Node.js $($NodeJson.version) (>= v20 required)"
                    $HasNode = $true
                }
                else { Write-DepWarn -Ctx $Ctx -Message "Node.js $NodeVer — smoke test failed" }
            }
            else { Write-DepFail -Ctx $Ctx -Message "Node.js $NodeVer too old (v20+ required)" }
        }
        catch { Write-DepWarn -Ctx $Ctx -Message "Node.js found but smoke test failed: $_" }
    }
    else {
        Write-DepFail -Ctx $Ctx -Message 'Node.js not found'
        if ($IsInstallMode) {
            Install-DependencyPackage -Ctx $Ctx -Fix $Fix -Platform $Platform -Name 'node' -PackageNames @{
                brew = 'node@22'; apt = 'nodejs'; dnf = 'nodejs'
                winget = 'OpenJS.NodeJS.LTS'; choco = 'nodejs-lts'; scoop = 'nodejs-lts'
            }
        }
    }

    if (Get-Command npm -ErrorAction SilentlyContinue) {
        $NpmVer = (npm --version 2>&1).Trim()
        Write-DepPass -Ctx $Ctx -Message "npm $NpmVer"
    }
    else { Write-DepFail -Ctx $Ctx -Message 'npm not found' }

    $ElectronApps = @('taxonomy-editor', 'poviewer', 'summary-viewer', 'edge-viewer')
    foreach ($App in $ElectronApps) {
        Test-DepElectronApp -Ctx $Ctx -RepoRoot $RepoRoot -App $App -IsTestMode $IsTestMode -IsInstallMode $IsInstallMode -Fix $Fix -HasNode $HasNode
    }
}
