# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared dependency checking engine used by Install-AIDependencies and Test-Dependencies.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Invoke-DependencyCheck {
    <#
    .SYNOPSIS
        Core dependency checking engine. Returns a structured results object.
    .DESCRIPTION
        Checks all project dependencies, runs smoke tests, and returns a hashtable
        of results. Caller controls whether to fix (install) or just report.

        t/3910: decomposed from a single 142-complexity function into this thin
        orchestrator plus the Private/Test-Dep*, Install-DependencyPackage,
        Get-DependencyPackageManager, Resolve-DependencyPlatform, and Write-Dep*
        helpers it calls in sequence. Pure refactor — every message, color, counter
        and control-flow branch is unchanged; see each helper's own docstring for which
        original section it came from.
    .PARAMETER Mode
        'install' — check + offer to fix.  'test' — check + version freshness, no fixing.
    .PARAMETER Fix
        When Mode=install, actually attempt to install missing deps.
    .PARAMETER Quiet
        Suppress passing checks in output.
    .PARAMETER SkipNode
        Skip Node.js checks.
    .PARAMETER SkipPython
        Skip Python checks.
    .PARAMETER RepoRoot
        Repository root path.
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('install', 'test')]
        [string]$Mode = 'test',

        [switch]$Fix,
        [switch]$Quiet,
        [switch]$SkipNode,
        [switch]$SkipPython,
        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest

    $Ctx = @{
        Passed   = 0
        Warned   = 0
        Failed   = 0
        Fixed    = 0
        Outdated = 0
        Results  = [System.Collections.Generic.List[PSObject]]::new()
    }

    $IsTestMode    = $Mode -eq 'test'
    $IsInstallMode = $Mode -eq 'install'
    $FixBool       = [bool]$Fix
    $Platform      = Resolve-DependencyPlatform

    $TitleVerb = if ($IsTestMode) { 'Dependency Test' } else { 'Dependency Check' }
    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan
    Write-Host "  AI Triad Research — $TitleVerb" -ForegroundColor White
    Write-Host "  Platform: $Platform  |  Mode: $Mode$(if ($Fix) { ' (fix)' })" -ForegroundColor Gray
    Write-Host "$('═' * 60)" -ForegroundColor Cyan

    Test-DepPowerShellEnv -Ctx $Ctx -Quiet:$Quiet
    Test-DepGit -Ctx $Ctx -RepoRoot $RepoRoot -IsInstallMode $IsInstallMode -Fix $FixBool -Platform $Platform
    Test-DepAIApiKeys -Ctx $Ctx
    Test-DepNodeNpm -Ctx $Ctx -RepoRoot $RepoRoot -SkipNode ([bool]$SkipNode) -IsTestMode $IsTestMode -IsInstallMode $IsInstallMode -Fix $FixBool -Platform $Platform
    Test-DepDocumentConversion -Ctx $Ctx -IsInstallMode $IsInstallMode -Fix $FixBool -Platform $Platform
    Test-DepPythonEmbeddings -Ctx $Ctx -RepoRoot $RepoRoot -SkipPython ([bool]$SkipPython) -IsTestMode $IsTestMode -IsInstallMode $IsInstallMode -Fix $FixBool -Platform $Platform
    if ($Platform -eq 'Windows') {
        Test-DepWindowsContainers -Ctx $Ctx -IsInstallMode $IsInstallMode -Fix $FixBool
    }
    Test-DepDockerNeo4j -Ctx $Ctx -IsInstallMode $IsInstallMode -Fix $FixBool -Platform $Platform
    Test-DepDataIntegrity -Ctx $Ctx -RepoRoot $RepoRoot -IsInstallMode $IsInstallMode -Fix $FixBool

    Write-DepCheckSummary -Ctx $Ctx -IsInstallMode $IsInstallMode -Fix $FixBool

    return $Ctx
}
