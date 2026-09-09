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
    CLASSIFY (§3, AI clause classifier, fol-eval-classify.ps1), COREF (§6, the hard prerequisite,
    fol-eval-coref.ps1 — resolves cross-turn deps on the assertoric subset + reports coverage loss),
    FOL (§7, fol-eval-fol.ps1 — neo-Davidsonian formalization of the resolved usable subset, REUSING the
    LogicalFormPass core via module session state, no fork, so it is shape-identical to the summary FOL corpus),
    CONTRADICTION + FN-rate (§8, fol-eval-contradict.ps1 — structural intra-debate cross-agent contradiction
    detection + the make-or-break paraphrase false-negative rate, scored WITH vs WITHOUT normalization).
    Classifier + coref are INSTRUMENT-PROVISIONAL (§5/t/3342); the §8 numbers are measurement reports, not
    gates — no number anchors a conclusion until CL double-annotates (§11/§12).
    The summary-corpus direction (§8 i) + §9 correlation outputs are NOT implemented yet and throw (honest failure).
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
    [ValidateRange(1, 50)]
    [int]$CorefBatchSize = 10,

    [Parameter()]
    [ValidateRange(1, 100)]
    [int]$MaxContextTurns = 12,

    [Parameter()]
    [string]$FnFixturePath,

    [Parameter()]
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1') -Force -ErrorAction Stop
$Mod = Get-Module AITriad
if (-not $Mod) { throw 'AITriad module failed to load; cannot resolve data-root helpers.' }

# Clause segmenter (§4) + classifier (§3) + coref (§6) + FOL (§7) — pure, dot-sourceable libraries.
. (Join-Path $PSScriptRoot 'fol-eval-segment.ps1')
. (Join-Path $PSScriptRoot 'fol-eval-classify.ps1')
. (Join-Path $PSScriptRoot 'fol-eval-coref.ps1')
. (Join-Path $PSScriptRoot 'fol-eval-fol.ps1')
. (Join-Path $PSScriptRoot 'fol-eval-contradict.ps1')

# Get-Prompt is a module-PRIVATE helper (Import-Module does not expose it), so the classifier/coref
# Get-Prompt calls would fail with 'not recognized'. Dot-source it + set $script:ModuleRoot so its
# default Prompts/ dir resolves the fol-clause-*.prompt files (same handling as the CC classifier, t/3302).
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
                $speaker = if ($turn.PSObject.Properties['speaker'] -and $turn.speaker) { [string]$turn.speaker } else { '' }
                $statements.Add([PSCustomObject]@{ turn_index = $turnIndex; content = [string]$turn.content; speaker = $speaker })
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
    coref_batch_size       = $CorefBatchSize
    max_context_turns      = $MaxContextTurns
    fn_fixture             = $FnFixturePath
    stages_implemented     = @('load', 'run-bound', 'manifest', 'segment', 'classify', 'coref', 'fol', 'contradiction', 'fn-rate')
    stages_pending_pairing = @('summary-corpus-direction', 'correlate')
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

# ── COREF stage (design §6, the HARD PREREQUISITE) — Increment 3 ────────────────────────────
# Resolve cross-turn deps in the assertoric subset so each clause is self-contained before FOL.
# Self-contained clauses pass through with NO model call; demonstrative/topic-ellipsis/attributed-
# restatement clauses go to the AI resolver, grouped per debate (each debate's prior turns are the
# shared context). Coverage loss is reported keyed on anaphora_dependency (§6) — a measurement, not a gate.
Write-Host ''
Write-Host "=== COREF stage (design §6) — cross-turn resolution on the assertoric subset (PAID; batch=$CorefBatchSize) ===" -ForegroundColor Cyan
$assertoric = @($classified | Where-Object { $_.is_assertoric })

# Per-debate statement lookup (context source) from the already-loaded selection.
$stmtByDebate = @{}
foreach ($deb in $selected) { $stmtByDebate[$deb.DebateId] = @($deb.Statements) }

$corefMap = @{}
$needResolve = @($assertoric | Where-Object { $_.anaphora_dependency -ne 'self-contained' })
foreach ($g in @($needResolve | Group-Object debate_id)) {
    $ctx = if ($stmtByDebate.ContainsKey($g.Name)) { $stmtByDebate[$g.Name] } else { @() }
    $m = Invoke-FolCorefResolveDebate -ContextStatements @($ctx) -Clauses @($g.Group) `
        -BatchSize $CorefBatchSize -MaxContextTurns $MaxContextTurns -Temperature 0
    foreach ($k in $m.Keys) { $corefMap[$k] = $m[$k] }
}

$resolved = @(ConvertTo-CorefResolved -Clauses $assertoric -Results $corefMap)
$resolvedPath = Join-Path $resolvedOut 'resolved-clauses.jsonl'
Set-Content -LiteralPath $resolvedPath -Value @($resolved | ForEach-Object { $_ | ConvertTo-Json -Depth 4 -Compress }) -Encoding utf8

$cov = Measure-CorefCoverage -Resolved $resolved
Write-Host "  Assertoric subset: $($cov.total) clauses -> $resolvedPath  (self-contained passthrough + AI-resolved)" -ForegroundColor White
Write-Host "  Coverage: usable (self_contained+resolved) $($cov.usable_count)/$($cov.total) = $($cov.usable_fraction); coverage-loss (partial+unresolved) $($cov.coverage_loss_count) = $($cov.coverage_loss_fraction)" -ForegroundColor White
Write-Host '  By anaphora_dependency (§6 — attributed-restatement is the highest-value/highest-risk cell):' -ForegroundColor White
foreach ($d in $cov.by_anaphora_dependency) {
    Write-Host ("    {0,-24} usable {1,4}/{2,-4} = {3}" -f $d.anaphora_dependency, $d.usable, $d.total, $d.usable_fraction) -ForegroundColor DarkGray
}
if ($cov.total -gt 0 -and $cov.usable_count -eq 0) {
    Write-Warning 'COREF: no assertoric clause is usable — either the classifier returned nothing (missing key) or every resolution failed. resolved-clauses.jsonl was still emitted so the run is inspectable; no resolution is trustworthy.'
}

# ── FOL stage (design §7) — Increment 4. Reuses the LogicalFormPass core (no fork) ──────────
# Formalize the coref-USABLE assertoric clauses into neo-Davidsonian logical forms via the SAME
# prompt/usage/grounding/validation the summary FOL corpus uses (fol-eval-fol.ps1 -> module session
# state for the private grounders), so the §8 cross-corpus contradiction check is apples-to-apples.
# partial/unresolved clauses are excluded (fol_status 'skipped-unresolved'); no clause is dropped.
Write-Host ''
Write-Host '=== FOL stage (design §7) — neo-Davidsonian formalization of the resolved assertoric subset (PAID) ===' -ForegroundColor Cyan
$usableAssertoric = @($resolved | Where-Object { $_.coref_usable })
$folMap = Invoke-FolClauseExtraction -Module $Mod -Clauses $usableAssertoric -Temperature 0.1
$formalized = @(ConvertTo-FolClauseFormalized -Clauses $resolved -Results $folMap)

$formalizedPath = Join-Path $resolvedOut 'formalized-clauses.jsonl'
Set-Content -LiteralPath $formalizedPath -Value @($formalized | ForEach-Object { $_ | ConvertTo-Json -Depth 12 -Compress }) -Encoding utf8

$folStats = Measure-FolExtraction -Formalized $formalized
Write-Host "  Assertoric clauses: $($folStats.total) -> $formalizedPath  (attempted $($folStats.attempted) usable; skipped-unresolved $($folStats.total - $folStats.attempted))" -ForegroundColor White
Write-Host "  Formalized: $($folStats.formalized_count)/$($folStats.attempted) = $($folStats.formalized_fraction)" -ForegroundColor White
foreach ($k in @($folStats.status_counts.Keys | Sort-Object)) {
    Write-Host ("    {0,-20} {1}" -f $k, $folStats.status_counts[$k]) -ForegroundColor DarkGray
}
if ($folStats.attempted -gt 0 -and $folStats.formalized_count -eq 0) {
    Write-Warning 'FOL: no clause formalized — the backend returned nothing (missing key / model?). formalized-clauses.jsonl was still emitted so the run is inspectable; no logical_form is present.'
}

# ── CONTRADICTION + paraphrase FN-rate stage (design §8) — Increment 5, the MAKE-OR-BREAK metric ──
# (a) Intra-debate cross-AGENT contradiction/agreement over the formalized clauses (direction ii), run
#     BOTH raw (no normalization) and normalized so the normalization delta is visible on real data.
# (b) The paraphrase FALSE-NEGATIVE RATE against the canonical fixture (one predicate / five surface forms),
#     scored WITH and WITHOUT the predicate normalization pass so its value is isolated (the design's
#     make-or-break metric). All pure/structural — no model call. Direction (i) vs the summary corpus and
#     the §9 correlation outputs are the next increment.
Write-Host ''
Write-Host '=== CONTRADICTION + FN-rate stage (design §8) — structural, no model call ===' -ForegroundColor Cyan

# Speaker map (debate_id|turn_index -> speaker) for the cross-agent constraint.
$speakerMap = @{}
foreach ($deb in $selected) {
    foreach ($st in $deb.Statements) {
        $sp = if ($st.PSObject.Properties['speaker']) { [string]$st.speaker } else { '' }
        $speakerMap["$($deb.DebateId)|$($st.turn_index)"] = $sp
    }
}

# Load the FN fixture (read-only; code-repo file, not the data root) + derive the run-level normalization map.
if (-not $FnFixturePath) { $FnFixturePath = Join-Path $PSScriptRoot 'fol-eval-fn-fixture.json' }
$normMap = @{}
$fnFixture = $null
if (Test-Path -LiteralPath $FnFixturePath) {
    $fnFixture = Get-Content -Raw -LiteralPath $FnFixturePath | ConvertFrom-Json
    foreach ($case in @($fnFixture.cases)) {
        if ($case.PSObject.Properties['normalization_map'] -and $case.normalization_map) {
            foreach ($p in $case.normalization_map.PSObject.Properties) { $normMap[$p.Name.ToLowerInvariant()] = [string]$p.Value }
        }
    }
}
else {
    Write-Warning "CONTRADICTION: FN fixture not found ($FnFixturePath) — FN-rate report skipped; contradiction detection still runs with an empty normalization map."
}

# (a) Intra-debate cross-agent contradictions — raw vs normalized.
$contraRaw = @(Find-IntraDebateContradictions -Formalized $formalized -SpeakerMap $speakerMap -NormalizationMap @{})
$contraNorm = @(Find-IntraDebateContradictions -Formalized $formalized -SpeakerMap $speakerMap -NormalizationMap $normMap)
$contraPath = Join-Path $resolvedOut 'contradictions.jsonl'
Set-Content -LiteralPath $contraPath -Value @($contraNorm | ForEach-Object { $_ | ConvertTo-Json -Depth 4 -Compress }) -Encoding utf8
$rawContraN = @($contraRaw | Where-Object { $_.relation -eq 'contradict' }).Count
$normContraN = @($contraNorm | Where-Object { $_.relation -eq 'contradict' }).Count
$normAgreeN = @($contraNorm | Where-Object { $_.relation -eq 'agree' }).Count
Write-Host "  Intra-debate cross-agent pairs (formalized): contradict raw=$rawContraN normalized=$normContraN; agree normalized=$normAgreeN -> $contraPath" -ForegroundColor White

# (b) Paraphrase FN-rate — the make-or-break metric.
if ($null -ne $fnFixture) {
    $fn = Measure-ParaphraseFnRate -Fixture $fnFixture
    $fnPath = Join-Path $resolvedOut 'fn-rate-report.json'
    $fn | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $fnPath -Encoding utf8
    Write-Host "  Paraphrase FN-rate (fixture, $($fn.gold_pairs) gold pairs): WITHOUT normalization $($fn.raw_fn_rate)  ->  WITH normalization $($fn.normalized_fn_rate)  (gap $($fn.normalization_gap)) -> $fnPath" -ForegroundColor White
    Write-Host '  (INSTRUMENT-PROVISIONAL — illustrative single-annotator fixture; no number anchors a threshold until CL double-annotates, design §11/§12.)' -ForegroundColor DarkGray
}

# ── DIRECTION (i) vs summary corpus + CORRELATION outputs (design §8 i / §9) — next increment ──
throw (New-EvalError `
    'Run the full FOL-on-debate eval pipeline' `
    "SEGMENT + CLASSIFY + COREF + FOL + CONTRADICTION/FN-rate ran (contradictions.jsonl + fn-rate-report.json emitted; intra-debate contradict normalized=$normContraN) but the summary-corpus direction (i) and the §9 correlation outputs are not yet implemented." `
    'Inspect contradictions.jsonl + fn-rate-report.json now. Direction (i) — contradiction vs the formalized POV summary corpus — plus the §9 correlation join (CL convergence metrics; optional conflict corpus) is the final increment.')
