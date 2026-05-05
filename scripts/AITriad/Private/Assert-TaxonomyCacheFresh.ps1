# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Assert-TaxonomyCacheFresh {
    <#
    .SYNOPSIS
        Checks if on-disk taxonomy files are newer than the in-memory cache
        and reloads if stale. Also invalidates the embeddings cache if
        embeddings.json has been regenerated.
    .DESCRIPTION
        Called at the start of cmdlets that read $script:TaxonomyData or
        $script:CachedEmbeddings. Compares file LastWriteTime against the
        timestamps recorded at load time. If any file is newer, flushes
        and reloads the affected cache.

        This is cheap — just stat calls on 4-6 files, no JSON parsing
        unless a file has actually changed.
    #>
    [CmdletBinding()]
    param()

    # Cooldown: skip check if last reload was < 30s ago
    if ($script:TaxonomyCacheLastCheck -and
        ([DateTime]::UtcNow - $script:TaxonomyCacheLastCheck).TotalSeconds -lt 30) {
        return
    }
    $script:TaxonomyCacheLastCheck = [DateTime]::UtcNow

    $TaxDir = Get-TaxonomyDir
    if (-not (Test-Path $TaxDir)) { return }

    # ── Check taxonomy POV files ──────────────────────────────────────────────
    $NeedReload = $false
    foreach ($File in Get-ChildItem -Path $TaxDir -Filter '*.json' -File) {
        if ($File.Name -in 'embeddings.json', 'edges.json', 'policy_actions.json',
            '_archived_edges.json', 'lineage_categories.json') { continue }

        $Cached = $script:TaxonomyFileTimestamps[$File.FullName]
        if (-not $Cached -or $File.LastWriteTime -gt $Cached) {
            $NeedReload = $true
            break
        }
    }

    if ($NeedReload) {
        Write-Verbose 'Taxonomy cache stale — reloading from disk'
        $script:TaxonomyData = @{}
        $script:TaxonomyFileTimestamps = @{}

        foreach ($File in Get-ChildItem -Path $TaxDir -Filter '*.json' -File) {
            if ($File.Name -in 'embeddings.json', 'edges.json', 'policy_actions.json',
                '_archived_edges.json', 'lineage_categories.json') { continue }
            if ($File.Length -gt 10MB) { continue }
            try {
                $Json = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
                if (-not ($Json -and $Json.PSObject.Properties['nodes'])) { continue }
                $PovName = $File.BaseName.ToLower()
                $script:TaxonomyData[$PovName] = $Json
                $script:TaxonomyFileTimestamps[$File.FullName] = $File.LastWriteTime
                Write-Verbose "  Reloaded '$PovName' ($($Json.nodes.Count) nodes)"
            }
            catch {
                Write-Warning "Taxonomy reload: failed to load $($File.Name): $_"
            }
        }

        # Also reload policy registry
        $RegistryFile = Join-Path $TaxDir 'policy_actions.json'
        if (Test-Path $RegistryFile) {
            try {
                $script:PolicyRegistry = Get-Content -Raw $RegistryFile | ConvertFrom-Json
            } catch { }
        }
    }

    # ── Check embeddings.json ─────────────────────────────────────────────────
    if ($null -ne $script:CachedEmbeddings) {
        $EmbFile = Join-Path $TaxDir 'embeddings.json'
        if (Test-Path $EmbFile) {
            $EmbWriteTime = (Get-Item $EmbFile).LastWriteTime
            if (-not $script:EmbeddingsTimestamp -or $EmbWriteTime -gt $script:EmbeddingsTimestamp) {
                Write-Verbose 'Embeddings cache stale — will reload on next use'
                $script:CachedEmbeddings = $null
                $script:EmbeddingsTimestamp = $null
            }
        }
    }
}
