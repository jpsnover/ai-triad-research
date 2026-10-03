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

        Normalizes .File to '/' separators (t/3874) -- Measure-CodeComplexity's
        File comes from [System.IO.Path]::GetRelativePath, which returns the OS-
        native separator ('\' on Windows, '/' on Linux). A baseline generated on
        Windows and enforced on Linux CI (or vice versa) would otherwise never
        match on ContainsKey, reading every baselined file as a brand-new
        offender. This is the SOLE producer both Update-ComplexityBaseline
        (generator) and Test-ComplexityBudget (enforcer) call, so normalizing
        once here fixes both the written keys and the enforcer's lookup key --
        no second normalization point to keep in sync.
    .PARAMETER Path
        Root directory to scan (passed through to Measure-CodeComplexity).
    .OUTPUTS
        [pscustomobject[]] Same shape as Measure-CodeComplexity: { File;
        Function; Complexity; StartLine }, with File always '/'-separated.
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
    } | ForEach-Object {
        $_.File = $_.File.Replace('\', '/')
        $_
    })
}
