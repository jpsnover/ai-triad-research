# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared scan-scope filter for t/3829's complexity ratchet. Both
# Update-ComplexityBaseline (generator) and Test-ComplexityBudget (enforcer)
# call this SAME function so the scan-scope exclusion list lives in exactly
# one place rather than being duplicated across the two cmdlets -- per
# TL's "enumerate your pairs" instruction (t/3829#4), this ties the
# generator's scope to the enforcer's scope structurally, not by convention.

function Get-ComplexityScanTargets {
    <#
    .SYNOPSIS
        Measure-CodeComplexity results, filtered to the complexity-ratchet's
        scan scope (t/3829).
    .DESCRIPTION
        Excludes tests/, build/, and .worktrees/ path segments (TL's ruling,
        t/3829#9) -- none currently exist nested under scripts/, but the
        exclusion is defensive against future additions, not inferred from
        today's absence.
    .PARAMETER Path
        Root directory to scan (passed through to Measure-CodeComplexity).
    .OUTPUTS
        [pscustomobject[]] Same shape as Measure-CodeComplexity: { File;
        Function; Complexity; StartLine }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    Set-StrictMode -Version Latest

    $excludeSegments = @('tests', 'build', '.worktrees')
    $measured = @(Measure-CodeComplexity -Path $Path)

    return @($measured | Where-Object {
        $segments = $_.File -split '[\\/]'
        -not (@($segments | Where-Object { $excludeSegments -contains $_.ToLowerInvariant() })).Count
    })
}
