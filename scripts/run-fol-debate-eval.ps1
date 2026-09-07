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

    IMPLEMENTED stages: load, run-bound, manifest, SEGMENT (§4, rule-based, fol-eval-segment.ps1),
    CLASSIFY (§3, AI clause classifier, fol-eval-classify.ps1). The classifier is INSTRUMENT-PROVISIONAL
    (§5/t/3342): its per-class distribution is checked against the §3.3 bands as a SANITY gate only —
    labels anchor no conclusion until CL scores the blind gold set (fol-eval-classifier-gold.jsonl).
    The coref/FOL/contradiction/FN-rate stages are NOT implemented yet and throw (honest failure).
    Runnable paths without a model call: -DryRun (plan+manifest) and -SkipClassify (segment only).

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
    AI model note (the classifier's model is set by the usage 'enrichment.fol-clause-classify' in
    ai-usages.json). Recorded in the manifest. Default gemini-3.5-flash-lite.
.PARAMETER ClassifyBatchSize
    Clauses per classifier model call (batch-first, per-clause fallback for misses). Default 15.
.PARAMETER SkipClassify
    Run SEGMENT only (emit clauses.jsonl), make NO model calls. Inspect segmentation without a key.
.PARAMETER DryRun
    Plan only: load + sample debates, emit the manifest (sampling plan + cost ceiling), make
    NO model calls and hit NO stage. The cheapest runnable path.
.EXAMPLE
    pwsh -File scripts/run-fol-debate-eval.ps1 -OutputDir ./.fol-eval-out -MaxDebates 20 -DryRun
.EXAMPLE
    pwsh -File scripts/run-fol-debate-eval.ps1 -OutputDir ./.fol-eval-out -MaxDebates 5 -SkipClassify
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
    [ValidateRange(1, 50)]
    [int]$ClassifyBatchSize = 15,

    [Parameter()]
    [switch]$SkipClassify,

    [Parameter()]
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1') -Force -ErrorAction Stop
$Mod = Get-Module AITriad
if (-not $Mod) { throw 'AITriad module failed to load; cannot resolve data-root helpers.' }

# Clause segmenter (§4) + classifier (§3) — pure, dot-sourceable libraries (no top-level side effects).
. (Join-Path $PSScriptRoot 'fol-eval-segment.ps1')
. (Join-Path $PSScriptRoot 'fol-eval-classify.ps1')

# Get-Prompt is a module-PRIVATE helper (Import-Module does not expose it), so the classifier's
# Get-Prompt call would fail with 'not recognized'. Dot-source it + set $script:ModuleRoot so its
# default Prompts/ dir resolves fol-clause-classify.prompt (same handling as the CC classifier, t/3302).
$script:ModuleRoot = Join-Path $PSScriptRoot 'AITriad'
. (Join-Path $PSScriptRoot 'AITriad' 'Private' 'Get-Prompt.ps1')

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
    classify_batch_size    = $ClassifyBatchSize
    stages_implemented     = @('load', 'run-bound', 'manifest', 'segment', 'classify')
    stages_pending_pairing = @('coref', 'fol', 'contradiction', 'fn-rate', 'correlate')
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
$allClauses = [System.Collections.Generic.List[object]]::new()
$ruleCounts = @{}
foreach ($deb in $selected) {
    foreach ($st in $deb.Statements) {
        $cls = @(Split-DebateTurnClauses -Text $st.content -DebateId $deb.DebateId -TurnIndex $st.turn_index)
        foreach ($cl in $cls) {
            $allClauses.Add($cl)
            $rule = [string]$cl.segmentation_rule
            if ($ruleCounts.ContainsKey($rule)) { $ruleCounts[$rule]++ } else { $ruleCounts[$rule] = 1 }
        }
    }
}
Set-Content -LiteralPath $clausesPath -Value @($allClauses | ForEach-Object { $_ | ConvertTo-Json -Depth 4 -Compress }) -Encoding utf8

Write-Host ''
Write-Host '=== SEGMENT stage (design §4) — rule-based clause segmentation ===' -ForegroundColor Cyan
Write-Host "  Clauses: $($allClauses.Count) across $($selected.Count) debate(s) -> $clausesPath" -ForegroundColor White
foreach ($rk in @($ruleCounts.Keys | Sort-Object)) {
    Write-Host ("    {0,-26} {1}" -f $rk, $ruleCounts[$rk]) -ForegroundColor DarkGray
}

if ($SkipClassify) {
    Write-Host ''
    Write-Host 'SkipClassify: SEGMENT-only run — clauses.jsonl emitted, no model calls. (Inspect segmentation without a key.)' -ForegroundColor Green
    Write-Host ''
    return [PSCustomObject]@{ manifest = $manifest; clauses_path = $clausesPath; clause_count = $allClauses.Count }
}

# ── CLASSIFY stage (design §3) — AI clause classifier; Increment 2b ─────────────────────────
# Types each clause into the closed 5-type taxonomy + attributes (fol-eval-classify.ps1). PAID: model
# calls, bounded by the run cap. INSTRUMENT-PROVISIONAL (§5, t/3342): the per-class distribution below
# is a SANITY check vs the §3.3 bands, NOT a threshold — labels anchor no conclusion until CL scores the
# blind gold set. A clause is never dropped: an unresolved clause is 'unclassified' (excluded from FOL).
Write-Host ''
Write-Host "=== CLASSIFY stage (design §3) — AI clause classifier (PAID; batch=$ClassifyBatchSize) ===" -ForegroundColor Cyan
$classMap = Invoke-FolClauseClassifyBatched -Clauses @($allClauses) -BatchSize $ClassifyBatchSize -Temperature 0
$classified = @(ConvertFrom-FolClauseClassification -Clauses @($allClauses) -Results $classMap)

$classifiedPath = Join-Path $resolvedOut 'classified-clauses.jsonl'
Set-Content -LiteralPath $classifiedPath -Value @($classified | ForEach-Object { $_ | ConvertTo-Json -Depth 4 -Compress }) -Encoding utf8

$dist = Measure-FolClauseDistribution -Classified $classified
Write-Host "  Classified: $($dist.total) clauses -> $classifiedPath  (unclassified: $($dist.unclassified_count))" -ForegroundColor White
Write-Host '  Per-class distribution (vs §3.3 sanity bands — inspect if outside, NOT a gate):' -ForegroundColor White
foreach ($pt in $dist.per_type) {
    $flag = if ($pt.within_band) { 'ok ' } else { 'OUT' }
    $bandTxt = if ($null -ne $pt.band_lo) { "[$($pt.band_lo)-$($pt.band_hi)]" } else { '[--]' }
    $color = if ($pt.within_band) { 'DarkGray' } else { 'DarkYellow' }
    Write-Host ("    {0,-32} {1,4}  {2,6}  {3} {4}" -f $pt.primary_type, $pt.count, $pt.fraction, $flag, $bandTxt) -ForegroundColor $color
}
$asFlag = if ($dist.assertoric_within_band) { 'ok ' } else { 'OUT' }
Write-Host ("    {0,-32} {1,4}  {2,6}  {3} [0.55-0.65]" -f 'ASSERTORIC TOTAL (-> FOL)', $dist.assertoric_count, $dist.assertoric_fraction, $asFlag) -ForegroundColor Cyan
if ($dist.unclassified_count -eq $dist.total -and $dist.total -gt 0) {
    Write-Warning 'CLASSIFY: every clause is unclassified — the backend returned nothing (missing key / model?). classified-clauses.jsonl was still emitted so the run is inspectable; no labels are trustworthy.'
}

# ── COREF / FOL / CONTRADICTION / FN-rate (design §6/§7/§8) — later increments, NOT implemented ──
throw (New-EvalError `
    'Run the full FOL-on-debate eval pipeline' `
    "SEGMENT + CLASSIFY ran (clauses.jsonl + classified-clauses.jsonl emitted; $($dist.assertoric_count) assertoric of $($dist.total)) but the coref/FOL/contradiction/FN-rate stages are not yet implemented." `
    'Inspect classified-clauses.jsonl now (or use -DryRun / -SkipClassify). The coref stage (design §6, the hard prerequisite on the attributed-opponent x assertoric cell) is the next increment; FOL + contradiction + paraphrase FN-rate follow.')
