# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — score the clause classifier against CL's blind gold set (design §5). PURE.
.DESCRIPTION
    Joins the harness's classified-clauses.jsonl (predicted §3 labels, by clause id) with CL's blind gold
    (fol-eval-classifier-gold.jsonl: the same ids + CL's hand labels) and computes per-primary-type
    precision / recall / F1 + a gold×predicted confusion matrix + overall accuracy + per-attribute accuracy
    (attribution / anaphora_dependency / polarity). This is the instrument CL asked for (t/3354#28/#29) to
    lift classified-clauses out of INSTRUMENT-PROVISIONAL (§5, t/3342).

    GOLD IS AUTHORITATIVE: only clause ids present in the gold set are scored. A gold id absent from the
    classified output scores as predicted 'missing' (counts against that gold type's recall) — never dropped,
    so a starved/again-broken classifier can't inflate the score by silently shrinking the denominator.

    All functions are PURE (no AI, no I/O); the runner (score-fol-classifier-gold.ps1) reads the two JSONL
    files and feeds parsed rows in. Single-annotator gold spot-checks DIRECTION; κ/α is not established until
    CL's second annotation (§11), so no number here certifies precision on its own.
.LINK
    score-fol-classifier-gold.ps1
.LINK
    fol-eval-classify.ps1
#>

Set-StrictMode -Version Latest

$script:FOL_SCORE_TYPES = @('assertoric-factual', 'assertoric-causal', 'normative-deontic', 'speech-act-belief-revision-meta', 'rhetorical-evaluative')

function Join-FolGold {
    <#
    .SYNOPSIS
        Join classified predictions onto the gold rows by clause id. Pure. Gold is authoritative.
    .OUTPUTS
        [object[]] one row per gold item: { id, gold_type, pred_type, gold_attribution, pred_attribution,
        gold_anaphora, pred_anaphora, gold_polarity, pred_polarity, matched }. A gold id absent from
        Classified gets pred_type 'missing' (matched=$false).
    .PARAMETER Classified
        Parsed classified-clauses.jsonl rows (each with id + primary_type + attributes).
    .PARAMETER Gold
        Parsed gold rows (each with id + primary_type + optional attributes).
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Classified,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Gold
    )
    Set-StrictMode -Version Latest

    $predById = @{}
    foreach ($c in $Classified) {
        if ($c.PSObject.Properties['id'] -and $c.id) { $predById[[string]$c.id] = $c }
    }
    $get = { param($obj, $name) if ($obj -and $obj.PSObject.Properties[$name] -and $null -ne $obj.$name) { [string]$obj.$name } else { '' } }

    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($g in $Gold) {
        if (-not ($g.PSObject.Properties['id'] -and $g.id)) { continue }
        $id = [string]$g.id
        $pred = if ($predById.ContainsKey($id)) { $predById[$id] } else { $null }
        $predType = if ($null -ne $pred) { & $get $pred 'primary_type' } else { 'missing' }
        $goldType = & $get $g 'primary_type'
        $out.Add([PSCustomObject]@{
                id               = $id
                gold_type        = $goldType
                pred_type        = $predType
                gold_attribution = & $get $g 'attribution'
                pred_attribution = & $get $pred 'attribution'
                gold_anaphora    = & $get $g 'anaphora_dependency'
                pred_anaphora    = & $get $pred 'anaphora_dependency'
                gold_polarity    = & $get $g 'polarity'
                pred_polarity    = & $get $pred 'polarity'
                matched          = ($goldType -eq $predType)
            })
    }
    return @($out)
}

function Measure-FolClassifierScore {
    <#
    .SYNOPSIS
        Per-type precision/recall/F1 + confusion matrix + overall + per-attribute accuracy. Pure.
    .PARAMETER Joined
        Output of Join-FolGold.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Joined)
    Set-StrictMode -Version Latest

    $n = @($Joined).Count
    $correct = @($Joined | Where-Object { $_.matched }).Count

    $perType = [System.Collections.Generic.List[object]]::new()
    foreach ($t in $script:FOL_SCORE_TYPES) {
        $tp = @($Joined | Where-Object { $_.gold_type -eq $t -and $_.pred_type -eq $t }).Count
        $predT = @($Joined | Where-Object { $_.pred_type -eq $t }).Count
        $goldT = @($Joined | Where-Object { $_.gold_type -eq $t }).Count
        $precision = if ($predT -gt 0) { [Math]::Round($tp / [double]$predT, 4) } else { $null }   # null: never predicted
        $recall = if ($goldT -gt 0) { [Math]::Round($tp / [double]$goldT, 4) } else { $null }       # null: absent from gold
        $f1 = if ($null -ne $precision -and $null -ne $recall -and ($precision + $recall) -gt 0) {
            [Math]::Round((2 * $precision * $recall) / ($precision + $recall), 4)
        } else { $null }
        $perType.Add([PSCustomObject]@{
                primary_type = $t
                support      = $goldT
                tp           = $tp
                predicted    = $predT
                precision    = $precision
                recall       = $recall
                f1           = $f1
            })
    }

    # Confusion matrix: gold -> { pred -> count } (predicted may include 'missing' + any junk label).
    $confusion = [ordered]@{}
    foreach ($row in $Joined) {
        $gt = [string]$row.gold_type; $pt = [string]$row.pred_type
        if (-not $confusion.Contains($gt)) { $confusion[$gt] = [ordered]@{} }
        if (-not $confusion[$gt].Contains($pt)) { $confusion[$gt][$pt] = 0 }
        $confusion[$gt][$pt]++
    }

    # Per-attribute accuracy over rows where BOTH gold + pred carry the attribute.
    $attrAcc = [ordered]@{}
    foreach ($a in @(@{k = 'attribution'; g = 'gold_attribution'; p = 'pred_attribution' },
            @{k = 'anaphora_dependency'; g = 'gold_anaphora'; p = 'pred_anaphora' },
            @{k = 'polarity'; g = 'gold_polarity'; p = 'pred_polarity' })) {
        $scoreable = @($Joined | Where-Object { $_.($a.g) -ne '' -and $_.($a.p) -ne '' })
        $agree = @($scoreable | Where-Object { $_.($a.g) -eq $_.($a.p) }).Count
        $attrAcc[$a.k] = [PSCustomObject]@{
            scoreable = $scoreable.Count
            correct   = $agree
            accuracy  = if ($scoreable.Count -gt 0) { [Math]::Round($agree / [double]$scoreable.Count, 4) } else { $null }
        }
    }

    return [PSCustomObject]@{
        n                  = $n
        overall_accuracy   = if ($n -gt 0) { [Math]::Round($correct / [double]$n, 4) } else { 0.0 }
        per_type           = @($perType)
        confusion          = $confusion
        attribute_accuracy = $attrAcc
        provenance         = 'single-annotator gold spot-checks DIRECTION; kappa/alpha not established until CL double-annotation (design §11).'
    }
}
