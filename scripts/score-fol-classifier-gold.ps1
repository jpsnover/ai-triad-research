#Requires -Version 7
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Score the FOL-on-debate clause classifier against CL's blind gold set (design §5, t/3354). READ-ONLY IO.
.DESCRIPTION
    Reads a keyed run's classified-clauses.jsonl (predicted §3 labels) and CL's blind
    fol-eval-classifier-gold.jsonl (hand labels, same clause ids), joins by id, and reports per-primary-type
    precision / recall / F1 + a gold×predicted confusion matrix + overall + per-attribute accuracy
    (fol-eval-score.ps1, all pure). Emits a JSON report to -ReportPath. This is the CL-requested scorer that
    lifts classified-clauses out of INSTRUMENT-PROVISIONAL once the gold exists.

    Gold is authoritative: only ids present in the gold set are scored; a gold id absent from the classified
    output scores as predicted 'missing'. Single-annotator gold spot-checks DIRECTION; no number certifies
    precision until CL's second annotation (§11).

    Pure-IO glue only — the scoring transforms live in fol-eval-score.ps1 (dot-source unit-tested); this
    script just reads the two JSONL files, calls them, prints, and writes the report.
.PARAMETER ClassifiedPath
    Path to classified-clauses.jsonl from a keyed run's -OutputDir. Required.
.PARAMETER GoldPath
    Path to the blind gold JSONL. Default: scripts/fol-eval-classifier-gold.jsonl (CL's deliverable).
.PARAMETER ReportPath
    Where to write the JSON score report. Default: <ClassifiedPath dir>/classifier-score.json.
.EXAMPLE
    pwsh -File scripts/score-fol-classifier-gold.ps1 -ClassifiedPath ./fol-eval-run1/classified-clauses.jsonl
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ClassifiedPath,

    [Parameter()]
    [string]$GoldPath,

    [Parameter()]
    [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'fol-eval-score.ps1')

function Read-JsonLines {
    param([Parameter(Mandatory)][string]$Path)
    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $rows.Add(($line | ConvertFrom-Json))
    }
    return @($rows)
}

if (-not (Test-Path -LiteralPath $ClassifiedPath -PathType Leaf)) {
    throw "score-fol-classifier-gold: classified file not found: '$ClassifiedPath' — run the harness first (run-fol-debate-eval.ps1, keyed) to produce classified-clauses.jsonl."
}
if (-not $GoldPath) { $GoldPath = Join-Path $PSScriptRoot 'fol-eval-classifier-gold.jsonl' }
if (-not (Test-Path -LiteralPath $GoldPath -PathType Leaf)) {
    throw "score-fol-classifier-gold: gold file not found: '$GoldPath' — this is CL's blind §5 deliverable (label classified-clauses.jsonl clause ids by hand). Pass -GoldPath once it exists."
}
if (-not $ReportPath) { $ReportPath = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $ClassifiedPath)) 'classifier-score.json' }

$classified = Read-JsonLines -Path $ClassifiedPath
$gold = Read-JsonLines -Path $GoldPath

$joined = @(Join-FolGold -Classified $classified -Gold $gold)
$score = Measure-FolClassifierScore -Joined $joined

Write-Host ''
Write-Host "=== FOL clause-classifier score vs gold (design §5) ===" -ForegroundColor Cyan
Write-Host "  Gold items scored: $($score.n)  (classified rows: $(@($classified).Count))   Overall accuracy: $($score.overall_accuracy)" -ForegroundColor White
Write-Host '  Per primary_type:' -ForegroundColor White
Write-Host ("    {0,-32} {1,4} {2,7} {3,7} {4,7}" -f 'type', 'supp', 'prec', 'rec', 'f1') -ForegroundColor DarkGray
foreach ($t in $score.per_type) {
    Write-Host ("    {0,-32} {1,4} {2,7} {3,7} {4,7}" -f $t.primary_type, $t.support, ("$($t.precision)"), ("$($t.recall)"), ("$($t.f1)")) -ForegroundColor DarkGray
}
Write-Host '  Attribute accuracy:' -ForegroundColor White
foreach ($k in $score.attribute_accuracy.Keys) {
    $a = $score.attribute_accuracy[$k]
    Write-Host ("    {0,-22} {1}/{2} = {3}" -f $k, $a.correct, $a.scoreable, ("$($a.accuracy)")) -ForegroundColor DarkGray
}

$score | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding utf8
Write-Host "  Report -> $ReportPath" -ForegroundColor Green
Write-Host '  (Single-annotator gold spot-checks DIRECTION; no threshold until CL double-annotates, §11.)' -ForegroundColor DarkGray
Write-Host ''
return $score
