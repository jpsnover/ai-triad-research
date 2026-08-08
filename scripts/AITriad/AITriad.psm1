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

    # Provenance (populated from metadata.json provenance fields)
    [object]       $Provenance
    [string]       $ProvenanceStatus
    [string]       $ResolvedUrl

    # Summary statistics (populated when summary exists)
    [int]          $TotalClaims
    [ClaimsByPov]  $ClaimsByPov
    [int]          $TotalFacts
    [int]          $UnmappedConcepts
    [AITModelInfo] $ModelInfo
}

Update-TypeData -TypeName AITSource -MemberType AliasProperty -MemberName DocId -Value Id -Force

# ─────────────────────────────────────────────────────────────────────────────
# AITDebate — typed representation of a debate session
# ─────────────────────────────────────────────────────────────────────────────
class AITDebate {
    [string]       $Id
    [string]       $Title
    [string]       $Topic
    [DateTime]     $CreatedAt
    [DateTime]     $UpdatedAt
    [string]       $Phase
    [string]       $Audience
    [string]       $Protocol
    [string]       $SourceType
    [string]       $SourceRef
    [string[]]     $Debaters
    [double]       $Temperature
    [string]       $Model
    [string]       $Origin
    [bool]         $AdaptiveStaging
    [string]       $Pacing
    [int]          $TranscriptCount
    [int]          $Rounds
    [int]          $Statements
    [int]          $Interventions
    [bool]         $HasSynthesis
    [bool]         $HasDiagnostics
    [bool]         $HasHarvest
    [string]       $FilePath
}

Update-TypeData -TypeName AITDebate -MemberType AliasProperty -MemberName DebateId -Value Id -Force

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
    # t/1588 — structural signals mirrored from lib/debate/severeTestScheduler.ts's
    # computeNodeImportance() so PS + TS derive `degree` and `usage` from the
    # same source. ConflictIds may be absent on nodes with no conflict links;
    # DoctrinallyAnchored defaults to $false; DebateRefs is the count-source
    # for the `usage` importance term.
    [string[]]$ConflictIds
    [bool]$DoctrinallyAnchored
    [string[]]$DebateRefs
    [PSObject]$Interpretations
    [string[]]$LinkedNodes
    [double]$Score
    [PSObject]$GraphAttributes
    [PSObject[]]$LabelHistory
    [PSObject[]]$DescriptionHistory
    [PSObject[]]$ChangeHistory
    [string]$PlainDescription
    [string]$PlainDescriptionVersion
}

# ─────────────────────────────────────────────────────────────────────────────
# AITClaim — typed representation of an extracted claim (factual or key point)
# ─────────────────────────────────────────────────────────────────────────────
class AITClaim {
    [string]   $DocId
    [string]   $Type            # FactualClaim | KeyPoint
    [string]   $Text
    [string]   $Label           # claim_label (FactualClaim only)
    [string]   $POV             # accelerationist/safetyist/skeptic (KeyPoint only)
    [string]   $Category        # BDI category (KeyPoint only)
    [string]   $Stance          # aligned/neutral/opposed (KeyPoint only)
    [string]   $DocPosition     # supports/contradicts/discusses (FactualClaim only)
    [string]   $TemporalScope   # historical/predictive/timeless (FactualClaim only)
    [string]   $TemporalBound   # date bound (FactualClaim only)
    [double]   $Confidence      # extraction_confidence
    [double]   $FireConfidence  # fire_confidence (FactualClaim only)
    [string[]] $LinkedNodes     # taxonomy node IDs
    [string]   $Specificity     # evidence_criteria.specificity (FactualClaim only)
    [bool]     $HasWarrant      # evidence_criteria.has_warrant (FactualClaim only)
    [string]   $EvidenceLevel   # evidence_criteria.category_criteria.evidence_level (FactualClaim only)
    [string]   $Verbatim        # verbatim quote (KeyPoint only)
}

# ─────────────────────────────────────────────────────────────────────────────
# HealthCheck — individual check result from Test-TaxEditorHealth
# ─────────────────────────────────────────────────────────────────────────────
class HealthCheck {
    [string] $Endpoint
    [string] $Purpose
    [int]    $Status
    [bool]   $Healthy
    [int]    $Ms
    [string] $Detail
}

# ─────────────────────────────────────────────────────────────────────────────
# TaxEditorHealthResult — overall result from Test-TaxEditorHealth
# ─────────────────────────────────────────────────────────────────────────────
class TaxEditorHealthResult {
    [string]        $BaseUrl
    [bool]          $Healthy
    [HealthCheck[]] $Checks
    [int]           $AverageMs
    [int]           $FreeTierKeyPoolSize
    [string]        $Timestamp
}

# ─────────────────────────────────────────────────────────────────────────────
# AcaRevision — typed result from Get-TaxEditorRevision
# ─────────────────────────────────────────────────────────────────────────────
class AcaRevision {
    [string] $Name
    [bool]   $Active
    [int]    $TrafficWeight
    [string] $RunningState
    [string] $ImageTag
    [string] $CreatedAt
}

# ─────────────────────────────────────────────────────────────────────────────
# GhcrImage — typed result from Get-TaxEditorImage
# ─────────────────────────────────────────────────────────────────────────────
class GhcrImage {
    [string[]] $Tags
    [string]   $Digest
    [string]   $CreatedAt
    [bool]     $IsKnownGood
}

# ─────────────────────────────────────────────────────────────────────────────
# DataCommit — typed result from Get-TaxEditorDataCommit
# ─────────────────────────────────────────────────────────────────────────────
class DataCommit {
    [string] $Sha
    [string] $ShortSha
    [string] $Message
    [string] $Author
    [string] $Date
}

# ─────────────────────────────────────────────────────────────────────────────
# BlobInfo — typed result from Get-TaxEditorBlob
# ─────────────────────────────────────────────────────────────────────────────
class BlobInfo {
    [string] $Name
    [string] $Container
    [long]   $Size
    [string] $LastModified
    [bool]   $Deleted
    [string] $DeletedAt
}

# ─────────────────────────────────────────────────────────────────────────────
# EndpointTestResult — typed result from Test-TaxEditorEndpoints
# ─────────────────────────────────────────────────────────────────────────────
class EndpointTestResult {
    [string] $Endpoint
    [string] $Category
    [string] $Description
    [int]    $Status
    [bool]   $Pass
    [int]    $Ms
    [object] $NodeCount
    [string] $Error
}

class AnonymousFlowStepResult {
    [int]    $Step
    [string] $Method
    [string] $Endpoint
    [string] $Description
    [string] $BugTags
    [bool]   $Pass
    [int]    $StatusCode
    [int]    $Ms
    [string] $Error
}

# ─────────────────────────────────────────────────────────────────────────────
# StaleImageCleanupResult — typed result from Remove-StaleContainerImages (t/1492)
# ─────────────────────────────────────────────────────────────────────────────
class StaleImageCleanupResult {
    [string]  $Package
    [string]  $Owner
    [int]     $TotalUntagged
    [int]     $KeptCount
    [int]     $DeletedCount
    [long[]]  $DeletedIds
    [string[]] $Failures
    [string]  $CutoffUtc
}

# ─────────────────────────────────────────────────────────────────────────────
# TaxonomySnapshotResult — typed result from Get-TaxonomySnapshot (t/1493)
# ─────────────────────────────────────────────────────────────────────────────
class TaxonomySnapshotResult {
    [string]   $OutputPath
    [string]   $Repo
    [string]   $Branch
    [string]   $Commit
    [string]   $Generated
    [object[]] $Files
    [bool]     $Valid
    [string[]] $MissingRequired
    [string]   $SnapshotMetaPath
}

# ─────────────────────────────────────────────────────────────────────────────
# ContainerAppRevisionInfo — typed result from Get-ContainerAppRevision (t/1498)
# ─────────────────────────────────────────────────────────────────────────────
class ContainerAppRevisionInfo {
    [string] $Name
    [int]    $TrafficWeight
    [bool]   $Active
    [string] $Fqdn
    [string] $CreatedTime
}

# ─────────────────────────────────────────────────────────────────────────────
# GitHubWorkflowJobInfo / GitHubWorkflowRunInfo — typed results
# from Get-GitHubWorkflowRun (t/1499)
# ─────────────────────────────────────────────────────────────────────────────
class GitHubWorkflowJobInfo {
    [string] $Name
    [string] $Status
    [string] $Conclusion
}

class GitHubWorkflowRunInfo {
    [long]                    $RunId
    [string]                  $Status
    [string]                  $Conclusion
    [string]                  $HeadSha
    [string]                  $Url
    [GitHubWorkflowJobInfo[]] $Jobs
}

class FreeTierStatus {
    [string]   $Tier
    [int]      $DailyTokenBudget
    [int]      $TokensUsedToday
    [int]      $TokensRemainingToday
    [double]   $BudgetUtilizationPct
    [int]      $RPMLimit
    [string[]] $AllowedRoutes
    [object]   $MilestoneWarnings
    [string]   $LastResetTime
    [string]   $BaseUrl
}

class EdgeTypeResolution {
    [string] $Action   # accept | reclassify | drop
    [string] $Type     # canonical type when accept/reclassify; empty when drop
    [string] $Reason   # human-readable explanation for reclassify/drop
}

class ServiceWorkerHealthCheck {
    [string] $Name
    [bool]   $Pass
    [string] $Detail
}

class ServiceWorkerHealth {
    [string]                     $BaseUrl
    [bool]                       $FetchedOk
    [int]                        $StatusCode
    [int]                        $Bytes
    [string]                     $Hash
    [string]                     $SkipWaitingMode   # auto | message | none
    [bool]                       $ClientsClaim
    [string[]]                   $Denylist
    [string[]]                   $MissingDenylist
    [string]                     $NavigateFallback
    [int]                        $PrecacheCount
    [object[]]                   $PrecacheManifest
    [ServiceWorkerHealthCheck[]] $Checks
    [bool]                       $OverallPass
}

class PersonaEndpointTestResult {
    [string] $Persona
    [string] $Method
    [string] $Endpoint
    [string] $Category
    [bool]   $ExpectedAccess   # true = expected 2xx, false = expected 401/403
    [bool]   $ActualAccess     # true = got 2xx, false = got 401/403 (or 200-but-shell)
    [bool]   $Pass             # ExpectedAccess == ActualAccess after shell reclassification (t/1355)
    [int]    $StatusCode
    [string] $ContentType      # t/1355 — used to distinguish real JSON response from SPA fall-through
    [string] $BodyKind         # t/1355 — 'json' | 'html' | 'empty' | 'unparsed'
    [int]    $Ms
    [string] $Note             # 'skipped: no PersonaSecret'; '200-but-SPA-shell' etc.
    [string] $Error
}

# t/1224 — Organization data model. Mirrors the HLD at t/1217#1 plus the
# policy_engagement field added per TL guidance.
class OrganizationPovAlignment {
    [double] $Score          # -1.0 .. 1.0
    [string] $Rationale
}

class OrganizationTopicEngagement {
    [string] $TopicRef       # sit-NNN
    [string] $Stance         # advocate | opponent | researcher | neutral
    [string] $Description
}

class OrganizationPolicyEngagement {
    [string] $PolicyRef      # pol-NNN
    [string] $Stance         # supports | opposes
}

class OrganizationKeyFigure {
    [string] $Name
    [string] $Role
    [string] $Relevance
}

class OrganizationExternalLink {
    [string] $Type           # website | position_paper | report | blog | social | wikipedia | legislation
    [string] $Url
    [string] $Title
}

# t/1560 — derived per-camp alignment (mirrors PovAlignmentDerivedPerCamp
# in lib/organizations/types.ts). Three-state: PovAlignmentDerived null on
# the Organization = never computed; NetRatio null with N=0 = computed,
# no data; NetRatio non-null = computed with data. Do NOT collapse
# NetRatio to 0.0 default — erases the "no data" signal (TL t/1560#4).
class OrganizationPovAlignmentDerivedPerCamp {
    [int]                     $Advocates
    [int]                     $Opposes
    [int]                     $N
    [System.Nullable[double]] $NetRatio
}

class OrganizationPovAlignmentDerivedProvenance {
    [string]   $ComputedAt
    [string]   $CmdletVersion
    [string]   $InputEdgesSha
    [string[]] $IncludedStatusFilter
    [int]      $EdgeCount
}

class OrganizationPovAlignmentDerived {
    [OrganizationPovAlignmentDerivedPerCamp]    $Acc
    [OrganizationPovAlignmentDerivedPerCamp]    $Saf
    [OrganizationPovAlignmentDerivedPerCamp]    $Skp
    [OrganizationPovAlignmentDerivedProvenance] $Provenance
}

# ─────────────────────────────────────────────────────────────────────────────
# NodeTestingRecord — typed emit from Get-NodeTestingRecord (t/1579 Phase 2).
# Read-only projection of graph_attributes.debate_tested onto a
# pipeline-composable shape for research users.
# ─────────────────────────────────────────────────────────────────────────────
class NodeTestingRecord {
    [string]   $NodeId
    [string]   $Pov              # accelerationist | safetyist | skeptic
    [string]   $Category         # Beliefs | Desires | Intentions
    [string]   $Label
    [string]   $Tier             # untested | cited | contested | well_tested
    [double]   $SortKey
    [int]      $Engagements
    [int]      $Challenges
    [int]      $Held
    [int]      $Weakened
    [string]   $LastTested
    [bool]     $Refined          # true if any revision has held_since
    [bool]     $Stale            # description_hash mismatch (see help for exemption)
    [string[]] $ChallengerCamps  # distinct camps in record[]
    [double]   $Importance       # populated only when -SortBy Deficit
    [double]   $Deficit          # populated only when -SortBy Deficit
    [double]   $TestingPriority  # importance * deficit, only when -SortBy Deficit
}

class Organization {
    [string]                          $Id          # org-NNN
    [string]                          $Name
    [string]                          $ShortName
    [string]                          $Type        # think_tank | advocacy | regulatory | academic | corporate | intergovernmental | civil_society | standards_body | research_lab
    [string]                          $Description
    [string]                          $Url
    [string]                          $Headquarters
    [int]                             $Founded
    [string]                          $Status      # active | dissolved | merged
    [hashtable]                       $PovAlignment           # 'accelerationist'|'safetyist'|'skeptic' → OrganizationPovAlignment
    [OrganizationPovAlignmentDerived] $PovAlignmentDerived    # t/1560; $null when never computed
    [OrganizationTopicEngagement[]]   $TopicEngagement
    [OrganizationPolicyEngagement[]]  $PolicyEngagement
    [OrganizationKeyFigure[]]         $KeyFigures
    [OrganizationExternalLink[]]      $ExternalLinks
    [string[]]                        $SourceRefs
    [string[]]                        $Tags
    [string]                          $CreatedAt
    [string]                          $LastModified
}

class OrganizationStakeholders {
    [string]         $PolicyId
    [Organization[]] $Supporters
    [Organization[]] $Opposers
}

class OrganizationIntegrityIssue {
    [string] $OrgId
    [string] $Severity   # error | warning
    [string] $Field
    [string] $Message
}

class OrganizationIntegrityReport {
    [int]                          $Total
    [int]                          $Errors
    [int]                          $Warnings
    [bool]                         $Pass
    [OrganizationIntegrityIssue[]] $Issues
}

# t/1526 — Organization actor-relationship edges (parallel to argumentation edges.json)
class OrganizationEdge {
    [string]   $Source          # org-*
    [string]   $Target          # org-* | sit-* | pol-* | src-* | BDI node id, per type family
    [string]   $Type            # one of Resolve-OrganizationEdgeType 9-value registry
    [string]   $Rationale
    [string[]] $SourceRefs
    [string]   $Status          # approved | proposed | disputed | rejected (default: approved)
    [string]   $DiscoveredAt    # YYYY-MM-DD
}

class OrganizationEdgeIntegrityIssue {
    [int]    $EdgeIndex
    [string] $Source
    [string] $Target
    [string] $Type
    [string] $Severity   # error | warning
    [string] $Field
    [string] $Message
}

class OrganizationEdgeIntegrityReport {
    [int]                                 $Total
    [int]                                 $Errors
    [int]                                 $Warnings
    [bool]                                $Pass
    [OrganizationEdgeIntegrityIssue[]]    $Issues
}

# ─────────────────────────────────────────────────────────────────────────────
class ViteDevStatus {
    [int]     $Port
    [bool]    $Listening
    [int]     $ProcessId
    [string]  $ProcessName
    [string]  $WorkingDirectory
    [bool]    $IsMainRepo
    [bool]    $IsRegisteredWorktree
    [bool]    $IsOrphanedWorktree
    [int]     $RootHttpStatus
    [int]     $IndexHttpStatus
    [string]  $Summary
}

# ─────────────────────────────────────────────────────────────────────────────
# Module-scoped taxonomy store
# ─────────────────────────────────────────────────────────────────────────────
$script:TaxonomyData = @{}
$script:TaxonomyFileTimestamps = @{}  # file path → LastWriteTime for staleness detection
$script:CachedEmbeddings = $null         # Lazy-loaded by Get-RelevantTaxonomyNodes
$script:EmbeddingsTimestamp = $null      # LastWriteTime of embeddings.json
$script:CachedSyntheticVectors = $null   # Lazy-loaded (multi-vector synthetic embeddings)
$script:SyntheticTimestamp = $null       # LastWriteTime of synthetic_embeddings.json
$script:TaxonomyCacheLastCheck = $null  # UTC time of last staleness check (cooldown)
# Provisional threshold (0.45) — calibrate against SAF-167 repro case and a
# good-vs-bad attribution distribution before treating this as a tuned gate.
$script:RetrievalConfidenceThreshold = 0.45
# CL-owned: veto when sim(kp, excludes_text) - sim(kp, core_text) > this margin (0.0 = any positive margin).
$script:ExcludesVetoMargin = 0.0

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
        foreach ($File in Get-ChildItem -Path $Dir -Filter '*.ps1' -File -Recurse) {
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
        if ($File.Name -in 'embeddings.json', 'edges.json', 'policy_actions.json', '_archived_edges.json', 'lineage_categories.json', 'interpretation_embeddings.json', 'source_evidence_index.json', 'similarity-cache.json') { continue }
        # Embedding-variant files (e.g. embeddings-orgstance-6733.json, t/524) are legitimately
        # large (50MB+, ~9,500 orgs x 1,536-dim vectors) and carry no .nodes array — they are
        # loaded on demand by org-stance cmdlets, never by this POV loop. Skip them BEFORE the
        # corruption guard so they neither trip the 10MB POV-corruption warning (t/1645) nor get
        # parsed-then-discarded 13x per batch run. The 10MB guard below still protects POV files.
        if ($File.Name -like 'embeddings-*.json' -or $File.Name -like '*-embeddings.json') { continue }
        if ($File.Length -gt 10MB) {
            Write-Warning "Taxonomy: skipping $($File.Name) — file is $([math]::Round($File.Length / 1MB, 1)) MB (likely corrupted, max 10 MB)."
            continue
        }
        try {
            $Json    = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
            # Only register POV files that follow the taxonomy-node shape (a .nodes
            # array whose entries carry an 'id'). Auxiliary files (lineage_categories.json)
            # and sidecar logs (entity_extraction_log.json, whose nodes are keyed by
            # 'node_id' — t/1834) live alongside POV files but must NOT be treated as POVs.
            if (-not (Test-IsPovTaxonomyData $Json)) {
                Write-Verbose "Taxonomy: skipping $($File.Name) (not a POV node file — no id-shaped nodes[])"
                continue
            }
            $PovName = $File.BaseName.ToLower()
            $script:TaxonomyData[$PovName] = $Json
            $script:TaxonomyFileTimestamps[$File.FullName] = $File.LastWriteTime
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
    'Get-AITDebate'
    'Repair-PovDescriptions'
    'Repair-PovLineage'
    'Repair-PovAttributes'
    'Export-AggregatedCruxes'
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
    'Resume-AITDebate'
    'Convert-DebateToAudio'
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
    'Repair-ResolvedBackfill'
    'Invoke-EdgeWeightEvaluation'
    'Repair-Markdown'
    'Compare-DebateRuns'
    'Compare-DebateQuality'
    'Measure-DebateQuality'
    'Invoke-DebateAB'
    'Get-AICostReport'
    'Show-OSSLicenses'
    'Get-FlightRecorderDump'
    'Get-LatestFlightRecorderDump'
    'Get-AzureFlightRecorder'
    'Show-FlightRecorder'
    'Update-AITSourceIndex'
    'Get-PovLineage'
    'Get-IntellectualLineage'
    'Invoke-BDIWeightAssignment'
    'Register-AITriadDrive'
    'Get-TaxonomyProcess'
    'Request-FlightRecorderDump'
    'Get-FlightRecorderReport'
    'Get-AITClaim'
    'Compare-EmbeddingModel'
    'Test-RerankerBaseline'
    'New-SyntheticCorpus'
    'Update-SyntheticCorpus'
    'Sync-SyntheticCorpus'
    'Export-SyntheticEmbeddings'
    'Test-SynthesisCompleteness'
    'Get-ImportReport'
    'Get-CalibrationTrend'
    'Test-TaxEditorHealth'
    'Test-TaxEditorEndpoints'
    'Test-AnonymousDebateFlow'
    'Test-PersonaEndpoints'
    'Test-ServiceWorkerHealth'
    'Watch-DebateProgress'
    'Invoke-DebateBatch'
    'Get-FreeTierStatus'
    'Invoke-TaxEditorSmokeTest'
    'Test-AzureHealth'
    'Test-GitHubHealth'
    'Get-TaxEditorRevision'
    'Switch-TaxEditorRevision'
    'Get-TaxEditorDataCommit'
    'Undo-TaxEditorDataCommit'
    'Sync-TaxEditorData'
    'Reset-TaxEditorSession'
    'Get-TaxEditorImage'
    'Deploy-TaxEditorImage'
    'Set-TaxEditorKnownGood'
    'Restore-TaxEditorKnownGood'
    'Test-TaxEditorInfra'
    'Deploy-TaxEditorInfra'
    'Get-TaxEditorBlob'
    'Restore-TaxEditorBlob'
    'Get-CriticalInteraction'
    'Test-CriticalInteractions'
    'Merge-FlightRecorderDumps'
    'Get-TriadConfig'
    'Set-TriadConfig'
    'Invoke-TriadConfigReload'
    'Invoke-VernacularBatch'
    # t/1224 — Organization data model
    'Get-Organization'
    'Find-OrganizationByPOV'
    'Find-OrganizationByTopic'
    'Get-OrganizationStakeholders'
    'Import-Organization'
    'Compare-OrganizationPositions'
    # t/1526 — Organization actor-relationship edges
    'Get-OrganizationEdge'
    'Import-OrganizationEdge'
    # t/1804 — Entity ontology (Phase 1): store + curation cmdlets
    'Get-Entity'
    'Import-Entity'
    # t/1261 — UsageID registry
    'Invoke-AIByUsage'
    # t/1308 — cc→sit migration
    'Invoke-CcToSitMigration'
    'Test-AIApiKey'
    'Test-AIBackendHealth'
    'Test-AIModelsConfig'
    # t/1492 — GHCR cleanup
    'Remove-StaleContainerImages'
    # t/1493 — Taxonomy snapshot fetch
    'Get-TaxonomySnapshot'
    # t/1498 — ACA revision queries
    'Get-ContainerAppRevision'
    # t/1499 — GH workflow run queries
    'Get-GitHubWorkflowRun'
    # t/1550 — POV aphorism backfill
    'Invoke-AphorismBatch'
    # t/1553 Stage 0 — org PUBLISHED edge seeding
    'Invoke-OrgPublishedSeeding'
    # t/1553 Stage 1 — org stance claim extraction
    'Invoke-OrgStanceExtraction'
    # t/1553 Stages 2+3 — claim→node matching + edge proposal aggregation
    'Invoke-OrgClaimMatching'
    # t/1560 Stage 5 — R2 rollup, per-camp derived alignment from approved edges
    'Invoke-OrgDerivedCampScores'
    # t/1500 Phase 3 — blue-green deploy orchestration (e/41)
    'Disable-ContainerAppRevision'
    'New-ContainerAppRevision'
    'Set-ContainerAppTraffic'
    'Get-ContainerAppDiagnostics'
    # t/1579 — Debate-Tested Phase 2 research surface
    'Get-NodeTestingRecord'
    'Update-NodeTestingRecord'
    # t/1654 — pre-embedding TAXONOMY_DIR validation
    'Test-TaxonomyDirContents'
    # t/1806 — Entity ontology Phase 1: extraction + maintenance reports
    'Invoke-EntityExtraction'
    'Get-EntityReport'
    # t/1894 — Entity ontology Phase 2-B: batch mention indexer (entity_mentions.json)
    'Update-EntityMentionIndex'
    # t/2196 — Vite dev server diagnostic
    'Get-ViteDevStatus'
    # t/2330 — Debate session state diagnostic
    'Get-DebateSessionState'
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
