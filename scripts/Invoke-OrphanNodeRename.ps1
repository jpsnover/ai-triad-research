#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Renames 26 bad-prefix orphan nodes to correct BDI-compliant IDs.
    Updates node IDs, parent_id references, linked_nodes, and edge references.
.DESCRIPTION
    Fixes nodes using non-BDI prefixes (data, methods, goals) by renaming them
    to the correct prefix-category pattern (beliefs, desires, intentions).
    All references throughout the taxonomy and summaries are updated.
.PARAMETER DataRoot
    Path to the ai-triad-data repository. Defaults to resolved data path.
.PARAMETER DryRun
    Show what would change without writing files.
#>
[CmdletBinding()]
param(
    [string]$DataRoot,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve data root
if (-not $DataRoot) {
    $configFile = Join-Path $PSScriptRoot '..' '.aitriad.json'
    if (Test-Path $configFile) {
        $config = Get-Content $configFile -Raw | ConvertFrom-Json
        $DataRoot = Join-Path (Split-Path $configFile) $config.data_root
    } else {
        $DataRoot = Join-Path $PSScriptRoot '..' '..' 'ai-triad-data'
    }
}

$TaxDir = Join-Path $DataRoot 'taxonomy' 'Origin'

# ── Rename Map ──────────────────────────────────────────────
# Each entry: old_id → new_id
# New IDs are sequential from the max+1 in each category

$RenameMap = [ordered]@{
    # Accelerationist
    'acc-data-001'    = 'acc-beliefs-021'    # Machine-Tacit Knowledge (Beliefs)
    'acc-goals-001'   = 'acc-desires-020'    # AI Literacy as Core Curriculum (Desires)

    # Safetyist - data → beliefs
    'saf-data-001'    = 'saf-beliefs-049'    # AI-Mediated Emotional Dependency
    'saf-data-002'    = 'saf-beliefs-050'    # AI System Drift Monitoring
    'saf-data-003'    = 'saf-beliefs-051'    # Implicit Bias as Discriminatory Indicator
    'saf-data-004'    = 'saf-beliefs-052'    # Sycophancy as Causal Mechanism

    # Safetyist - methods → intentions
    'saf-methods-001' = 'saf-intentions-103' # AI-Free Assessment Design
    'saf-methods-002' = 'saf-intentions-104' # Child-Rights-by-Design in AI
    'saf-methods-003' = 'saf-intentions-105' # Automated Fairness Benchmarking
    'saf-methods-004' = 'saf-intentions-106' # Context Association Test (CAT)
    'saf-methods-005' = 'saf-intentions-107' # Effective Challenge Culture
    'saf-methods-006' = 'saf-intentions-108' # Finetuning as Memorization Reactivation
    'saf-methods-007' = 'saf-intentions-109' # Implicit Association Test for AI
    'saf-methods-008' = 'saf-intentions-110' # Conditional Audit Outcome

    # Skeptic - data → beliefs
    'skp-data-001'    = 'skp-beliefs-060'    # AI-Driven Disinformation and Misinformation
    'skp-data-002'    = 'skp-beliefs-061'    # Adverse Impact Ratio Limitations
    'skp-data-003'    = 'skp-beliefs-062'    # Stereotype Sentiment Analysis
    'skp-data-004'    = 'skp-beliefs-063'    # Human-Cognitive Bias in AI Lifecycle
    'skp-data-005'    = 'skp-beliefs-064'    # Artificial Jagged Intelligence

    # Skeptic - methods → intentions
    'skp-methods-001' = 'skp-intentions-077' # AI Bias as a Business Liability
    'skp-methods-002' = 'skp-intentions-078' # Automated Bias Benchmarking
    'skp-methods-003' = 'skp-intentions-079' # Legislative Reporting on AI Harms
    'skp-methods-004' = 'skp-intentions-080' # Algorithmic Accountability Staffing
    'skp-methods-005' = 'skp-intentions-081' # Participatory Auditing as Thinking Aid
    'skp-methods-006' = 'skp-intentions-082' # Participatory Auditing Throughout the AI Pipeline
}

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ORPHAN NODE RENAME — 26 bad-prefix nodes → BDI-compliant IDs" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Host "  [DRY RUN] No files will be modified." -ForegroundColor Yellow
    Write-Host ""
}

# ── Phase 1: Update taxonomy JSON files ─────────────────────

$TaxFiles = @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json')
$totalReplacements = 0

foreach ($file in $TaxFiles) {
    $path = Join-Path $TaxDir $file
    if (-not (Test-Path $path)) {
        Write-Warning "  Taxonomy file not found: $path"
        continue
    }

    $content = Get-Content $path -Raw
    $fileReplacements = 0

    foreach ($old in $RenameMap.Keys) {
        $new = $RenameMap[$old]
        # Count occurrences (as node id, parent_id, linked_nodes, edge refs)
        $count = ([regex]::Matches($content, [regex]::Escape("`"$old`""))).Count
        if ($count -gt 0) {
            $content = $content -replace [regex]::Escape("`"$old`""), "`"$new`""
            $fileReplacements += $count
            Write-Host "  $file : $old → $new ($count refs)" -ForegroundColor Green
        }
    }

    if ($fileReplacements -gt 0) {
        $totalReplacements += $fileReplacements
        if (-not $DryRun) {
            Set-Content -Path $path -Value $content -NoNewline
        }
        Write-Host "  $file : $fileReplacements total replacements" -ForegroundColor Cyan
    }
}

# ── Phase 2: Update summaries ───────────────────────────────

$SummariesDir = Join-Path $DataRoot 'summaries'
if (Test-Path $SummariesDir) {
    $summaryFiles = Get-ChildItem $SummariesDir -Filter '*.json'
    $summaryUpdates = 0

    foreach ($sf in $summaryFiles) {
        $content = Get-Content $sf.FullName -Raw
        $changed = $false

        foreach ($old in $RenameMap.Keys) {
            $new = $RenameMap[$old]
            if ($content -match [regex]::Escape("`"$old`"")) {
                $content = $content -replace [regex]::Escape("`"$old`""), "`"$new`""
                $changed = $true
            }
        }

        if ($changed) {
            $summaryUpdates++
            if (-not $DryRun) {
                Set-Content -Path $sf.FullName -Value $content -NoNewline
            }
        }
    }

    Write-Host ""
    Write-Host "  Summaries updated: $summaryUpdates files" -ForegroundColor Cyan
}

# ── Phase 3: Update conflicts ───────────────────────────────

$ConflictsDir = Join-Path $DataRoot 'conflicts'
if (Test-Path $ConflictsDir) {
    $conflictFiles = Get-ChildItem $ConflictsDir -Filter '*.json'
    $conflictUpdates = 0

    foreach ($cf in $conflictFiles) {
        $content = Get-Content $cf.FullName -Raw
        $changed = $false

        foreach ($old in $RenameMap.Keys) {
            $new = $RenameMap[$old]
            if ($content -match [regex]::Escape("`"$old`"")) {
                $content = $content -replace [regex]::Escape("`"$old`""), "`"$new`""
                $changed = $true
            }
        }

        if ($changed) {
            $conflictUpdates++
            if (-not $DryRun) {
                Set-Content -Path $cf.FullName -Value $content -NoNewline
            }
        }
    }

    Write-Host "  Conflicts updated: $conflictUpdates files" -ForegroundColor Cyan
}

# ── Phase 4: Update edges ──────────────────────────────────

$EdgesFile = Join-Path $TaxDir 'edges.json'
if (Test-Path $EdgesFile) {
    $content = Get-Content $EdgesFile -Raw
    $edgeReplacements = 0

    foreach ($old in $RenameMap.Keys) {
        $new = $RenameMap[$old]
        $count = ([regex]::Matches($content, [regex]::Escape("`"$old`""))).Count
        if ($count -gt 0) {
            $content = $content -replace [regex]::Escape("`"$old`""), "`"$new`""
            $edgeReplacements += $count
        }
    }

    if ($edgeReplacements -gt 0) {
        if (-not $DryRun) {
            Set-Content -Path $EdgesFile -Value $content -NoNewline
        }
        Write-Host "  Edges updated: $edgeReplacements refs" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  COMPLETE: $totalReplacements taxonomy refs + summaries/conflicts/edges" -ForegroundColor Green
if ($DryRun) {
    Write-Host "  [DRY RUN] Re-run without -DryRun to apply changes." -ForegroundColor Yellow
}
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
