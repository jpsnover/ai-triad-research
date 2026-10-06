# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMNpmMetadata {
    <#
    .SYNOPSIS
        Enriches npm/npm-dev entries in place from each source's
        package-lock.json (license, integrity hash, resolved URL, locked
        version) -- no network calls. Extracted verbatim from Get-AITSBOM
        (t/3910) -- no behavior change.
    .PARAMETER Entries
        The full SBOM entries list (mutated in place for npm/npm-dev rows).
    .PARAMETER RepoRoot
        Repository root path.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries,

        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    Set-StrictMode -Version Latest

    $NpmEntries = @($Entries | Where-Object { $_.Type -in @('npm', 'npm-dev') })
    if ($NpmEntries.Count -eq 0) { return }

    $LockCache = Get-AITSBOMNpmLockCache -NpmEntries $NpmEntries -RepoRoot $RepoRoot

    foreach ($NpmEntry in $NpmEntries) {
        $SourceKey = $NpmEntry.Source -replace '/package\.json$', ''
        $CacheKey = "$SourceKey|$($NpmEntry.Name)"
        if ($LockCache.ContainsKey($CacheKey)) {
            $LockData = $LockCache[$CacheKey]
            if ($LockData.ContainsKey('license') -and $LockData.license)       { $NpmEntry.License   = $LockData.license }
            if ($LockData.ContainsKey('integrity') -and $LockData.integrity)   { $NpmEntry.Hash      = $LockData.integrity }
            if ($LockData.ContainsKey('resolved') -and $LockData.resolved)     { $NpmEntry.SourceUrl = $LockData.resolved }
            if ($LockData.ContainsKey('version') -and $LockData.version)       { $NpmEntry.Version   = $LockData.version }
        }
    }
}
