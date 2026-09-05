#Requires -Version 7
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# Cross-conflict candidate classifier (t/3339 classify-before-merge). Reads CL's candidate pairs
# (research/comp-linguist/analyses/xconflict-pairing/candidates.json — 1055 rows of {pair_id,
# stance_text (A), cand_text (B), stance_conflict_id, cand_conflict_id, cosine}), runs each A-vs-B pair
# through the SAME contradiction classifier as the same-doc/golden runs (invoke-contradiction-classifier.ps1,
# per-conflict batch + per-pair fallback), and writes predictions {pair_id, predicted, confidence, method}
# (carrying the conflict ids + cosine for CL's join). These predictions are INPUT to CL's blind
# precision golden + census — NOT a merge authorization (see GUARDRAIL below).
#
# GUARDRAIL (t/3342 / t/3339#10): the contradiction classifier does NOT generalize to cross-conflict
# pairs. On this 1055-pair set the automated precision gate FAILED — 0.571 precision / Wilson LB 0.391
# at conf>=0.85 (its within-conflict/same-doc calibration, recall 0.92 / precision 0.957, does not
# transfer; the conf>=0.90 subset was 12/14 but underpowered). So classifier-auto-merge is UNSAFE
# cross-conflict and stays OUT. Any cross-conflict merge must go through CENSUS + PI DUAL-VERIFICATION
# (only human-verified contradicts merge — a stronger no-false-attack guarantee than the classifier
# proxy), NEVER the automated contradict@>=0.90 / LB>=0.85 gate. Do NOT wire this output into an auto-merge.
#
# Pairs are chunked into synthetic "conflicts" of -BatchSize so each classifier batch stays within the
# usage maxTokens; grouping is arbitrary (each pair is judged independently). A pair is never dropped:
# a missing/unresolved verdict -> predicted 'unresolved'/'missing' (no merge).
#
# PAID: classifier calls the AI backend. Set GEMINI_API_KEY (invoked via `& pwsh`, full env inherited —
# NOT enrich's key-stripped _safe_env path, t/3336#1994). Bounded to the candidate count.
#
#   pwsh -File scripts/run-xconflict-classifier.ps1 -OutPath xconflict-predictions.json
#
# Pure transforms (ConvertTo-XcInput / Join-XcPredictions) are dot-source unit-tested with
# $env:XC_RUNNER_NOEXEC set (no AI, no subprocess).
[CmdletBinding()]
param(
    [string]$CandidatesPath = '',
    [string]$OutPath = '',
    [ValidateRange(1, 100)][int]$BatchSize = 15,
    [ValidateSet('per-conflict', 'per-pair')][string]$Mode = 'per-conflict'
)

Set-StrictMode -Version Latest

function Get-XcField {
    param([object]$Obj, [string]$Name, $Default = $null)
    if ($Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
    return $Default
}

function ConvertTo-XcInput {
    <#
    .SYNOPSIS
        Map candidate rows -> the classifier's frozen input, chunked into synthetic conflicts of BatchSize
        so each per-conflict batch stays within maxTokens. Pure; no AI, no I/O.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][object[]]$Candidates, [int]$BatchSize = 15)

    $conflicts = [System.Collections.Generic.List[object]]::new()
    $batch = [System.Collections.Generic.List[object]]::new()
    $n = 0
    foreach ($c in $Candidates) {
        $batch.Add([ordered]@{
                id = [string](Get-XcField $c 'pair_id')
                a  = [string](Get-XcField $c 'stance_text')
                b  = [string](Get-XcField $c 'cand_text')
            })
        if ($batch.Count -ge $BatchSize) {
            $conflicts.Add([ordered]@{ cid = "xc-batch-$n"; pairs = @($batch) })
            $batch = [System.Collections.Generic.List[object]]::new()
            $n++
        }
    }
    if ($batch.Count -gt 0) {
        $conflicts.Add([ordered]@{ cid = "xc-batch-$n"; pairs = @($batch) })
    }
    return @{ conflicts = @($conflicts) }
}

function Join-XcPredictions {
    <#
    .SYNOPSIS
        Join classifier results (keyed by pair id) back onto the candidate rows. A pair with no result
        -> predicted 'missing' (never dropped). Pure; no AI, no I/O.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][object[]]$Candidates,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Results
    )
    $map = @{}
    foreach ($r in $Results) {
        $id = [string](Get-XcField $r 'id')
        if (-not [string]::IsNullOrWhiteSpace($id)) { $map[$id] = $r }
    }
    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($c in $Candidates) {
        $pid2 = [string](Get-XcField $c 'pair_id')
        if ($map.ContainsKey($pid2)) {
            $r = $map[$pid2]
            $predicted = [string](Get-XcField $r 'label' 'unresolved')
            $confidence = [double](Get-XcField $r 'confidence' 0.0)
            $method = [string](Get-XcField $r 'method' 'unknown')
        }
        else {
            $predicted = 'missing'; $confidence = 0.0; $method = 'missing'
        }
        $out.Add([ordered]@{
                pair_id            = $pid2
                predicted          = $predicted
                confidence         = $confidence
                method             = $method
                stance_conflict_id = [string](Get-XcField $c 'stance_conflict_id')
                cand_conflict_id   = [string](Get-XcField $c 'cand_conflict_id')
                cosine             = (Get-XcField $c 'cosine')
            })
    }
    return @($out)
}

function Invoke-CCClassifier {
    # Run the classifier as a child pwsh process (full parent env — key inherited; NOT enrich's _safe_env).
    # Results come back via a FILE (-OutPath), not stdout (warnings would corrupt stdout JSON, t/3302).
    [CmdletBinding()]
    [OutputType([object[]])]
    param([Parameter(Mandatory)][string]$InputPath, [string]$Mode = 'per-conflict')

    $classifier = Join-Path $PSScriptRoot 'invoke-contradiction-classifier.ps1'
    if (-not (Test-Path -LiteralPath $classifier -PathType Leaf)) {
        throw (New-ActionableError -PassThru -ErrorType 'ClassifierMissing' `
                -Goal 'Classify cross-conflict candidate pairs' `
                -Problem "invoke-contradiction-classifier.ps1 not found next to this runner ('$classifier')" `
                -Location 'run-xconflict-classifier.ps1' `
                -NextSteps @('Run from a checkout that includes scripts/invoke-contradiction-classifier.ps1'))
    }
    $resultsFile = [System.IO.Path]::GetTempFileName()
    $exit = 0
    $text = ''
    try {
        $null = & pwsh -NoProfile -NonInteractive -File $classifier -InputPath $InputPath -Mode $Mode -OutPath $resultsFile
        $exit = $LASTEXITCODE
        if (Test-Path -LiteralPath $resultsFile) { $text = [string](Get-Content -LiteralPath $resultsFile -Raw) }
    }
    finally {
        Remove-Item -LiteralPath $resultsFile -Force -ErrorAction SilentlyContinue
    }
    if ($exit -ne 0 -or [string]::IsNullOrWhiteSpace($text)) {
        throw (New-ActionableError -PassThru -ErrorType 'ClassifierNoOutput' `
                -Goal 'Classify cross-conflict candidate pairs' `
                -Problem "the classifier wrote no results (exit $exit) — likely a missing API key or backend error" `
                -Location 'run-xconflict-classifier.ps1' `
                -NextSteps @('Set GEMINI_API_KEY (or Register-AIBackend) and retry', 'Check the classifier warnings above'))
    }
    $parsed = $null
    try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null }
    if ($null -eq $parsed -or -not $parsed.PSObject.Properties['results']) {
        $snip = $text.Substring(0, [Math]::Min(200, $text.Length))
        throw (New-ActionableError -PassThru -ErrorType 'ClassifierBadOutput' `
                -Goal 'Classify cross-conflict candidate pairs' `
                -Problem "the classifier output was not the expected { results: [...] } shape. First 200 chars: $snip" `
                -Location 'run-xconflict-classifier.ps1' `
                -NextSteps @('Inspect the results file content shown above'))
    }
    return @($parsed.results)
}

# ── main (skipped when dot-sourced for unit tests: $env:XC_RUNNER_NOEXEC) ──
if (-not $env:XC_RUNNER_NOEXEC) {
    $ErrorActionPreference = 'Stop'
    Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1') -Force -ErrorAction Stop

    if ([string]::IsNullOrWhiteSpace($CandidatesPath)) {
        $CandidatesPath = Join-Path $PSScriptRoot '..' 'research' 'comp-linguist' 'analyses' 'xconflict-pairing' 'candidates.json'
    }
    if (-not (Test-Path -LiteralPath $CandidatesPath -PathType Leaf)) {
        throw (New-ActionableError -PassThru -ErrorType 'CandidatesMissing' `
                -Goal 'Classify cross-conflict candidate pairs' `
                -Problem "candidates file not found: '$CandidatesPath'" `
                -Location 'run-xconflict-classifier.ps1' `
                -NextSteps @('Pass -CandidatesPath, or run from a checkout with research/comp-linguist/analyses/xconflict-pairing/candidates.json'))
    }
    if ([string]::IsNullOrWhiteSpace($OutPath)) { $OutPath = 'xconflict-predictions.json' }
    if (-not [System.IO.Path]::IsPathRooted($OutPath)) { $OutPath = Join-Path (Get-Location).Path $OutPath }

    $doc = Get-Content -LiteralPath $CandidatesPath -Raw | ConvertFrom-Json
    $cands = @(Get-XcField $doc 'candidates' @())
    if (@($cands).Count -eq 0) {
        throw (New-ActionableError -PassThru -ErrorType 'CandidatesEmpty' `
                -Goal 'Classify cross-conflict candidate pairs' `
                -Problem "no 'candidates' in '$CandidatesPath'" `
                -Location 'run-xconflict-classifier.ps1' `
                -NextSteps @('Confirm the file has a top-level candidates[] array'))
    }

    $ccInput = ConvertTo-XcInput -Candidates $cands -BatchSize $BatchSize
    Write-Host "Candidates: $(@($cands).Count) pairs -> $(@($ccInput.conflicts).Count) batch(es) of <=$BatchSize; mode=$Mode. Calling classifier (PAID)..." -ForegroundColor Cyan

    $tmpIn = [System.IO.Path]::GetTempFileName()
    try {
        $ccInput | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmpIn -Encoding utf8
        $results = Invoke-CCClassifier -InputPath $tmpIn -Mode $Mode
    }
    finally {
        Remove-Item -LiteralPath $tmpIn -Force -ErrorAction SilentlyContinue
    }

    $preds = Join-XcPredictions -Candidates $cands -Results $results
    $outDoc = [ordered]@{
        _meta       = [ordered]@{
            ticket         = 't/3339'
            purpose        = 'cross-conflict classify-before-merge predictions (CL builds the blind precision golden)'
            candidates     = $CandidatesPath
            classifier     = 'enrichment.contradiction-classify'
            mode           = $Mode
            batch_size     = $BatchSize
            n_predictions  = @($preds).Count
            note           = 'GUARDRAIL (t/3342 / t/3339#10): the classifier does NOT generalize cross-conflict (golden precision 0.571 / Wilson LB 0.391 @conf>=0.85 — the automated LB gate FAILED). These predictions are INPUT to CL''s census + PI dual-verification; only human-verified contradicts merge. Do NOT auto-merge cross-conflict on the contradict@>=0.90 / LB>=0.85 gate.'
        }
        predictions = @($preds)
    }
    $outDoc | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutPath -Encoding utf8

    $n = @($preds).Count
    $nContra = @($preds | Where-Object { $_.predicted -eq 'contradict' }).Count
    $nContra90 = @($preds | Where-Object { $_.predicted -eq 'contradict' -and [double]$_.confidence -ge 0.90 }).Count
    $nMissing = @($preds | Where-Object { $_.method -eq 'missing' }).Count
    Write-Host "Wrote $n predictions -> $OutPath  (contradict: $nContra; contradict@>=0.90: $nContra90; missing: $nMissing)" -ForegroundColor Green
    Write-Host "Next: hand $OutPath to CL (Computational Linguist) for the blind precision golden." -ForegroundColor Green
    if ($nMissing -gt 0) {
        Write-Warning "$nMissing pair(s) came back 'missing' (classifier didn't resolve them) — a re-run may recover them (t/3336 rate-limit pattern)."
    }
}
