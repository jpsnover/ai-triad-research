# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Data path resolution ──
# Reads .aitriad.json to determine where data lives.
# Priority: $env:AI_TRIAD_DATA_ROOT > .aitriad.json > platform default

$script:DataConfig = $null
$script:DataConfigDir = $null   # directory where .aitriad.json was found

function Get-PlatformDataDir {
    <#
    .SYNOPSIS
        Returns the platform-appropriate default data directory for AITriad.
    #>
    if ($IsWindows) {
        return Join-Path (Join-Path $env:LOCALAPPDATA 'AITriad') 'data'
    }
    elseif ($IsMacOS) {
        return Join-Path (Join-Path (Join-Path (Join-Path $HOME 'Library') 'Application Support') 'AITriad') 'data'
    }
    else {
        # Linux — XDG Base Directory spec
        $XdgData = $env:XDG_DATA_HOME
        if ([string]::IsNullOrWhiteSpace($XdgData)) {
            $XdgData = Join-Path (Join-Path $HOME '.local') 'share'
        }
        return Join-Path (Join-Path $XdgData 'aitriad') 'data'
    }
}

function Initialize-DataConfig {
    if ($null -ne $script:DataConfig) { return }

    # Try to load .aitriad.json from repo root (dev), module root (PSGallery),
    # or the code repo found by walking up from $PWD
    $CodeRoot = Get-CodeRoot
    $ConfigPaths = @(
        (Join-Path $script:RepoRoot '.aitriad.json')
        (Join-Path $script:ModuleRoot '.aitriad.json')
        (Join-Path $CodeRoot '.aitriad.json')
    )

    foreach ($ConfigPath in $ConfigPaths) {
        if (Test-Path $ConfigPath) {
            try {
                $script:DataConfig = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
                $script:DataConfigDir = Split-Path $ConfigPath -Parent
                Write-Verbose "Data config: loaded from $ConfigPath"
                return
            }
            catch {
                Write-Warning "Failed to load .aitriad.json: $($_.Exception.Message)"
            }
        }
    }

    # Fallback defaults — use platform-specific data dir for PSGallery installs
    if ($script:IsDevInstall) { $DefaultRoot = '.' } else { $DefaultRoot = Get-PlatformDataDir }

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

function Get-CodeRoot {
    <#
    .SYNOPSIS
        Returns the resolved absolute path to the code repository root.
    .DESCRIPTION
        Priority: $env:AI_TRIAD_CODE_ROOT > walk up from $PWD for .aitriad.json >
        .aitriad.json code_root (relative to config location) > $script:RepoRoot.
        Needed when the module is installed outside the dev repo (e.g. PSGallery)
        but Electron apps still live in the original repo checkout.
    #>

    # 1. Env var takes highest priority
    if (-not [string]::IsNullOrWhiteSpace($env:AI_TRIAD_CODE_ROOT)) {
        $Resolved = Resolve-Path $env:AI_TRIAD_CODE_ROOT -ErrorAction SilentlyContinue
        if ($Resolved) { return $Resolved.Path }
        return $env:AI_TRIAD_CODE_ROOT
    }

    # 2. If we're in a dev install, RepoRoot is already the code repo
    if ($script:IsDevInstall) {
        return $script:RepoRoot
    }

    # 2b. Check code_root from bundled .aitriad.json (read directly to avoid circular call with Initialize-DataConfig)
    $BundledConfig = Join-Path $script:ModuleRoot '.aitriad.json'
    if (Test-Path $BundledConfig) {
        try {
            $Cfg = Get-Content -Raw -Path $BundledConfig | ConvertFrom-Json
            if ($Cfg.PSObject.Properties['code_root'] -and $Cfg.code_root -and (Test-Path $Cfg.code_root)) {
                return $Cfg.code_root
            }
        } catch { }
    }

    # 3. Walk up from $PWD looking for .aitriad.json (user is likely cd'd into repo)
    $Dir = (Get-Location).Path
    while ($Dir) {
        $Candidate = Join-Path $Dir '.aitriad.json'
        if (Test-Path $Candidate) {
            return $Dir
        }
        $Parent = Split-Path $Dir -Parent
        if ($Parent -eq $Dir) { break }
        $Dir = $Parent
    }

    # 4. Fallback
    return $script:RepoRoot
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
    # Resolve relative to where .aitriad.json was found, then Get-CodeRoot fallback
    if ($script:DataConfigDir) { $Anchor = $script:DataConfigDir } else { $Anchor = Get-CodeRoot }
    return Join-Path $Anchor $Root
}

function Get-TaxonomyDir {
    <#
    .SYNOPSIS
        Returns the absolute path to the taxonomy directory (e.g. taxonomy/Origin).
    .PARAMETER ChildPath
        Optional child path to append (e.g. 'embeddings.json').
    #>
    param([string]$ChildPath)
    Initialize-DataConfig
    $Dir = $script:DataConfig.taxonomy_dir
    if ([System.IO.Path]::IsPathRooted($Dir)) { $Result = $Dir } else { $Result = Join-Path (Get-DataRoot) $Dir }
    if ($ChildPath) { return Join-Path $Result $ChildPath }
    return $Result
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
