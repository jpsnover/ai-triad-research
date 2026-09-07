# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate offline eval harness (t/3354, steps 1-2) — FOUNDATION increment.
.DESCRIPTION
    Measurement-first, offline: does attaching logical_form to debate claims add signal
    beyond the CL convergence metrics? Design (co-signed, TL-gated):
    research/comp-linguist/analyses/fol-debate-eval/fol-eval-design.md (#2042);
    ground truth: fol-debate-sample-findings.md (#2026).

    Pipeline (design §2): turn -> SEGMENT (§4) -> CLASSIFY each clause (§3) ->
    COREF/attribution on the assertoric subset (§6, hard prerequisite) -> FOL extraction
    (§7, reuses Private/LogicalFormPass.ps1) -> CONTRADICTION + paraphrase FN-rate (§8).

    THIS COMMIT is the foundation only: the read-only input loaders, the read-only OUTPUT
    guardrail, the run-bounding cap + up-front manifest, and the stage-dispatch skeleton.
    The segmenter and clause classifier (§3/§4, CL-authoritative) are NOT implemented here —
    they land after the CL pairing pass that enumerates the blind gold set
    (fol-eval-classifier-gold.jsonl). Those stages throw until then, so -DryRun (plan +
    manifest, no model calls) is the runnable path in this increment.

    READ-ONLY (design §1, TL tightening e/141#8): the harness writes NOTHING under the data
    root — not outputs, not caches, not temp/intermediates. -OutputDir is asserted to be
    OUTSIDE the data root (fail-closed). No in-loop / live path is touched.

    RUN-BOUNDING (design §10): an explicit sampling plan + hard cap (-MaxDebates,
    -MaxClausesPerDebate) with the model-call cost ceiling reported up front. Over-cap
    debates are SAMPLED and LOGGED, never silently truncated.

    NOTE: the data-root helpers (Get-DataRoot / Get-DebatesDir / Test-IsUnderDataRoot) and
    New-ActionableError are Private to the AITriad module (not exported), so this standalone
    runner reaches them through the module session state via `& (Get-Module AITriad) { }`
    (thin wrappers below) rather than calling them directly, which would fail.
.PARAMETER OutputDir
    PS-scoped output directory. MUST be outside the data root (asserted). Required.
.PARAMETER DebatesDir
    Completed-debate corpus. Default: Get-DebatesDir (data root, read-only).
.PARAMETER MaxDebates
    Hard cap on debates per run (run-bound §10). Over-cap => deterministic sample + log.
.PARAMETER MaxClausesPerDebate
    Hard cap on clauses formalized per debate (run-bound §10).
.PARAMETER Model
    AI model for the (not-yet-implemented) classifier/FOL stages. Default gemini-3.5-flash-lite.
.PARAMETER DryRun
    Plan only: load + sample debates, emit the manifest (sampling plan + cost ceiling), make
    NO model calls and hit NO unimplemented stage. The runnable path this increment.
.EXAMPLE
    pwsh -File scripts/run-fol-debate-eval.ps1 -OutputDir ./.fol-eval-out -MaxDebates 20 -DryRun
.LINK
    run-xconflict-classifier.ps1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputDir,

    [Parameter()]
    [string]$DebatesDir,

    [Parameter()]
    [ValidateRange(1, 1000)]
    [int]$MaxDebates = 20,

    [Parameter()]
    [ValidateRange(1, 5000)]
    [int]$MaxClausesPerDebate = 40,

    [Parameter()]
    [string]$Model = 'gemini-3.5-flash-lite',

    [Parameter()]
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1') -Force -ErrorAction Stop
$Mod = Get-Module AITriad
if (-not $Mod) { throw 'AITriad module failed to load; cannot resolve data-root helpers.' }

# Clause segmenter (design §4) — a pure, dot-sourceable library (no top-level side effects).
. (Join-Path $PSScriptRoot 'fol-eval-segment.ps1')

# ── Module-session-state wrappers for Private helpers (see .DESCRIPTION note) ──────
function Resolve-DebatesDir { & $Mod { Get-DebatesDir } }
function Test-OutputUnderDataRoot { param([string]$Path) & $Mod { param($p) Test-IsUnderDataRoot -Path $p } $Path }
function New-EvalError {
    param([string]$Goal, [string]$Problem, [string]$NextSteps)
    & $Mod { param($g, $p, $n) New-ActionableError -PassThru -Goal $g -Problem $p -Location 'run-fol-debate-eval.ps1' -NextSteps $n } $Goal $Problem $NextSteps
}

# ── READ-ONLY OUTPUT GUARDRAIL (design §1, TL tightening) ──────────────────────────
# Nothing the harness emits — outputs, caches, temp — may land under the data root.
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$resolvedOut = (Resolve-Path -LiteralPath $OutputDir).Path
if (Test-OutputUnderDataRoot $resolvedOut) {
    throw (New-EvalError `
        'Run the FOL-on-debate offline eval' `
        "OutputDir resolves under the data root ($resolvedOut) — the harness is read-only over the data repo and must never write there (design §1)." `
        'Pass -OutputDir to a path OUTSIDE ../ai-triad-data (e.g. a repo-local ./.fol-eval-out or a scratch dir).')
}

# ── READ-ONLY INPUT LOAD (design §1/§2) ────────────────────────────────────────────
if (-not $DebatesDir) { $DebatesDir = Resolve-DebatesDir }
if (-not (Test-Path -LiteralPath $DebatesDir)) {
    throw (New-EvalError `
        'Run the FOL-on-debate offline eval' `
        "debates dir not found: $DebatesDir" `
        'Verify the data root (Get-DebatesDir / .aitriad.json) or pass -DebatesDir.')
}

# Completed debates only (phase=closed); substantive turns are transcript[] type=statement.
$allFiles = @(Get-ChildItem -LiteralPath $DebatesDir -Filter '*.json' -File)
$closed = [System.Collections.Generic.List[object]]::new()
foreach ($f in $allFiles) {
    $d = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json
    if (-not ($d.PSObject.Properties['phase'] -and $d.phase -eq 'closed')) { continue }

    # Stable debate id for clause ids: the debate's own id if present, else the file stem.
    $debateId = if ($d.PSObject.Properties['id'] -and $d.id) { [string]$d.id } else { [System.IO.Path]::GetFileNameWithoutExtension($f.Name) }

    # Retain statement turns with their ACTUAL transcript index (span reproducibility, §11).
    $statements = [System.Collections.Generic.List[object]]::new()
    if ($d.PSObject.Properties['transcript'] -and $null -ne $d.transcript) {
        $turnIndex = -1
        foreach ($turn in @($d.transcript)) {
            $turnIndex++
            if ($turn.PSObject.Properties['type'] -and $turn.type -eq 'statement' -and
                $turn.PSObject.Properties['content'] -and $turn.content) {
                $statements.Add([PSCustomObject]@{ turn_index = $turnIndex; content = [string]$turn.content })
            }
        }
    }
    if ($statements.Count -eq 0) { continue }
    $closed.Add([PSCustomObject]@{ File = $f.Name; DebateId = $debateId; StatementCount = $statements.Count; Statements = $statements })
}

# ── RUN-BOUNDING (design §10): deterministic sample + LOG, never silent truncation ──
$totalClosed = $closed.Count
$selected = @($closed)
$dropped = 0
if ($totalClosed -gt $MaxDebates) {
    # Deterministic (sorted by filename) head sample — reproducible; over-cap surfaced.
    $selected = @($closed | Sort-Object File | Select-Object -First $MaxDebates)
    $dropped = $totalClosed - $MaxDebates
}

$estStatements = (@($selected | Measure-Object -Property StatementCount -Sum).Sum)
# Cost ceiling is an UPPER bound: each retained clause (<= MaxClausesPerDebate/debate) costs
# one classifier call + (assertoric only) one FOL call; reported up front, not after.
$clauseCeiling = [Math]::Min($estStatements * 4, $selected.Count * $MaxClausesPerDebate)  # ~<=4 clauses/statement heuristic, capped
$manifest = [ordered]@{
    ticket                 = 't/3354'
    design                 = 'research/comp-linguist/analyses/fol-debate-eval/fol-eval-design.md (#2042)'
    generated_offline      = $true
    read_only_data_repo    = $true
    output_dir             = $resolvedOut
    debates_dir            = $DebatesDir
    model                  = $Model
    total_closed_debates   = $totalClosed
    selected_debates       = $selected.Count
    dropped_over_cap       = $dropped
    max_debates            = $MaxDebates
    max_clauses_per_debate = $MaxClausesPerDebate
    est_statement_turns    = $estStatements
    clause_cost_ceiling    = $clauseCeiling
    est_model_calls_upper  = $clauseCeiling * 2   # classifier + FOL, upper bound
    dry_run                = [bool]$DryRun
    stages_implemented     = @('load', 'run-bound', 'manifest', 'segment')
    stages_pending_pairing = @('classify', 'coref', 'fol', 'contradiction', 'fn-rate', 'correlate')
}

Write-Host ''
Write-Host '=== FOL-on-debate eval — run manifest (design §10) ===' -ForegroundColor Cyan
Write-Host "  Closed debates:   $totalClosed  (selected $($selected.Count), dropped-over-cap $dropped)" -ForegroundColor White
Write-Host "  Statement turns:  $estStatements   Clause cost-ceiling: $clauseCeiling" -ForegroundColor White
Write-Host "  Model-call upper bound: $($manifest.est_model_calls_upper)   Model: $Model" -ForegroundColor White
Write-Host "  Output (outside data root): $resolvedOut" -ForegroundColor White
if ($dropped -gt 0) {
    Write-Host "  NOTE: $dropped closed debate(s) over the -MaxDebates cap were sampled out (deterministic head sample), NOT silently dropped." -ForegroundColor DarkYellow
}
$manifestPath = Join-Path $resolvedOut 'run-manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Host "  Manifest -> $manifestPath" -ForegroundColor Green

if ($DryRun) {
    Write-Host ''
    Write-Host 'DryRun: plan + manifest only — no model calls, no stage execution. Foundation increment.' -ForegroundColor Green
    Write-Host ''
    return [PSCustomObject]$manifest
}

# ── SEGMENT stage (design §4) — rule-based, pure (fol-eval-segment.ps1); Increment 2a ──────
# Segment every selected debate's statement turns into finite clauses and emit them as JSONL with
# stable ids + char spans (double-annotation-ready, §11). This is deterministic and makes NO model
# calls — it is the honest, runnable extension of the foundation. The classifier (§3) that TYPES
# each clause is the next increment (2b) and is what turns these clauses into the assertoric subset.
$clausesPath = Join-Path $resolvedOut 'clauses.jsonl'
$clauseLines = [System.Collections.Generic.List[string]]::new()
$ruleCounts = @{}
foreach ($deb in $selected) {
    foreach ($st in $deb.Statements) {
        $cls = @(Split-DebateTurnClauses -Text $st.content -DebateId $deb.DebateId -TurnIndex $st.turn_index)
        foreach ($cl in $cls) {
            $clauseLines.Add(($cl | ConvertTo-Json -Depth 4 -Compress))
            $rule = [string]$cl.segmentation_rule
            if ($ruleCounts.ContainsKey($rule)) { $ruleCounts[$rule]++ } else { $ruleCounts[$rule] = 1 }
        }
    }
}
Set-Content -LiteralPath $clausesPath -Value $clauseLines -Encoding utf8

Write-Host ''
Write-Host '=== SEGMENT stage (design §4) — rule-based clause segmentation ===' -ForegroundColor Cyan
Write-Host "  Clauses: $($clauseLines.Count) across $($selected.Count) debate(s) -> $clausesPath" -ForegroundColor White
foreach ($rk in @($ruleCounts.Keys | Sort-Object)) {
    Write-Host ("    {0,-26} {1}" -f $rk, $ruleCounts[$rk]) -ForegroundColor DarkGray
}

# ── CLASSIFY + downstream stages (design §3/§6/§7/§8) — Increment 2b, NOT implemented here ──
# The clause classifier (§3 5-type taxonomy + attributes) is a new AI instrument validated against
# the blind gold set (§5). Throwing (rather than a fake no-op) keeps the harness honest: a non-DryRun
# run fails loudly with the exact next step instead of emitting empty results that look complete.
throw (New-EvalError `
    'Run the full FOL-on-debate eval pipeline' `
    "The SEGMENT stage ran (clauses.jsonl emitted, $($clauseLines.Count) clauses) but the classify/coref/FOL/contradiction stages are not yet implemented — the clause classifier (design §3) is Increment 2b." `
    'Inspect clauses.jsonl now (or use -DryRun for the plan+manifest). The classifier stage follows with the Computational Linguist blind gold set (design §5); until then load/run-bound/manifest/segment are implemented.')
