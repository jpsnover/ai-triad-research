#Requires -Version 7
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# Fork-B validation runner (t/3302) — the ONE paid command for the semantic-opposition gate.
#
# Reads CL's frozen blind golden (semantic-opposition-golden.json, 122 pairs), runs each within-conflict
# assertion pair through the contradiction classifier (invoke-contradiction-classifier.ps1, per-conflict
# batch + per-pair fallback), and writes a PREDICTIONS file that CL scores against the golden labels/splits
# (precision on REP held_out, recall on all held_out contradicts, P/R curve). This script produces
# predictions ONLY — it does NOT compute the gate metrics (CL owns scoring, to keep the grader independent
# of the code under test). A pair is never dropped: a missing/unresolved classifier verdict → predicted
# 'unresolved' (= no edge), so precision/recall denominators stay honest.
#
# PAID: the classifier calls the AI backend (Invoke-AIByUsage). Set GEMINI_API_KEY (or register a backend)
# before running. Bounded to the golden's 122 pairs (~ one batch per conflict + per-pair fallbacks).
#
#   pwsh -File scripts/run-semantic-golden-classifier.ps1 -OutPath predictions.json
#
# Pure transforms (ConvertTo-CCInput / Join-CCPredictions) are dot-source unit-tested with
# $env:SEMGOLD_RUNNER_NOEXEC set (no AI, no subprocess).
[CmdletBinding()]
param(
    # Non-mandatory so the file can be dot-sourced for unit tests (a Mandatory param blocks dot-source).
    [string]$GoldenPath = '',
    [string]$OutPath = '',
    [ValidateSet('per-conflict', 'per-pair')][string]$Mode = 'per-conflict'
)

Set-StrictMode -Version Latest

function Get-GoldenPairField {
    # StrictMode-safe read of a property that may be absent on a ConvertFrom-Json object.
    param([object]$Obj, [string]$Name, $Default = $null)
    if ($Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
    return $Default
}

function ConvertTo-CCInput {
    <#
    .SYNOPSIS
        Map golden pairs -> the classifier's frozen input contract, grouped by conflict for batch mode:
        { conflicts: [ { cid, pairs: [ { id, a, b } ] } ] }.  Pure; no AI, no I/O.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][object[]]$Pairs)

    $byConflict = [ordered]@{}
    foreach ($p in $Pairs) {
        $cid = [string](Get-GoldenPairField $p 'conflict_id' 'unknown-conflict')
        if (-not $byConflict.Contains($cid)) {
            $byConflict[$cid] = [System.Collections.Generic.List[object]]::new()
        }
        $byConflict[$cid].Add([ordered]@{
                id = [string](Get-GoldenPairField $p 'pair_id')
                a  = [string](Get-GoldenPairField $p 'assertion_a')
                b  = [string](Get-GoldenPairField $p 'assertion_b')
            })
    }

    $conflicts = [System.Collections.Generic.List[object]]::new()
    foreach ($cid in $byConflict.Keys) {
        $conflicts.Add([ordered]@{ cid = $cid; pairs = @($byConflict[$cid]) })
    }
    return @{ conflicts = @($conflicts) }
}

function Join-CCPredictions {
    <#
    .SYNOPSIS
        Join classifier results (keyed by pair id) back onto the golden pairs, carrying the gold label,
        pool, and split so CL's scorer has everything in one file. A pair with no result -> predicted
        'unresolved' / method 'missing' (never silently dropped). Pure; no AI, no I/O.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][object[]]$Pairs,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Results
    )

    $map = @{}
    foreach ($r in $Results) {
        $id = [string](Get-GoldenPairField $r 'id')
        if (-not [string]::IsNullOrWhiteSpace($id)) { $map[$id] = $r }
    }

    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($p in $Pairs) {
        $pid2 = [string](Get-GoldenPairField $p 'pair_id')   # $pid is a read-only automatic variable
        if ($map.ContainsKey($pid2)) {
            $r = $map[$pid2]
            $predicted = [string](Get-GoldenPairField $r 'label' 'unresolved')
            $confidence = [double](Get-GoldenPairField $r 'confidence' 0.0)
            $method = [string](Get-GoldenPairField $r 'method' 'unknown')
        }
        else {
            $predicted = 'unresolved'
            $confidence = 0.0
            $method = 'missing'
        }
        $out.Add([ordered]@{
                pair_id        = $pid2
                conflict_id    = [string](Get-GoldenPairField $p 'conflict_id')
                gold_label     = [string](Get-GoldenPairField $p 'label')
                predicted      = $predicted
                confidence     = $confidence
                method         = $method
                pool           = [string](Get-GoldenPairField $p 'pool')
                split          = [string](Get-GoldenPairField $p 'split')
                stratum        = [string](Get-GoldenPairField $p 'stratum')
                precision_trap = [bool](Get-GoldenPairField $p 'precision_trap' $false)
            })
    }
    return @($out)
}

function Invoke-CCClassifier {
    # Run the classifier as a child pwsh process (it imports the module + calls the AI backend in its main).
    # Returns the parsed results array. Isolated so the paid boundary is a single call site.
    [CmdletBinding()]
    [OutputType([object[]])]
    param([Parameter(Mandatory)][string]$InputPath, [string]$Mode = 'per-conflict')

    $classifier = Join-Path $PSScriptRoot 'invoke-contradiction-classifier.ps1'
    if (-not (Test-Path -LiteralPath $classifier -PathType Leaf)) {
        throw (New-ActionableError -PassThru -ErrorType 'ClassifierMissing' `
                -Goal 'Run the semantic-opposition golden through the contradiction classifier' `
                -Problem "invoke-contradiction-classifier.ps1 not found next to this runner ('$classifier')" `
                -Location 'run-semantic-golden-classifier.ps1' `
                -NextSteps @('Run from the fork-B branch (feat/qbaf-semantic-classifier-t3302), where the classifier lives'))
    }
    # Read results from a FILE, not stdout: the classifier's Write-Warning fallback notices render onto
    # captured stdout ahead of the JSON and break ConvertFrom-Json (t/3302 live-run failure). Warnings
    # flow to the console (operator sees progress); the data channel is the file.
    $resultsFile = [System.IO.Path]::GetTempFileName()
    $exit = 0
    $text = ''
    try {
        # Discard the child's success-stream output ($null =): warnings/host lines would otherwise
        # pollute this function's output. The data is read from $resultsFile below.
        $null = & pwsh -NoProfile -NonInteractive -File $classifier -InputPath $InputPath -Mode $Mode -OutPath $resultsFile
        $exit = $LASTEXITCODE
        if (Test-Path -LiteralPath $resultsFile) { $text = [string](Get-Content -LiteralPath $resultsFile -Raw) }
    }
    finally {
        Remove-Item -LiteralPath $resultsFile -Force -ErrorAction SilentlyContinue
    }

    if ($exit -ne 0 -or [string]::IsNullOrWhiteSpace($text)) {
        throw (New-ActionableError -PassThru -ErrorType 'ClassifierNoOutput' `
                -Goal 'Run the semantic-opposition golden through the contradiction classifier' `
                -Problem "the classifier wrote no results (exit $exit) — likely a missing API key or backend error" `
                -Location 'run-semantic-golden-classifier.ps1' `
                -NextSteps @('Set GEMINI_API_KEY (or Register-AIBackend) and retry', 'Check the classifier warnings above for the AI error'))
    }

    $parsed = $null
    try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null }
    if ($null -eq $parsed -or -not $parsed.PSObject.Properties['results']) {
        $snip = $text.Substring(0, [Math]::Min(200, $text.Length))
        throw (New-ActionableError -PassThru -ErrorType 'ClassifierBadOutput' `
                -Goal 'Run the semantic-opposition golden through the contradiction classifier' `
                -Problem "the classifier output was not the expected { results: [...] } shape. First 200 chars: $snip" `
                -Location 'run-semantic-golden-classifier.ps1' `
                -NextSteps @('Inspect the results file content shown above'))
    }
    return @($parsed.results)
}

# ── main (skipped when dot-sourced for unit tests: $env:SEMGOLD_RUNNER_NOEXEC) ──
if (-not $env:SEMGOLD_RUNNER_NOEXEC) {
    $ErrorActionPreference = 'Stop'
    Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1') -Force -ErrorAction Stop

    if ([string]::IsNullOrWhiteSpace($GoldenPath)) {
        $GoldenPath = Join-Path $PSScriptRoot '..' 'research' 'comp-linguist' 'analyses' 'semantic-opposition-golden' 'semantic-opposition-golden.json'
    }
    if (-not (Test-Path -LiteralPath $GoldenPath -PathType Leaf)) {
        throw (New-ActionableError -PassThru -ErrorType 'GoldenMissing' `
                -Goal 'Score the contradiction classifier against the frozen golden' `
                -Problem "golden not found: '$GoldenPath'" `
                -Location 'run-semantic-golden-classifier.ps1' `
                -NextSteps @('Pass -GoldenPath, or run from a checkout that includes research/comp-linguist/analyses/semantic-opposition-golden/'))
    }
    if ([string]::IsNullOrWhiteSpace($OutPath)) { $OutPath = 'semantic-golden-predictions.json' }
    # Anchor a relative -OutPath to the caller's location explicitly. A bare relative literal path can be
    # resolved against the .NET process cwd (which diverges from Get-Location after a `cd`), landing the
    # file somewhere surprising — a live run wrote the results out of sight this way (t/3302).
    if (-not [System.IO.Path]::IsPathRooted($OutPath)) { $OutPath = Join-Path (Get-Location).Path $OutPath }

    $golden = Get-Content -LiteralPath $GoldenPath -Raw | ConvertFrom-Json
    $pairs = @(Get-GoldenPairField $golden 'pairs' @())
    if (@($pairs).Count -eq 0) {
        throw (New-ActionableError -PassThru -ErrorType 'GoldenEmpty' `
                -Goal 'Score the contradiction classifier against the frozen golden' `
                -Problem "the golden at '$GoldenPath' has no 'pairs'" `
                -Location 'run-semantic-golden-classifier.ps1' `
                -NextSteps @('Confirm the golden JSON has a top-level pairs[] array'))
    }

    Write-Host "Golden: $(@($pairs).Count) pairs from $GoldenPath" -ForegroundColor Cyan
    $ccInput = ConvertTo-CCInput -Pairs $pairs
    Write-Host "Grouped into $(@($ccInput.conflicts).Count) conflict batch(es); mode=$Mode. Calling classifier (PAID)..." -ForegroundColor Cyan

    $tmpIn = [System.IO.Path]::GetTempFileName()
    try {
        $ccInput | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmpIn -Encoding utf8
        $results = Invoke-CCClassifier -InputPath $tmpIn -Mode $Mode
    }
    finally {
        Remove-Item -LiteralPath $tmpIn -Force -ErrorAction SilentlyContinue
    }

    $predictions = Join-CCPredictions -Pairs $pairs -Results $results

    $doc = [ordered]@{
        _meta       = [ordered]@{
            ticket      = 't/3302'
            purpose     = 'Fork-B semantic-opposition classifier predictions (hand to CL to score)'
            golden_path = $GoldenPath
            mode        = $Mode
            n_pairs     = @($pairs).Count
            note        = 'Predictions only. CL scores precision (REP held_out) / recall (all held_out contradicts) + P/R curve vs the gold labels.'
        }
        predictions = @($predictions)
    }
    $doc | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutPath -Encoding utf8

    $n = @($predictions).Count
    $nContradict = @($predictions | Where-Object { $_.predicted -eq 'contradict' }).Count
    $nMissing = @($predictions | Where-Object { $_.method -eq 'missing' }).Count
    Write-Host "Wrote $n predictions -> $OutPath  (predicted contradict: $nContradict; missing: $nMissing)" -ForegroundColor Green
    Write-Host "Next: hand $OutPath to CL (Main (Comp Linguist)) to score against the golden's blind labels/splits." -ForegroundColor Green
}
