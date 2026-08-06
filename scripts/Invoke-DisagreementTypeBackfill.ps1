# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Classifies disagreement_type on unpopulated situation nodes (t/2191).
.DESCRIPTION
    Runs the CL-authored rubric (research/comp-linguist/docs/disagreement-type-
    classification-rubric.md §4.1) over situation nodes in situations.json that
    lack a disagreement_type value. Uses gemini-3.5-flash-lite via AIEnrich.

    Runs a 10-node seed check first — must reproduce the 9 non-abstain labels
    from rubric §3 before the full pass is trusted and written.
.PARAMETER SituationsPath
    Override the situations.json path (default: resolved from .aitriad.json).
.PARAMETER DryRun
    Run the full pass but do not write changes — useful for testing.
.PARAMETER SeedOnly
    Stop after the seed check (do not run the full pass).
.PARAMETER Model
    AI model to use. Default: gemini-3.5-flash-lite.
#>
[CmdletBinding()]
param(
    [string]$SituationsPath = '',
    [switch]$DryRun,
    [switch]$SeedOnly,
    [string]$Model = 'gemini-3.5-flash-lite'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Import-Module (Join-Path $PSScriptRoot 'AIEnrich.psm1') -Force -WarningAction SilentlyContinue

# ── Resolve situations.json path ─────────────────────────────────────────────
if (-not $SituationsPath) {
    $aitriadCfg = Get-Content (Join-Path $RepoRoot '.aitriad.json') -Raw | ConvertFrom-Json
    $dataRoot   = (Resolve-Path (Join-Path $RepoRoot $aitriadCfg.data_root)).Path
    $SituationsPath = Join-Path $dataRoot $aitriadCfg.taxonomy_dir 'situations.json'
}
if (-not (Test-Path $SituationsPath)) {
    throw "situations.json not found at: $SituationsPath"
}

# ── Classification prompt (rubric §4.1 + v7 concise principled approach) ─────
$ClassifyPrompt = @'
You are classifying the **type of cross-POV disagreement** a policy "situation" turns on. You are given a situation's description and how up to three points of view (accelerationist, safetyist, skeptic) interpret it.

**Apply in order:**

**1. DEFINITIONAL** — the dispute is about what the central *object* ontologically IS. The test: would agreeing on a shared definition dissolve the disagreement? The debate must be about the NATURE OF THE THING ITSELF (e.g., "is AI a self-producing organism or an externally designed artifact?"), not about which policy frame to apply to it. (Rare.)

**2. STRUCTURAL** — the primary debate is about which *problem category* this situation belongs to: specifically, whether this is a routine/ordinary instance addressable by familiar tools, versus a categorically different problem where ordinary approaches fundamentally fail. BOTH of the following must be true: (a) the frame-category question IS the central debate, and (b) at least two POVs are directly in frame conflict on this question. A single POV reframing while the other two debate implications does NOT make structural.

**3. INTERPRETIVE (default)** — everything else. Use interpretive when the POVs share a working concept/frame and split on implications, urgency, or action — including when: (a) two POVs debate implications while a third shifts focus elsewhere; (b) the three POVs hold positive, protective, and lower-priority stances toward the same concept; (c) the debate is about what to do, not whether the frame applies. When in doubt, choose **interpretive**.

**Insufficient:** interpretations absent or too thin → `"insufficient"` with low confidence.

Return JSON: { "disagreement_type": "definitional|interpretive|structural|insufficient", "confidence": 0.0-1.0, "rationale": "<= 25 words" }
'@

# Seed set from rubric §3 — expected labels for the agreement check
$SeedExpected = [ordered]@{
    'sit-447' = 'definitional'
    'sit-001' = 'interpretive'
    'sit-100' = 'interpretive'
    'sit-250' = 'interpretive'
    'sit-350' = 'interpretive'
    'sit-430' = 'interpretive'
    'sit-470' = 'interpretive'
    'sit-300' = 'structural'
    'sit-400' = 'structural'
    'sit-050' = 'insufficient'  # abstain case — all null interpretations
}

# ── Helper: build the per-node prompt input ──────────────────────────────────
function Build-NodeInput([PSObject]$Node) {
    $desc = if ($Node.PSObject.Properties['description']) { [string]$Node.description } else { '' }
    $parts = [System.Collections.Generic.List[string]]::new()
    $parts.Add("SITUATION: $($Node.id)")
    $parts.Add("DESCRIPTION: $desc")
    $parts.Add('')

    foreach ($pov in @('accelerationist', 'safetyist', 'skeptic')) {
        $interp = if ($Node.PSObject.Properties['interpretations'] -and $Node.interpretations) {
            $Node.interpretations
        } else { $null }

        $povData = if ($interp -and $interp.PSObject.Properties[$pov]) { $interp.$pov } else { $null }
        if ($null -eq $povData) {
            $parts.Add("${pov}: [no interpretation]")
            continue
        }

        # Summaries stored as the string "null" when unpopulated
        $summary = if ($povData.PSObject.Properties['summary']) { [string]$povData.summary } else { '' }
        if ($summary -eq 'null' -or [string]::IsNullOrWhiteSpace($summary)) {
            # Fall back to belief if available
            $belief = if ($povData.PSObject.Properties['belief']) { [string]$povData.belief } else { '' }
            if ($belief -eq 'null' -or [string]::IsNullOrWhiteSpace($belief)) {
                $parts.Add("${pov}: [no interpretation]")
            } else {
                $parts.Add("${pov} (belief): $belief")
            }
        } else {
            $parts.Add("${pov}: $summary")
        }
    }

    return $parts -join "`n"
}

# ── Helper: detect low-signal node (all POV content null) ────────────────────
function Test-LowSignal([PSObject]$Node) {
    $interp = if ($Node.PSObject.Properties['interpretations'] -and $Node.interpretations) {
        $Node.interpretations
    } else { return $true }

    $nonNull = 0
    foreach ($pov in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $interp.PSObject.Properties[$pov]) { continue }
        $povData = $interp.$pov
        if ($null -eq $povData) { continue }
        foreach ($field in @('summary', 'belief', 'desire', 'intention')) {
            if ($povData.PSObject.Properties[$field]) {
                $v = [string]$povData.$field
                if ($v -ne 'null' -and -not [string]::IsNullOrWhiteSpace($v)) {
                    $nonNull++
                    break
                }
            }
        }
    }
    return $nonNull -le 1
}

# ── Helper: classify one node ─────────────────────────────────────────────────
function Invoke-ClassifyNode([PSObject]$Node) {
    $input   = Build-NodeInput $Node
    $fullPrompt = "$ClassifyPrompt`n`nHere is the situation to classify:`n`n$input"

    $response = Invoke-AIApi -Prompt $fullPrompt -Model $Model -JsonMode -Temperature 0.1 -MaxTokens 256
    if ($null -eq $response) { return $null }

    try {
        $text = if ($response.PSObject.Properties['Text']) { [string]$response.Text } else { [string]$response }
        # Strip markdown code fences if present
        $cleaned = $text -replace '(?s)```json\s*', '' -replace '(?s)```\s*$', ''
        $result = $cleaned | ConvertFrom-Json
        return $result
    } catch {
        Write-Warning "[$($Node.id)] Failed to parse AI response: $($response.Text)"
        return $null
    }
}

# ── Load situations.json ──────────────────────────────────────────────────────
Write-Host 'Loading situations.json...' -ForegroundColor Cyan
$Raw   = Get-Content -Raw -Path $SituationsPath | ConvertFrom-Json
$Nodes = @($Raw.nodes)
Write-Host "  Loaded $($Nodes.Count) nodes." -ForegroundColor Cyan

# ── Phase 1: Seed check ───────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== Seed check (10 nodes, rubric §3) ===' -ForegroundColor Yellow
$seedIds   = @($SeedExpected.Keys)
$seedNodes = @($Nodes | Where-Object { $_.id -in $seedIds })

if ($seedNodes.Count -ne $seedIds.Count) {
    $missing = @($seedIds | Where-Object { $_ -notin @($seedNodes.id) })
    throw "Seed nodes missing from situations.json: $($missing -join ', ')"
}

$seedResults   = [ordered]@{}
$seedAgreement = 0
$seedTotal     = 0

foreach ($node in @($seedIds | ForEach-Object { $id = $_; @($seedNodes | Where-Object { $_.id -eq $id })[0] })) {
    $nodeId   = $node.id
    $expected = $SeedExpected[$nodeId]
    Write-Host "  Classifying $nodeId (expected: $expected)..." -NoNewline

    if (Test-LowSignal $node) {
        $predicted = 'insufficient'
        Write-Host " LOW-SIGNAL → insufficient" -ForegroundColor DarkYellow
    } else {
        $result = Invoke-ClassifyNode $node
        if ($null -eq $result) {
            $predicted = 'error'
            Write-Host " ERROR" -ForegroundColor Red
        } else {
            $predicted = [string]$result.disagreement_type
            $conf      = if ($result.PSObject.Properties['confidence']) { [double]$result.confidence } else { 0.0 }
            $rationale = if ($result.PSObject.Properties['rationale']) { [string]$result.rationale } else { '' }
            Write-Host " → $predicted (conf=$([Math]::Round($conf,2))) — $rationale" -ForegroundColor Cyan
        }
    }

    $seedResults[$nodeId] = $predicted
    $seedTotal++
    if ($predicted -eq $expected) { $seedAgreement++ }
    elseif ($expected -eq 'insufficient' -and $predicted -eq 'insufficient') { }
    else {
        Write-Host "    !! MISMATCH: expected '$expected', got '$predicted'" -ForegroundColor Red
    }
}

Write-Host ''
Write-Host "Seed agreement: $seedAgreement/$seedTotal" -ForegroundColor $(if ($seedAgreement -ge 9) { 'Green' } else { 'Red' })

# The §3 rubric requires reproducing the 9 non-abstain labels.
# sit-050 is expected 'insufficient' — pass if all 10 match OR if only interpretive/structural
# boundary cases miss (rubric notes this is the expected error mode).
$nonAbstainAgreement = @($seedIds | Where-Object {
    $SeedExpected[$_] -ne 'insufficient' -and $seedResults[$_] -eq $SeedExpected[$_]
}).Count

Write-Host "Non-abstain agreement: $nonAbstainAgreement/9" -ForegroundColor $(if ($nonAbstainAgreement -ge 9) { 'Green' } else { 'Yellow' })

if ($nonAbstainAgreement -lt 9) {
    Write-Host ''
    Write-Host 'Seed check FAILED — classifier does not reproduce rubric §3 labels.' -ForegroundColor Red
    Write-Host 'Mismatches:' -ForegroundColor Red
    foreach ($id in $seedIds) {
        if ($SeedExpected[$id] -ne 'insufficient' -and $seedResults[$id] -ne $SeedExpected[$id]) {
            Write-Host "  $id : expected $($SeedExpected[$id]), got $($seedResults[$id])" -ForegroundColor Red
        }
    }
    exit 1
}

Write-Host 'Seed check PASSED.' -ForegroundColor Green

if ($SeedOnly) {
    Write-Host 'SeedOnly mode — stopping before full pass.' -ForegroundColor Yellow
    exit 0
}

# ── Phase 2: Full population pass ─────────────────────────────────────────────
Write-Host ''
Write-Host '=== Full population pass ===' -ForegroundColor Yellow

$toClassify = @($Nodes | Where-Object {
    -not ($_.PSObject.Properties['disagreement_type'] -and
          -not [string]::IsNullOrWhiteSpace([string]$_.disagreement_type))
})
Write-Host "  Nodes to classify: $($toClassify.Count)" -ForegroundColor Cyan

$counts = @{ definitional = 0; interpretive = 0; structural = 0; insufficient = 0; error = 0 }
$written = 0
$skipped = 0
$errors  = 0

for ($i = 0; $i -lt $toClassify.Count; $i++) {
    $node   = $toClassify[$i]
    $nodeId = $node.id
    $pct    = [Math]::Round(($i + 1) / $toClassify.Count * 100, 1)
    Write-Progress -Activity 'Classifying situation nodes' -Status "$nodeId ($($i+1)/$($toClassify.Count))" -PercentComplete $pct

    if (Test-LowSignal $node) {
        Write-Verbose "[$nodeId] LOW-SIGNAL → skip (no write)"
        $counts['insufficient']++
        $skipped++
        continue
    }

    $result = Invoke-ClassifyNode $node
    if ($null -eq $result) {
        Write-Warning "[$nodeId] Classifier returned null — skipping"
        $counts['error']++
        $errors++
        continue
    }

    $label = [string]$result.disagreement_type
    if ($label -notin @('definitional', 'interpretive', 'structural', 'insufficient')) {
        Write-Warning "[$nodeId] Unexpected label '$label' — skipping"
        $counts['error']++
        $errors++
        continue
    }

    if ($label -eq 'insufficient') {
        # Rule §4.2: do not write the field for low-signal nodes
        Write-Verbose "[$nodeId] Classifier returned insufficient — leaving field absent"
        $counts['insufficient']++
        $skipped++
        continue
    }

    $counts[$label]++

    # Mutate the live node object (same reference as in $Raw.nodes)
    $liveNode = @($Raw.nodes | Where-Object { $_.id -eq $nodeId })[0]
    if ($liveNode.PSObject.Properties['disagreement_type']) {
        $liveNode.disagreement_type = $label
    } else {
        $liveNode | Add-Member -NotePropertyName 'disagreement_type' -NotePropertyValue $label -Force
    }
    $written++
}

Write-Progress -Activity 'Classifying situation nodes' -Completed

# ── Write results ──────────────────────────────────────────────────────────────
Write-Host ''
Write-Host "=== Results ===" -ForegroundColor Yellow
Write-Host "  Written: $written  |  Abstained: $skipped  |  Errors: $errors"
Write-Host "  Distribution:"
foreach ($k in $counts.Keys) {
    Write-Host "    $k : $($counts[$k])"
}

if ($DryRun) {
    Write-Host ''
    Write-Host 'DRY RUN — no changes written to disk.' -ForegroundColor Yellow
    exit 0
}

# Serialize and write using the situations.json writer contract:
# ConvertTo-Json -Depth 20, UTF-8 without BOM.
Write-Host ''
Write-Host 'Writing situations.json...' -ForegroundColor Cyan
$json = $Raw | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($SituationsPath, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host 'Done.' -ForegroundColor Green

# ── Summary for t/2170 comment ────────────────────────────────────────────────
Write-Host ''
Write-Host '=== Copy the following to t/2170 ===' -ForegroundColor Cyan
Write-Host "Seed agreement: $seedAgreement/10 (non-abstain: $nonAbstainAgreement/9)"
Write-Host "Label distribution — definitional: $($counts['definitional']), interpretive: $($counts['interpretive']), structural: $($counts['structural']), abstained (low-signal): $skipped, errors: $errors"
Write-Host "Total written: $written / $($toClassify.Count) attempted"
