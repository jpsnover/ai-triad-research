# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Bootstrap script — loads the AITriad module and runs Install-AIDependencies.
.DESCRIPTION
    This standalone script exists so users can run dependency checks before
    the module is set up. It loads the module and delegates to the
    Install-AIDependencies cmdlet.
.PARAMETER Fix
    Attempt to install missing dependencies automatically.
.PARAMETER Quiet
    Only show warnings and failures, not passing checks.
.PARAMETER SkipNode
    Skip Node.js and Electron app dependency checks.
.PARAMETER SkipPython
    Skip Python and embedding dependency checks.
.EXAMPLE
    ./scripts/Install-AIDependencies.ps1
.EXAMPLE
    ./scripts/Install-AIDependencies.ps1 -Fix
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [switch]$Fix,
    [switch]$Quiet,
    [switch]$SkipNode,
    [switch]$SkipPython
)

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Import-Module (Join-Path $RepoRoot 'scripts' 'AITriad' 'AITriad.psm1') -Force -ErrorAction Stop

$Params = @{}
if ($Fix)        { $Params['Fix'] = $true }
if ($Quiet)      { $Params['Quiet'] = $true }
if ($SkipNode)   { $Params['SkipNode'] = $true }
if ($SkipPython) { $Params['SkipPython'] = $true }

$Result = Install-AIDependencies @Params -PassThru
exit $(if ($Result.Failed -gt 0) { 1 } else { 0 })
