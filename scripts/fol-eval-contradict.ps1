# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — CONTRADICTION detection + the paraphrase FALSE-NEGATIVE RATE (design §8). Increment 5.
.DESCRIPTION
    The design's MAKE-OR-BREAK primary metric. Two things:

    1. A structural contradiction/agreement detector over neo-Davidsonian logical forms (pure): two
       clause logical forms stand in a relation on a SHARED predication when their (normalized) predicate
       matches and their participant sets overlap — 'contradict' when polarities differ, 'agree' when they
       match, else 'neutral'. Applied intra-debate cross-AGENT (different speakers) over the run's
       formalized clauses (design §8 direction ii — shared-predicate contradictions confirmed on real data).

    2. The paraphrase FALSE-NEGATIVE RATE (design §8, THE make-or-break metric). One underlying predicate
       surfaces in ≥5 forms ("protects them" / "pull up the drawbridge" / "corporate moats" / …). WITHOUT
       predicate+entity normalization, structural matching misses these (each has a different raw predicate)
       — real disagreements go undetected (false negatives). Measure-ParaphraseFnRate scores a labeled
       fixture WITH and WITHOUT the normalization pass so the normalization's value is ISOLATED (the gap).

    Everything here is PURE (no AI, no I/O) and dot-source unit-tested. The detector emits raw contradictions
    AND the labeled FN set; nothing anchors a conclusion until CL double-annotates (design §11, §12).
.LINK
    fol-eval-fol.ps1
.LINK
    run-fol-debate-eval.ps1
#>

Set-StrictMode -Version Latest

function Get-NormalizedPredicate {
    <#
    .SYNOPSIS
        Canonicalize a predicate: case-fold + apply the predicate normalization map. Pure.
    .DESCRIPTION
        The normalization map (from the FN fixture / a future synonym resource) maps a raw predicate to a
        canonical predicate; an unmapped predicate normalizes to its lowercased self. This is the single
        chokepoint the WITH/WITHOUT-normalization comparison toggles (pass an empty map for "without").
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowNull()][AllowEmptyString()][string]$Predicate,
        [hashtable]$NormalizationMap = @{}
    )
    Set-StrictMode -Version Latest
    if ([string]::IsNullOrWhiteSpace($Predicate)) { return '' }
    $p = $Predicate.Trim().ToLowerInvariant()
    if ($NormalizationMap.ContainsKey($p)) { return [string]$NormalizationMap[$p] }
    return $p
}

function Get-FolParticipantKeys {
    <#
    .SYNOPSIS
        The normalized participant set of a logical form: arg refs (lit: stripped) ∪ about refs, lowercased. Pure.
    .DESCRIPTION
        Debate-clause args are all lit:"surface phrase" (no entity_refs), so participants are surface
        tokens; about[] may carry ent ids. Used to require participant OVERLAP before calling two clauses
        the "same predication" — predicate match alone over-fires.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param([Parameter(Mandatory)]$LogicalForm)
    Set-StrictMode -Version Latest
    $keys = [System.Collections.Generic.HashSet[string]]::new()
    if ($LogicalForm.PSObject.Properties['args'] -and $LogicalForm.args) {
        foreach ($a in @($LogicalForm.args)) {
            if ($a.PSObject.Properties['ref'] -and $a.ref) {
                $ref = [string]$a.ref
                $ref = $ref -replace '^lit:', ''
                $ref = $ref.Trim().Trim('"').ToLowerInvariant()
                if (-not [string]::IsNullOrWhiteSpace($ref)) { [void]$keys.Add($ref) }
            }
        }
    }
    if ($LogicalForm.PSObject.Properties['about'] -and $LogicalForm.about) {
        foreach ($ab in @($LogicalForm.about)) {
            if ($ab.PSObject.Properties['ref'] -and $ab.ref) {
                $r = [string]$ab.ref
                $r = $r.Trim().Trim('"').ToLowerInvariant()
                if (-not [string]::IsNullOrWhiteSpace($r)) { [void]$keys.Add($r) }
            }
        }
    }
    return @($keys)
}

function Get-FolPolarity {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)]$LogicalForm)
    Set-StrictMode -Version Latest
    if ($LogicalForm.PSObject.Properties['polarity'] -and $LogicalForm.polarity) { return ([string]$LogicalForm.polarity).Trim().ToLowerInvariant() }
    return 'positive'
}

function Test-FolClausePair {
    <#
    .SYNOPSIS
        Relation between two clause logical forms on a shared predication (design §8). Pure.
    .OUTPUTS
        'contradict' | 'agree' | 'neutral'.
        contradict = same normalized predicate + overlapping participants + OPPOSITE polarity.
        agree      = same normalized predicate + overlapping participants + SAME polarity.
        neutral    = otherwise (different predicate, or disjoint participants).
    .DESCRIPTION
        Participant overlap is required unless BOTH forms are participant-less (a bare predication) — this
        keeps predicate-only coincidences from firing as contradictions. Normalization is applied to the
        predicate via -NormalizationMap; pass an empty map for the WITHOUT-normalization arm.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]$LfA,
        [Parameter(Mandatory)]$LfB,
        [hashtable]$NormalizationMap = @{}
    )
    Set-StrictMode -Version Latest
    $predA = Get-NormalizedPredicate -Predicate ([string]$LfA.predicate) -NormalizationMap $NormalizationMap
    $predB = Get-NormalizedPredicate -Predicate ([string]$LfB.predicate) -NormalizationMap $NormalizationMap
    if ([string]::IsNullOrWhiteSpace($predA) -or $predA -ne $predB) { return 'neutral' }

    $keysA = @(Get-FolParticipantKeys -LogicalForm $LfA)
    $keysB = @(Get-FolParticipantKeys -LogicalForm $LfB)
    $overlap = $false
    if ($keysA.Count -eq 0 -and $keysB.Count -eq 0) { $overlap = $true }       # bare predication vs bare predication
    else {
        foreach ($k in $keysA) { if ($keysB -contains $k) { $overlap = $true; break } }
    }
    if (-not $overlap) { return 'neutral' }

    if ((Get-FolPolarity -LogicalForm $LfA) -ne (Get-FolPolarity -LogicalForm $LfB)) { return 'contradict' }
    return 'agree'
}

function Find-IntraDebateContradictions {
    <#
    .SYNOPSIS
        Cross-AGENT contradiction/agreement pairs within each debate over the formalized clauses (§8 ii). Pure.
    .DESCRIPTION
        Considers only clauses with fol_status 'formalized' (a real logical_form). Pairs are within one
        debate and between DIFFERENT speakers (cross-agent — a debater agreeing with themselves is not the
        signal). SpeakerMap keys "<debate_id>|<turn_index>" -> speaker; a clause with no speaker mapping is
        treated as speaker '' and still compared (never silently dropped) — but same-'' pairs are excluded
        as not-provably-cross-agent. Returns the contradict + agree pairs (neutral omitted).
    .PARAMETER Formalized
        The formalized clauses (from ConvertTo-FolClauseFormalized).
    .PARAMETER SpeakerMap
        Hashtable "<debate_id>|<turn_index>" -> speaker.
    .PARAMETER NormalizationMap
        Predicate normalization map; empty = the WITHOUT-normalization arm.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Formalized,
        [Parameter(Mandatory)][hashtable]$SpeakerMap,
        [hashtable]$NormalizationMap = @{}
    )
    Set-StrictMode -Version Latest
    $out = [System.Collections.Generic.List[object]]::new()
    $withLf = @($Formalized | Where-Object { [string]$_.fol_status -eq 'formalized' -and $_.logical_form })

    # Group by debate.
    $byDebate = @{}
    foreach ($c in $withLf) {
        $d = [string]$c.debate_id
        if (-not $byDebate.ContainsKey($d)) { $byDebate[$d] = [System.Collections.Generic.List[object]]::new() }
        $byDebate[$d].Add($c)
    }

    foreach ($d in $byDebate.Keys) {
        $clauses = @($byDebate[$d])
        for ($i = 0; $i -lt $clauses.Count; $i++) {
            for ($j = $i + 1; $j -lt $clauses.Count; $j++) {
                $a = $clauses[$i]; $b = $clauses[$j]
                $spkA = if ($SpeakerMap.ContainsKey("$d|$($a.turn_index)")) { [string]$SpeakerMap["$d|$($a.turn_index)"] } else { '' }
                $spkB = if ($SpeakerMap.ContainsKey("$d|$($b.turn_index)")) { [string]$SpeakerMap["$d|$($b.turn_index)"] } else { '' }
                # cross-agent only: distinct, non-empty speakers.
                if ($spkA -eq '' -or $spkB -eq '' -or $spkA -eq $spkB) { continue }
                $rel = Test-FolClausePair -LfA $a.logical_form -LfB $b.logical_form -NormalizationMap $NormalizationMap
                if ($rel -eq 'neutral') { continue }
                $out.Add([PSCustomObject]@{
                        debate_id   = $d
                        id_a        = [string]$a.id
                        id_b        = [string]$b.id
                        speaker_a   = $spkA
                        speaker_b   = $spkB
                        predicate_a = [string]$a.logical_form.predicate
                        predicate_b = [string]$b.logical_form.predicate
                        relation    = $rel
                    })
            }
        }
    }
    return @($out)
}

function Measure-ParaphraseFnRate {
    <#
    .SYNOPSIS
        The make-or-break metric (design §8): paraphrase false-negative rate WITH vs WITHOUT normalization. Pure.
    .DESCRIPTION
        For each fixture case, every surface form shares ONE canonical predicate (gold: all pairs SHOULD
        match). A pair "matches" when the two forms' normalized raw_predicate are equal. WITHOUT normalization
        uses an empty map (raw predicates differ -> misses -> false negatives); WITH normalization applies the
        case's normalization_map (all -> canonical -> matches). The FN-rate is missed-gold-pairs / gold-pairs;
        the WITHOUT−WITH gap isolates the normalization's value.
    .PARAMETER Fixture
        Parsed fixture: { cases: [ { canonical_predicate, surface_forms:[{text, raw_predicate}], normalization_map } ] }.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([Parameter(Mandatory)]$Fixture)
    Set-StrictMode -Version Latest

    $cases = @()
    if ($Fixture.PSObject.Properties['cases'] -and $Fixture.cases) { $cases = @($Fixture.cases) }

    $perCase = [System.Collections.Generic.List[object]]::new()
    $totalPairs = 0; $rawMissed = 0; $normMissed = 0

    foreach ($case in $cases) {
        $forms = @($case.surface_forms)
        # Build the case normalization map (PSCustomObject from JSON -> hashtable).
        $map = @{}
        if ($case.PSObject.Properties['normalization_map'] -and $case.normalization_map) {
            foreach ($p in $case.normalization_map.PSObject.Properties) { $map[$p.Name.ToLowerInvariant()] = [string]$p.Value }
        }
        $casePairs = 0; $caseRawMissed = 0; $caseNormMissed = 0
        for ($i = 0; $i -lt $forms.Count; $i++) {
            for ($j = $i + 1; $j -lt $forms.Count; $j++) {
                $casePairs++
                $rawA = Get-NormalizedPredicate -Predicate ([string]$forms[$i].raw_predicate) -NormalizationMap @{}
                $rawB = Get-NormalizedPredicate -Predicate ([string]$forms[$j].raw_predicate) -NormalizationMap @{}
                if ($rawA -ne $rawB) { $caseRawMissed++ }    # gold says match; raw missed it -> false negative
                $nA = Get-NormalizedPredicate -Predicate ([string]$forms[$i].raw_predicate) -NormalizationMap $map
                $nB = Get-NormalizedPredicate -Predicate ([string]$forms[$j].raw_predicate) -NormalizationMap $map
                if ($nA -ne $nB) { $caseNormMissed++ }
            }
        }
        $perCase.Add([PSCustomObject]@{
                canonical_predicate = [string]$case.canonical_predicate
                surface_form_count  = $forms.Count
                gold_pairs          = $casePairs
                raw_missed          = $caseRawMissed
                normalized_missed   = $caseNormMissed
                raw_fn_rate         = if ($casePairs -gt 0) { [Math]::Round($caseRawMissed / [double]$casePairs, 4) } else { 0.0 }
                normalized_fn_rate  = if ($casePairs -gt 0) { [Math]::Round($caseNormMissed / [double]$casePairs, 4) } else { 0.0 }
            })
        $totalPairs += $casePairs; $rawMissed += $caseRawMissed; $normMissed += $caseNormMissed
    }

    $rawRate = if ($totalPairs -gt 0) { [Math]::Round($rawMissed / [double]$totalPairs, 4) } else { 0.0 }
    $normRate = if ($totalPairs -gt 0) { [Math]::Round($normMissed / [double]$totalPairs, 4) } else { 0.0 }
    return [PSCustomObject]@{
        cases                 = $cases.Count
        gold_pairs            = $totalPairs
        raw_fn_rate           = $rawRate
        normalized_fn_rate    = $normRate
        normalization_gap     = [Math]::Round($rawRate - $normRate, 4)
        per_case              = @($perCase)
    }
}
