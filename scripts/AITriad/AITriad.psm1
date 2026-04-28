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
$_resolvedParent = Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..') -ErrorAction SilentlyContinue
if ($_resolvedParent) { $_candidateRepoRoot = $_resolvedParent.Path } else { $_candidateRepoRoot = $null }
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
# ClaimsByPov — per-POV claim counts for AITSource objects
# ─────────────────────────────────────────────────────────────────────────────
class ClaimsByPov {
    [int]$Accelerationist
    [int]$Safetyist
    [int]$Skeptic
    [int]$Situations
}

# ─────────────────────────────────────────────────────────────────────────────
# AITModelInfo — model and extraction parameters used to generate a summary
# ─────────────────────────────────────────────────────────────────────────────
class AITModelInfo {
    [string] $Model
    [double] $Temperature
    [int]    $MaxTokens
    [string] $ExtractionMode      # fire | single_shot | auto_fire
    [string] $TaxonomyFilter      # rag | full | rag_per_chunk
    [int]    $TaxonomyNodes
    [double] $FireConfidenceThreshold
    [bool]   $Chunked
    [int]    $ChunkCount
    [PSObject]$FireStats           # api_calls, iterations, claims_total, etc.
}

# ─────────────────────────────────────────────────────────────────────────────
# AITSource — typed representation of a source document + summary statistics
# ─────────────────────────────────────────────────────────────────────────────
class AITSource {
    [string]       $Id
    [string]       $Title
    [string]       $Url
    [string[]]     $Authors
    [string]       $DatePublished
    [string]       $DateIngested
    [string]       $ImportTime
    [string]       $SourceTime
    [string]       $SourceType
    [string[]]     $PovTags
    [string[]]     $TopicTags
    [string[]]     $RolodexAuthorIds
    [string]       $ArchiveStatus
    [string]       $SummaryVersion
    [string]       $SummaryStatus
    [string]       $SummaryUpdated
    [string]       $OneLiner
    [string]       $MDPath
    [string]       $Directory

    # Summary statistics (populated when summary exists)
    [int]          $TotalClaims
    [ClaimsByPov]  $ClaimsByPov
    [int]          $TotalFacts
    [int]          $UnmappedConcepts
    [AITModelInfo] $ModelInfo
}

Update-TypeData -TypeName AITSource -MemberType AliasProperty -MemberName DocId -Value Id -Force

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
    [string]$ParentRelationship
    [string]$ParentRationale
    [string[]]$Children
    [string[]]$CrossCuttingRefs
    [string[]]$SituationRefs
    [PSObject]$Interpretations
    [string[]]$LinkedNodes
    [double]$Score
    [PSObject]$GraphAttributes
}

# ─────────────────────────────────────────────────────────────────────────────
# Module-scoped taxonomy store
# ─────────────────────────────────────────────────────────────────────────────
$script:TaxonomyData = @{}
$script:CachedEmbeddings = $null  # Lazy-loaded by Get-RelevantTaxonomyNodes

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
        if ($File.Name -in 'embeddings.json', 'edges.json', 'policy_actions.json', '_archived_edges.json') { continue }
        if ($File.Length -gt 10MB) {
            Write-Warning "Taxonomy: skipping $($File.Name) — file is $([math]::Round($File.Length / 1MB, 1)) MB (likely corrupted, max 10 MB)."
            continue
        }
        try {
            $Json    = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
            # Only register POV files that follow the taxonomy shape (have a .nodes array).
            # Auxiliary files (lineage_categories.json, etc.) live alongside POV files but
            # don't belong in $script:TaxonomyData.
            if (-not ($Json -and $Json.PSObject.Properties['nodes'])) {
                Write-Verbose "Taxonomy: skipping $($File.Name) (no 'nodes' property — not a POV file)"
                continue
            }
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

# Load policy registry
$script:PolicyRegistry = $null
$RegistryFile = Join-Path $TaxonomyDir 'policy_actions.json'
if (Test-Path $RegistryFile) {
    try {
        $script:PolicyRegistry = Get-Content -Raw -Path $RegistryFile | ConvertFrom-Json
        Write-Verbose "Policy registry: loaded $($script:PolicyRegistry.policy_count) policies"
    }
    catch {
        Write-Warning "Policy registry: failed to load — $($_.Exception.Message)"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Backward-compatibility & convenience aliases
# ─────────────────────────────────────────────────────────────────────────────
Set-Alias -Name 'Import-Document'  -Value 'Import-AITriadDocument'  -Scope Global
Set-Alias -Name 'TaxonomyEditor'   -Value 'Show-TaxonomyEditor'    -Scope Global
Set-Alias -Name 'POViewer'         -Value 'Show-POViewer'           -Scope Global
Set-Alias -Name 'SummaryViewer'    -Value 'Show-SummaryViewer'      -Scope Global
Set-Alias -Name 'Redo-Snapshots'   -Value 'Update-Snapshot'         -Scope Global
Set-Alias -Name 'Install-AITdependencies' -Value 'Install-AIDependencies' -Scope Global
Set-Alias -Name 'Workflow'             -Value 'Show-WorkflowRunner'    -Scope Global

# ─────────────────────────────────────────────────────────────────────────────
# Deprecation wrappers — old cmdlet names delegate to new names
# ─────────────────────────────────────────────────────────────────────────────
function Find-CrossCuttingCandidates {
    <#
    .SYNOPSIS
        DEPRECATED: Use Find-SituationCandidates instead.
    #>
    [CmdletBinding()]
    param()

    Write-Warning (New-ActionableError -Goal 'run Find-CrossCuttingCandidates' `
        -Problem 'Find-CrossCuttingCandidates was renamed in the Situations migration' `
        -Location 'AITriad module' `
        -NextSteps 'Use Find-SituationCandidates instead' `
        -PassThru)

    Find-SituationCandidates @PSBoundParameters
}

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
    'Measure-TaxonomyBaseline'
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
    'Find-SituationCandidates'
    'Find-CrossCuttingCandidates'
    'Show-TriadDialogue'
    'Register-AIBackend'
    'Install-AITriadData'
    'Install-AIDependencies'
    'Test-Dependencies'
    'Find-PossibleFallacy'
    'Find-PolicyAction'
    'Get-Policy'
    'Update-PolicyRegistry'
    'Show-FallacyInfo'
    'Test-TaxonomyIntegrity'
    'Invoke-HierarchyProposal'
    'Set-TaxonomyHierarchy'
    'Invoke-SchemaMigration'
    'Invoke-PolicyRefinement'
    'Repair-UnmappedConcepts'
    'Invoke-AITDebate'
    'Convert-MD2PDF'
    'Show-Markdown'
    'Show-DebateDiagnostics'
    'Show-DebateHarvest'
    'Repair-DebateOutput'
    'Get-AITSBOM'
    'Test-OntologyCompliance'
    'Get-RelevantTaxonomyNodes'
    'Invoke-QbafConflictAnalysis'
    'Test-ExtractionQuality'
    'Show-WorkflowRunner'
    'Test-EdgeDirection'
    'Test-AITJudgeModel'
    'Repair-AITSummaryMappings'
    'Invoke-EdgeWeightEvaluation'
    'Normalize-Markdown'
    'Compare-DebateRuns'
    'Invoke-DebateAB'
) -Alias @(
    'Import-Document'
    'TaxonomyEditor'
    'POViewer'
    'SummaryViewer'
    'Redo-Snapshots'
    'Show-MD'
    'Workflow'
)

# ─────────────────────────────────────────────────────────────────────────────
# Register -Model argument completers (module-scoped, captures $script:ValidModelIds)
# ─────────────────────────────────────────────────────────────────────────────
$_modelCompleter = {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    $script:ValidModelIds | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}

foreach ($_cmd in @(
    'Invoke-POVSummary', 'Invoke-BatchSummary', 'Invoke-AttributeExtraction',
    'Invoke-EdgeDiscovery', 'Invoke-GraphQuery', 'Invoke-TaxonomyProposal',
    'Invoke-HierarchyProposal', 'Invoke-PolicyRefinement', 'Invoke-AITDebate',
    'Import-AITriadDocument', 'Find-PolicyAction', 'Find-PossibleFallacy',
    'Find-SituationCandidates', 'Get-ConflictEvolution', 'Get-Edge',
    'Get-IngestionPriority', 'Get-RelevantTaxonomyNodes', 'Get-TopicFrequency',
    'Show-TriadDialogue'
)) {
    Register-ArgumentCompleter -CommandName $_cmd -ParameterName 'Model' -ScriptBlock $_modelCompleter
}
