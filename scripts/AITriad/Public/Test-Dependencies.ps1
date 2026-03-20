# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-Dependencies {
    <#
    .SYNOPSIS
        Tests whether all project dependencies are present, working, and up to date.
    .DESCRIPTION
        Runs smoke tests on all dependencies and checks for outdated packages.
        Unlike Install-Dependencies, this command never installs or updates
        anything — it only reports what it finds.

        For each dependency it checks:
          - Is it installed?
          - Does a smoke test pass?
          - Are there newer versions available? (npm outdated, pip list --outdated)
          - Are data files (embeddings) stale relative to the taxonomy?

        Outdated items are flagged but NOT updated automatically.
    .PARAMETER Quiet
        Only show warnings, failures, and outdated items.
    .PARAMETER SkipNode
        Skip Node.js and Electron app dependency checks.
    .PARAMETER SkipPython
        Skip Python and embedding dependency checks.
    .PARAMETER PassThru
        Return the results object for piping.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Test-Dependencies
    .EXAMPLE
        Test-Dependencies -Quiet
    .EXAMPLE
        $r = Test-Dependencies -PassThru; $r.Outdated
    #>
    [CmdletBinding()]
    param(
        [switch]$Quiet,
        [switch]$SkipNode,
        [switch]$SkipPython,
        [switch]$PassThru,
        [string]$RepoRoot = $script:RepoRoot
    )

    $Result = Invoke-DependencyCheck -Mode test -Quiet:$Quiet `
        -SkipNode:$SkipNode -SkipPython:$SkipPython -RepoRoot $RepoRoot

    if ($PassThru) { return $Result }
}
