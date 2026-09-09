# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — summary-corpus contradiction (design §8 i) + CORRELATION outputs (§9). Increment 6 (final).
.DESCRIPTION
    Closes the harness:

    (i) SUMMARY-CORPUS direction (design §8 i): compare each formalized debate-clause logical form against
        the EXISTING formalized POV summary corpus logical forms (the ones Invoke-LogicalFormPass attached),
        using the identical structural detector (Test-FolClausePair, fol-eval-contradict.ps1). This is CL's
        "link the assertoric claims back to the already-formalized summary corpus" — the summary FOL is the
        entailment/contradiction target, not re-formalized dialogue.

    §9 CORRELATION outputs (harness emits; CL analyzes): a per-debate, claim-level-provenance index that CL
        can JOIN to crux_addressed_rate / convergence_score (target ii) to test the prediction that FOL
        under-counts vs crux_addressed_rate because of paraphrase false-negatives. Target (iii) — the
        conflict/QBAF corpus (Main-PS's seam, 15 verified PAIRS, exclude status=demoted) — is optional and
        left as a follow-up (loop Main-PS for the field paths + demoted-excluding predicate).

    All functions here are PURE (no AI, no I/O). The runner does the read-only summary-corpus load and feeds
    parsed summaries in. Nothing anchors a conclusion until CL double-annotates (design §11/§12).
.LINK
    fol-eval-contradict.ps1
.LINK
    run-fol-debate-eval.ps1
#>

Set-StrictMode -Version Latest

function Get-SummaryClaimLogicalForms {
    <#
    .SYNOPSIS
        Extract the { source, camp, claim_ref, logical_form } entries from ONE parsed summary. Pure.
    .DESCRIPTION
        Walks pov_summaries.{accelerationist,safetyist,skeptic}.key_points[] (camp acc/saf/skp) and
        top-level factual_claims[] (camp 'factual'), yielding only claims that carry a non-empty
        logical_form. claim_ref is a stable "<source>|<camp>|<index>" provenance key.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)]$Summary,
        [Parameter(Mandatory)][string]$SourceId
    )
    Set-StrictMode -Version Latest
    $out = [System.Collections.Generic.List[object]]::new()
    $camps = @{ accelerationist = 'acc'; safetyist = 'saf'; skeptic = 'skp' }
    if ($Summary.PSObject.Properties['pov_summaries'] -and $Summary.pov_summaries) {
        foreach ($pov in @('accelerationist', 'safetyist', 'skeptic')) {
            if (-not $Summary.pov_summaries.PSObject.Properties[$pov]) { continue }
            $povData = $Summary.pov_summaries.$pov
            if (-not $povData -or -not $povData.PSObject.Properties['key_points'] -or -not $povData.key_points) { continue }
            $idx = -1
            foreach ($kp in @($povData.key_points)) {
                $idx++
                if ($kp.PSObject.Properties['logical_form'] -and $kp.logical_form) {
                    $out.Add([PSCustomObject]@{ source = $SourceId; camp = $camps[$pov]; claim_ref = "$SourceId|$($camps[$pov])|$idx"; logical_form = $kp.logical_form })
                }
            }
        }
    }
    if ($Summary.PSObject.Properties['factual_claims'] -and $Summary.factual_claims) {
        $idx = -1
        foreach ($fc in @($Summary.factual_claims)) {
            $idx++
            if ($fc.PSObject.Properties['logical_form'] -and $fc.logical_form) {
                $out.Add([PSCustomObject]@{ source = $SourceId; camp = 'factual'; claim_ref = "$SourceId|factual|$idx"; logical_form = $fc.logical_form })
            }
        }
    }
    return @($out)
}

function Find-SummaryCorpusContradictions {
    <#
    .SYNOPSIS
        Contradiction/agreement of each formalized debate clause vs the summary-corpus logical forms (§8 i). Pure.
    .DESCRIPTION
        Structural detector (Test-FolClausePair) over debate-clause × summary-claim pairs; emits the
        contradict + agree pairs (neutral omitted) with full provenance (debate clause id + summary claim_ref).
        Requires fol-eval-contradict.ps1 dot-sourced (Test-FolClausePair). Only formalized debate clauses
        (fol_status 'formalized') participate.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Formalized,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$SummaryLfs,
        [hashtable]$NormalizationMap = @{}
    )
    Set-StrictMode -Version Latest
    $out = [System.Collections.Generic.List[object]]::new()
    $debateLfs = @($Formalized | Where-Object { [string]$_.fol_status -eq 'formalized' -and $_.logical_form })
    foreach ($dc in $debateLfs) {
        foreach ($sc in $SummaryLfs) {
            $rel = Test-FolClausePair -LfA $dc.logical_form -LfB $sc.logical_form -NormalizationMap $NormalizationMap
            if ($rel -eq 'neutral') { continue }
            $out.Add([PSCustomObject]@{
                    debate_id      = [string]$dc.debate_id
                    debate_clause  = [string]$dc.id
                    turn_index     = $dc.turn_index
                    summary_source = [string]$sc.source
                    summary_camp   = [string]$sc.camp
                    summary_claim  = [string]$sc.claim_ref
                    relation       = $rel
                })
        }
    }
    return @($out)
}

function New-CorrelationIndex {
    <#
    .SYNOPSIS
        The §9 correlation-ready index: per-debate joinable counts CL joins to the convergence metrics. Pure.
    .DESCRIPTION
        For each debate present in the formalized set, emits the claim-level-provenance keys + FOL-signal
        counts (assertoric formalized, intra-debate cross-agent contradictions, summary-corpus contradictions).
        CL joins debate_id -> crux_addressed_rate / convergence_score (target ii) to test the FOL-under-counts
        prediction. The global paraphrase FN-rate summary is carried alongside so the normalization gap travels
        with the correlation data. Target (iii) conflict-corpus is a follow-up (not joined here).
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Formalized,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$IntraContradictions,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$SummaryContradictions,
        [Parameter(Mandatory)]$FnReport
    )
    Set-StrictMode -Version Latest

    $debates = @($Formalized | ForEach-Object { [string]$_.debate_id } | Sort-Object -Unique)
    $perDebate = [System.Collections.Generic.List[object]]::new()
    foreach ($d in $debates) {
        $formalizedN = @($Formalized | Where-Object { [string]$_.debate_id -eq $d -and [string]$_.fol_status -eq 'formalized' }).Count
        $intraN = @($IntraContradictions | Where-Object { [string]$_.debate_id -eq $d -and $_.relation -eq 'contradict' }).Count
        $summaryN = @($SummaryContradictions | Where-Object { [string]$_.debate_id -eq $d -and $_.relation -eq 'contradict' }).Count
        $perDebate.Add([PSCustomObject]@{
                debate_id                     = $d
                assertoric_formalized         = $formalizedN
                intra_debate_contradictions   = $intraN
                summary_corpus_contradictions = $summaryN
                join_key                      = "debate_id=$d -> crux_addressed_rate / convergence_score (CL, target ii)"
            })
    }

    return [PSCustomObject]@{
        _doc               = 'FOL-on-debate correlation index (t/3354 §9). Harness emits; CL joins debate_id -> crux_addressed_rate/convergence_score to test whether FOL contradictions under-count vs crux_addressed_rate (paraphrase FN gap). INSTRUMENT-PROVISIONAL — no number anchors a threshold until CL double-annotates (design §11/§12). Target (iii) conflict/QBAF corpus is a follow-up (loop Main-PS).'
        debates            = $debates.Count
        paraphrase_fn_rate = if ($null -ne $FnReport) { [PSCustomObject]@{ raw = $FnReport.raw_fn_rate; normalized = $FnReport.normalized_fn_rate; gap = $FnReport.normalization_gap; gold_pairs = $FnReport.gold_pairs } } else { $null }
        per_debate         = @($perDebate)
    }
}
