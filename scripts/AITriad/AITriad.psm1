# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Version 7.0
Set-StrictMode -Version Latest

# ─────────────────────────────────────────────────────────────────────────────
# Module root paths
# Supports both dev layout (scripts/AITriad/) and PSGallery install (flat module dir)
# ─────────────────────────────────────────────────────────────────────────────
$script:ModuleRoot = $PSScriptRoot

# Detect if we're in a dev repo (scripts/AITriad/) or a PSGallery install
$_candidateRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..') -ErrorAction SilentlyContinue)?.Path
if ($_candidateRepoRoot -and (Test-Path (Join-Path $_candidateRepoRoot '.aitriad.json'))) {
    $script:RepoRoot = $_candidateRepoRoot
    $script:IsDevInstall = $true
} elseif ($_candidateRepoRoot -and (Test-Path (Join-Path $_candidateRepoRoot 'CLAUDE.md'))) {
    $script:RepoRoot = $_candidateRepoRoot
    $script:IsDevInstall = $true
} else {
    # PSGallery or standalone install — module root IS the root
    $script:RepoRoot = $PSScriptRoot
    $script:IsDevInstall = $false
}

# ─────────────────────────────────────────────────────────────────────────────
# TaxonomyNode class — must live in .psm1 for PowerShell type resolution
# ─────────────────────────────────────────────────────────────────────────────
class TaxonomyNode {
    [string]$POV
    [string]$Id
    [string]$Label
    [string]$Description
    [string]$Category
    [string]$ParentId
    [string[]]$Children
    [string[]]$CrossCuttingRefs
    [PSObject]$Interpretations
    [string[]]$LinkedNodes
    [double]$Score
    [PSObject]$GraphAttributes
}

# ─────────────────────────────────────────────────────────────────────────────
# Module-scoped taxonomy store
# ─────────────────────────────────────────────────────────────────────────────
$script:TaxonomyData = @{}

# ─────────────────────────────────────────────────────────────────────────────
# Load ai-models.json — single source of truth for backend/model lists
# ─────────────────────────────────────────────────────────────────────────────
$script:AIModelConfig  = $null
$script:ValidModelIds  = @()

# Try repo root first (dev), then module root (PSGallery install)
$AIModelsPath = Join-Path $script:RepoRoot 'ai-models.json'
if (-not (Test-Path $AIModelsPath)) {
    $AIModelsPath = Join-Path $script:ModuleRoot 'ai-models.json'
}
if (Test-Path $AIModelsPath) {
    try {
        $script:AIModelConfig = Get-Content -Raw -Path $AIModelsPath | ConvertFrom-Json
        $script:ValidModelIds = @($script:AIModelConfig.models | ForEach-Object { $_.id })
        Write-Verbose "AI Models: loaded $($script:ValidModelIds.Count) models from ai-models.json"
    }
    catch {
        Write-Warning "AI Models: failed to load ai-models.json — $($_.Exception.Message)"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Dot-source Private/ then Public/ functions
# ─────────────────────────────────────────────────────────────────────────────
foreach ($Scope in @('Private', 'Public')) {
    $Dir = Join-Path $PSScriptRoot $Scope
    if (Test-Path $Dir) {
        foreach ($File in Get-ChildItem -Path $Dir -Filter '*.ps1' -File) {
            . $File.FullName
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Import companion modules
# Dev: scripts/ dir (parent of AITriad/)
# PSGallery: bundled in module root alongside AITriad.psm1
# ─────────────────────────────────────────────────────────────────────────────
$_companionDirs = @(
    (Join-Path $script:ModuleRoot '..')     # Dev layout: scripts/
    $script:ModuleRoot                       # PSGallery: bundled in module root
)

foreach ($_name in @('DocConverters', 'AIEnrich')) {
    $_loaded = $false
    foreach ($_dir in $_companionDirs) {
        $_path = Join-Path $_dir "$_name.psm1"
        if (Test-Path $_path) {
            try {
                Import-Module $_path -Force
                $_loaded = $true
                break
            }
            catch {
                Write-Warning "Failed to import ${_name}.psm1: $_ — related features will be unavailable."
            }
        }
    }
    if (-not $_loaded) {
        Write-Verbose "${_name}.psm1 not found — related features will be unavailable."
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Load taxonomy data at import time (same logic as standalone Taxonomy.psm1)
# ─────────────────────────────────────────────────────────────────────────────
$TaxonomyDir = Get-TaxonomyDir
if (Test-Path $TaxonomyDir) {
    foreach ($File in Get-ChildItem -Path $TaxonomyDir -Filter '*.json' -File) {
        if ($File.Name -in 'embeddings.json', 'edges.json') { continue }
        try {
            $Json    = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
            $PovName = $File.BaseName.ToLower()
            $script:TaxonomyData[$PovName] = $Json
            Write-Verbose "Taxonomy: loaded '$PovName' ($($Json.nodes.Count) nodes) from $($File.Name)"
        }
        catch {
            Write-Warning "Taxonomy: failed to load $($File.Name): $_ — this POV will be unavailable until the file is fixed."
        }
    }
}

if ($script:TaxonomyData.Count -eq 0) {
    Write-Warning "Taxonomy: no valid JSON files loaded from $TaxonomyDir — most commands will not work."
}

# ─────────────────────────────────────────────────────────────────────────────
# Backward-compatibility & convenience aliases
# ─────────────────────────────────────────────────────────────────────────────
Set-Alias -Name 'Import-Document'  -Value 'Import-AITriadDocument'  -Scope Global
Set-Alias -Name 'TaxonomyEditor'   -Value 'Show-TaxonomyEditor'    -Scope Global
Set-Alias -Name 'POViewer'         -Value 'Show-POViewer'           -Scope Global
Set-Alias -Name 'SummaryViewer'    -Value 'Show-SummaryViewer'      -Scope Global
Set-Alias -Name 'Redo-Snapshots'   -Value 'Update-Snapshot'         -Scope Global

# ─────────────────────────────────────────────────────────────────────────────
# Export public surface
# ─────────────────────────────────────────────────────────────────────────────
Export-ModuleMember -Function @(
    'Get-Tax'
    'Update-TaxEmbeddings'
    'Import-AITriadDocument'
    'Invoke-POVSummary'
    'Invoke-BatchSummary'
    'Find-Conflict'
    'Find-AITSource'
    'Save-AITSource'
    'Save-WaybackUrl'
    'Invoke-PIIAudit'
    'Update-Snapshot'
    'Show-TaxonomyEditor'
    'Show-POViewer'
    'Show-SummaryViewer'
    'Show-AITriadHelp'
    'Get-TaxonomyHealth'
    'Invoke-TaxonomyProposal'
    'Compare-Taxonomy'
    'Get-AITSource'
    'Get-Summary'
    'Invoke-AttributeExtraction'
    'Invoke-EdgeDiscovery'
    'Get-GraphNode'
    'Find-GraphPath'
    'Approve-Edge'
    'Approve-TaxonomyProposal'
    'Get-Edge'
    'Set-Edge'
    'Invoke-GraphQuery'
    'Get-ConflictEvolution'
    'Export-TaxonomyToGraph'
    'Install-GraphDatabase'
    'Invoke-CypherQuery'
    'Show-GraphOverview'
    'Get-TopicFrequency'
    'Get-IngestionPriority'
    'Find-CrossCuttingCandidates'
    'Show-TriadDialogue'
    'Register-AIBackend'
    'Install-AITriadData'
    'Install-AIDependencies'
    'Test-Dependencies'
    'Find-PossibleFallacy'
    'Find-PolicyAction'
    'Show-FallacyInfo'
) -Alias @(
    'Import-Document'
    'TaxonomyEditor'
    'POViewer'
    'SummaryViewer'
    'Redo-Snapshots'
)
