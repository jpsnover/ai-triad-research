# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMNpmLockCache {
    <#
    .SYNOPSIS
        Builds a {"<sourceKey>|<pkgName>" -> lock entry} cache by parsing
        each distinct npm source's package-lock.json once. Split out of
        Update-AITSBOMNpmMetadata (t/3910) to bring both functions under the
        complexity ratchet -- no behavior change.
    .PARAMETER NpmEntries
        The npm/npm-dev SBOM entries (read-only here; used only to find
        each distinct source's lock file).
    .PARAMETER RepoRoot
        Repository root path.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [PSObject[]]$NpmEntries,

        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    Set-StrictMode -Version Latest

    $LockCache = @{}
    $ProcessedSources = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($NpmEntry in $NpmEntries) {
        $SourceKey = $NpmEntry.Source -replace '/package\.json$', ''
        if (-not $ProcessedSources.Add($SourceKey)) { continue }

        if ($SourceKey -eq 'package.json') { $LockPath = Join-Path $RepoRoot 'package-lock.json' }
        else { $LockPath = Join-Path (Join-Path $RepoRoot $SourceKey) 'package-lock.json' }

        if (-not (Test-Path $LockPath)) { continue }

        try {
            $Lock = Get-Content -Raw -Path $LockPath | ConvertFrom-Json -AsHashtable
            if ($Lock.ContainsKey('packages')) {
                foreach ($Key in $Lock.packages.Keys) {
                    if (-not $Key.StartsWith('node_modules/')) { continue }
                    $PkgNameFromLock = $Key.Substring('node_modules/'.Length)
                    $LockCache["$SourceKey|$PkgNameFromLock"] = $Lock.packages[$Key]
                }
            }
        }
        catch {
            Write-Verbose "Could not parse $LockPath`: $($_.Exception.Message)"
        }
    }

    return $LockCache
}
