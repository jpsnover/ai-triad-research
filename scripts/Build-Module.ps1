# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Builds the AITriad PowerShell module for PSGallery distribution.
.DESCRIPTION
    Creates a self-contained module directory in build/AITriad/ ready for
    Publish-Module. Bundles companion modules, ai-models.json, prompts,
    and a default .aitriad.json for non-dev installs.
.PARAMETER OutputDir
    Build output directory. Default: build/
.PARAMETER Clean
    Remove existing build directory before building.
.EXAMPLE
    ./scripts/Build-Module.ps1
.EXAMPLE
    ./scripts/Build-Module.ps1 -Clean
    Publish-Module -Path ./build/AITriad -NuGetApiKey $key -Repository PSGallery
#>
param(
    [string]$OutputDir = (Join-Path $PSScriptRoot '..' 'build'),
    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ModuleDir = Join-Path $OutputDir 'AITriad'

Write-Host '=== Building AITriad Module ===' -ForegroundColor Cyan

# ── Clean ──
if ($Clean -and (Test-Path $OutputDir)) {
    Write-Host "Cleaning $OutputDir..."
    Remove-Item -Recurse -Force $OutputDir
}

# ── Create output ──
New-Item -ItemType Directory -Path $ModuleDir -Force | Out-Null

# ── Copy module core ──
$ModuleSrc = Join-Path $RepoRoot 'scripts' 'AITriad'
Write-Host "Copying module from $ModuleSrc..."

# Core files
Copy-Item (Join-Path $ModuleSrc 'AITriad.psm1') $ModuleDir
Copy-Item (Join-Path $ModuleSrc 'AITriad.psd1') $ModuleDir

# Public/ and Private/ functions
foreach ($Dir in @('Public', 'Private')) {
    $SrcDir = Join-Path $ModuleSrc $Dir
    $DstDir = Join-Path $ModuleDir $Dir
    if (Test-Path $SrcDir) {
        Copy-Item $SrcDir $DstDir -Recurse
    }
}

# Prompts/
$PromptsSrc = Join-Path $ModuleSrc 'Prompts'
if (Test-Path $PromptsSrc) {
    Copy-Item $PromptsSrc (Join-Path $ModuleDir 'Prompts') -Recurse
}

# Formats/
$FormatsSrc = Join-Path $ModuleSrc 'Formats'
if (Test-Path $FormatsSrc) {
    Copy-Item $FormatsSrc (Join-Path $ModuleDir 'Formats') -Recurse
}

# ── Bundle companion modules ──
Write-Host 'Bundling companion modules...'
$ScriptsDir = Join-Path $RepoRoot 'scripts'

foreach ($Companion in @('AIEnrich.psm1', 'DocConverters.psm1')) {
    $Src = Join-Path $ScriptsDir $Companion
    if (Test-Path $Src) {
        Copy-Item $Src $ModuleDir
        Write-Host "  + $Companion"
    } else {
        Write-Warning "  Companion module not found: $Companion"
    }
}

# ── Bundle ai-models.json ──
$ModelsFile = Join-Path $RepoRoot 'ai-models.json'
if (Test-Path $ModelsFile) {
    Copy-Item $ModelsFile $ModuleDir
    Write-Host '  + ai-models.json'
}

# ── Create default .aitriad.json for PSGallery installs ──
# This uses a placeholder that Resolve-DataPath.ps1 will resolve to the
# platform-specific default path at runtime.
$DefaultConfig = @{
    data_root     = '__PLATFORM_DEFAULT__'
    taxonomy_dir  = 'taxonomy/Origin'
    sources_dir   = 'sources'
    summaries_dir = 'summaries'
    conflicts_dir = 'conflicts'
    debates_dir   = 'debates'
    queue_file    = '.summarise-queue.json'
    version_file  = 'TAXONOMY_VERSION'
} | ConvertTo-Json -Depth 5

# Don't bundle .aitriad.json — let Resolve-DataPath use platform defaults
# for PSGallery installs (no .aitriad.json = use Get-PlatformDataDir)

# ── Bundle LICENSE ──
$License = Join-Path $RepoRoot 'LICENSE'
if (Test-Path $License) {
    Copy-Item $License $ModuleDir
}

# ── Validate manifest ──
Write-Host 'Validating module manifest...'
try {
    $Manifest = Test-ModuleManifest -Path (Join-Path $ModuleDir 'AITriad.psd1') -ErrorAction Stop
    Write-Host "  Module: $($Manifest.Name) v$($Manifest.Version)" -ForegroundColor Green
    Write-Host "  Functions: $($Manifest.ExportedFunctions.Count)" -ForegroundColor Green
} catch {
    Write-Warning "Manifest validation warning: $_"
}

# ── Summary ──
$FileCount = (Get-ChildItem -Path $ModuleDir -Recurse -File).Count
$Size = [Math]::Round((Get-ChildItem -Path $ModuleDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1)

Write-Host ''
Write-Host '=== Build Complete ===' -ForegroundColor Cyan
Write-Host "  Output:    $ModuleDir"
Write-Host "  Files:     $FileCount"
Write-Host "  Size:      ${Size} MB"
Write-Host ''
Write-Host 'To publish:' -ForegroundColor Yellow
Write-Host "  Publish-Module -Path '$ModuleDir' -NuGetApiKey `$key -Repository PSGallery"
Write-Host ''
Write-Host 'To test locally:' -ForegroundColor Yellow
Write-Host "  Import-Module '$ModuleDir' -Force"
Write-Host ''
