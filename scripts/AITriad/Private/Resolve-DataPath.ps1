# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Data path resolution ──
# Reads .aitriad.json to determine where data lives.
# Priority: $env:AI_TRIAD_DATA_ROOT > .aitriad.json > platform default

$script:DataConfig = $null

function Get-PlatformDataDir {
    <#
    .SYNOPSIS
        Returns the platform-appropriate default data directory for AITriad.
    #>
    if ($IsWindows) {
        return Join-Path $env:LOCALAPPDATA 'AITriad' 'data'
    }
    elseif ($IsMacOS) {
        return Join-Path $HOME 'Library' 'Application Support' 'AITriad' 'data'
    }
    else {
        # Linux — XDG Base Directory spec
        $XdgData = $env:XDG_DATA_HOME
        if ([string]::IsNullOrWhiteSpace($XdgData)) {
            $XdgData = Join-Path $HOME '.local' 'share'
        }
        return Join-Path $XdgData 'aitriad' 'data'
    }
}

function Initialize-DataConfig {
    if ($null -ne $script:DataConfig) { return }

    # Try to load .aitriad.json from repo root (dev) or module root (PSGallery)
    $ConfigPaths = @(
        (Join-Path $script:RepoRoot '.aitriad.json')
        (Join-Path $script:ModuleRoot '.aitriad.json')
    )

    foreach ($ConfigPath in $ConfigPaths) {
        if (Test-Path $ConfigPath) {
            try {
                $script:DataConfig = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
                Write-Verbose "Data config: loaded from $ConfigPath"
                return
            }
            catch {
                Write-Warning "Failed to load .aitriad.json: $($_.Exception.Message)"
            }
        }
    }

    # Fallback defaults — use platform-specific data dir for PSGallery installs
    $DefaultRoot = if ($script:IsDevInstall) { '.' } else { Get-PlatformDataDir }

    $script:DataConfig = [PSCustomObject]@{
        data_root     = $DefaultRoot
        taxonomy_dir  = 'taxonomy/Origin'
        sources_dir   = 'sources'
        summaries_dir = 'summaries'
        conflicts_dir = 'conflicts'
        debates_dir   = 'debates'
        queue_file    = '.summarise-queue.json'
        version_file  = 'TAXONOMY_VERSION'
    }
    Write-Verbose "Data config: using defaults (data_root=$DefaultRoot)"
}

function Get-DataRoot {
    <#
    .SYNOPSIS
        Returns the resolved absolute path to the data root directory.
    #>
    Initialize-DataConfig

    # Env var takes highest priority
    if (-not [string]::IsNullOrWhiteSpace($env:AI_TRIAD_DATA_ROOT)) {
        $Resolved = Resolve-Path $env:AI_TRIAD_DATA_ROOT -ErrorAction SilentlyContinue
        if ($Resolved) { return $Resolved.Path }
        return $env:AI_TRIAD_DATA_ROOT
    }

    $Root = $script:DataConfig.data_root
    if ([System.IO.Path]::IsPathRooted($Root)) {
        return $Root
    }
    return Join-Path $script:RepoRoot $Root
}

function Get-TaxonomyDir {
    <#
    .SYNOPSIS
        Returns the absolute path to the taxonomy directory (e.g. taxonomy/Origin).
    #>
    Initialize-DataConfig
    $Dir = $script:DataConfig.taxonomy_dir
    if ([System.IO.Path]::IsPathRooted($Dir)) { return $Dir }
    return Join-Path (Get-DataRoot) $Dir
}

function Get-SourcesDir {
    Initialize-DataConfig
    $Dir = $script:DataConfig.sources_dir
    if ([System.IO.Path]::IsPathRooted($Dir)) { return $Dir }
    return Join-Path (Get-DataRoot) $Dir
}

function Get-SummariesDir {
    Initialize-DataConfig
    $Dir = $script:DataConfig.summaries_dir
    if ([System.IO.Path]::IsPathRooted($Dir)) { return $Dir }
    return Join-Path (Get-DataRoot) $Dir
}

function Get-ConflictsDir {
    Initialize-DataConfig
    $Dir = $script:DataConfig.conflicts_dir
    if ([System.IO.Path]::IsPathRooted($Dir)) { return $Dir }
    return Join-Path (Get-DataRoot) $Dir
}

function Get-DebatesDir {
    Initialize-DataConfig
    $Dir = $script:DataConfig.debates_dir
    if ([System.IO.Path]::IsPathRooted($Dir)) { return $Dir }
    return Join-Path (Get-DataRoot) $Dir
}

function Get-QueueFile {
    Initialize-DataConfig
    $File = $script:DataConfig.queue_file
    if ([System.IO.Path]::IsPathRooted($File)) { return $File }
    return Join-Path (Get-DataRoot) $File
}

function Get-VersionFile {
    Initialize-DataConfig
    $File = $script:DataConfig.version_file
    if ([System.IO.Path]::IsPathRooted($File)) { return $File }
    return Join-Path (Get-DataRoot) $File
}
