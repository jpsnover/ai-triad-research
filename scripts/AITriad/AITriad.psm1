# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Version 7.0
Set-StrictMode -Version Latest

# ─────────────────────────────────────────────────────────────────────────────
# Module root paths
# ─────────────────────────────────────────────────────────────────────────────
$script:ModuleRoot = $PSScriptRoot
$script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path

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
# Import companion modules (kept separate for AMSI isolation)
# ─────────────────────────────────────────────────────────────────────────────
$ScriptsDir = Join-Path $script:ModuleRoot '..'

$DocConvertersPath = Join-Path $ScriptsDir 'DocConverters.psm1'
if (Test-Path $DocConvertersPath) {
    try {
        Import-Module $DocConvertersPath -Force
    }
    catch {
        Write-Warning "Failed to import DocConverters.psm1: $_ — PDF/HTML conversion will be unavailable."
    }
}

$AIEnrichPath = Join-Path $ScriptsDir 'AIEnrich.psm1'
if (Test-Path $AIEnrichPath) {
    try {
        Import-Module $AIEnrichPath -Force
    }
    catch {
        Write-Warning "Failed to import AIEnrich.psm1: $_ — AI API calls will be unavailable."
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Load taxonomy data at import time (same logic as standalone Taxonomy.psm1)
# ─────────────────────────────────────────────────────────────────────────────
$TaxonomyDir = Join-Path $script:RepoRoot 'taxonomy' 'Origin'
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
Set-Alias -Name 'EdgeViewer'       -Value 'Show-EdgeViewer'         -Scope Global
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
    'Find-Source'
    'Save-Source'
    'Save-WaybackUrl'
    'Invoke-PIIAudit'
    'ConvertTo-GeneralTaxonomy'
    'Update-Snapshot'
    'Show-TaxonomyEditor'
    'Show-POViewer'
    'Show-SummaryViewer'
    'Show-EdgeViewer'
    'Show-AITriadHelp'
    'Get-TaxonomyHealth'
    'Invoke-TaxonomyProposal'
    'Compare-Taxonomy'
    'Get-Source'
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
) -Alias @(
    'Import-Document'
    'TaxonomyEditor'
    'POViewer'
    'SummaryViewer'
    'EdgeViewer'
    'Redo-Snapshots'
)
