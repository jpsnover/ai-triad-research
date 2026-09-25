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
    # t/3197 — G1 grounding refs (t/3157), written onto POV nodes by the G7 reconciler
    # (reconcile_grounding.py). Arrays of objects:
    #   ConceptRefs[] : { ref: 'term:<canonical_form>', surface, method: surface|embedding, link_confidence, status: linked|proposed }
    #   EntityRefs[]  : { ref: <entity_id>, surface, method: exact|alias, link_confidence, match_level, status: linked }
    # Default to a NON-NULL empty array: under Set-StrictMode -Version Latest, `$null.Count`
    # THROWS, so a $null default would break the AC filter `Where-Object { $_.ConceptRefs.Count }`
    # on ungrounded nodes. ([PSObject[]]@() coerces to $null for a typed property; ::new(0) does not.)
    [PSObject[]]$ConceptRefs = [PSObject[]]::new(0)
    [PSObject[]]$EntityRefs  = [PSObject[]]::new(0)
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
# TriadDeckExport — typed -PassThru result from Export-TriadDebateBrief (T8).
# Cross-surface wire contract; field parity with lib/brief/types.ts:182
# (TriadDeckExport) is enforced by a Pester parity test. Optional TS fields
# (checkerModel, specPath) map to nullable PS properties.
# ─────────────────────────────────────────────────────────────────────────────
class TriadDeckExport {
    [string]    $DebateId
    [string]    $Title
    [string]    $Preset
    [string]    $Model
    [string]    $ModelSource
    [string]    $CheckerModel
    [string]    $Path
    [string]    $SpecPath
    [string]    $ManifestPath
    [double]    $TraceCoveragePct
    [hashtable] $Verdicts
    [string[]]  $Warnings
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

class DebatePersistenceResult {
    [string] $Status       # OK | LOCKED | NO_PERMISSION
    [string] $Path
    [string] $LockHolder   # process name if identifiable, otherwise $null
}

# AI Call Log record (t/3243; schema of record from t/3235#1 / t/3241). One instance
# per ai-call-log.jsonl line. Get-AICallLog emits these; Show-AICallLog (t/3244) renders them.
class AICallLogEntry {
    [int]      $ID           # monotonic within the log file (a "session" = the file)
    [datetime] $Datetime     # UTC; parsed from the ISO-8601 round-trip string on disk
    [string]   $Scenario     # caller-supplied tag (e.g. Debate, Chat, Fact Check)
    [string]   $PromptID     # UsageID from ai-usages.json, or '' when absent
    [string]   $PromptStart  # first 160 chars of the rendered prompt
    [int]      $RetryCount   # 0 first attempt, N for the Nth retry
    [string]   $Status       # HTTP/API status (e.g. 200, 429, 500, timeout)
}

# ─────────────────────────────────────────────────────────────────────────────
# Module-scoped mutable state (t/3665)
# ─────────────────────────────────────────────────────────────────────────────
# All mutable $script:* runtime state is (re)initialized by the single-source
# Initialize-AITriadRuntimeState (Private/), called once below after dot-sourcing and
# re-invoked per test file by the test bootstrap to reset state cheaply. Here we only
# declare the PRISTINE corpus holders it populates on first call and re-points to on reset.
$script:_PristineTaxonomyData        = $null
$script:_PristineTaxonomyTimestamps  = $null
$script:_PristinePolicyRegistry      = $null
$script:_PristineCorpusHash          = $null

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
        if (-not $_loaded) {
            $_path = Join-Path $_dir "$_name.psm1"
            if (Test-Path $_path) {
                try {
                    Import-Module $_path -Force
                    $_loaded = $true
                }
                catch {
                    Write-Warning "Failed to import ${_name}.psm1: $_ — related features will be unavailable."
                }
            }
        }
    }
    if (-not $_loaded) {
        Write-Verbose "${_name}.psm1 not found — related features will be unavailable."
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Initialize mutable runtime state — single source of truth (t/3665).
# First call eager-loads the taxonomy/policy corpus (same logic as before) and captures
# a pristine reference + hash; the test bootstrap re-invokes it per file to reset cheaply.
# Must run AFTER dot-sourcing (needs Get-TaxonomyDir / Test-IsPovTaxonomyData) and after
# companion-module import.
# ─────────────────────────────────────────────────────────────────────────────
Initialize-AITriadRuntimeState

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
    'Clear-AICallLog'   # t/3241 — AI Call Log core (rotate/clear)
    'Get-AICallLog'     # t/3243 — AI Call Log reader (filterable, pipeline)
    'Show-AICallLog'    # t/3244 — AI Call Log HTML viewer (sortable/filterable)
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
    'Repair-SituationReciprocity'
    # t/3015 — WS-B Stage 2: commit embedding-proposed evidence links (provenance-stamped, purgeable)
    'Add-SituationEvidenceLink'
    'Export-AggregatedCruxes'
    'Export-TriadDebateBrief'
    'Test-BriefNarrationStage'
    'Get-Summary'
    'Invoke-AttributeExtraction'
    'Invoke-EdgeDiscovery'
    'Invoke-EdgeRationaleBackfill'
    'Get-GraphNode'
    'Find-GraphPath'
    'Approve-Edge'
    'Approve-TaxonomyProposal'
    'Get-Concept'   # t/3291 — standardized dictionary reader + concept<->node reverse map
    'Get-Edge'
    'Get-Situation'
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
    # t/2876 — pre-validate taxonomy dir against embed_taxonomy.py loader contract
    'Test-TaxonomyDir'
    # t/2902 — dirty-tree-sweep guard for whole-file data-repo writes
    'Assert-CleanDataTree'
    # t/2916 — durable batch writer: field-surgical node-field edits (sweep-proof)
    'Save-JsonNodeFieldEdits'
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
    # t/3011 — data-boundary gate validator for situation per-POV BDI decomposition
    'Test-SituationBdiCompliance'
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
    'Get-SyntheticStatement'
    'Export-SyntheticEmbeddings'
    'Test-SynthesisCompleteness'
    'Get-ImportReport'
    'Get-CalibrationTrend'
    'Test-TaxEditorHealth'
    # t/3584 — hosted inquiry data-presence smoke (defeats ADR-001 silent-empty)
    'Test-TaxEditorInquiry'
    # t/2787 — smoke-test /api/embeddings/compute in production
    'Test-EmbeddingHealth'
    'Test-TaxEditorEndpoints'
    'Test-AnonymousDebateFlow'
    'Test-PersonaEndpoints'
    'Test-ServiceWorkerHealth'
    'Watch-DebateProgress'
    'Invoke-DebateBatch'
    'Get-FreeTierStatus'
    'Sync-FreeTierKeys'
    'Invoke-TaxEditorSmokeTest'
    # t/2668 — analytics storage round-trip diagnosis
    # t/2775 — validate the built preload.cjs artifact before launch
    'Test-PreloadHealth'
    'Test-AnalyticsBackend'
    # t/2702 — analytics blob container health (exists/accessible/recent data)
    'Test-AnalyticsBlobHealth'
    # t/2708 — analytics read-side: per-event-type counts from the query endpoint
    'Get-AnalyticsEventTypes'
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
    'Invoke-DebateGroundingBatch'
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
    'Update-EntityEmbeddings'   # t/3121 D — backfill entity_embeddings.json to v2 multi-vector
    # t/1261 — UsageID registry
    'Invoke-AIByUsage'
    # t/1308 — cc→sit migration
    'Invoke-CcToSitMigration'
    'Test-AIApiKey'
    # t/3564 — drift-proof model-tier resolver (reads ai-models.json debateTiers)
    'Get-AITierModel'
    # t/3596 — derived belief-node → source index (sidecar source_index.json)
    'Build-NodeSourceIndex'
    'Test-GeminiKeyPool'
    'Test-AIBackendHealth'
    'Test-AIBackendQuota'
    'Test-AIModelsConfig'
    # t/1492 — GHCR cleanup
    'Remove-StaleContainerImages'
    # t/1493 — Taxonomy snapshot fetch
    'Get-TaxonomySnapshot'
    # t/1498 — ACA revision queries
    'Get-ContainerAppRevision'
    # t/1499 — GH workflow run queries
    'Get-GitHubWorkflowRun'
    'Get-CIFailureSummary'
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
    # t/3124 — Claim-side entity grounding: writes entity_refs[] onto summary claims
    'Update-ClaimEntityRef'
    # t/3215 — FOL Phase 1: formalize claims into neo-Davidsonian logical_form (schema t/3126)
    'Invoke-LogicalFormPass'
    # t/2196 — Vite dev server diagnostic
    'Get-ViteDevStatus'
    # t/2330 — Debate session state diagnostic
    'Get-DebateSessionState'
    # t/2335 — Debate index field-type integrity check (per-session files)
    'Test-DebateIndexIntegrity'
    # t/2735 — Debate index (.debate-index.json) type-invalid entry scan + repair
    'Get-DebateIndexHealth'
    # t/3065 — 429/rate-limit pattern summary from a flight recorder dump
    'Get-DebateRateLimitSummary'
    # t/2367 — Debate blob existence check in Azure storage
    'Test-DebateSession'
    # t/2545 — Pre-flight atomic write+rename probe for debate output dir
    'Test-DebatePersistence'
    # Op-ed generation in a POV Soul-document voice
    'New-OpEd'
    # Fetch + convert + validate a source URL for op-ed generation (once per URL)
    'Get-OpEdSource'
    # t/2765 — ACA server log retrieval with requestId correlation
    'Get-ServerLog'
    # t/3082 — Log Analytics server-log query (deep history) by window/requestId/pattern
    'Get-TaxEditorServerLogs'
    # t/3168 — one-shot embeddings-cache resolving/re-computing verdict on the live revision
    'Test-EmbeddingsCacheHealth'
    # t/3195 — parse JSON tolerating truncation (recovers the valid prefix; exported so the
    # Invoke-EntityExtraction parallel runspace can call it)
    'ConvertFrom-TruncatableJson'
    # t/3225 — stale-head-merge guard: verify PR headRefOid == remote tip before gh pr merge
    'Invoke-VerifiedMerge'
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
    'Invoke-EdgeDiscovery', 'Invoke-EdgeRationaleBackfill', 'Invoke-GraphQuery', 'Invoke-TaxonomyProposal',
    'Invoke-HierarchyProposal', 'Invoke-PolicyRefinement', 'Invoke-AITDebate',
    'Import-AITriadDocument', 'Find-PolicyAction', 'Find-PossibleFallacy',
    'Find-SituationCandidates', 'Get-ConflictEvolution', 'Get-Edge',
    'Get-IngestionPriority', 'Get-RelevantTaxonomyNodes', 'Get-TopicFrequency',
    'Show-TriadDialogue'
)) {
    Register-ArgumentCompleter -CommandName $_cmd -ParameterName 'Model' -ScriptBlock $_modelCompleter
}
