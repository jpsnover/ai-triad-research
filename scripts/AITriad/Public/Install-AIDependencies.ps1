# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Install-AIDependencies {
    <#
    .SYNOPSIS
        Verifies and optionally installs all dependencies for AI Triad Research.
    .DESCRIPTION
        Checks each dependency, runs a smoke test to verify it works, and reports
        the result. Use -Fix to automatically install missing components via the
        system package manager (brew, apt, winget, etc.).

        Dependencies are grouped into three tiers:
          REQUIRED    — Core functionality will not work without these.
          RECOMMENDED — Graceful degradation if missing.
          OPTIONAL    — Feature-gated; only needed for specific workflows.
    .PARAMETER Fix
        Attempt to install missing dependencies automatically.
    .PARAMETER Quiet
        Only show warnings and failures, not passing checks.
    .PARAMETER SkipNode
        Skip Node.js and Electron app dependency checks.
    .PARAMETER SkipPython
        Skip Python and embedding dependency checks.
    .PARAMETER PassThru
        Return the results object for piping.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Install-AIDependencies
    .EXAMPLE
        Install-AIDependencies -Fix
    .EXAMPLE
        Install-AIDependencies -Quiet -SkipNode
    #>
    [CmdletBinding()]
    param(
        [switch]$Fix,
        [switch]$Quiet,
        [switch]$SkipNode,
        [switch]$SkipPython,
        [switch]$PassThru,
        [string]$RepoRoot = $script:RepoRoot
    )

    $Result = Invoke-DependencyCheck -Mode install -Fix:$Fix -Quiet:$Quiet `
        -SkipNode:$SkipNode -SkipPython:$SkipPython -RepoRoot $RepoRoot

    if ($PassThru) { return $Result }
}
